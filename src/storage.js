// storage.js
/*
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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

const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const csv = require('fast-csv');
const expect = require('chai').expect;
const logger = require('./logger.js');
const interrupt = require('./interrupt.js');
const debounce = require('./debounce.js');
const cache = require('./memoize-cache.js');

module.exports = _.extend(function(dirname) {
    var cachedDatabases = cache(openDatabase.bind(this, dirname), require('os').cpus().length*2);
    return {
        open(name, cb) {
            return cachedDatabases(safe(name), cb);
        },
        close() {
            return cachedDatabases.close();
        }
    };
}, {
    _readMetadata: readMetadata,
    _renameMetadata: renameMetadata,
    _mergeMetadata: mergeMetadata
});

function openDatabase(dir, name) {
    var dirname = path.resolve(dir, safe(name));
    var memoized = _.memoize(openCollection.bind(this, dirname));
    return {
        collection: memoized,
        flushCache() {
            var values = _.values(memoized.cache);
            memoized.cache = {};
            return Promise.all(values)
                .then(collections => Promise.all(collections.map(coll => coll.close())));
        },
        close() {
            var values = _.values(memoized.cache);
            memoized.cache = {};
            return Promise.all(values)
                .then(collections => Promise.all(collections.map(coll => coll.close())));
        }
    };
}

function safe(segment) {
    expect(segment).is.ok.and.not.be.a('object').and.not.be.a('function');
    if (!_.isString(segment)) return safe('' + segment);
    else if (segment.match(/^[\w._-]+$/)) return segment;
    else return segment.replace(/[^\w.-]+/g,'_');
}

function openCollection(dirname, name) {
    var cachedTables = cache(readTable);
    var collpath = path.resolve(dirname, safe(name));
    var debouncedWriteMetadata = debounce(writeMetadata, 10000);
    var locks = {};
    return readMetadata(collpath).then(metadata => ({
        close() {
            return Promise.all([
                debouncedWriteMetadata.close(),
                cachedTables.close()
            ]);
        },
        listNames() {
            return metadata.tables.map(entry => entry.name || entry.id);
        },
        lockWith(names, cb) {
            var expired;
            var promise = new Promise(aquired => _.defer(() => {
                var priorLocks = names.reduce((priorLocks, name) => {
                    if (locks[name]) {
                        var prior = _.union(priorLocks, locks[name]);
                        locks[name].push(promise);
                        return prior;
                    } else {
                        locks[name] = [promise];
                        return priorLocks;
                    }
                }, []);
                Promise.all(priorLocks).then(aquired, aquired).then(() => {
                    expired = priorLocks.concat(promise);
                });
            })).then(unlocked => cb(names));
            promise.catch(err => {}).then(result => {
                locks = _.omit(_.mapObject(locks, values => _.without(values, expired)), _.isEmpty);
            });
            return promise;
        },
        propertyOf(block, name, value) {
            var id = safe(block);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            var entry = metadata.tables[idx];
            if (!entry || entry.id != id) throw Error("Unknown table " + path.resolve(collpath, id + '.csv'));
            if (arguments.length == 2)
                return entry.properties[name];
            else
                entry.properties[name] = value;
        },
        exists(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            var entry = metadata.tables[idx];
            return entry && entry.id == id;
        },
        remove(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            var entry = metadata.tables[idx];
            if (!entry || entry.id != id) return Promise.resolve(false);
            metadata.tables.splice(idx, 1);
            var filename = path.resolve(collpath, id + '.csv');
            return Promise.all([new Promise((cb, error) => {
                fs.unlink(filename, err => {
                    if (err) error(err);
                    else cb();
                });
            }), debouncedWriteMetadata(collpath, metadata)]).then(() => true);
        },
        filenameOf(name) {
            var id = safe(name);
            return path.resolve(collpath, id + '.csv');
        },
        sizeOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].size;
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv'));
        },
        columnsOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return [].concat(metadata.tables[idx].head, metadata.tables[idx].tail)
                  .reduce((columns, obj) => {
                    return _.union(columns, _.keys(obj));
                }, []);
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv'));
        },
        headOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].head;
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv'));
        },
        tailOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].tail;
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv'));
        },
        readFrom(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (!metadata.tables[idx] || metadata.tables[idx].id != id)
                throw Error("Unknown table " + path.resolve(collpath, id + '.csv'));
            var filename = path.resolve(collpath, id + '.csv');
            return cachedTables(filename, metadata.tables[idx].size);
        },
        writeTo(records, name) {
            var id = safe(name);
            var filename = path.resolve(collpath, id + '.csv');
            return writeTable(filename, records)
              .then(() => cachedTables.replaceEntry(filename, Promise.resolve(records)))
              .then(() => {
                var entry = {
                    id: id,
                    name: name,
                    size: records.length,
                    head: records.slice(0, 2),
                    tail: records.slice(-2),
                    updatedAt: new Date().toISOString()
                };
                var idx = _.sortedIndex(metadata.tables, entry, 'id');
                if (metadata.tables[idx] && metadata.tables[idx].id == id) {
                    metadata.tables[idx] = _.extend(metadata.tables[idx], entry);
                } else {
                    entry.properties = {};
                    entry.createdAt = entry.updatedAt;
                    metadata.tables.splice(idx, 0, entry);
                }
                return debouncedWriteMetadata(collpath, metadata);
            });
        },
        flushCache() {
            return cachedTables.flush();
        }
    }));
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
        if (!_.isArray(metadata.tables))
            metadata.tables = [];
        return metadata;
    }).catch(error => logger.error("Could not read", dirname, error.message) || {tables:[]});
}

function writeMetadata(dirname, metadata) {
    var filename = path.resolve(dirname, 'index.json');
    var part = partFor(filename);
    return mkdirp(dirname).then(() => {
        return new Promise((ready, error) => {
            fs.writeFile(part, JSON.stringify(metadata, null, ' '), err => {
                if (err) error(err);
                else ready();
            });
        });
    }).then(() => renameMetadata(part, filename, metadata));
}

function renameMetadata(part, filename, metadata) {
    return new Promise(cb => {
        fs.stat(filename, (err, stats) => err ? cb() : cb(stats))
    }).then(stats => {
        if (stats && metadata.mtime && stats.mtime.valueOf() > metadata.mtime.valueOf())
            return mergeMetadata(part, filename, metadata);
    }).then(() => new Promise((ready, error) => {
        fs.rename(part, filename, err => {
            if (err) error(err);
            else ready();
        });
    }));
}

function mergeMetadata(part, filename, metadata) {
    var collpath = path.dirname(filename);
    return readMetadata(collpath).then(target => {
        var tables = metadata.tables;
        target.tables.forEach(entry => {
            var idx = _.sortedIndex(tables, entry, 'id');
            if (tables[idx] && tables[idx].id == entry.id) {
                if (tables[idx].updatedAt < entry.updatedAt) {
                    tables[idx] = _.extend(tables[idx], entry);
                }
            } else {
                tables.splice(idx, 0, entry);
            }
        });
        var absent = tables.filter(entry => {
            var idx = _.sortedIndex(target.tables, entry, 'id');
            return !target.tables[idx] || target.tables[idx].id != entry.id;
        });
        return Promise.all(absent.map(entry => new Promise(cb => {
            var filename = path.resolve(collpath, entry.id + '.csv');
            fs.access(filename, fs.R_OK, err => err ? cb(false) : cb(true));
        }))).then(ok => {
            absent.filter((entry, i) => !ok[i]).forEach(entry => {
                var idx = _.sortedIndex(tables, entry, 'id');
                if (tables[idx] && tables[idx].id == entry.id) {
                    tables.splice(idx, 1);
                }
            });
            return _.extend(metadata, target, {
                tables: tables
            });
        });
    }).then(merged => new Promise((ready, error) => {
        fs.writeFile(part, JSON.stringify(merged, null, ' '), err => {
            if (err) error(err);
            else ready();
        });
    }));
}

function readTable(filename, size) {
    var check = interrupt();
    return new Promise((ready, error) => {
        var objects = _.isFinite(size) ? new Array(size) : new Array();
        objects.length = 0;
        csv.fromStream(fs.createReadStream(filename), {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
                    check();
                    objects.push(_.mapObject(data, value => _.isFinite(value) ? +value : value));
                } catch (e) {
                    this.emit('error', e);
                }
            })
            .on('end', () => ready(objects));
    });
}

function writeTable(filename, table) {
    expect(table).to.be.an('array');
    var part = partFor(filename);
    return mkdirp(path.dirname(filename)).then(() => {
        return new Promise(finished => {
            var headers = _.union(_.keys(_.first(table)), _.keys(_.last(table)));
            var output = fs.createWriteStream(part);
            output.on('finish', finished);
            var writer = csv.createWriteStream({
                headers: headers,
                rowDelimiter: '\r\n',
                includeEndRowDelimiter: true
            });
            writer.pipe(output);
            table.forEach(record => writer.write(record));
            writer.end();
        });
    }).then(() => {
        return new Promise((ready, error) => {
            fs.rename(part, filename, err => {
                if (err) error(err);
                else ready();
            });
        });
    });
}

function mkdirp(dirname) {
    return new Promise((present, absent) => {
        fs.access(dirname, fs.F_OK, err => err ? absent(err) : present(dirname));
    }).catch(absent => {
        if (absent.code != 'ENOENT') throw absent;
        return mkdirp(path.dirname(dirname)).then(() => new Promise((ready, error) => {
            fs.mkdir(dirname, err => err ? error(err) : ready(dirname));
        })).catch(err => {
            if (err.code == 'EEXIST') return dirname;
            else throw err;
        });
    });
}

var seq = Date.now() % 32768;
function partFor(filename) {
    return filename + '.part' + (++seq).toString(16);
}
