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
        properties: [
            'symbol', 'conId', 'market', 'name', 'secType', 'exchange', 'currency',
            'tradingClass', 'industry', 'category', 'subcategory'
        ],
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
    const market_set = (options.market ? [markets[options.market]] :
        _.values(markets)).reduce((market_set, market) => {
        if (market.secType) return market_set.concat(market);
        else if (!market.secTypes) return market_set;
        else return market_set.concat(market.secTypes.map(secType => Object.assign({}, market, {secType})));
    }, []);
    const combined = _.flatten(await Promise.all(_.map(_.groupBy(market_set, market => {
        return `${market.secType}.${market.currency}`;
    }), async(market_set) => {
        const primaryExchs = _.every(market_set, 'primaryExch') && market_set.map(market => market.primaryExch);
        const exchanges = _.every(market_set, 'exchange') && market_set.map(market => market.exchange);
        const currencies = _.every(market_set, 'currency') && market_set.map(market => market.currency);
        const contract = joinCommon(market_set.map(market => toContract(market, options)));
        const as_is = await client.reqContractDetails(contract).catch(err => {
            logger.debug(`TWS IB Could not find ${options.symbol} as ${_.first(market_set).currency} ${_.first(market_set).secType}: ${err.message}`);
            return [];
        });
        const details = as_is.length || !~contract.localSymbol.indexOf('.') ? as_is :
            await client.reqContractDetails(Object.assign({}, contract, {
                localSymbol: contract.localSymbol.replace('.', ' ')
            })).catch(err => []);
        return details.filter(detail => {
            if (primaryExchs && !~primaryExchs.indexOf(detail.summary.primaryExch)) return false;
            if (exchanges && !~exchanges.indexOf(detail.summary.exchange)) return false;
            if (currencies && !~currencies.indexOf(detail.summary.currency)) return false;
            else return true;
        });
    })));
    const conIds = _.values(_.groupBy(combined, detail => detail.summary.conId));
    return conIds.map(details => flattenContractDetails(details)).map(detail => _.omit({
        symbol: toSymbol(markets[options.market] || markets[detail.primaryExch], detail),
        market: options.market || markets[detail.primaryExch] && detail.primaryExch,
        secType: detail.secType,
        name: detail.longName,
        exchange: detail.exchange,
        minTick: detail.minTick,
        currency: detail.currency,
        tradingClass: detail.tradingClass,
        industry: detail.industry,
        category: detail.category,
        subcategory: detail.subcategory,
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
    const duration = toDurationString(end_past ? end : now, options);
    const barSize = toBarSizeSetting(options.interval);
    const prices = await client.reqHistoricalData(contract, endDateTime, duration, barSize, whatToShow, 1, 1);
    const adjust = whatToShow == 'TRADES' ? fromTrades :
        whatToShow == 'ADJUSTED_LAST' ? fromAdjusted :
        ~['MIDPOINT', 'ASK', 'BID', 'BID_ASK'].indexOf(whatToShow) ? fromMidpoint :
        withoutAdjClase;
    const result = adjust(prices, adjusts, ib_tz, options);
    const start = moment.tz(options.begin, options.tz).format();
    const finish = moment.tz(options.end || options.now, options.tz).format();
    let first = _.sortedIndex(result, {ending: start}, 'ending');
    let last = end_past ? _.sortedIndex(result, {ending: finish}, 'ending') + 1 : result.length;
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
    let last = end_past ? _.sortedIndex(result, {ending: finish}, 'ending') + 1 : result.length;
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

function toDurationString(end, options) {
    expect(options).to.have.property('begin').that.is.ok;
    const begin = periods(options).ceil(options.begin).subtract(periods(options).millis, 'milliseconds');
    const years = end.diff(begin,'years', true);
    if (years > 1) return Math.ceil(years) + ' Y';
    const days = end.diff(begin,'days', true);
    if (days > 1 || options.interval == 'day') return Math.ceil(days) + ' D';
    const minutes = end.diff(begin,'minutes', true);
    return (Math.ceil(minutes + 1) * 60) + ' S';
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
        currency: market.currency,
        includeExpired: market.secType == 'FUT'
    }, v => !v);
}

function toLocalSymbol(market, symbol) {
    if (market.secType == 'FUT') return toFutSymbol(market, symbol);
    else if (market.secType == 'CASH') return toCashSymbol(market, symbol);
    else if (market.secType == 'OPT') return symbol;
    else if (market.secType) return symbol;
    else if (symbol.match(/^(.*)([A-Z])(\d)(\d)$/)) return toFutSymbol(market, symbol);
    else return symbol;
}

function toSymbol(market, detail) {
    if (detail.secType == 'FUT') return fromFutSymbol(market, detail.localSymbol);
    else if (detail.secType == 'CASH') return detail.symbol;
    else if (detail.secType == 'OPT') return detail.localSymbol;
    else return ~detail.localSymbol.indexOf(' ') ? detail.localSymbol.replace(' ', '.') : detail.localSymbol;
}

function toFutSymbol(market, symbol) {
    if ((market||{}).month_abbreviation) {
        const abbreviations = {F: 'JAN', G: 'FEB', H: 'MAR', J: 'APR', K: 'MAY', M: 'JUN', N: 'JUL', Q: 'AUG', U: 'SEP', V: 'OCT', X: 'NOV', Z: 'DEC'};
        const m = symbol.match(/^(\w*)([A-Z])(\d)(\d)$/);
        if (!m) return symbol;
        const [, root, code, decade, year] = m;
        const space = '    '.substring(root.length);
        return `${root}${space} ${abbreviations[code]} ${decade}${year}`;
    } else {
        return symbol.replace(/^(.*)([A-Z])(\d)(\d)$/,'$1$2$4');
    }
}

function fromFutSymbol(market, symbol) {
    if ((market||{}).month_abbreviation) {
        const codes = {JAN: 'F', FEB: 'G', MAR: 'H', APR: 'J', MAY: 'K', JUN: 'M', JUL: 'N', AUG: 'Q', SEP: 'U', OCT: 'V', NOV: 'X', DEC: 'Z'};
        const [, root, month, year] = symbol.match(/^(\w*) +([A-Z]+) (\d\d)$/);
        return `${root}${codes[month]}${year}`;
    } else {
        const [, root, month, y] = symbol.match(/^(\w*)([A-Z])(\d)$/);
        const now = moment();
        const decade = y >= (now.year() - 2) % 10 ?
            (now.year() - 2).toString().substring(2, 3) :
            (now.year() + 8).toString().substring(2, 3);
        return `${root}${month}${decade}${y}`;
    }
}

function toCashSymbol(market, symbol) {
    return `${symbol}.${market.currency}`;
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
    const period = periods(options);
    return period.floor(starting.add(period.millis, 'milliseconds')).format();
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

