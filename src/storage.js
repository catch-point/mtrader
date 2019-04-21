// storage.js
/*
 *  Copyright (c) 2016-2019 James Leigh, Some Rights Reserved
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

const util = require('util');
const fs = require('graceful-fs');
const path = require('path');
const zlib = require('zlib');
const _ = require('underscore');
const csv = require('fast-csv');
const expect = require('chai').expect;
const awriter = require('./atomic-write.js');
const logger = require('./logger.js');
const debounce = require('./debounce.js');
const cache = require('./memoize-cache.js');

module.exports = _.extend(function(dirname) {
    const cachedDatabases = cache(openDatabase.bind(this, dirname));
    return {
        open(name, cb) {
            return cachedDatabases(safe(name), cb);
        },
        flush() {
            return cachedDatabases.flush();
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
    const dirname = path.resolve(dir, safe(name));
    const memoized = _.memoize(openCollection.bind(this, dirname));
    logger.trace("Opening", dirname, "from", process.pid);
    return {
        collection: memoized,
        flushCache() {
            const values = _.values(memoized.cache);
            memoized.cache = {};
            return Promise.all(values)
                .then(collections => Promise.all(collections.map(coll => coll.close())));
        },
        close(closedBy) {
            logger.trace("Closing", dirname, "from", process.pid);
            const values = _.values(memoized.cache);
            memoized.cache = {};
            return Promise.all(values)
                .then(collections => Promise.all(collections.map(coll => coll.close(closedBy))));
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
    let locks = {};
    const cachedTables = cache(readTable);
    const collpath = path.resolve(dirname, safe(name));
    const debouncedWriteMetadata = debounce(writeMetadata, 10000, 100);
    let closed = false;
    const failIfClosed = () => {
        if (closed) throw Error(`Collection ${collpath} already closed in ${process.pid} ${closed}`);
    };
    return readMetadata(collpath).then(metadata => ({
        close(closedBy) {
            closed = closedBy || true;
            return Promise.all([
                debouncedWriteMetadata.close(),
                cachedTables.close()
            ]);
        },
        listNames() {
            failIfClosed();
            return metadata.tables.map(entry => entry.name || entry.id);
        },
        lockWith(names, cb) {
            failIfClosed();
            let expired;
            const promise = new Promise(aquired => _.defer(() => {
                const priorLocks = names.reduce((priorLocks, name) => {
                    if (locks[name]) {
                        const prior = _.union(priorLocks, locks[name]);
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
            failIfClosed();
            const id = safe(block);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            const entry = metadata.tables[idx];
            if (!entry || entry.id != id) throw Error("Unknown table " + path.resolve(collpath, id + '.csv.gz'));
            if (arguments.length == 2)
                return entry.properties[name];
            entry.properties[name] = value;
            return debouncedWriteMetadata(collpath, metadata);
        },
        exists(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            const entry = metadata.tables[idx];
            return entry && entry.id == id;
        },
        remove(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            const entry = metadata.tables[idx];
            if (!entry || entry.id != id) return Promise.resolve(false);
            metadata.tables.splice(idx, 1);
            const filename = path.resolve(collpath, entry.file || id + '.csv.gz');
            return Promise.all([new Promise((cb, error) => {
                fs.unlink(filename, err => {
                    if (err) error(err);
                    else cb();
                });
            }), debouncedWriteMetadata(collpath, metadata)]).then(() => true);
        },
        filenameOf(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            const entry = metadata.tables[idx];
            if (!entry || entry.id != id) return path.resolve(collpath, id + '.csv.gz');
            else return path.resolve(collpath, entry.file || id + '.csv.gz');
        },
        sizeOf(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].size;
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv.gz'));
        },
        columnsOf(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return [].concat(metadata.tables[idx].head, metadata.tables[idx].tail)
                  .reduce((columns, obj) => {
                    return _.union(columns, _.keys(obj));
                }, []);
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv.gz'));
        },
        headOf(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].head;
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv.gz'));
        },
        tailOf(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            if (metadata.tables[idx] && metadata.tables[idx].id == id)
                return metadata.tables[idx].tail;
            else throw Error("Unknown table " + path.resolve(collpath, id + '.csv.gz'));
        },
        readFrom(name) {
            failIfClosed();
            const id = safe(name);
            const idx = _.sortedIndex(metadata.tables, {id: id}, 'id');
            const entry = metadata.tables[idx];
            if (!entry || entry.id != id)
                throw Error("Unknown table " + path.resolve(collpath, id + '.csv.gz'));
            const filename = path.resolve(collpath, entry.file || id + '.csv.gz');
            return cachedTables(filename, metadata.tables[idx].size);
        },
        replaceWith(records, name) {
            failIfClosed();
            const id = safe(name);
            const file = id + '.csv.gz';
            const filename = path.resolve(collpath, file);
            return writeTable(filename, records)
              .then(() => cachedTables.replaceEntry(filename, Promise.resolve(records)))
              .then(() => {
                const entry = {
                    id: id,
                    name: name,
                    size: records.length,
                    head: records.slice(0, 2),
                    tail: records.slice(-2),
                    updatedAt: new Date().toISOString()
                };
                const idx = _.sortedIndex(metadata.tables, entry, 'id');
                if (metadata.tables[idx] && metadata.tables[idx].id == id) {
                    entry.file = file;
                    entry.properties = {};
                    entry.createdAt = entry.updatedAt;
                    metadata.tables[idx] = entry;
                } else {
                    entry.file = file;
                    entry.properties = {};
                    entry.createdAt = entry.updatedAt;
                    metadata.tables.splice(idx, 0, entry);
                }
                return debouncedWriteMetadata(collpath, metadata);
            }).then(() => records);
        },
        writeTo(records, name) {
            failIfClosed();
            const id = safe(name);
            const file = id + '.csv.gz';
            const filename = path.resolve(collpath, file);
            return writeTable(filename, records)
              .then(() => cachedTables.replaceEntry(filename, Promise.resolve(records)))
              .then(() => {
                const entry = {
                    id: id,
                    name: name,
                    size: records.length,
                    head: records.slice(0, 2),
                    tail: records.slice(-2),
                    updatedAt: new Date().toISOString()
                };
                const idx = _.sortedIndex(metadata.tables, entry, 'id');
                if (metadata.tables[idx] && metadata.tables[idx].id == id) {
                    metadata.tables[idx] = _.extend(metadata.tables[idx], entry);
                } else {
                    entry.file = file;
                    entry.properties = {};
                    entry.createdAt = entry.updatedAt;
                    metadata.tables.splice(idx, 0, entry);
                }
                return debouncedWriteMetadata(collpath, metadata);
            }).then(() => records);
        },
        flushCache() {
            return cachedTables.flush();
        }
    }));
}

function readMetadata(dirname) {
    const filename = path.resolve(dirname, 'index.json.gz');
    return new Promise((present, absent) => {
        fs.access(filename, fs.R_OK, err => err ? absent(err) : present(dirname));
    }).then(present => new Promise((ready, error) => {
        fs.stat(filename, (err, stats) => err ? error(err) : ready(stats));
    })).then(stats => {
        return util.promisify(fs.readFile)(filename)
          .then(util.promisify(zlib.gunzip)).then(JSON.parse)
          .then(metadata => _.extend(metadata, {mtime: stats.mtime}));
    }, absent => {
        if (absent.code != 'ENOENT') logger.error("Could not read", filename, absent);
        else return {};
    }).then(metadata => {
        if (!_.isArray(metadata.tables))
            metadata.tables = [];
        return metadata;
    }).catch(error => logger.error("Could not read", dirname, error.message) || {tables:[]});
}

async function writeMetadata(dirname, metadata) {
    const filename = path.resolve(dirname, 'index.json.gz');
    const part = awriter.partFor(filename);
    await awriter.mkdirp(dirname)
    const json = JSON.stringify(metadata, null, ' ');
    const buffer = await util.promisify(zlib.gzip)(json);
    await util.promisify(fs.writeFile)(part, buffer);
    return renameMetadata(part, filename, metadata);
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

async function mergeMetadata(part, filename, metadata) {
    const collpath = path.dirname(filename);
    const target = await readMetadata(collpath);
    const tables = metadata.tables;
    target.tables.forEach(entry => {
        const idx = _.sortedIndex(tables, entry, 'id');
        if (tables[idx] && tables[idx].id == entry.id) {
            if (tables[idx].updatedAt < entry.updatedAt) {
                tables[idx] = _.extend(tables[idx], entry);
            }
        } else {
            tables.splice(idx, 0, entry);
        }
    });
    const absent = tables.filter(entry => {
        const idx = _.sortedIndex(target.tables, entry, 'id');
        return !target.tables[idx] || target.tables[idx].id != entry.id;
    });
    const ok = await Promise.all(absent.map(entry => new Promise(cb => {
        const filename = path.resolve(collpath, entry.file || entry.id + '.csv.gz');
        fs.access(filename, fs.R_OK, err => err ? cb(false) : cb(true));
    })));
    absent.filter((entry, i) => !ok[i]).forEach(entry => {
        const idx = _.sortedIndex(tables, entry, 'id');
        if (tables[idx] && tables[idx].id == entry.id) {
            tables.splice(idx, 1);
        }
    });
    const merged = _.extend(metadata, target, {
        tables: tables
    });
    const decompressed = JSON.stringify(merged, null, ' ');
    const compressed = await util.promisify(zlib.gzip)(decompressed);
    await util.promisify(fs.writeFile)(part, compressed);
}

function readTable(filename, size) {
    return new Promise((ready, error) => {
        const objects = _.isFinite(size) ? new Array(size) : new Array();
        objects.length = 0;
        const stream = fs.createReadStream(filename).on('error', error);
        const pipe = stream.pipe(zlib.createGunzip().on('error', error));
        csv.fromStream(pipe, {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
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
    return awriter(filename => new Promise((finished, error) => {
        const headers = _.union(_.keys(_.first(table)), _.keys(_.last(table)));
        const output = fs.createWriteStream(filename).on('error', error);
        output.on('finish', finished);
        const writer = csv.createWriteStream({
            headers: headers,
            rowDelimiter: '\r\n',
            includeEndRowDelimiter: true
        }).on('error', error);
        writer.pipe(zlib.createGzip().on('error', error)).pipe(output);
        table.forEach(record => writer.write(record));
        writer.end();
    }), filename);
}
