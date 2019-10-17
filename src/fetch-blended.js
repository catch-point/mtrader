// fetch-blended.js
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
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const config = require('./config.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const Fetch = require('./fetch.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

module.exports = function(settings = {}) {
    const cfg = settings.config ? readConfig(settings.config, settings) : settings;
    if (_.isEmpty(cfg)) throw Error("Missing fetch blended config");
    expect(cfg).to.have.property('assets').that.is.an('array');
    const delegate = new Fetch(merge(_.omit(config('fetch'), 'blended'), settings.fetch));
    const markets = _.uniq(cfg.assets.map(asset => asset.market));
    return Object.assign(async(options) => {
        if (options.info=='version') return [{version}];
        if (options.info=='help')
            return delegate({info:'help'}).then(_.flatten).then(info => info.map(interday => {
                if (!interday.options || !interday.options.market) return info;
                else return merge(interday, {options: {market: {
                    values: markets
                }}});
            }));
        const dayFn = day.bind(this, blendCall.bind(this, delegate, cfg, 'interday'));
        switch(options.interval) {
            case 'lookup': return lookup(delegate, cfg, 'lookup', options);
            case 'fundamental': return delegateCall(delegate, cfg, 'fundamental', options);
            case 'day': return dayFn(options);
            default: return delegateCall(delegate, cfg, 'intraday', options);
        }
    }, {
        close() {
            return Promise.resolve(delegate && delegate.close());
        }
    });
};

function readConfig(name, settings = {}) {
    const filename = config.resolve(name);
    const base = path.dirname(filename);
    const cfg = _.extend({base}, config.read(filename), settings);
    return cfg;
}

function lookup(delegate, cfg, cmd, options) {
    return delegateCall(delegate, cfg, cmd, options).then(result => result.map(item => {
        const asset = cfg.assets.find(a => _.matcher(a.underlying)(item));
        return _.defaults(_.omit(asset, 'underlying', 'blend'), item);
    }));
}

function delegateCall(delegate, cfg, cmd, options) {
    const asset = findAsset(cfg, cmd, options);
    const market = asset && asset.underlying && asset.underlying.market ?
        _.omit(config('markets')[asset.underlying.market], 'datasources', 'label', 'description') : null;
    const hours = market && options.tz ? convertTime(market, options.tz) : null;
    const opts = !asset || !asset.underlying ? options :
        _.defaults({}, asset && asset.underlying, market, hours, options);
    return delegate(opts);
}

function convertTime(market, tz) {
    const mtz2tz = time => moment.tz('2010-03-01T' + time, market.market_tz).tz(tz).format('HH:mm:ss');
    return {
        afterHoursClosesAt: mtz2tz(market.trading_hours.substring(market.trading_hours.length - 8)),
        marketClosesAt: mtz2tz(market.liquid_hours.substring(market.liquid_hours.length - 8)),
        marketOpensAt: mtz2tz(market.liquid_hours.substring(0, 8)),
        premarketOpensAt: mtz2tz(market.trading_hours.substring(0, 8))
    };
}

function blendCall(delegate, cfg, cmd, options) {
    const asset = findAsset(cfg, cmd, options);
    if (!asset || !asset.blend)
        return delegateCall(delegate, cfg, cmd, _.defaults({interval: 'day'}, options));
    const end = options.end && moment.tz(options.end, options.tz).format(options.ending_format);
    return asset.blend.reduceRight((promise, blend, i) => promise.then(result => {
        return readData(cfg, blend, options).then(part => {
            if (i == asset.blend.length-1) {
                const begining = _.isEmpty(part) && moment.tz(options.begin, options.tz).format(options.ending_format);
                const ending = !_.isEmpty(part) && _.last(part).ending;
                const earlier = _.last(_.sortBy(_.compact([begining, ending])));
                const later = _.last(_.sortBy(_.compact([end, ending])));
                if (end && later > end) return part;
                else return delegateCall(delegate, cfg, cmd, _.defaults({
                    interval: 'day',
                    begin: earlier,
                    end: later != earlier ? later : undefined
                }, options)).then(data => {
                    result = data;
                    return part;
                });
            } else {
                return part;
            }
        }).then(part => {
            if (_.isEmpty(result)) return part;
            const next = _.last(part);
            let overlap = _.sortedIndex(result, next, 'ending');
            if (!result[overlap] || result[overlap].ending > next.ending) overlap--;
            if (!result[overlap])
                return part.concat(result);
            else if (next.adj_close == result[overlap].adj_close)
                return part.concat(result.slice(overlap+1));
            const scale = result[overlap].adj_close / next.adj_close;
            return part.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}))
                .concat(result.slice(overlap+1));
        });
    }), Promise.resolve([]));
}

function findAsset(cfg, cmd, options) {
    expect(cfg).to.have.property('assets').that.is.an('array');
    return cfg.assets.find(asset => asset.symbol == options.symbol && asset.market == options.market);
}

function readData(cfg, blend, options) {
    if (!blend.data) expect(blend).to.have.property('filename');
    const file = blend.filename && path.resolve(cfg.base, blend.filename);
    return Promise.resolve(file ? new Promise((present, absent) => {
        fs.access(file, fs.R_OK, err => err ? absent(err) : present(file));
    }).then(present => readTable(file), absent => {
        throw Error(`Could not read ${file} ${absent.message}`);
    }) : blend.data);
}

function readTable(filename) {
    return new Promise((ready, error) => {
        const objects = new Array();
        csv.fromStream(fs.createReadStream(filename), {headers : true, ignoreEmpty: true})
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

function day(readTable, options) {
    expect(options).to.have.property('tz').that.is.a('string');
    return readTable(options).then(result => {
        const begin = moment.tz(options.begin, options.tz);
        const start = begin.format(options.ending_format);
        const first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        const end = moment.tz(options.end || now, options.tz);
        if (end.isAfter()) return result;
        const final = end.format(options.ending_format);
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}
