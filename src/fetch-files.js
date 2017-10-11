// fetch-files.js
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
const moment = require('moment-timezone');
const config = require('./config.js');
const google = require('./fetch-google.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const storage = require('./storage.js');

module.exports = function() {
    var fallbacks = _.mapObject(_.object(_.intersection(
        config('files.fallback') || [],
        _.compact([
            config('google.enabled') && 'google',
            config('yahoo.enabled') && 'yahoo',
            config('iqfeed.enabled') && 'iqfeed'
        ])
    ), []), (nil, fallback) => {
        return 'google' == fallback ? google() :
            'yahoo' == fallback ? yahoo() :
            'iqfeed' == fallback ? iqfeed() :
            null;
    });
    var dirname = config('files.dirname') || path.resolve(config('prefix'), 'var/');
    var store = Promise.resolve(storage(dirname));
    config.addListener((name, value) => {
        if (name == 'files.dirname') {
            store = store.then(store => store.close()).then(() => storage(value));
        }
    });
    var open = (name, cb) => store.then(store => store.open(name, cb));
    return {
        offline: true,
        close() {
            return Promise.all(_.map(fallbacks, fb => fb.close()))
                .then(() => store).then(store => store.close());
        },
        lookup: readOrWriteResult.bind(this, fallbacks, open, 'lookup'),
        fundamental: readOrWriteResult.bind(this, fallbacks, open, 'fundamental'),
        interday: readOrWriteResult.bind(this, fallbacks, open, 'interday'),
        intraday: readOrWriteResult.bind(this, fallbacks, open, 'intraday')
    };
};

function readOrWriteResult(fallbacks, open, cmd, options) {
    var args = _.compact(_.pick(options, 'interval', 'minutes', 'begin', 'end'));
    var name = options.exchange ? options.symbol + '.' + options.exchange : options.symbol;
    return open(name, (err, db) => {
        if (err) throw err;
        return db.collection(cmd).then(coll => coll.lockWith([name], names => {
            var name = _.map(args, arg => safe(arg)).join('.') || 'result';
            if (coll.exists(name)) return coll.readFrom(name);
            else if (options.offline || _.isEmpty(fallbacks))
                throw Error("Data file not found " + coll.filenameOf(name));
            else return _.reduce(fallbacks, (promise, fb, source) => promise.catch(err => {
                var datasource = config(['exchanges', options.exchange, 'datasources', source]);
                if (!datasource || !_.contains(datasource.fetch, options.interval)) throw err;
                var opt = _.defaults({}, options, _.omit(datasource, 'fetch'));
                return fb[cmd](opt).then(result => {
                    return coll.writeTo(result, name).then(() => result);
                });
            }), Promise.reject());
        }));
    });
}

function safe(segment) {
    if (_.isObject(segment) && segment.toJSON) return safe(segment.toJSON());
    if (_.isObject(segment)) return safe(segment.toString());
    else if (!_.isString(segment)) return safe('' + segment);
    else return segment.replace(/\W+/g,'_');
}
