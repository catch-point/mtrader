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
const iqfeed = require('./fetch-iqfeed.js');
const remote = require('./fetch-remote.js');
const files = require('./fetch-files.js');
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
        description: "Looks up existing symbol/market using the given symbol prefix using the local IQFeed client",
        properties: ['symbol', 'iqfeed_symbol', 'market', 'name', 'listed_market', 'security_type'],
        options: commonOptions
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
                values: _.intersection(["year", "quarter", "month", "week", "day"], config('fetch.ivolatility.interday'))
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
    const cfg = config('fetch.ivolatility') || {};
    const delegate = cfg.delegate == 'remote' ? remote() :
        cfg.delegate == 'iqfeed' ? iqfeed() :
        cfg.delegate == 'files' ? files() : null;
    const ivolatility = Ivolatility(cacheDir, downloadDir, auth_file, downloadType);
    return {
        close() {
            return Promise.all([
                delegate && delegate.close(),
                ivolatility.close()
            ]);
        },
        help() {
            return Promise.resolve(help());
        },
        async lookup(options) {
            if (options.market && options.market != 'OPRA') return [];
            const symbol = options.symbol;
            const m = symbol.match(/^(.*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
            if (!m) return [];
            const underlying = m[1];
            const yy = +m[2];
            const cc = yy<50 ? 2000 : 1900;
            const year = cc + yy;
            const day = m[3];
            const mo = months[m[4]];
            const cmonth = calls[m[4]];
            const pmonth = puts[m[4]];
            const pc = cmonth ? 'C' : 'P';
            const month = cmonth || pmonth;
            const strike = strike_format(+m[5]);
            return [{
                symbol: symbol,
                market: 'OPRA',
                listed_market: 'OPRA',
                name: `${underlying} ${month} ${year} ${pc} ${strike}`,
                strike_price: strike,
                expiration_date: `${year}-${mo}-${day}`
            }];
        },
        interday: options => {
            expect(options).to.have.property('symbol');
            expect(options).to.have.property('marketClosesAt');
            expect(options.interval).to.be.oneOf(['year', 'quarter', 'month', 'week', 'day']);
            const dayFn = day.bind(this, loadIvolatility.bind(this, ivolatility.interday), delegate);
            switch(options.interval) {
                case 'year': return year(dayFn, options);
                case 'quarter': return quarter(dayFn, options);
                case 'month': return month(dayFn, options);
                case 'week': return week(dayFn, options);
                case 'day': return dayFn(options);
                default:
                    expect(options.interval).to.be.oneOf([
                        'year', 'quarter', 'month', 'week', 'day'
                    ]);
            }
        }
    };
};

const calls = {
    A: 'JAN', B: 'FEB', C: 'MAR', D: 'APR', E: 'MAY', F: 'JUN',
    G: 'JUL', H: 'AUG', I: 'SEP', J: 'OCT', K: 'NOV', L: 'DEC'
};
const puts = {
    M: 'JAN', N: 'FEB', O: 'MAR', P: 'APR', Q: 'MAY', R: 'JUN',
    S: 'JUL', T: 'AUG', U: 'SEP', V: 'OCT', W: 'NOV', X: 'DEC'
};
const months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
const strike_format = d3.format(".2f");
const iv_strike_format = d3.format("08d");
async function loadIvolatility(ivolatility, options) {
    const symbol = options.symbol;
    const m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) throw Error(`Unknown option symbol format ${symbol}`);
    const underlying = m[1];
    const yy = m[2];
    const cc = +yy<50 ? 2000 : 1900;
    const year = cc + +yy;
    const mo = months[m[4]];
    const day = m[3];
    const cmonth = calls[m[4]];
    const pmonth = puts[m[4]];
    const cp = cmonth ? 'C' : 'P';
    const strike = iv_strike_format(+m[5] * 1000);
    const iv_symbol = `${underlying}${yy}${mo}${day}${cp}${strike}`;
    const data = await ivolatility(_.defaults({}, options, {iv_symbol}))
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

function isOptionActive(symbol, begin, end) {
    const m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return null;
    const yy = m[2];
    const cc = +yy<50 ? 2000 : 1900;
    const year = cc + +yy;
    const day = m[3];
    const mo = months[m[4]];
    const expiration_date = `${year}-${mo}-${day}`;
    const exdate = moment(expiration_date).endOf('day');
    const issued = mo == '01' ?
        moment(exdate).subtract(3, 'years') :
        moment(exdate).subtract(9, 'months');
    return exdate.isAfter(begin) && issued.isBefore(end);
}

function day(readTable, delegate, options) {
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
        if (!delegate) return adata;
        if (adata.length) {
            if (now.days() === 0 || now.days() === 6) return adata;
            const tz = options.tz;
            const opensAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketOpensAt, tz);
            const closesAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, tz);
            if (!opensAt.isBefore(closesAt)) opensAt.subtract(1, 'day');
            if (now.isBefore(opensAt)) return adata;
            if (!closesAt.isAfter(_.last(adata).ending)) return adata;
            if (end.isBefore(opensAt)) return adata;
            if (!isOptionActive(options.symbol, opensAt, now)) return adata;
        }
        const bdata = await delegate.interday(_.defaults({
            interval: 'day',
            begin: adata.length ? _.last(adata).ending : options.begin
        }, options));
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

async function year(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('year'),
        end: end && (end.isAfter(moment(end).startOf('year')) ? end.endOf('year') : end)
    }, options));
    const years = _.groupBy(bars, bar => moment(bar.ending).year());
    return _.map(years, bars => bars.reduce((year, month) => {
        const adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('year', month.ending, options),
            open: year.open || adj(month.open),
            high: Math.max(year.high, adj(month.high)) || year.high || adj(month.high),
            low: Math.min(year.low, adj(month.low)) || year.low || adj(month.low),
            close: month.close,
            volume: year.volume + month.volume || year.volume || month.volume,
            adj_close: month.adj_close
        }, month, year);
      }, {}));
}

async function quarter(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('quarter'),
        end: end && (end.isAfter(moment(end).startOf('quarter')) ? end.endOf('quarter') : end)
    }, options));
    const quarters = _.groupBy(bars, bar => moment(bar.ending).format('Y-Q'));
    return _.map(quarters, bars => bars.reduce((quarter, month) => {
        const adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('quarter', month.ending, options),
            open: quarter.open || adj(month.open),
            high: Math.max(quarter.high, adj(month.high)) || quarter.high || adj(month.high),
            low: Math.min(quarter.low, adj(month.low)) || quarter.low || adj(month.low),
            close: month.close,
            volume: quarter.volume + month.volume || quarter.volume || month.volume,
            adj_close: month.adj_close
        }, month, quarter);
      }, {}));
}

async function month(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await day(_.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('month'),
        end: end && (end.isAfter(moment(end).startOf('month')) ? end.endOf('month') : end)
    }, options));
    const months = _.groupBy(bars, bar => moment(bar.ending).format('Y-MM'));
    return _.map(months, bars => bars.reduce((month, day) => {
        const adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('month', day.ending, options),
            open: month.open || adj(day.open),
            high: Math.max(month.high, adj(day.high)) || month.high || adj(day.high),
            low: Math.min(month.low, adj(day.low)) || month.low || adj(day.low),
            close: day.close,
            volume: month.volume + day.volume || month.volume || day.volume,
            adj_close: day.adj_close
        }, day, month);
      }, {}));
}

async function week(day, options) {
    const begin = moment.tz(options.begin, options.tz);
    const bars = await day(_.defaults({
        begin: begin.day() === 0 || begin.day() == 6 ? begin.startOf('day') :
            begin.startOf('isoWeek').subtract(1, 'days'),
        end: options.end && moment.tz(options.end, options.tz).endOf('isoWeek').subtract(2, 'days')
    }, options));
    const weeks = _.groupBy(bars, bar => moment(bar.ending).format('gggg-WW'));
    return _.map(weeks, bars => bars.reduce((week, day) => {
        const adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('isoWeek', day.ending, options),
            open: week.open || adj(day.open),
            high: Math.max(week.high, adj(day.high)) || week.high || adj(day.high),
            low: Math.min(week.low, adj(day.low)) || week.low || adj(day.low),
            close: day.close,
            volume: week.volume + day.volume || week.volume || day.volume,
            adj_close: day.adj_close
        }, day, week);
      }, {}));
}

function adjustment(base, bar) {
    const scale = bar.adj_close/bar.close * base.close / base.adj_close;
    if (Math.abs(scale -1) < 0.000001) return _.identity;
    else return price => Math.round(price * scale * 10000) / 10000;
}

function endOf(unit, date, options) {
    const start = moment.tz(date, options.tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    let ending = moment(start).endOf(unit);
    let closes, days = 0;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.format();
}
