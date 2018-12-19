// ivolatility-client.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
 *
 *  Redistribution and use in source and binary forms, with or without
 *  modification, are permitted provided that the following conditions are met:
 *
 *  1. Redistributions of source code must retain the above copyright notice,
 *  this list of conditions and the following disclaimer.
 *
 *  2. Redistributions in binary form must reproduce the above copyright
 *  notice, this list of conditions and the following disclaimer in the
 *  documentation and/or other materials provided with the distribution.
 *
 *  3. Neither the name of the copyright holder nor the names of its
 *  contributors may be used to endorse or promote products derived from this
 *  software without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */

const fs = require('graceful-fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const http = require('http');
const https = require('https');
const child_process = require('child_process');
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const yauzl = require('yauzl');
const logger = require('./logger.js');
const interrupt = require('./interrupt.js');
const awriter = require('./atomic-write.js');
const cache = require('./memoize-cache.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

module.exports = function(cacheDir, downloadDir, username, passwordFile, downloadType) {
    var store = storage(cacheDir);
    var checkForUpdatesFn = checkForUpdates.bind(this, cacheDir, downloadDir, username, passwordFile, downloadType);
    var checkTormorrow;
    var another_six_hours = 6 * 60 * 1000;
    var processEveryDay = () => {
        return processing = checkForUpdatesFn().then(() => {
            store.flush();
            checkTormorrow = setTimeout(() => {
                processing.then(processEveryDay);
            }, another_six_hours);
            checkTormorrow.unref();
        });
    };
    var processing = processEveryDay();
    return {
        listAvailableDownloads(dType) {
            var password = passwordFile && fs.readFileSync(passwordFile, 'utf8').trim();
            return listAvailableDownloads(username, password, dType || downloadType);
        },
        downloadUpdates(dType) {
            return downloadUpdates(downloadDir, username, passwordFile, dType || downloadType);
        },
        processNewFiles() {
            return processing.then(() => processNewFiles(cacheDir, downloadDir));
        },
        close() {
            return processing.then(() => {
                if (checkTormorrow) clearTimeout(checkTormorrow);
            }).then(() => store.close());
        },
        interday(options) {
            expect(options).to.have.property('iv_symbol');
            var symbol = options.iv_symbol;
            expect(symbol).to.be.like(/^(\w+)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
            var m = symbol.match(/^(\w+)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
            var [, underlying, yy, month, day] = m;
            var cc = +yy<50 ? 2000 : 1900;
            var year = cc + +yy;
            var expiry_date = `${year}-${month}-${day}`;
            return processing.then(() => store.open(underlying, (err, db) => {
                if (err) throw err;
                return db.collection(expiry_date).then(collection => {
                    if (!collection.exists(symbol))
                        throw Error(`Unknown options symbol ${collection.filenameOf(symbol)}`);
                    else return collection.readFrom(symbol);
                });
            }));
        }
    };
};

function checkForUpdates(cacheDir, downloadDir, username, passwordFile, downloadType) {
    return Promise.resolve(username ? downloadUpdates(downloadDir, username, passwordFile, downloadType) : null)
      .then(() => Promise.resolve(downloadDir ? processNewFiles(cacheDir, downloadDir) : null))
      .catch(err => logger.error("Could not process updates from ivolatility.com", err));
}

function processNewFiles(cacheDir, downloadDir) {
    var sink = createDataSinkStore(cacheDir);
    var close = () => sink.close();
    return readMetadata(downloadDir).then(metadata => {
        return listNewFiles(downloadDir, metadata).then(files => files.reduce((wait, file) => wait.then(() => {
            var filename = path.resolve(downloadDir, file);
            return explodeZip(filename, (stats, datum) => {
                sink(datum);
                if (!~stats.symbols.indexOf(datum.symbol)) {
                    stats.symbols.push(datum.symbol);
                }
                if (!~stats.exchanges.indexOf(datum.exchange)) {
                    stats.exchanges.push(datum.exchange);
                }
                if (!~stats.expirations.indexOf(datum.expiration)) {
                    stats.expirations.push(datum.expiration);
                }
                return stats;
            }, {file, symbols:[], exchanges:[], expirations:[]}).then(stats => {
                var idx = metadata.entries.findIndex(entry => entry.file == file);
                if (idx<0) metadata.entries.push(stats);
                else metadata.entries[idx] = stats;
                return stats;
            });
        }), Promise.resolve())).then(result => {
            return writeMetadata(downloadDir, metadata).then(() => result);
        });
    }).then(result => close().then(() => result), err => close().then(() => Promise.reject(err))).then(result => {
        if (result) logger.info("Finished processing new ivolatility.com files");
    });
}

function createDataSinkStore(cacheDir) {
    var every_five_minutes = 5 * 60 * 1000;
    var cleanup, error, abort;
    var total = 0, count = 0;
    var queue = {};
    var helpers = {};
    var check = interrupt();
    var logProgress = _.noop;
    var keyOf = datum => datum.expiration.substring(0, 2);
    var fork = key => {
        var forked = child_process.fork(module.filename, [cacheDir]);
        forked.on('message', msg => {
            if (msg && msg.cmd == 'ready' && queue[key].length) {
                var payload = queue[key].splice(0, Math.min(queue[key].length, 100));
                forked.send({cmd: 'store', payload});
                count+= payload.length;
                logProgress(count/total);
            } else if (msg && msg.cmd == 'ready') {
                _.defer(() => {
                    if (queue[key].length) {
                        var payload = queue[key].splice(0, Math.min(queue[key].length, 100));
                        forked.send({cmd: 'store', payload});
                        count+= payload.length;
                        logProgress(count/total);
                    } else {
                        forked.send({cmd:'close'});
                    }
                });
            } else if (msg && msg.cmd == 'error') {
                abort = true;
                error = Error(msg.message);
            }
        }).on('disconnect', () => {
            delete helpers[key];
            if (cleanup) cleanup();
            else if (queue[key].length) helpers[key] = fork(key);
        });
        return forked;
    };
    return _.extend(datum => {
        check();
        total++;
        var key = keyOf(datum);
        if (!queue[key]) queue[key] = [];
        queue[key].push(datum);
        try {
            if (error) throw error;
        } finally {
            if (error) error = null;
        }
        if (!abort && !helpers[key] && !cleanup) helpers[key] = fork(key);
        return datum;
    }, {
        close() {
            return new Promise((ready, fail) => {
                logProgress = _.throttle(progress => {
                    logger.log("Processing ivolatility.com files", Math.round(progress*100), "% complete");
                }, every_five_minutes);
                cleanup = () => {
                    if (_.isEmpty(helpers) && _.isEmpty(_.flatten(_.values(queue)))) {
                        ready();
                    } else if (error) {
                        _.values(helpers).forEach(helper => helper.disconnect());
                        fail(error);
                    } else if (abort && _.isEmpty(helpers)) {
                        ready();
                    }
                };
                cleanup();
            });
        }
    });
}


if (require.main === module && process.send) {
    var cacheDir = process.argv[2];
    var sink = createInlineDataSinkStore(cacheDir);
    var ready = () => {
        process.send({cmd:'ready'});
    };
    process.on('message', msg => {
        if (msg && msg.cmd == 'store') {
            Promise.all(msg.payload.map(sink)).then(ready).catch(err => {
                process.send({cmd:'error', message: err.stack || err.message || err});
            });
        } else if (msg && msg.cmd == 'close') {
            sink.close().then(() => {
                process.disconnect();
            });
        }
    }).on('disconnect', () => sink.close());
    ready();
}

function createInlineDataSinkStore(cacheDir) {
    var check = interrupt();
    var store = storage(cacheDir);
    var lookup = cache(datum => {
        var date = mdy2ymd(datum.expiration);
        var optsym = datum.symbol + datum['option symbol'].replace(/^.*\s+/,'');
        var dbname = datum.symbol;
        return store.open(dbname, (err, db) => {
            if (err) throw err;
            return db.collection(date).then(collection => {
                if (!collection.exists(optsym)) return [];
                else return collection.readFrom(optsym);
            });
        }).then(array => ({
            add(datum) {
                var idx = _.sortedIndex(array, datum, datum => mdy2ymd(datum.date));
                if (array[idx] && array[idx].date == datum.date) {
                    array[idx] = datum;
                } else {
                    array.splice(idx, 0, datum);
                }
                return Promise.resolve(datum);
            },
            close() {
                return store.open(dbname, (err, db) => {
                    if (err) throw err;
                    return db.collection(date).then(collection => {
                        return collection.writeTo(array, optsym);
                    });
                });
            }
        }));
    }, datum => datum.symbol + datum.expiration + datum['option symbol'], 1000);
    return _.extend(datum => {
        check();
        return lookup(datum).then(data => data.add(datum));
    }, {
        close() {
            return lookup.close().then(() => store.close());
        }
    });
}

function mdy2ymd(mdy) {
    return mdy.replace(/(\d\d)\/(\d\d)\/(\d\d\d\d)/, '$3-$1-$2');
}

function explodeZip(file, reduce, initial) {
    var check = interrupt();
    var result = initial;
    logger.info("Extracting", file);
    return new Promise((ready, error) => {
        var entries = [];
        yauzl.open(file, {lazyEntries: true}, (err, zipfile) => {
            if (err) return error(err);
            zipfile.readEntry();
            zipfile.on('close', () => ready(Promise.all(entries)));
            zipfile.on('entry', function(entry) {
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) return error(err);
                    entries.push(new Promise((ready, error) => {
                        csv.fromStream(readStream, {headers : true, ignoreEmpty: true})
                            .on('error', error)
                            .on('data', function(data) {
                                try {
                                    check();
                                    var obj = _.mapObject(data, value => _.isFinite(value) ? +value : value);
                                    result = reduce(initial, obj);
                                } catch (e) {
                                    this.emit('error', e);
                                }
                        }).on('end', () => ready(result));
                    }).then(result => zipfile.readEntry(), err => {
                        zipfile.close();
                        return Promise.reject(err);
                    }));
                });
            });
        });
    }).then(() => result);
}

function listNewFiles(downloadDir, metadata) {
    return listZipFiles(downloadDir)
      .then(files => Promise.all(files.map(file => mtime(path.resolve(downloadDir, file))
      .then(mtime => {
        var entry = metadata.entries.find(entry => entry.file == file);
        if (!entry) return file;
        else return null;
    }))).then(updated => _.compact(updated)));
}

function listZipFiles(downloadDir) {
    return new Promise((present, absent) => {
        fs.access(downloadDir, fs.R_OK, err => err ? absent(err) : present(downloadDir));
    }).then(present => new Promise((ready, error) => {
        fs.readdir(downloadDir, (err, files) => err ? error(err) : ready(files));
    }), absent => {
        if (absent.code != 'ENOENT') logger.error("Could not read", downloadDir, absent);
        else return [];
    }).then(files => files.filter(file => file.endsWith('.zip') || file.endsWith('.ZIP')));
}

function readMetadata(dirname) {
    var filename = path.resolve(dirname, 'index.json');
    return new Promise((present, absent) => {
        fs.access(filename, fs.R_OK, err => err ? absent(err) : present(dirname));
    }).then(present => new Promise((ready, error) => {
        fs.stat(filename, (err, stats) => err ? error(err) : ready(stats));
    })).then(stats => {
        return new Promise((ready, error) => {
            fs.readFile(filename, 'utf-8', (err, data) => {
                if (err) error(err);
                else ready(data);
            });
        }).then(JSON.parse).then(metadata => _.extend(metadata, {mtime: stats.mtime}));
    }, absent => {
        if (absent.code != 'ENOENT') logger.error("Could not read", filename, absent);
        else return {};
    }).then(metadata => {
        if (!_.isArray(metadata.entries))
            metadata.entries = [];
        return metadata;
    }).catch(error => logger.error("Could not read", dirname, error.message) || {tables:[]});
}

function writeMetadata(dirname, metadata) {
    var filename = path.resolve(dirname, 'index.json');
    return awriter(filename => {
        return new Promise((ready, error) => {
            fs.writeFile(filename, JSON.stringify(metadata, null, ' '), err => {
                if (err) error(err);
                else ready();
            });
        });
    }, filename);
}

function mtime(filename) {
    return new Promise((ready, error) => {
        fs.stat(filename, (err, stats) => err ? error(err) : ready(stats));
    }).then(stats => stats.mtime);
}

function downloadUpdates(downloadDir, username, passwordFile, downloadType) {
    var password = fs.readFileSync(passwordFile, 'utf8').trim();
    return readMetadata(downloadDir).then(metadata => {
        return listAvailableDownloads(username, password, downloadType, metadata.mtime)
          .then(fileUrls => absentFileUrls(downloadDir, fileUrls))
          .then(fileUrls => downloadFiles(downloadDir, fileUrls));
    });
}

function listAvailableDownloads(username, password, downloadType, mtime) {
    var point = moment(mtime);
    var fileUid = 'https://www.ivolatility.com/loadCSV?fileUid=';
    var order_id = 'http://www.ivolatility.com/data_download.csv?order_id=';
    var order_uid = '&order_uid=';
    var host = url.parse('http://www.ivolatility.com/dd-server/history');
    return retrieveCookies(username, password).then(cookies => {
        var userIdCookie = cookies.find(cookie => cookie.startsWith("IV%5FUID="));
        var userId = userIdCookie.substring(userIdCookie.indexOf('=')+1);
        var payload = querystring.stringify({
            pageSize: 10,
            userId: userId,
            limit: 10,
            downloadType: downloadType || 'DAILY_ONLY',
            page: 1,
            start: 0
        });
        logger.debug("Checking for new ivolatility.com downloads using ID", userId, username);
        return new Promise((ready, error) => {
            var req = http.request(_.extend({method: 'POST', headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload),
                Cookie: cookies.join('; ')
            }}, host), res => {
                var buffer = [];
                res.setEncoding('utf8');
                res.on('data', chunk => {if (chunk) buffer.push(chunk)});
                res.on('error', error).on('end', () => {
                    try {
                        ready(JSON.parse(buffer.join('')).rs
                            .filter(order => order.orderData || order.order_uid).map(order => {
                                if (order.orderData) return fileUid + order.orderData.fileUid;
                                else return order_id + order.order_id + order_uid + order.order_uid;
                            })
                        );
                    } catch (err) {
                        logger.log("ivolatility.com", payload, buffer.join(''));
                        error(err);
                    }
                });
            });
            req.on('error', error);
            req.write(payload);
            req.end();
        });
    });
}

function retrieveCookies(username, password) {
    var host = url.parse('https://www.ivolatility.com/login.j');
    var payload = querystring.stringify({
        username,
        password,
        service_name: 'Home Page',
        step: 1,
        login__is__sent: 1
    });
    return new Promise((ready, error) => {
        var req = https.request(_.extend({method: 'POST', headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload)
        }}, host), res => {
            res.on('data', _.noop);
            res.on('error', error).on('end', () => {
                ready(res.headers['set-cookie'].map(cookie => cookie.substring(0, cookie.indexOf(';'))));
            });
        });
        req.on('error', error);
        req.write(payload);
        req.end();
    });
}

function absentFileUrls(downloadDir, fileUrls) {
    return Promise.all(fileUrls.map(fileUrl => {
        var fileUid = fileUrl.substring(fileUrl.lastIndexOf('=')+1);
        var filename = path.resolve(downloadDir, fileUid + '.zip');
        return new Promise(absent => {
            fs.access(filename, fs.R_OK, err => err ? absent(fileUrl) : absent());
        });
    })).then(_.compact)
}

function downloadFiles(downloadDir, fileUrls) {
    return Promise.all(fileUrls.map(fileUrl => {
        var fileUid = fileUrl.substring(fileUrl.lastIndexOf('=')+1);
        var filename = path.resolve(downloadDir, fileUid + '.zip');
        return awriter(filename => new Promise((ready, error) => {
            var file = fs.createWriteStream(filename);
            logger.info("Downloading", fileUrl);
            var protocol = fileUrl.startsWith('https') ? https : http;
            var req = protocol.get(fileUrl, res => {
                res.pipe(file);
                res.on('error', error).on('end', ready);
            });
            req.on('error', error);
        }), filename).then(() => filename);
    }));
}
