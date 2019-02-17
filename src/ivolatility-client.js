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
'use strict';

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
const d3 = require('d3-format');
const yauzl = require('yauzl');
const logger = require('./logger.js');
const interrupt = require('./interrupt.js');
const awriter = require('./atomic-write.js');
const cache = require('./memoize-cache.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

module.exports = function(cacheDir, downloadDir, auth_file, downloadType) {
    const store = storage(cacheDir);
    const checkForUpdatesFn = checkForUpdates.bind(this, cacheDir, downloadDir, auth_file, downloadType);
    let checkTormorrow, processing;
    const another_six_hours = 6 * 60 * 60 * 1000;
    const another_21_hours = 21 * 60 * 60 * 1000;
    const processEveryDay = () => {
        return processing = checkForUpdatesFn().then(result => {
            store.flush();
            checkTormorrow = setTimeout(() => {
                processing.then(processEveryDay);
            }, result ? another_21_hours : another_six_hours);
            checkTormorrow.unref();
        });
    };
    processing = processEveryDay();
    return {
        listAvailableDownloads(dType) {
            const token = auth_file ? fs.readFileSync(auth_file, 'utf8').trim() : '';
            const auth = new Buffer.from(token, 'base64').toString().split(/:/);
            const username = auth[0];
            const password = auth[1];
            return listAvailableDownloads(username, password, dType || downloadType);
        },
        downloadUpdates(dType) {
            return downloadUpdates(downloadDir, auth_file, dType || downloadType);
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
            const symbol = options.iv_symbol;
            expect(symbol).to.be.like(/^(\w+)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
            const m = symbol.match(/^(\w+)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
            const [, underlying, yy, month, day] = m;
            const cc = +yy<50 ? 2000 : 1900;
            const year = cc + +yy;
            const expiry_date = `${year}-${month}-${day}`;
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

function checkForUpdates(cacheDir, downloadDir, auth_file, downloadType) {
    return Promise.resolve(auth_file ? downloadUpdates(downloadDir, auth_file, downloadType) : null)
      .then(() => Promise.resolve(downloadDir ? processNewFiles(cacheDir, downloadDir) : null))
      .catch(err => logger.error("Could not process updates from ivolatility.com", err));
}

function processNewFiles(cacheDir, downloadDir) {
    return readMetadata(downloadDir).then(metadata => {
        return listNewFiles(downloadDir, metadata).then(files => files.reduce((wait, file) => wait.then(() => {
            const filename = path.resolve(downloadDir, file);
            return explodeZip(filename, (stats, entryStream, entryName) => {
                const sink = createDataSinkStore(cacheDir);
                return parseZipEntry(entryStream, (stats, datum) => {
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
                }, stats).then(result => {
                    return sink.close(entryName).then(() => result);
                }, err => {
                    return sink.close(entryName).then(() => Promise.reject(err));
                });
            }, {file, symbols:[], exchanges:[], expirations:[]}).then(stats => {
                const idx = metadata.entries.findIndex(entry => entry.file == file);
                if (idx<0) metadata.entries.push(stats);
                else metadata.entries[idx] = stats;
                return stats;
            });
        }), Promise.resolve())).then(result => {
            return writeMetadata(downloadDir, metadata).then(() => result);
        });
    }).then(result => {
        if (result) logger.info("Finished processing new ivolatility.com files");
    });
}

function createDataSinkStore(cacheDir) {
    const every_minute = 60 * 1000;
    let cleanup, error, abort;
    let total = 0, count = 0;
    const queue = {};
    const helpers = {};
    const check = interrupt();
    let logProgress = _.noop;
    const keyOf = datum => datum.expiration.substring(0, 2);
    const fork = key => {
        const forked = child_process.fork(module.filename, [cacheDir]);
        forked.on('message', msg => {
            if (count) logProgress(count/total);
            if (abort) {
                forked.send({cmd:'close'});
            } else if (msg && msg.cmd == 'ready' && queue[key].length) {
                const payload = queue[key].splice(0, Math.min(queue[key].length, 100));
                forked.send({cmd: 'store', payload});
                count+= payload.length;
            } else if (msg && msg.cmd == 'ready' && cleanup) {
                forked.send({cmd:'close'});
            } else if (msg && msg.cmd == 'ready') {
                _.defer(() => {
                    if (queue[key].length) {
                        const payload = queue[key].splice(0, Math.min(queue[key].length, 100));
                        forked.send({cmd: 'store', payload});
                        count+= payload.length;
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
            if (!abort && queue[key].length) helpers[key] = fork(key);
            else if (cleanup) cleanup();
        });
        return forked;
    };
    return _.extend(datum => {
        check();
        total++;
        const key = keyOf(datum);
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
        close(entryName) {
            return new Promise((ready, fail) => {
                const logProgressNow = progress => {
                    logger.log("Processing ivolatility", entryName, Math.round(progress*100), "% complete");
                };
                logProgress = _.throttle(logProgressNow, every_minute, {trailing: false});
                cleanup = () => {
                    if (error && _.isEmpty(helpers)) {
                        fail(error);
                    } else if (abort && _.isEmpty(helpers)) {
                        ready();
                    } else if (error || abort) {
                        _.values(helpers).forEach(helper => helper.send({cmd:'close'}));
                    } else if (_.isEmpty(helpers) && _.isEmpty(_.flatten(_.values(queue)))) {
                        logger.log("Processing ivolatility", entryName, "is complete");
                        ready();
                    }
                };
                cleanup();
            });
        }
    });
}


if (require.main === module && process.send) {
    const cacheDir = process.argv[2];
    const sink = createInlineDataSinkStore(cacheDir);
    const ready = () => {
        process.send({cmd:'ready'});
    };
    const error = err => {
        process.send({cmd:'error', message: err.stack || err.message || err});
    };
    process.on('message', msg => {
        if (msg && msg.cmd == 'store') {
            Promise.all(msg.payload.map(sink)).then(ready).catch(error);
        } else if (msg && msg.cmd == 'close') {
            sink.close().catch(error).then(() => {
                process.disconnect();
            });
        }
    }).on('disconnect', () => sink.close());
    ready();
}

let counter = 0;
const strike_format = d3.format("08d");
function createInlineDataSinkStore(cacheDir) {
    const check = interrupt();
    const store = storage(cacheDir);
    const iv_symbol_of = datum => {
        const yymmdd = datum.expiration.replace(/(\d\d)\/(\d\d)\/\d\d(\d\d)/, '$3$1$2');
        const cp = datum['call/put'];
        const strike = strike_format(+datum.strike * 1000);
        return `${datum.symbol}${yymmdd}${cp}${strike}`;
    };
    const lookup = cache(datum => {
        const date = mdy2ymd(datum.expiration);
        const dbname = datum.symbol;
        const iv_symbol = iv_symbol_of(datum);
        const entryId = ++counter;
        return store.open(dbname, (err, db) => {
            if (err) throw err;
            return db.collection(date).then(collection => {
                if (!collection.exists(iv_symbol)) return [];
                else return collection.readFrom(iv_symbol);
            });
        }).then(array => ({
            add(datum) {
                const idx = _.sortedIndex(array, datum, datum => mdy2ymd(datum.date));
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
                        return collection.writeTo(array, iv_symbol);
                    });
                });
            }
        }));
    }, iv_symbol_of, 1000);
    return _.extend(datum => {
        check();
        return lookup(datum).then(data => data.add(datum));
    }, {
        flush() {
            return lookup.flush().then(() => store.flush());
        },
        close() {
            return lookup.close().then(() => store.close());
        }
    });
}

function mdy2ymd(mdy) {
    return mdy.replace(/(\d\d)\/(\d\d)\/(\d\d\d\d)/, '$3-$1-$2');
}

function explodeZip(file, reduce, initial) {
    let result = initial;
    logger.info("Extracting", file);
    return new Promise((ready, error) => {
        const entries = [];
        yauzl.open(file, {lazyEntries: true}, (err, zipfile) => {
            if (err) return error(err);
            zipfile.readEntry();
            zipfile.on('close', () => Promise.all(entries).then(() => ready(result), error));
            zipfile.on('entry', function(entry) {
                logger.debug("Processing", file, entry.fileName);
                zipfile.openReadStream(entry, (err, entryStream) => {
                    if (err) return error(err);
                    entries.push(reduce(result, entryStream, entry.fileName).then(next => {
                        return result = next;
                    }).then(result => zipfile.readEntry(), err => {
                        zipfile.close();
                        return Promise.reject(err);
                    }));
                });
            });
        });
    }).then(() => result);
}

function parseZipEntry(entryStream, reduce, initial) {
    const check = interrupt();
    let result = initial;
    return new Promise((ready, error) => {
        csv.fromStream(entryStream, {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
                    check();
                    const obj = _.mapObject(data, value => _.isFinite(value) ? +value : value);
                    result = reduce(initial, obj);
                } catch (e) {
                    this.emit('error', e);
                }
        }).on('end', () => ready(result));
    });
}

function listNewFiles(downloadDir, metadata) {
    return listZipFiles(downloadDir)
      .then(files => Promise.all(files.map(file => mtime(path.resolve(downloadDir, file))
      .then(mtime => {
        const entry = metadata.entries.find(entry => entry.file == file);
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
    const filename = path.resolve(dirname, 'index.json');
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
    const filename = path.resolve(dirname, 'index.json');
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

function downloadUpdates(downloadDir, auth_file, downloadType) {
    const token = auth_file ? fs.readFileSync(auth_file, 'utf8').trim() : '';
    const auth = new Buffer.from(token, 'base64').toString().split(/:/);
    const username = auth[0];
    const password = auth[1];
    return readMetadata(downloadDir).then(metadata => {
        return listAvailableDownloads(username, password, downloadType, metadata.mtime)
          .then(fileUrls => absentFileUrls(downloadDir, fileUrls))
          .then(fileUrls => downloadFiles(downloadDir, fileUrls));
    });
}

function listAvailableDownloads(username, password, downloadType, mtime) {
    const point = moment(mtime);
    const fileUid = 'https://www.ivolatility.com/loadCSV?fileUid=';
    const order_id = 'http://www.ivolatility.com/data_download.csv?order_id=';
    const order_uid = '&order_uid=';
    const host = url.parse('http://www.ivolatility.com/dd-server/history');
    return retrieveCookies(username, password).then(cookies => {
        const userIdCookie = cookies.find(cookie => cookie.startsWith("IV%5FUID="));
        const userId = userIdCookie.substring(userIdCookie.indexOf('=')+1);
        const payload = querystring.stringify({
            pageSize: 10,
            userId: userId,
            limit: 10,
            downloadType: downloadType || 'DAILY_ONLY',
            page: 1,
            start: 0
        });
        logger.debug("Checking for new ivolatility.com downloads using ID", userId, username);
        return new Promise((ready, error) => {
            const req = http.request(_.extend({method: 'POST', headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload),
                Cookie: cookies.join('; ')
            }}, host), res => {
                const buffer = [];
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
    const host = url.parse('https://www.ivolatility.com/login.j');
    const payload = querystring.stringify({
        username,
        password,
        service_name: 'Home Page',
        step: 1,
        login__is__sent: 1
    });
    return new Promise((ready, error) => {
        const req = https.request(_.extend({method: 'POST', headers: {
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
        const fileUid = fileUrl.substring(fileUrl.lastIndexOf('=')+1);
        const filename = path.resolve(downloadDir, fileUid + '.zip');
        return new Promise(absent => {
            fs.access(filename, fs.R_OK, err => err ? absent(fileUrl) : absent());
        });
    })).then(_.compact)
}

function downloadFiles(downloadDir, fileUrls) {
    return Promise.all(fileUrls.map(fileUrl => {
        const fileUid = fileUrl.substring(fileUrl.lastIndexOf('=')+1);
        const filename = path.resolve(downloadDir, fileUid + '.zip');
        return awriter(filename => new Promise((ready, error) => {
            const file = fs.createWriteStream(filename);
            logger.info("Downloading", fileUrl);
            const protocol = fileUrl.startsWith('https') ? https : http;
            const req = protocol.get(fileUrl, res => {
                if (res.statusCode == 200 || res.statusCode == 203) {
                    res.pipe(file);
                    res.on('error', error).on('end', () => {
                        fs.stat(filename, (err, stats) => {
                            if (err) error(err);
                            else if (stats.size) ready();
                            else error(Error("Could not download " + fileUrl));
                        });
                    });
                } else {
                    error(Error("Could not download " + fileUrl + " " + res.statusMessage));
                    res.resume();
                }
            });
            req.on('error', error);
        }), filename).then(() => filename);
    }));
}
