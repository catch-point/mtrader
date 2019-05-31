// lookup.js
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
const util = require('util');
const _ = require('underscore');
const moment = require('moment-timezone');
const awriter = require('./atomic-write.js');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

const tz = (moment.defaultZone||{}).name || moment.tz.guess();

/**
 * @returns a function that returns an object about the security in the given options
 */
module.exports = function(fetch) {
    const fetchOnline = fetchOptionsFactory(fetch, false, false);
    const fetchReadOnly = fetchOptionsFactory(fetch, false, true);
    const fetchOffline = fetchOptionsFactory(fetch, true, true);
    const self = function(options) {
        return options.offline ? fetchOffline(options) :
            options.read_only ? fetchReadOnly(options) : fetchOnline(options);
    };
    self.close = () => Promise.resolve();
    return self;
};

/**
 * @returns a function that returns an object about the security in the given options
 */
function fetchOptionsFactory(fetch, offline, read_only) {
    const dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const memoizeFirstLookup = _.memoize((symbol, market) => {
        return readInfo(dir, symbol, market, offline).catch(async(err) => {
            if (offline) throw err;
            const matches = await fetch({
                interval: 'lookup',
                symbol: symbol,
                market: market,
                tz
            });
            const security = _.first(matches);
            if (_.isEmpty(security))
                throw Error("Unknown symbol: " + (market ? symbol + '.' + market:market));
            else if (security.symbol != symbol)
                throw Error("Unknown symbol: " + symbol + ", but " + security.symbol + " is known");
            else if (read_only) return security;
            else return saveInfo(dir, symbol, market, security);
        });
    }, (symbol, market) => {
        return market ? symbol + ' ' + market : symbol;
    });
    return function(options) {
        expect(options).to.have.property('symbol');
        const symbol = options.symbol.toUpperCase();
        const market = options.market;
        const markets = config('markets');
        return memoizeFirstLookup(symbol, market).then(security => {
            return _.defaults({},
                security,
                options,
                markets[security.market] && convertTime(markets[security.market]),
                markets[security.market] && {
                    currency: markets[security.market].currency,
                    security_type: markets[security.market].default_security_type
                }
            );
        }, err => {
            memoizeFirstLookup.cache = {};
            if (!market) throw err;
            logger.debug("Fetch lookup failed on ", symbol + '.' + market, err);
            return _.defaults({},
                options,
                markets[market] && convertTime(markets[market]),
                markets[market] && {
                    currency: markets[market].currency,
                    security_type: markets[market].default_security_type
                }
            );
        });
    };
}

function convertTime(market) {
    const mtz2tz = time => moment.tz('2010-03-01T' + time, market.market_tz).tz(tz).format('HH:mm:ss');
    return {
        afterHoursClosesAt: mtz2tz(market.trading_hours.substring(market.trading_hours.length - 8)),
        marketClosesAt: mtz2tz(market.liquid_hours.substring(market.liquid_hours.length - 8)),
        marketOpensAt: mtz2tz(market.liquid_hours.substring(0, 8)),
        premarketOpensAt: mtz2tz(market.trading_hours.substring(0, 8)),
        tz
    };
}

async function readInfo(dir, symbol, market, offline) {
    const yesterday = offline ? 0 : Date.now() - 24 *60 * 60 *1000;
    const file = getInfoFileName(dir, symbol, market);
    const stats = await util.promisify(fs.stat)(file);
    if (stats.mtime.valueOf() <= yesterday)
        throw Object.assign(Error("too old"), {file: file, mtime: stats.mtime});
    const data = await util.promisify(fs.readFile)(file, 'utf-8');
    return JSON.parse(data);
}

async function saveInfo(dir, symbol, market, info) {
    const file = getInfoFileName(dir, symbol, market);
    const data = JSON.stringify(info, null, '  ') + '\n';
    await awriter.writeFile(file, data);
    return info;
}

function getInfoFileName(dir, symbol, market) {
    return path.resolve(dir, market || '', safe(symbol), 'info.json');
}

function safe(segment) {
    expect(segment).is.ok.and.not.be.a('object').and.not.be.a('function');
    if (!_.isString(segment)) return safe('' + segment);
    else if (segment.match(/^[\w._-]+$/)) return segment;
    else return segment.replace(/[^\w.-]+/g,'_');
}
