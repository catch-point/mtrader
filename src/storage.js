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
const debounce = require('./debounce.js');
const cache = require('./cache.js');

module.exports = function(dirname) {
    var cachedDatabases = cache(openDatabase.bind(this, dirname), 10);
    return {
        open(name, cb) {
            return cachedDatabases(safe(name), cb);
        },
        close() {
            return cachedDatabases.close();
        }
    };
};

function openDatabase(dir, name) {
    var dirname = path.resolve(dir, safe(name));
    var memoized = _.memoize(openCollection.bind(this, dirname));
    return {
        collection: memoized,
        close() {
            return Promise.all(_.values(memoized.cache))
                .then(values => Promise.all(values.map(collection => collection.close())));
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
        property(name, value) {
            if (arguments.length == 1)
                return metadata.properties[name];
            else
                metadata.properties[name] = value;
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
            else throw Error("Unknown table " + name);
        },
        columnsOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return [].concat(metadata.tables[idx].head, metadata.tables[idx].tail)
                  .reduce((columns, obj) => {
                    return _.union(columns, _.keys(obj));
                }, []);
            else throw Error("Unknown table " + name);
        },
        headOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].head;
            else throw Error("Unknown table " + name);
        },
        tailOf(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].tail;
            else throw Error("Unknown table " + name);
        },
        readFrom(name) {
            var id = safe(name);
            var idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (!metadata.tables[idx] || metadata.tables[idx].id != id)
                throw Error("Unknown table " + name);
            var filename = path.resolve(collpath, id + '.csv');
            return cachedTables(filename, metadata.tables[idx].size);
        },
        writeTo(records, name) {
            var id = safe(name);
            var filename = path.resolve(collpath, id + '.csv');
            return writeTable(filename, records).then(() => {
                cachedTables.replaceEntry(filename, Promise.resolve(records));
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
                    entry.createdAt = entry.updatedAt;
                    metadata.tables.splice(idx, 0, entry);
                }
                return debouncedWriteMetadata(collpath, metadata);
            });
        }
    }));
}

function readMetadata(dirname) {
    var filename = path.resolve(dirname, 'index.json');
    return new Promise((present, absent) => {
        fs.access(filename, fs.R_OK, err => err ? absent(err) : present(dirname));
    }).then(present => {
        return new Promise((ready, error) => {
            fs.readFile(filename, (err, data) => {
                if (err) error(err);
                else ready(data);
            });
        }).then(JSON.parse);
    }, absent => {
        if (absent.code != 'ENOENT') logger.error("Could not read", filename, absent);
        else return {};
    }).then(metadata => {
        if (!_.isObject(metadata.properties))
            metadata.properties = {};
        if (!_.isArray(metadata.tables))
            metadata.tables = [];
        return metadata;
    });
}

function writeMetadata(dirname, metadata) {
    var filename = path.resolve(dirname, 'index.json');
    var part = partFor(filename);
    return mkdirp(dirname).then(() => {
        return new Promise((ready, error) => {
            fs.writeFile(part, JSON.stringify(metadata), err => {
                if (err) error(err);
                else ready();
            });
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

function readTable(filename, size) {
    return new Promise((ready, error) => {
        var objects = _.isFinite(size) ? new Array(size) : new Array();
        objects.length = 0;
        csv.fromStream(fs.createReadStream(filename), {headers : true, ignoreEmpty: true})
            .on('data', data => objects.push(_.mapObject(data, value => _.isFinite(value) ? +value : value)))
            .on('end', () => ready(objects))
            .on('error', error);
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
