// fetch-ib.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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

const _ = require('underscore');
const moment = require('moment-timezone');
const d3 = require('d3-format');
const logger = require('./logger.js');
const config = require('./config.js');
const periods = require('./periods.js');
const Adjustments = require('./adjustments.js');
const IB = require('./ib-client.js');
const expect = require('chai').expect;

function help() {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: config('fetch.ib.markets')
        },
        conId: {
            description: "IB contract ID"
        }
    };
    const tzOptions = {
        marketOpensAt: {
            description: "Time of day that the market options"
        },
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
        properties: ['symbol', 'conId', 'market', 'name', 'secType', 'exchange', 'currency', 'tradingClass'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["lookup"]
            },
        })
    };
    const interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic interday data for a security on the local TWS client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'wap', 'count', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "day",
                description: "The bar timeframe for the results",
                values: _.intersection(["day"],config('fetch.ib.intervals'))
            },
        })
    };
    const intraday = {
        name: "intraday",
        usage: "intraday(options)",
        description: "Historic intraday data for a security on the local TWS client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'wap', 'count', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "m<minutes>",
                description: "Number of minutes in a single bar length, prefixed by the letter 'm'",
                values: config('fetch.ib.intervals')
                    .filter(interval => /^m\d+$/.test(interval))
            }
        })
    };
    return _.compact([
        ~config('fetch.ib.intervals').indexOf('lookup') && lookup,
        interday.options.interval.values.length && interday,
        intraday.options.interval.values.length && intraday
    ]);
}

module.exports = function() {
    let promiseClient;
    const Client = () => {
        return promiseClient = (promiseClient || Promise.reject())
          .catch(err => ({disconnected: true})).then(client => {
            if (client.disconnected) return new IB(
                config('fetch.ib.host'), config('fetch.ib.port'), config('fetch.ib.clientId')
            ).open();
            else if (client.connected) return client;
            else return client.open();
        });
    };
    const ib_tz = config('fetch.ib.tz') || (moment.defaultZone||{}).name || moment.tz.guess();
    const adjustments = Adjustments();
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).ib
    )), v => !v);
    const self = async(options) => {
        if (options.help) return help();
        const client = await Client();
        const adj = isNotEquity(markets, options) ? null : adjustments;
        if (options.interval == 'lookup') return lookup(markets, client, options);
        else if (options.interval == 'day') return interday(markets, adj, client, ib_tz, options);
        else if (options.interval.charAt(0) == 'm') return intraday(markets, adj, client, ib_tz, options);
        else throw Error(`Unknown interval: ${options.interval}`);
    };
    self.open = () => Client();
    self.close = () => Promise.all([
        (promiseClient || Promise.resolve({close:_.noop}))
          .then(client => client.close(), () => undefined),
        adjustments.close()
    ]);
    return self;
};

function isNotEquity(markets, options) {
    const secType = (markets[options.market]||{}).secType;
    return secType && secType != 'STK';
}

async function lookup(markets, client, options) {
    const market_set = options.market ? [markets[options.market]] :
        _.values(markets).filter(market => market.secType);
    const combined = _.flatten(await Promise.all(_.map(_.groupBy(market_set, market => {
        return `${market.secType}.${market.currency}`;
    }), async(market_set) => {
        const secTypes = _.every(market_set, 'secType') && market_set.map(market => market.secType);
        const primaryExchs = _.every(market_set, 'primaryExch') && market_set.map(market => market.primaryExch);
        const exchanges = _.every(market_set, 'exchange') && market_set.map(market => market.exchange);
        const currencies = _.every(market_set, 'currency') && market_set.map(market => market.currency);
        const contract = joinCommon(market_set.map(market => toContract(market, options)));
        const details = await client.reqContractDetails(contract).catch(err => []);
        return details.filter(detail => {
            if (secTypes && !~secTypes.indexOf(detail.summary.secType)) return false;
            if (primaryExchs && !~primaryExchs.indexOf(detail.summary.primaryExch)) return false;
            if (exchanges && !~exchanges.indexOf(detail.summary.exchange)) return false;
            if (currencies && !~currencies.indexOf(detail.summary.currency)) return false;
            else return true;
        });
    })));
    const conIds = _.values(_.groupBy(combined, detail => detail.summary.conId));
    return conIds.map(details => flattenContractDetails(details)).map(detail => _.omit({
        symbol: ~detail.symbol.indexOf(' ') ? detail.symbol.replace(' ', '.') : detail.symbol,
        market: options.market || markets[detail.primaryExch] && detail.primaryExch,
        secType: detail.secType,
        name: detail.longName,
        exchange: detail.exchange,
        minTick: detail.minTick,
        currency: detail.currency,
        tradingClass: detail.tradingClass,
        conId: detail.conId
    }, v => !v));
}

async function interday(markets, adjustments, client, ib_tz, options) {
    expect(options).to.have.property('market').that.is.oneOf(_.keys(markets));
    expect(options).to.have.property('tz').that.is.ok;
    const adjusts = adjustments && await adjustments(options);
    const market = markets[options.market];
    const contract = toContract(market, options);
    const whatToShow = market.whatToShow || 'MIDPOINT';
    const end = periods(options).ceil(options.end || options.now);
    const now = moment().tz(options.tz);
    const end_past = end && end.isBefore(now);
    const end_str = end_past ? end.utc().format('YYYYMMDD HH:mm:ss z') : '';
    const endDateTime = whatToShow != 'ADJUSTED_LAST' ? end_str : '';
    const supported = !market.intervals || ~market.intervals.indexOf(options.interval);
    const duration = toDurationString(end_past ? end : now, options, !supported && 5);
    const barSize = toBarSizeSetting(supported ? options.interval : 'm60');
    const prices = await client.reqHistoricalData(contract, endDateTime, duration, barSize, whatToShow, 1, 1);
    const adjust = whatToShow == 'TRADES' ? fromTrades :
        whatToShow == 'ADJUSTED_LAST' ? fromAdjusted :
        ~['MIDPOINT', 'ASK', 'BID', 'BID_ASK'].indexOf(whatToShow) ? fromMidpoint :
        withoutAdjClase;
    const mapped = adjust(prices, adjusts, ib_tz, options);
    const result = supported ? mapped : mapped.reduce((result, bar) => {
        const merging = result.length && _.last(result).ending == bar.ending;
        if (!merging && isBeforeOpen(bar.ending, options)) return result;
        const today = merging ? result.pop() : {};
        result.push(Object.assign({}, bar, {
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low
        }));
        return result;
    }, []);
    const start = moment.tz(options.begin, options.tz).format();
    const finish = moment.tz(options.end || options.now, options.tz).format();
    let first = _.sortedIndex(result, {ending: start}, 'ending');
    let last = _.sortedIndex(result, {ending: finish}, 'ending');
    if ((result[last]||{}).ending == finish) last++;
    if (first <= 0 && last >= result.length) return result;
    else return result.slice(first, last);
}

async function intraday(markets, adjustments, client, ib_tz, options) {
    expect(options).to.have.property('market').that.is.oneOf(_.keys(markets));
    expect(options).to.have.property('tz').that.is.ok;
    const adjusts = adjustments && await adjustments(options);
    const market = markets[options.market];
    const contract = toContract(market, options);
    const whatToShow = market.whatToShow || 'MIDPOINT';
    const end = periods(options).ceil(options.end || options.now);
    const now = moment().tz(options.tz);
    const end_past = end && end.isBefore(now);
    const end_str = end_past ? end.utc().format('YYYYMMDD HH:mm:ss z') : '';
    const endDateTime = whatToShow != 'ADJUSTED_LAST' ? end_str : '';
    const duration = toDurationString(end_past ? end : now, options);
    const barSize = toBarSizeSetting(options.interval);
    const prices = await client.reqHistoricalData(contract, endDateTime, duration, barSize, whatToShow, 0, 1);
    const adjust = whatToShow == 'TRADES' ? fromTrades :
        whatToShow == 'ADJUSTED_LAST' ? fromAdjusted :
        ~['MIDPOINT', 'ASK', 'BID', 'BID_ASK'].indexOf(whatToShow) ? fromMidpoint :
        withoutAdjClase;
    const result = adjust(prices, adjusts, ib_tz, options);
    const start = moment.tz(options.begin, options.tz).format();
    const finish = moment.tz(options.end || options.now, options.tz).format();
    let first = _.sortedIndex(result, {ending: start}, 'ending');
    let last = _.sortedIndex(result, {ending: finish}, 'ending');
    if ((result[last]||{}).ending == finish) last++;
    if (first <= 0 && last >= result.length) return result;
    else return result.slice(first, last);
}

function fromTrades(prices, adjusts, ib_tz, options) {
    return adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: formatTime(datum.time, ib_tz, options),
        open: parseCurrency(datum.open, adj_split_only),
        high: parseCurrency(datum.high, adj_split_only),
        low: parseCurrency(datum.low, adj_split_only),
        close: parseCurrency(datum.close, adj_split_only),
        volume: datum.volume,
        wap: datum.wap,
        count: datum.count,
        adj_close: Math.round(parseCurrency(datum.close, adj_split_only) * adj * 1000000) / 1000000
    }));
}

function fromAdjusted(prices, adjusts, ib_tz, options) {
    return adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: formatTime(datum.time, ib_tz, options),
        open: parseCurrency(datum.open, adj),
        high: parseCurrency(datum.high, adj),
        low: parseCurrency(datum.low, adj),
        close: parseCurrency(datum.close, adj),
        volume: datum.volume,
        wap: datum.wap,
        count: datum.count,
        adj_close: datum.close
    }));
}

function fromMidpoint(prices, adjusts, ib_tz, options) {
    return adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: formatTime(datum.time, ib_tz, options),
        open: parseCurrency(datum.open, adj_split_only),
        high: parseCurrency(datum.high, adj_split_only),
        low: parseCurrency(datum.low, adj_split_only),
        close: parseCurrency(datum.close, adj_split_only),
        adj_close: Math.round(parseCurrency(datum.close, adj_split_only) * adj * 1000000) / 1000000
    }));
}

function withoutAdjClose(prices, adjusts, ib_tz, options) {
    return adjRight(prices, adjusts, options, (datum, splits, adj) => ({
        ending: formatTime(datum.time, ib_tz, options),
        open: datum.open,
        high: datum.high,
        low: datum.low,
        close: datum.close
    }));
}

function toDurationString(end, options, max_days) {
    expect(options).to.have.property('begin').that.is.ok;
    const begin = periods(options).ceil(options.begin).subtract(periods(options).millis, 'milliseconds');
    const years = end.diff(begin,'years', true);
    if (years > 1 && (!max_days || max_days > years*365)) return Math.ceil(years) + ' Y';
    const days = end.diff(begin,'days', true);
    if (max_days && days > max_days)
        throw Error(`Too many days between ${begin.format()} and ${end.format()} for ${options.symbol}`);
    if (days > 1 || options.interval == 'day') return Math.ceil(days) + ' D';
    const seconds = end.diff(begin,'seconds', true);
    return Math.ceil(seconds) + ' S';
}

function toBarSizeSetting(interval) {
    switch(interval) {
        case 'year': return '12 month';
        case 'quarter': return '3 month';
        case 'month': return '1 month';
        case 'week': return '1 week';
        case 'day': return '1 day';
        case 'm480': return '8 hours';
        case 'm240': return '4 hours';
        case 'm120': return '2 hours';
        case 'm60': return '1 hour';
        case 'm30': return '30 mins';
        case 'm20': return '20 mins';
        case 'm15': return '15 mins';
        case 'm10': return '10 mins';
        case 'm5': return '5 mins';
        case 'm3': return '3 mins';
        case 'm2': return '2 mins';
        case 'm1': return '1 min';
        case 's30': return '30 secs';
        case 's15': return '15 secs';
        case 's10': return '10 secs';
        case 's5': return '5 secs';
        case 's1': return '1 secs';
        default:
            throw Error(`Unknown supported bar setting: ${interval}`);
    }
}

function flattenContractDetails(details) {
    const omit = [];
    const picking = ['minTick', 'longName', 'industry', 'category', 'subcategory'];
    const picked = details
      .map(detail => Object.assign(_.pick(detail, picking), detail.summary));
    return joinCommon(picked);
}

function joinCommon(contracts) {
    const omit = [];
    const joined = contracts.reduce((contract, summary) => {
        _.keys(summary).forEach(key => {
            if (contract[key] && summary[key] && _.isArray(contract[key]) && _.isArray(summary[key])) {
                contract[key] = _.uniq(contract[key].concat(summary[key]));
            } else if (contract[key] && summary[key] && contract[key] != summary[key]) {
                omit.push(key);
            } else if (summary[key]) {
                contract[key] = summary[key];
            }
        });
        return contract;
    }, {});
    return omit.length ? _.omit(joined, omit) : joined;
}

function toContract(market, options) {
    return _.omit({
        conId: options.conId,
        localSymbol: toLocalSymbol(market, options.symbol),
        secType: market.secType,
        primaryExch: market.primaryExch,
        exchange: market.exchange,
        currency: market.currency
    }, v => !v);
}

function toLocalSymbol(market, symbol) {
    if (market.secType == 'FUT') return toFutSymbol(market, symbol);
    else if (market.secType == 'CASH') return toCashSymbol(market, symbol);
    else if (market.secType == 'OPT') return toOptSymbol(market, symbol);
    else return ~symbol.indexOf('.') ? symbol.replace('.', ' ') : symbol;
}

function toFutSymbol(market, symbol) {
    return symbol.replace(/^(.*)([A-Z])(\d)(\d)$/,'$1$2$4');
}

function toCashSymbol(market, symbol) {
    return `${symbol}.${market.currency}`;
}

const months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
const strike_format = d3.format("08d");
function toOptSymbol(market, symbol) {
    const m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return symbol;
    const yy = m[2];
    const day = m[3];
    const mo = months[m[4]];
    const right = m[4] < 'M' ? 'C' : 'P';
    const strike = strike_format(+m[5] * 1000);
    const space = '      ';
    const root = m[1].substring(0, space.length) + space.substring(m[1].length);
    return `${root}${yy}${mo}${day}${right}${strike}`;
}

function parseCurrency(string, adj_split_only) {
    if (adj_split_only == 1 || Math.abs(adj_split_only -1) < 0.000001) return parseFloat(string);
    else return Math.round(parseFloat(string) / adj_split_only * 10000) / 10000;
}

function adjRight(bars, adjustments, options, cb) {
    const parseDate = bar => bar.time.replace(/^(\d\d\d\d)(\d\d)(\d\d)(\s)?\s*/, '$1-$2-$3$4');
    const result = [];
    let adj;
    let a = adjustments && adjustments.length;
    for (let i=bars.length -1; i>=0; i--) {
        if (adjustments && adjustments.length) {
            while (a > 0 && adjustments[a-1].exdate > parseDate(bars[i])) {
                adj = adjustments[--a];
            }
        }
        result[i] = cb(bars[i], adj && adj.adj || 1, adj && adj.adj_split_only || 1);
    }
    return result;
}

function formatTime(time, ib_tz, options) {
    const time_str = time.replace(/^(\d\d\d\d)(\d\d)(\d\d)(\s)?\s*/, '$1-$2-$3$4');
    const starting = moment.tz(time_str, ib_tz).tz(options.tz);
    if (options.interval == 'day') return endOfDay(starting, options);
    else return starting.add(periods(options).millis, 'milliseconds').format();
}

function endOfDay(date, options) {
    const start = moment.tz(date, options.tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    let ending = moment(start).endOf('day');
    let closes, days = 0;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf('day');
    } while (closes.isBefore(start));
    return closes.format();
}

function isBeforeOpen(ending, options) {
    const time = ending.substring(11, 19);
    if (options.marketOpensAt < options.marketClosesAt) {
        return time > options.marketClosesAt || time < options.marketOpensAt;
    } else if (options.marketClosesAt < options.marketOpensAt) {
        return time > options.marketClosesAt && time < options.marketOpensAt;
    } else {
        return false; // 24 hour market
    }
}

