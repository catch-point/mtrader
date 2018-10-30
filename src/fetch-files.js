// fetch-files.js
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

const fs = require('graceful-fs');
const path = require('path');
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const config = require('./config.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const storage = require('./storage.js');

module.exports = function() {
    var fallbacks = _.mapObject(_.object(
            config('fetch.files.fallback') || _.compact([
                (config('fetch.yahoo.enabled') || !config('fetch.iqfeed.enabled')) && 'yahoo',
                config('fetch.iqfeed.enabled') && 'iqfeed'
            ]), []), (nil, fallback) => {
        return 'yahoo' == fallback ? yahoo() :
            'iqfeed' == fallback ? iqfeed() :
            null;
    });
    var dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    var dirname = config('fetch.files.dirname') || dir;
    var store = Promise.resolve(storage(dirname));
    var open = (name, cb) => store.then(store => store.open(name, cb));
    return {
        close() {
            return Promise.all(_.map(fallbacks, fb => fb.close()))
                .then(() => store).then(store => store.close());
        },
        help: readOrWriteHelp.bind(this, fallbacks, open, 'help'),
        lookup: readOrWriteResult.bind(this, fallbacks, open, 'lookup'),
        fundamental: readOrWriteResult.bind(this, fallbacks, open, 'fundamental'),
        interday: readOrWriteResult.bind(this, fallbacks, open, 'interday'),
        intraday: readOrWriteResult.bind(this, fallbacks, open, 'intraday')
    };
};

function readOrWriteHelp(fallbacks, open, name) {
    return open(name, (err, db) => {
        if (err) throw err;
        return db.collection(name).then(coll => coll.lockWith([name], names => {
            return Promise.resolve().then(() => {
                if (coll.exists(name))
                    return coll.readFrom(name).then(result => result.map(help => _.defaults({
                        // need to restore columns into objects
                        options: _.isString(help.options) ?
                            JSON.parse(help.options) : help.options,
                        properties: _.isString(help.properties) ?
                            JSON.parse(help.properties) : help.properties
                    }, help))).catch(err => {});
            }).then(result => {
                if (result)
                    return result;
                else if (_.isEmpty(fallbacks))
                    throw Error("Data file not found " + coll.filenameOf(name));
                else return help(_.values(fallbacks)).then(result => {
                    return coll.writeTo(result.map(datum => _.extend({}, datum, {
                        options: JSON.stringify(datum.options),
                        properties: JSON.stringify(datum.properties)
                    })), name).then(() => result);
                });
            });
        }));
    });
}

function help(datasources) {
    return Promise.all(_.map(datasources, datasource => {
        return datasource.help();
    })).then(helps => {
        var groups = _.values(_.groupBy(_.flatten(helps), 'name'));
        return groups.map(helps => helps.reduce((help, h) => {
            var options = _.extend({}, h.options, help.options);
            return {
                name: help.name || h.name,
                usage: help.usage || h.usage,
                description: help.description || h.description,
                properties: _.union(help.properties, h.properties),
                options: _.mapObject(options, (option, name) => {
                    if (option.values && h.options[name] && h.options[name].values) return _.defaults({
                        values: _.compact(_.flatten([options.values, h.options[name].values], true))
                    }, option);
                    else if (option.values || h.options[name] && h.options[name].values) return _.defaults({
                        values: options.values || h.options[name] && h.options[name].values
                    }, option);
                    else return option;
                })
            };
        }, {}));
    });
}

function readOrWriteResult(fallbacks, open, cmd, options) {
    var args = _.compact(_.pick(options, 'interval', 'minutes', 'begin', 'end'));
    var name = options.market ? options.symbol + '.' + options.market : options.symbol;
    return open(name, (err, db) => {
        if (err) throw err;
        return db.collection(cmd).then(coll => coll.lockWith([name], names => {
            var name = _.map(args, arg => safe(arg)).join('.') || 'result';
            if (coll.exists(name)) return coll.readFrom(name);
            else if (_.isEmpty(fallbacks))
                throw Error("Data file not found " + coll.filenameOf(name));
            else return _.reduce(fallbacks, (promise, fb, source) => promise.catch(err => {
                if (!(options.interval == 'lookup' && config(['fetch', source, 'lookup'])) &&
                        !(options.interval == 'fundamental' && config(['fetch', source, 'fundamental'])) &&
                        !_.contains(config(['fetch', source, 'interday']), options.interval) &&
                        !_.contains(config(['fetch', source, 'intraday']), options.interval))
                    throw (err || Error("No fallback available for " + options.interval));
                var opt = _.defaults({}, options);
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
