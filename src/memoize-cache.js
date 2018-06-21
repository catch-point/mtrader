// memoize-cache.js
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

const _ = require('underscore');
const debounce = require('./debounce.js');

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
    var size = _.isFinite(hashFn) ? hashFn : poolSize || 1;
    var maxPoolSize = Math.ceil(size / ((_.isFinite(hashFn) ? poolSize : loadFactor) || 0.75));
    var hash = _.isFunction(hashFn) ? hashFn : _.identity.bind(_);
    var cache = {};
    var debounced = debounce(sweep, 10000, maxPoolSize);
    var releaseEntry = release.bind(this, debounced, size, cache);
    var cached = function() {
        var cb = _.isFunction(_.last(arguments)) ? _.last(arguments) : (err, result) => {
            if (err) throw err;
            else return result;
        };
        var args = _.isFunction(_.last(arguments)) ? _.initial(arguments) : arguments;
        var key = hash.apply(this, args);
        var entry = cache[key] ? cache[key] : cache[key] = {
            id: key,
            result: func.apply(this, args),
            registered: 0
        };
        try {
            aquire(entry);
            var next = entry.result && _.isFunction(entry.result.then) ?
                entry.result.then(
                    result => cb.call(this, null, result),
                    err => cb.call(this, err)
                ) : cb.call(this, entry.error, entry.result);
            if (next && _.isFunction(next.then)) return next.then(result => {
                releaseEntry(entry);
                return result;
            }, err => {
                releaseEntry(entry);
                throw err;
            });
            releaseEntry(entry);
            return next;
        } catch(err) {
            releaseEntry(entry);
            throw err;
        }
    };
    cached.replaceEntry = (key, result) => {
        cache[key] = {
            id: key,
            result: result,
            error: null,
            registered: 0,
            age: 0,
            marked: false
        };
    };
    cached.flush = () => {
        _.forEach(cache, entry => entry.marked = true);
        return sweep(cache);
    };
    cached.close = () => {
        _.forEach(cache, entry => entry.marked = true);
        return Promise.all([
            debounced.close(),
            sweep(cache)
        ]);
    };
    return cached;
}

function createEntry(key, func, args) {
    try {
        return {
            id: key,
            result: func.apply(this, args),
            registered: 0
        };
    } catch(err) {
        return {
            id: key,
            error: err,
            registered: 0
        };
    }
}

function aquire(entry) {
    entry.registered++;
    entry.age = 0;
    entry.marked = false;
}

function release(sweep, size, cache, entry) {
    _.forEach(cache, entry => !entry.registered && !entry.marked && entry.age++);
    entry.registered--;
    while(_.reject(cache, 'marked').length > size)
        mark(cache);
    sweep(cache);
}

function mark(cache) {
    var oldest = _.reject(cache, 'marked').reduce((oldest, base) => {
        if (base.registered || oldest && oldest.age >= base.age)
            return oldest;
        else
            return base;
    });
    if (oldest) oldest.marked = true;
}

function sweep(cache) {
    return Promise.all(_.map(_.pick(cache, _.property('marked')), (entry, id) => {
        try {
            if (entry.result && _.isFunction(entry.result.then))
                return entry.result
                    .then(obj => _.isFunction(obj.close) ? obj.close() : obj);
            else if (entry.result && _.isFunction(entry.result.close))
                return entry.result.close();
        } finally {
            delete cache[id];
        }
    }));
}
