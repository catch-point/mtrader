// fetch-ivolatility.js
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
const moment = require('moment-timezone');
const Big = require('big.js');
const d3 = require('d3-format');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const logger = require('./logger.js');
const share = require('./share.js');
const iqfeed = require('./fetch-iqfeed.js');
const Ivolatility = require('./ivolatility-client.js');
const expect = require('chai').expect;

function help(settings = {}) {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: settings.markets
        },
        iv_symbol: {
            description: "Symbol used by ivolatility.com"
        }
    };
    const tzOptions = {
        open_time: {
            description: "The time of day that the open value of the daily bar in recorded"
        },
        liquid_hours: {
            description: "Regular trading hours in the format 'hh:mm:00 - hh:mm:00'"
        },
        trading_hours: {
            description: "Trading hours in the format 'hh:mm:00 - hh:mm:00'"
        },
        security_tz: {
            description: "Timezone of liquid_hours using the identifier in the tz database"
        },
        tz: {
            description: "Timezone used to format the ending field, using the identifier in the tz database"
        },
        ending_format: {
            description: "Date and time format of the resulting ending field"
        }
    };
    const durationOptions = {
        begin: {
            example: "YYYY-MM-DD",
            description: "Sets the earliest date (or dateTime) to retrieve"
        },
        end: {
            example: "YYYY-MM-DD HH:MM:SS",
            description: "Sets the latest dateTime to retrieve"
        }
    };
    const contract = {
        name: "contract",
        usage: "contract(options)",
        description: "Looks up existing symbol/market using the given symbol",
        properties: ['symbol', 'market', 'name', 'security_type', 'currency', 'open_time', 'trading_hours', 'liquid_hours', 'security_tz'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["contract"]
            },
        })
    };
    const interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic interday data for options using an ivolatility.com account",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "year|quarter|month|week|day",
                description: "The bar timeframe for the results",
                values: _.intersection(["day"], settings.intervals)
            },
        })
    };
    return _.compact([
        contract,
        interday
    ]);
}

const shared_clients = {};

module.exports = function(settings = {}) {
    const markets = _.pick(config('markets'), settings.markets);
    const cache_dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const cacheDir = settings.cache || path.resolve(cache_dir, 'ivolatility');
    const libDir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const downloadDir = settings.downloads || path.resolve(libDir, 'ivolatility');
    const auth_file = settings.auth_file &&
        path.resolve(config('prefix'), 'etc', settings.auth_file);
    const downloadType = settings.downloadType;
    if (downloadType) expect(downloadType).to.be.oneOf(['DAILY_ONLY', 'EXCEPT_DAILY', 'ALL']);
    const shared = shared_clients[cacheDir] = shared_clients[cacheDir] || share(Ivolatility, () => {
        delete shared_clients[cacheDir];
    });
    const ivolatility = shared(cacheDir, downloadDir, auth_file, downloadType);
    return Object.assign(async(options) => {
        if (options.info=='help') return help(settings);
        if (options.info=='version') return [{version}];
        if (options.info) return [];
        switch(options.interval) {
            case 'contract': return contract(markets, options);
            case 'day': return interday(ivolatility, options);
            default: expect(options.interval).to.be.oneOf(['contract', 'day']);
        }
    }, {
        close() {
            return ivolatility.close();
        }
    });
};

async function contract(markets, options) {
    if (options.market && options.market != 'OPRA') return [];
    const symbol = options.symbol;
    const market = markets[options.market] || {};
    if (symbol.length != 21) throw Error(`Option symbol must have 21 bytes ${symbol}`);
    const underlying = symbol.substring(0, 6);
    const year = symbol.substring(6, 8);
    const month = symbol.substring(8, 10);
    const day = symbol.substring(10, 12);
    const right = symbol.charAt(12);
    const dollar = symbol.substring(13, 18);
    const decimal = symbol.substring(18, 21);
    const strike = +Big(dollar).add(Big(decimal).div(1000));
    const exdate = `20${year}-${month}-${day}`;
    const expiry = moment.tz(exdate, options.tz);
    return [{
        symbol: symbol,
        market: 'OPRA',
        name: `${underlying.trim()} ${expiry.format('MMM Y')} ${right} ${strike}`,
        security_type: market.default_security_type,
        currency: market.currency,
        security_tz: market.security_tz,
        open_time: market.open_time,
        trading_hours: market.trading_hours,
        liquid_hours: market.liquid_hours
    }];
}

function isOptionActive(symbol, begin, end) {
    if (symbol.length != 21) throw Error(`Option symbol must have 21 bytes ${symbol}`);
    const underlying = symbol.substring(0, 6);
    const year = symbol.substring(6, 8);
    const month = symbol.substring(8, 10);
    const day = symbol.substring(10, 12);
    const right = symbol.charAt(12);
    const dollar = symbol.substring(13, 18);
    const decimal = symbol.substring(18, 21);
    const exdate = `20${year}-${month}-${day}`;
    const expiry = moment(exdate).endOf('day');
    const issued = month == '01' ?
        moment(expiry).subtract(3, 'years') :
        moment(expiry).subtract(9, 'months');
    return expiry.isAfter(begin) && issued.isBefore(end);
}

function interday(ivolatility, options) {
    expect(options).to.have.property('symbol');
    expect(options.interval).to.be.oneOf(['day']);
    const readTable = loadIvolatility.bind(this, ivolatility.interday);
    const now = moment.tz(options.now, options.tz);
    const begin = moment.tz(options.begin, options.tz);
    const end = moment.tz(options.end || now, options.tz);
    if (!isOptionActive(options.symbol, begin, end)) return Promise.resolve([]);
    return readTable(options).then(result => {
        const start = begin.format(options.ending_format);
        const first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        if (end.isAfter()) return result;
        const final = end.format(options.ending_format);
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

async function loadIvolatility(ivolatility, options) {
    const data = await ivolatility(options)
    return data.map(datum => {
        const mid = +Big(datum.ask).add(datum.bid).div(2);
        const mdy = datum.date.match(/^(\d\d)\/(\d\d)\/(\d\d\d\d)$/);
        const close_time = options.liquid_hours.substring(options.liquid_hours.length - 8);
        const closes = moment.tz(`${mdy[3]}-${mdy[1]}-${mdy[2]}T${close_time}`, options.security_tz);
        return {
            ending: closes.tz(options.tz).format(options.ending_format),
            open: mid,
            high: mid,
            low: mid,
            close: mid,
            volume: datum.volume,
            adj_close: mid
        };
    });
}
