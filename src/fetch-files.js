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
'use strict';

const fs = require('graceful-fs');
const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const version = require('./version.js').toString();
const logger = require('./logger.js');
const config = require('./config.js');
const storage = require('./storage.js');
const Fetch = require('./fetch.js');

module.exports = function(settings = {}) {
    const fetch = new Fetch(merge(config('fetch'), {files:{enabled:false}}, settings.fetch));
    const dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const dirname = settings.dirname || dir;
    const store = storage(dirname);
    const open = (name, cb) => store.open(name, cb);
    return Object.assign(async(options) => {
        if (options.info=='version') return [{version}];
        if (options.info=='help') return readOrWriteHelp(fetch, open, 'help', options);
        if (options.info) return [];
        switch(options.interval) {
            case 'lookup': return readOrWriteResult(fetch, open, 'lookup', _.omit(options, 'begin', 'end'));
            case 'contract': return readOrWriteResult(fetch, open, 'contract', _.omit(options, 'begin', 'end'));
            case 'fundamental': return readOrWriteResult(fetch, open, 'fundamental', _.omit(options, 'begin', 'end'));
            case 'year':
            case 'quarter':
            case 'month':
            case 'week':
            case 'day': return readOrWriteResult(fetch, open, 'interday', options);
            default: return readOrWriteResult(fetch, open, 'intraday', options);
        }
    }, {
        async close() {
            await fetch.close();
            return store.close();
        }
    });
};

function readOrWriteHelp(fetch, open, name) {
    return open(name, async(err, db) => {
        if (err) throw err;
        const coll = await db.collection(name);
        return coll.lockWith([name], async(names) => {
            const result = coll.exists(name) && await coll.readFrom(name)
              .then(result => result.map(help => _.defaults({
                // need to restore columns into objects
                options: _.isString(help.options) ?
                    JSON.parse(help.options) : help.options,
                properties: _.isString(help.properties) ?
                    JSON.parse(help.properties) : help.properties
            }, help))).catch(err => {});
            if (result)
                return result;
            else return fetch({info:'help'}).then(async(result) => {
                logger.debug("fetch-files", coll.filenameOf(name));
                await coll.writeTo(result.map(datum => _.extend({}, datum, {
                    options: JSON.stringify(datum.options),
                    properties: JSON.stringify(datum.properties)
                })), name);
                return result;
            });
        });
    });
}

function readOrWriteResult(fetch, open, cmd, options) {
    const args = _.compact(_.pick(options, 'interval', 'begin', 'end'));
    const name = options.market ? options.symbol + '.' + options.market : options.symbol;
    return open(name, async(err, db) => {
        if (err) throw err;
        const coll = await db.collection(cmd);
        return coll.lockWith([name], async(names) => {
            const name = _.map(args, arg => safe(arg)).join('.') || 'result';
            if (coll.exists(name)) return coll.readFrom(name);
            else {
                logger.debug("fetch-files for", coll.filenameOf(name));
                const result = await fetch(options);
                await coll.writeTo(result, name)
                return result;
            }
        });
    });
}

function safe(segment) {
    if (_.isObject(segment) && segment.toJSON) return safe(segment.toJSON());
    if (_.isObject(segment)) return safe(segment.toString());
    else if (!_.isString(segment)) return safe('' + segment);
    else return segment.replace(/\W+/g,'_');
}
