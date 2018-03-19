// disk-cache.js
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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const _ = require('underscore');
const moment = require('moment-timezone');
const csv = require('fast-csv');
const expect = require('chai').expect;
const minor_version = require('./version.js').minor_version;
const config = require('./config.js');
const debounce = require('./debounce.js');
const interrupt = require('./interrupt.js');
const logger = require('./logger.js');

/**
 * Caches fn results to disk in baseDir
 */
module.exports = function(baseDir, fn, poolSize, loadFactor) {
    var maxPoolSize = poolSize / (loadFactor || 0.75);
    var cache = _.extend(new EventEmitter(), {
        added: 0,
        removed: 0,
        hit: 0,
        miss: 0,
        access: 0,
        pending: {},
        baseDir: baseDir,
        closed: false,
        locker: Promise.resolve(),
        prefix: Date.now().toString(36),
        seq: Math.floor(Math.random() * Math.pow(8, 8))
    });
    var promiseInitialCount = countEntries(cache)
        .catch(err => logger.error("Could not initialize cache", err));
    var debounced = debounce(function(){
        cache.prefix = Date.now().toString(36);
        return sweep.apply(this, arguments);
    }, 10000);
    return _.extend(function(options) {
        var opts = _.omit(options, _.isUndefined);
        var hash = readHash(opts);
        expect(hash).to.be.a('string');
        return getResult(cache, hash, opts, fn, options, result => {
            promiseInitialCount.then(initialCount => {
                if (maxPoolSize && initialCount + cache.added - cache.removed > maxPoolSize) {
                    debounced(cache, initialCount, poolSize);
                } else if (!maxPoolSize && cache.added > cache.removed) {
                    debounced(cache, initialCount, poolSize);
                }
            });
            return result;
        });
    }, {
        flush() {
            return promiseInitialCount.then(initialCount => sweep(cache, initialCount, poolSize));
        },
        close() {
            cache.closed = true;
            cache.emit('close');
            return promiseInitialCount.then(initialCount => {
                debounced(cache, initialCount, poolSize);
                return debounced.close().catch(err => {
                    logger.debug(err.message);
                }).then(() => {
                    if (cache.hit) {
                        var util = Math.round(100 * cache.hit / (cache.hit + cache.miss));
                        logger.debug("Cache utilization", util + '%');
                    }
                })
            });
        }
    });
};

/**
 * Counts the number of entries in baseDir
 */
function countEntries(cache) {
    return reduceEntries(cache, (count, entry) => count + 1, 0);
}

/**
 * Computes a hash for the given object
 */
function readHash(opts) {
    var data = JSON.stringify(opts);
    var hash = crypto.createHash('sha256');
    return hash.update(data).digest('base64');
}

/**
 * Reads the cached result from disk or creates a new cache entry
 */
function getResult(cache, hash, opts, fn, options, cb) {
    var memhit = cache.pending[hash] && cache.pending[hash].find(entry => {
        return entry.version == minor_version && _.isEqual(entry.opts, opts);
    });
    if (memhit) return memhit.promise;
    var cacheMiss = {};
    var dir = getDir(cache.baseDir, hash);
    return lock(cache, () => getEntry(cache, hash, opts)
      .catch(err => logger.warn("Could not read entry", hash, err))
      .then(entry => {
        if (entry) {
            cache.hit++;
            logger.trace("cache hit", entry);
            return readEntryResult(cache.baseDir, entry).catch(err => {
                cache.hit--;
                logger.warn("Could not read entry result", entry, err);
                return cacheMiss;
            });
        } else {
            return cacheMiss;
        }
    })).then(result => {
        if (result !== cacheMiss) return result;
        cache.miss++;
        return createCacheEntry(cache, hash, fn, options, cb);
    });
}

/**
 * Removes marked cached entries from disk and increases the age of other cached entries
 */
function sweep(cache, initialCount, poolSize) {
    var started = Date.now();
    var access = cache.hit + cache.miss - cache.access;
    var added = cache.added - cache.removed;
    return reduceEntries(cache, (count, entry) => {
        if (entry.marked)
            return deleteEntry(cache.baseDir, entry)
              .catch(err => logger.debug("Could not remove", entry, err))
              .then(() => count);
        else
            return writeEntryMetadata(cache, _.extend(entry, {age: entry.age+1}))
              .then(() => count + 1)
              .catch(err => logger.debug("Could not update", entry, err) || count);
    }, 0).then(count => {
        var removed = initialCount - count + cache.added - cache.removed;
        if (removed > 0) {
            var elapse = moment.duration(Date.now() - started);
            if (elapse.asSeconds() > 1)
                logger.log("Sweep removed", removed, "of", removed+count, "in", elapse.asSeconds()+'s');
        }
        _.extend(cache, {
            removed: initialCount - count + cache.added,
            access: cache.hit + cache.miss
        });
        if (poolSize && count > poolSize)
            return mark(cache, initialCount, poolSize);
        if (!poolSize && access && added > removed)
            return mark(cache, initialCount, Math.min(access, Math.max(initialCount, added)));
    });
}

/**
 * Marks the oldest cache entries for removal
 */
function mark(cache, initialCount, poolSize) {
    var size = initialCount + cache.added - cache.removed - poolSize;
    if (size <= 0) return Promise.resolve();
    return reduceEntries(cache, (oldest, entry) => {
        if (oldest.length < size || entry.age > _.first(oldest).age) {
            oldest.splice(_.sortedIndex(oldest, entry, 'age'), 0, entry);
        }
        if (oldest.length > size) {
            oldest.shift();
        }
        return oldest;
    }, []).then(oldest => Promise.all(oldest.map(entry => {
        return writeEntryMetadata(cache, _.extend(entry, {marked: true}));
    })));
}

/**
 * Iteratively calls cb for every cache entry in baseDir
 */
function reduceEntries(cache, cb, initial) {
    return lock(cache, () => flock(cache, () => new Promise(cb => {
        fs.readdir(cache.baseDir, (err, files) => cb(err ? [] : files));
    }).then(dirs => dirs.map(dir => path.resolve(cache.baseDir, dir)))
      .then(dirs => dirs.reduce((memo, dir) => memo.then(memo => new Promise(cb => {
        fs.readdir(dir, (err, files) => cb(err ? [] : files));
    }).then(files => files.filter(isMetadata))
      .then(files => files.map(file => path.resolve(dir, file)))
      .then(files => files.reduce((memo, file) => memo.then(memo => {
        return readEntryMetadata(file).then(entry => entry ? cb(memo, entry) : memo)
    }), Promise.resolve(memo)))), Promise.resolve(initial)))));
}

/**
 * Ensures that cb is running exclusively (in this process) for the given cache object
 */
function lock(cache, cb) {
    return cache.locker = cache.locker.then(_.noop, _.noop).then(cb);
}

/**
 * Ensures that cb is running exclusively for the given baseDir
 */
function flock(cache, cb) {
    var lock_file = path.resolve(cache.baseDir, ".~lock.pid");
    return mkdirp(cache.baseDir).then(() => aquireLock(cache, lock_file).then(cb)
      .then(result => deleteFile(cache.baseDir, lock_file).then(() => result),
            error => deleteFile(cache.baseDir, lock_file).then(() => {
        throw error;
    })));
}

/**
 * Creates a new lock_file with this process.pid as the contents, aborts on close
 * @return a Promise that will only resolve successfully if the lock_file is created
 */
function aquireLock(cache, lock_file) {
    return attemptLock(lock_file).catch(err => new Promise((locked, error) => {
        if (cache.closed) return error(Error(`Process ${process.pid} could not aquire lock ${lock_file}`));
        logger.log(err.message);
        var cleanup = () => {
            if (watcher) watcher.close();
            cache.removeListener('close', onclose);
        };
        var onclose = () => {
            cleanup();
            error(Error(`Process ${process.pid} could not aquire lock in time ${lock_file}`));
        };
        cache.on('close', onclose);
        var watcher = fs.watch(lock_file, {persistent:false}, () => attemptLock(lock_file).then(() => {
            cleanup();
            locked();
        }, err => logger.log(err.message))).on('error', err =>{
            cleanup();
            error(err);
        });
    })).catch(err => {
        if (cache.closed) throw err;
        logger.debug("Could not watch file", lock_file, err);
        // watcher could not be created (file deleted?), try again
        return aquireLock(cache, lock_file);
    });
}

/**
 * Attempt to create lock_file, if it does not already exists or has a pid of an unknown process
 * @return a Promise that will fail if lock_file already exsits and contains a pid of a running process
 */
function attemptLock(lock_file) {
    return new Promise((locked, notlocked) => {
        fs.writeFile(lock_file, process.pid, {flag:'wx'}, err => err ? notlocked(err) : locked());
    }).catch(notlocked => new Promise((ready, error) => {
        fs.readFile(lock_file, 'utf8', (err, data) => err ? error(err) : ready(data));
    }).then(pid => {
        if (pid) process.kill(pid, 0);
        return pid;
    }).then(pid => {
        if (!pid) throw Error(`Process ${process.pid} could not create lock ${lock_file}`);
        // the process with the lock_file is still running
        throw Error(`Process ${process.pid} is waiting for ${pid} to finish sweeping`);
    }, err => new Promise(ready => {
        fs.unlink(lock_file, ready);
    }).then(() => attemptLock(lock_file), err => {
        var msg = `Process ${process.pid} is trying to lock ${lock_file}`;
        logger.debug(msg, err);
        throw Error(msg);
    })));
}

/**
 * Reads a cache entry from disk and resets its age
 */
function getEntry(cache, hash, opts) {
    var dir = getDir(cache.baseDir, hash);
    return new Promise(cb => {
        fs.readdir(dir, (err, files) => cb(err ? [] : files));
    }).then(files => files.filter(isMetadata))
      .then(files => _.sortBy(files).reverse())
      .then(files => files.map(file => path.resolve(dir, file)))
      .then(files => Promise.all(files.map(file => readEntryMetadata(file))))
      .then(metas => metas.filter(entry => {
        return entry && entry.version == minor_version && entry.hash == hash && entry.result;
    })).then(entries => Promise.all(entries.map(entry => readEntryOptions(cache.baseDir, entry)))
      .then(options => entries.filter((entry, i) => _.isEqual(opts, options[i]))))
      .then(_.first).then(entry => {
        if (!entry || !entry.age && !entry.marked) return entry;
        return writeEntryMetadata(cache, _.extend(entry, {age: 0, marked: false}));
    });
}

/**
 * Create a new (pending) cache entry in memory
 */
function createCacheEntry(cache, hash, fn, options, cb) {
    expect(hash).to.be.a('string');
    var miss = {
        hash: hash,
        age: 0,
        marked: false,
        version: minor_version,
        label: options.label,
        promise: new Promise(cb => cb(fn(options))).then(result => {
            var opts = _.omit(options, _.isUndefined);
            return writePendingEntryResult(cache, miss, opts, result);
        }).then(result => {
            removePendingEntry(cache, miss);
            cache.added++;
            return cb(result);
        }, err => {
            removePendingEntry(cache, miss);
            throw err;
        })
    };
    var array = (cache.pending[hash] || []);
    array.unshift(miss);
    cache.pending[hash] = array;
    return miss.promise;
}

/**
 * Remove a pending cache entry from memory
 */
function removePendingEntry(cache, entry) {
    var array = cache.pending[entry.hash];
    var idx = array.indexOf(entry);
    if (idx < 0) throw Error(`Pending entry is missing: ${JSON.stringify(entry)}`);
    if (array.length == 1) delete cache.pending[entry.hash];
    else array.splice(idx, 1);
}

/**
 * Determines if the filename is the name of a cache entry
 */
function isMetadata(n) {
    return n.lastIndexOf('.entry.json') == n.length - '.entry.json'.length;
}

/**
 * Reads a JSON file into memory or returns undefined if the read/parse failed
 */
function readEntryMetadata(file) {
    return new Promise((ready, error) => {
        fs.readFile(file, 'utf8', (err, data) => err ? error(err) : ready(data));
    }).then(data => JSON.parse(data))
      .catch(err => logger.debug("Could not read", file, err));
}

/**
 * Writes the result to disk
 */
function writePendingEntryResult(cache, entry, opts, result) {
    var dir = getDir(cache.baseDir, entry.hash);
    return mkdirp(dir).then(() => {
        var filename = cache.prefix + (++cache.seq).toString(36);
        var file = path.resolve(dir, filename);
        if (_.isArray(result)) {
            return new Promise((finished, error) => {
                var output = fs.createWriteStream(file + '.result.csv');
                output.on('finish', finished);
                output.on('error', error);
                var writer = csv.createWriteStream({
                    headers: _.union(_.keys(_.first(result)), _.keys(_.last(result))),
                    rowDelimiter: '\r\n',
                    includeEndRowDelimiter: true
                });
                writer.pipe(output);
                result.forEach(datum => writer.write(datum));
                writer.end();
            }).then(() => writeObject(cache, file + '.options.json', opts))
              .then(() => writeObject(cache, file + '.entry.json', {
                hash: entry.hash,
                label: entry.label,
                age: 0,
                marked: false,
                version: minor_version,
                type: 'csv',
                result: filename + '.result.csv',
                options: filename + '.options.json',
                metadata: filename + '.entry.json'
            }));
        } else if (_.isObject(result)) {
            return writeObject(cache, file + '.result.json', result)
              .then(() => writeObject(cache, file + '.options.json', opts))
              .then(() => writeObject(cache, file + '.entry.json', {
                hash: entry.hash,
                label: entry.label,
                age: 0,
                marked: false,
                version: minor_version,
                type: 'json',
                result: filename + '.result.json',
                options: filename + '.options.json',
                metadata: filename + '.entry.json'
            }));
        }
    }).then(entry => result);
}

/**
 * Reads the options that were passed to fn for this cached entry
 */
function readEntryOptions(baseDir, entry) {
    var file = path.resolve(getDir(baseDir, entry.hash), entry.options);
    return new Promise((ready, error) => {
        fs.readFile(file, (err, data) => err ? error(err) : ready(data));
    }).then(JSON.parse.bind(JSON));
}

/**
 * Reads the cached result from disk
 */
function readEntryResult(baseDir, entry) {
    var file = path.resolve(getDir(baseDir, entry.hash), entry.result);
    if (entry.type == 'csv') {
        var check = interrupt();
        return new Promise((ready, error) => {
            var objects = [];
            csv.fromStream(fs.createReadStream(file).on('error', error), {headers : true, ignoreEmpty: true})
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
    } else if (entry.type == 'json') {
        return new Promise((ready, error) => {
            fs.readFile(file, (err, data) => err ? error(err) : ready(data));
        }).then(JSON.parse.bind(JSON));
    } else {
        throw Error(`Unknown cache entry type: ${JSON.stringify(entry)}`);
    }
}

/**
 * Write the (modified) cache entry to disk
 */
function writeEntryMetadata(cache, entry) {
    var dir = getDir(cache.baseDir, entry.hash);
    var file = path.resolve(dir, entry.metadata);
    return writeObject(cache, file, entry);
}

/**
 * Writes a JSON object to a file
 */
function writeObject(cache, file, object) {
    var part = partFor(cache, file);
    return new Promise((ready, error) => {
        var data = JSON.stringify(object, null, ' ');
        fs.writeFile(part, data, err => err ? error(err) : ready(object));
    }).then(() => new Promise((ready, error) => {
        fs.rename(part, file, err => err ? error(err) : ready(object));
    }));
}

/**
 * Removes a cache entry from disk and maybe its container directory
 */
function deleteEntry(baseDir, entry) {
    if (!entry.metadata) return Promise.resolve(); // already deleted
    var dir = getDir(baseDir, entry.hash);
    return Promise.all([
        deleteFile(dir, entry.metadata),
        deleteFile(dir, entry.options),
        deleteFile(dir, entry.result)
    ]).then(() => new Promise((ready, error) => {
        fs.readdir(dir, (err, files) => err ? error(err) : ready(files));
    })).then(files => files.length || new Promise((ready, error) => {
        fs.rmdir(dir, err => err ? error(err) : ready());
    })).then(() => {
        entry.marked = true;
        entry.file = null;
        entry.metadata = null;
        return entry;
    });
}

/**
 * Deletes a file and returns a promise
 */
function deleteFile(dir, filename) {
    return new Promise((ready, error) => {
        var file = path.resolve(dir, filename);
        fs.unlink(file, err => err ? error(err) : ready());
    });
}

/**
 * Determines the directory a cache entry with this hash should be stored in
 */
function getDir(baseDir, hash) {
    return path.resolve(baseDir, hash.substring(0, 8).replace(/\W/g,'').substring(0, 3));
}

/**
 * Provides a some what unique filename suffix
 */ 
function partFor(cache, filename) {
    return filename + '.part' + (++cache.seq).toString(36);
}

/**
 * Creates and directory and its parent directories
 */
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
