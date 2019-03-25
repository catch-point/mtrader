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
const csv = require('fast-csv');
const moment = require('moment-timezone');
const d3 = require('d3-format');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const logger = require('./logger.js');
const periods = require('./periods.js');
const iqfeed = require('./fetch-iqfeed.js');
const IB = require('./ib-client.js');
const Ivolatility = require('./ivolatility-client.js');
const expect = require('chai').expect;

function help() {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: config('fetch.ivolatility.markets')
        },
        iv_symbol: {
            description: "Symbol used by ivolatility.com"
        }
    };
    const tzOptions = {
        marketClosesAt: {
            description: "Time of day that the market closes"
        },
        tz: {
            description: "Timezone of the market formatted using the identifier in the tz database"
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
    const lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/market using the given symbol",
        properties: ['symbol', 'market', 'name', 'secType'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["lookup"]
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
                values: _.intersection(["day"], config('fetch.ivolatility.intervals'))
            },
        })
    };
    return _.compact([
        lookup,
        interday
    ]);
}

module.exports = function() {
    const cacheDir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const libDir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const downloadDir = config('fetch.ivolatility.downloads') || path.resolve(libDir, 'ivolatility');
    const auth_file = config('fetch.ivolatility.auth_file');
    const downloadType = config('fetch.ivolatility.downloadType');
    if (downloadType) expect(downloadType).to.be.oneOf(['DAILY_ONLY', 'EXCEPT_DAILY', 'ALL']);
    const ib_cfg = config('fetch.ivolatility.ib');
    const ib = ib_cfg && new IB(ib_cfg.host, ib_cfg.port, ib_cfg.clientId);
    const ivolatility = Ivolatility(cacheDir, downloadDir, auth_file, downloadType);
    return Object.assign(options => {
        if (options.help) return Promise.resolve(help());
        switch(options.interval) {
            case 'lookup': return lookup(options);
            case 'day': return interday(ivolatility, ib, options);
            default: expect(options.interval).to.be.oneOf(['lookup', 'day']);
        }
    }, {
        close() {
            return Promise.all([
                ib && ib.close(),
                ivolatility.close()
            ]);
        }
    });
};

async function lookup(options) {
    if (options.market && options.market != 'OPRA') return [];
    const symbol = options.symbol;
    if (symbol.length != 21) throw Error(`Option symbol must have 21 bytes ${symbol}`);
    const underlying = symbol.substring(0, 6);
    const year = symbol.substring(6, 8);
    const month = symbol.substring(8, 10);
    const day = symbol.substring(10, 12);
    const right = symbol.charAt(12);
    const dollar = symbol.substring(13, 18);
    const decimal = symbol.substring(18, 21);
    const mo = right_month_alpha[right][month];
    const strike = +dollar + +decimal / 1000;
    const exdate = `20${year}-${month}-${day}`;
    const expiry = moment.tz(exdate, options.tz);
    return [{
        symbol: symbol,
        market: 'OPRA',
        secType: 'OPT',
        name: `${underlying.trim()} ${expiry.format('MMM Y')} ${right} ${strike}`,
        strike_price: strike,
        expiration_date: exdate
    }];
}

const months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
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

function interday(ivolatility, ib, options) {
    expect(options).to.have.property('symbol');
    expect(options).to.have.property('marketClosesAt');
    expect(options.interval).to.be.oneOf(['day']);
    const readTable = loadIvolatility.bind(this, ivolatility.interday);
    const now = moment.tz(options.now, options.tz);
    const begin = moment.tz(options.begin, options.tz);
    const end = moment.tz(options.end || now, options.tz);
    if (!isOptionActive(options.symbol, begin, end)) return Promise.resolve([]);
    return readTable(options).then(result => {
        const start = begin.format();
        const first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        if (end.isAfter()) return result;
        const final = end.format();
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    }).then(async(adata) => {
        if (!ib) return adata;
        if (adata.length) {
            if (now.days() === 0 || now.days() === 6) return adata;
            const tz = options.tz;
            const opensAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.premarketOpensAt, tz);
            const closesAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.afterHoursClosesAt, tz);
            if (!opensAt.isBefore(closesAt)) opensAt.subtract(1, 'day');
            if (opensAt.isValid() && now.isBefore(opensAt)) return adata;
            if (closesAt.isValid() && !closesAt.isAfter(_.last(adata).ending)) return adata;
            if (opensAt.isValid() && end.isBefore(opensAt)) return adata;
            if (opensAt.isValid() && !isOptionActive(options.symbol, opensAt, now)) return adata;
        }
        const next_day = !adata.length ? options.begin : nextDayOpen(_.last(adata).ending, options);
        if (now.isBefore(next_day) || now.isAfter(moment(next_day).endOf('day'))) return adata;
        const bdata = await openBar(ib, options).catch(err => {
            logger.warn(`Could not fetch ${options.symbol} snapshot options data ${err.message}`);
            return [];
        });
        if (!bdata.length) return adata;
        const cdata = new Array(Math.max(adata.length, bdata.length));
        let a = 0, b = 0, c = 0;
        while (a < adata.length || b < bdata.length) {
            if (a >= adata.length) cdata[c++] = bdata[b++];
            else if (b >= bdata.length) cdata[c++] = adata[a++];
            else if (adata[a].ending < bdata[b].ending) cdata[c++] = adata[a++];
            else if (adata[a].ending > bdata[b].ending) cdata[c++] = bdata[b++];
            else {
                b++;
                cdata[c++] = adata[a++];
            }
        }
        return cdata;
    });
}

async function openBar(ib, options) {
    const snapshot = await (await ib.open()).reqMktData({
        conId: options.conId,
        localSymbol: options.symbol,
        secType: 'OPT',
        exchange: 'SMART',
        currency: options.currency
    });
    const bar = snapshot.reduce((bar, datum) => {
        switch(datum.tickType) {
            case IB.TICK_TYPE.OPEN: bar.open = datum.price; return bar;
            case IB.TICK_TYPE.HIGH: bar.high = datum.price; return bar;
            case IB.TICK_TYPE.LOW: bar.low = datum.price; return bar;
            case IB.TICK_TYPE.CLOSE: bar.close = datum.price; return bar;
            case IB.TICK_TYPE.BID: bar.bid = datum.price; return bar;
            case IB.TICK_TYPE.ASK: bar.ask = datum.price; return bar;
            case IB.TICK_TYPE.VOLUME: bar.volume = datum.size; return bar;
            default: return bar;
        }
    }, {});
    if (_.isEmpty(bar)) return [];
    bar.ending = endOfDay(undefined, options);
    if (bar.bid>0 && bar.ask>0) bar.close = (bar.bid + bar.ask) /2;
    delete bar.bid;
    delete bar.ask;
    bar.open = bar.open || bar.close;
    bar.high = bar.high || bar.close;
    bar.low = bar.low || bar.close;
    bar.adj_close = bar.adj_close || bar.close;
    return [bar];
}

function nextDayOpen(ending, options) {
    const period = periods(options);
    const next_day = period.inc(period.floor(ending),1).format('YYYY-MM-DD');
    return moment.tz(`${next_day} ${options.premarketOpensAt}`, options.tz);
}

function isMarketClosed(now, options) {
    const time = moment.tz(now, options.tz).format('HH:mm:ss');
    if (options.marketOpensAt < options.marketClosesAt) {
        return time > options.marketClosesAt || time <= options.marketOpensAt;
    } else if (options.marketClosesAt < options.marketOpensAt) {
        return time > options.marketClosesAt && time <= options.marketOpensAt;
    } else {
        return false; // 24 hour market
    }
}

function endOfDay(ending, options) {
    const today = moment.tz(ending, options.tz).format('YYYY-MM-DD');
    return moment.tz(`${today} ${options.marketClosesAt}`, options.tz).format();
}

async function loadIvolatility(ivolatility, options) {
    const data = await ivolatility(options)
    return data.map(datum => {
        const mid = Math.round((datum.ask + datum.bid)*100/2)/100;
        const mdy = datum.date.match(/^(\d\d)\/(\d\d)\/(\d\d\d\d)$/);
        const closes = moment.tz(`${mdy[3]}-${mdy[1]}-${mdy[2]} ${options.marketClosesAt}`, options.tz);
        return {
            ending: closes.format(),
            open: mid,
            high: mid,
            low: mid,
            close: mid,
            volume: datum.volume,
            adj_close: mid
        };
    });
}
