// memoize-cache.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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

const v8 = require('v8');
const process = require('process');
const _ = require('underscore');
const debounce = require('./debounce.js');
const logger = require('./logger.js');

const heap_limit = v8 && v8.getHeapStatistics().total_available_size || 0;

/**
 * Caches a given function by keeping the computed result in memory. Useful for
 * speeding up slow-running computations. If passed an optional hashFunction, it
 * will be used to compute the hash key for storing the result, based on the
 * arguments to the original function. The default hashFunction just uses the
 * first argument as the key. The last argument of the returned function is
 * assumed to be a callback function and is not passed to the given func, but
 * called from the returned function and those results are returned from it.
 */
module.exports = function(func, hashFn, poolSize, loadFactor) {
    const size = _.isFinite(hashFn) ? hashFn : poolSize || 1;
    const maxPoolSize = Math.ceil(size / ((_.isFinite(hashFn) ? poolSize : loadFactor) || 0.75));
    const hash = _.isFunction(hashFn) ? hashFn : _.identity.bind(_);
    const cache = {};
    const debounced = debounce(sweep, 10000, maxPoolSize);
    const releaseEntry = release.bind(this, debounced, size, cache);
    let closed = false;
    const cached = async function() {
        if (closed) throw Error(`Cache has been closed ${closed}`);
        const cb = _.isFunction(_.last(arguments)) ? _.last(arguments) : (err, result) => {
            if (err) throw err;
            else return result;
        };
        const args = _.isFunction(_.last(arguments)) ? _.initial(arguments) : arguments;
        const key = hash.apply(cached, args);
        if (cache[key] && cache[key].closing) {
            await cache[key].closing;
            const entry = cache[key] = {
                id: key,
                heap_before: size > 1 ? process.memoryUsage().heapUsed : null,
                result: func.apply(cached, args),
                registered: 0,
                locks: []
            };
            return aquireEntry(releaseEntry, entry, cb);
        } else if (cache[key]) {
            const entry = cache[key];
            return aquireEntry(releaseEntry, entry, cb);
        } else {
            const entry = cache[key] = {
                id: key,
                heap_before: size > 1 ? process.memoryUsage().heapUsed : null,
                result: func.apply(this, args),
                registered: 0,
                locks: []
            };
            return aquireEntry(releaseEntry, entry, cb);
        }
    };
    cached.replaceEntry = (key, result) => {
        cache[key] = {
            id: key,
            heap_before: size > 1 ? process.memoryUsage().heapUsed : null,
            result: result,
            error: null,
            registered: 0,
            locks: [],
            age: 0,
            marked: false
        };
    };
    cached.size = () => _.size(cache);
    cached.flush = () => {
        _.forEach(cache, entry => entry.marked = true);
        return sweep(cache);
    };
    cached.close = async(closedBy) => {
        closed = closedBy || 'already';
        await Promise.all(_.map(cache, async(entry) => {
            await Promise.all(entry.locks.map(lock => lock.catch(err => {})));
            entry.marked = true;
        }));
        return Promise.all([
            debounced.close(),
            sweep(cache)
        ]);
    };
    return cached;
}

function aquireEntry(releaseEntry, entry, cb) {
    try {
        aquire(entry);
        const next = entry.result && _.isFunction(entry.result.then) ?
            entry.result.then(
                result => cb.call(this, null, result),
                err => cb.call(this, err)
            ) : cb.call(this, entry.error, entry.result);
        if (next && _.isFunction(next.catch)) entry.locks.push(next);
        if (next && _.isFunction(next.then)) return next.then(result => {
            releaseEntry(entry, next);
            return result;
        }, err => {
            releaseEntry(entry, next);
            throw err;
        });
        releaseEntry(entry, next);
        return next;
    } catch(err) {
        releaseEntry(entry, next);
        throw err;
    }
}

function aquire(entry) {
    entry.registered++;
    entry.age = 0;
    entry.marked = false;
}

function release(sweep, size, cache, entry, lock) {
    _.forEach(cache, entry => !entry.registered && !entry.marked && entry.age++);
    entry.registered--;
    if (!entry.heap_after && size > 1) entry.heap_after = process.memoryUsage().heapUsed;
    const heap_avail_size = size > 1 ? availableHeapSize(cache) : size;
    const limit = Math.min(size, heap_avail_size);
    const idx = entry.locks.indexOf(lock);
    if (idx >= 0) entry.locks.splice(idx, 1);
    while(_.reject(cache, 'marked').length > limit && mark(cache));
    sweep(cache);
}

/**
 * Keep checking available heap size and compare memory growth rate. Try to keep
 * as much heap available as has been observed by the heap growth while aquiring
 * cache entries.
 */
function availableHeapSize(cache) {
    const sample = Object.values(cache).filter(entry => entry.heap_before < entry.heap_after);
    const heap_growth_rate = sample.reduce((total, entry) => {
        return total + entry.heap_after - entry.heap_before;
    }, 0) / sample.length;
    if (!sample.length || !heap_growth_rate) return Infinity;
    const usage = process.memoryUsage();
    const heap_avail = (heap_limit || usage.heapTotal) - usage.heapUsed;
    return Math.floor(heap_avail/heap_growth_rate);
}

function mark(cache) {
    const oldest = _.reject(cache, 'marked').reduce((oldest, base) => {
        if (base.registered || oldest && oldest.age >= base.age)
            return oldest;
        else
            return base;
    }, null);
    if (oldest) oldest.marked = true;
    return oldest && oldest.marked;
}

function sweep(cache) {
    return Promise.all(_.map(_.pick(cache, _.property('marked')), (entry, id) => {
        if (entry.closing) return entry.closing;
        const closing = closeEntry(entry);
        if (!closing) delete cache[id];
        else return entry.closing = Promise.resolve(closing).then(result => {
            delete cache[id];
            return result;
        }, err => {
            delete cache[id];
            logger.debug("Cache entry close", err);
        });
    }));
}

function closeEntry(entry) {
    try {
        if (entry.result && _.isFunction(entry.result.then)) {
            return entry.result.catch(err => {})
                .then(obj => obj && _.isFunction(obj.close) ? obj.close() : obj);
        } else if (entry.result && _.isFunction(entry.result.close)) {
            const closing = entry.result.close();
            if (closing && _.isFunction(closing.then)) return closing;
        }
    } catch(err) {
        logger.debug("Cache entry close", err);
    }
}
