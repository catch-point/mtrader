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
const Big = require('big.js');
const moment = require('moment-timezone');
const d3 = require('d3-format');
const merge = require('./merge.js');
const cache = require('./memoize-cache.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const periods = require('./periods.js');
const Adjustments = require('./adjustments.js');
const IB = require('./ib-gateway.js');
const Fetch = require('./fetch.js');
const expect = require('chai').expect;

function help(settings) {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: settings.markets
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
    const lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/market using the given symbol prefix using the local IB client",
        properties: ['symbol', 'conId', 'market', 'name', 'security_type', 'currency'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["lookup"]
            },
        })
    };
    const fundamental = {
        name: "fundamental",
        usage: "fundamental(options)",
        description: "Details of the given symbol/market contract",
        properties: [
            'symbol', 'market', 'security_type', 'name', 'secType', 'exchange', 'currency',
            'localSymbol', 'tradingClass', 'conId', 'primaryExch', 'marketName', 'longName',
            'minTick', 'orderTypes', 'validExchanges', 'priceMagnifier',
            'industry', 'category', 'subcategory',
            'timeZoneId', 'tradingHours', 'liquidHours'
        ],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["fundamental"]
            },
        })
    };
    const interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic interday data for a security on the local TWS client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "day",
                description: "The bar timeframe for the results",
                values: _.intersection(["day"],settings.intervals)
            },
        })
    };
    const intraday = {
        name: "intraday",
        usage: "intraday(options)",
        description: "Historic intraday data for a security on the local TWS client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "m<minutes>",
                description: "Number of minutes in a single bar length, prefixed by the letter 'm'",
                values: settings.intervals
                    .filter(interval => /^m\d+$/.test(interval))
            }
        })
    };
    return _.compact([
        ~settings.intervals.indexOf('lookup') && lookup,
        ~settings.intervals.indexOf('fundamental') && fundamental,
        interday.options.interval.values.length && interday,
        intraday.options.interval.values.length && intraday
    ]);
}

module.exports = function(settings = {}) {
    const fetch = new Fetch(merge(config('fetch'), {ib:{enabled:false}}, settings.fetch));
    const fetch_ib = createInstance(settings);
    const client = fetch_ib.client;
    const markets = fetch_ib.markets;
    const findContract = fetch_ib.findContract;
    const self = async(options) => {
        if (!fetch) {
            return ib(options);
        } else if (options.info=='help') {
            return fetch_ib(options);
        } else if (options.info=='version') {
            return fetch_ib(options);
        } else if (options.interval=='lookup') {
            if (isContractExpired(markets, client, options)) return fetch(options);
            else return fetch_ib(options);
        } else if (options.interval=='fundamental') {
            if (isContractExpired(markets, client, options)) return fetch(options);
            else return fetch_ib(options);
        } else if (isContractExpired(markets, client, options) || isHistorical(options)) {
            return fetch(options).catch(err => {
                return fetch_ib(options).catch(err2 => {
                    logger.debug(err2);
                    throw err;
                });
            });
        } else if (isTimeFrameAvailable(markets, client, options)) {
            return fetch_ib(options).catch(err => {
                return fetch(options).catch(err2 => {
                    logger.debug(err2);
                    throw err;
                });
            });
        } else {
            const next_open = marketOpensAt(options);
            if (next_open && (next_open.isAfter(options.now) || options.end && next_open.isAfter(options.end))) {
                return fetch(options).catch(err => {
                    return fetch_ib(options).catch(err2 => {
                        logger.debug(err2);
                        throw err;
                    });
                });
            } else {
                const market = markets[options.market];
                const secTypes = [].concat(market.secTypes || [], market.secType || []);
                const opt = _.intersection(secTypes, ['OPT', 'FOP']).length;
                return combineHistoricalLiveFeeds(fetch({
                    ...options,
                    end: next_open.format()
                }), fetch_ib({
                    ...options,
                    begin: next_open.format(),
                    interval: opt && options.interval.charAt(0) != 'm' ? 'm30' : options.interval
                }).catch(err => {
                    logger.warn(`Could not fetch ${options.symbol} snapshot IB data ${err.message}`);
                    return [];
                }), options);
            }
        }
    };
    self.open = () => fetch_ib.open();
    self.close = () => Promise.all([
        fetch_ib.close(),
        fetch && fetch.close()
    ]);
    return self;
};

const fmonth = {F:'01', G:'02', H:'03', J:'04', K:'05', M:'06', N:'07', Q:'08', U:'09', V:'10', X:'11', Z:'12'};
function isContractExpired(markets, client, options) {
    expect(options).to.have.property('symbol');
    const market = markets[options.market] || {};
    const secType = market.secType;
    const secTypes = market.secTypes || [];
    if (secType && !~['FUT', 'OPT', 'FOP'].indexOf(secType)) return false;
    if (secTypes.length && !_.intersection(secTypes, ['FUT', 'OPT', 'FOP']).length) return false;
    const opt = options.symbol.length == 21 &&
        options.symbol.match(/^(\w+)\s*([0-9]{6})([CP])([0-9]{5})([0-9]{3})$/);
    if (opt) return moment(`20${opt[2]}`).isBefore(options.now);
    const fut = options.symbol.match(/^(.+)([FGHJKMNQUVXZ])(\d\d)$/);
    if (fut) return moment(options.now).diff(`20${fut[3]}${fmonth[fut[2]]}22`, 'days') > 365*2;
    const fop = options.symbol.match(/^(.+)([FGHJKMNQUVXZ])(\d\d) [CP](\d+)$/);
    if (fop) return moment(`20${fop[3]}${fmonth[fop[2]]}22`).isBefore(options.now);
    if (secType || secTypes.length) logger.warn(`Unexpected contract symbol format ${options.symbol}`);
}

function isHistorical(options) {
    expect(options).to.have.property('begin');
    return moment(options.now).diff(options.begin, 'days') > 365;
}

function isTimeFrameAvailable(markets, client, options) {
    expect(options).to.have.property('begin');
    expect(options).to.have.property('interval');
    expect(options).to.have.property('market');
    const market = markets[options.market];
    const now = moment(options.now);
    const begin = moment(options.begin);
    const m = options.interval.charAt(0) == 'm' && +options.interval.substring(1);
    if (m <= 1 && now.diff(begin, 'days') > 1) return false;
    if (m <= 2 && now.diff(begin, 'days') > 2) return false;
    if (m <= 3 && now.diff(begin, 'days') > 5) return false;
    if (m <= 30 && now.diff(begin, 'days') > 31) return false;
    if (m <= 24*60 && now.diff(begin, 'days') > 365) return false;
    if (!m && market && ~['OPT', 'FOP'].indexOf(market.secType)) return false;
    return now.diff(begin, 'days') <= 365;
}

function marketOpensAt(options) {
    expect(options).to.have.property('tz');
    expect(options).to.have.property('premarketOpensAt');
    expect(options).to.have.property('afterHoursClosesAt');
    const now = moment(options.now);
    const weekday = moment(now);
    const end = moment(options.end || now);
    if (weekday.days() === 0) weekday.add(1, 'days');
    if (weekday.days() === 6) weekday.add(2, 'days');
    const tz = options.tz;
    const opensAt = moment.tz(weekday.format('YYYY-MM-DD') + ' ' + options.premarketOpensAt, tz);
    const closesAt = moment.tz(weekday.format('YYYY-MM-DD') + ' ' + options.afterHoursClosesAt, tz);
    if (!opensAt.isBefore(closesAt)) opensAt.subtract(1, 'day');
    if (now.isAfter(closesAt)) opensAt.add(1, 'day');
    if (opensAt.isValid()) return opensAt;
}

async function combineHistoricalLiveFeeds(historical_promise, live_promise, options) {
    const [historical_bars, live_intraday] = await Promise.all([historical_promise, live_promise]);
    const live_bars = live_intraday.map(bar => ({
        ending: formatTime(bar.ending, options),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        adj_close: bar.close
    })).reduce((reduced, bar) => {
        const merge = reduced.length && _.last(reduced).ending == bar.ending;
        const merge_with = merge ? reduced.pop() : {};
        reduced.push({
            ending: bar.ending,
            open: merge_with.open || bar.open,
            high: Math.max(merge_with.high||bar.high, bar.high),
            low: Math.min(merge_with.low||bar.low, bar.low),
            close: bar.close,
            volume: merge_with.volume + bar.volume,
            adj_close: bar.adj_close
        });
        return reduced;
    }, []);
    return historical_bars.concat(live_bars);
}

function createInstance(settings = {}) {
    const client = new IB(settings);
    const adjustments = Adjustments();
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).ib
    )), v => !v);
    const lookupContract_fn = lookupContract.bind(this, markets, client);
    const lookupContract_cache = cache(lookupContract_fn, o => `${o.symbol}.${o.market}`, 10);
    const findContract_fn = findContract.bind(this, lookupContract_cache, markets, client);
    const self = async(options) => {
        if (options.info=='help') return help(settings);
        if (options.info=='version') {
            return client.open().then(client => client.version()).then(client_version => {
                return [{version: client_version, name: 'TWS API'}];
            }, err => {
                return [{version: null, name: 'TWS API', message: err.message}];
            });
        }
        await client.open();
        const adj = isNotEquity(markets, options) ? null : adjustments;
        if (options.interval == 'lookup') return lookup(markets, client, options);
        else if (options.interval == 'fundamental') return fundamental(markets, client, options);
        else if (options.interval == 'day') return interday(findContract_fn, markets, adj, client, options);
        else if (options.interval.charAt(0) == 'm') return intraday(findContract_fn, markets, adj, client, options);
        else throw Error(`Unknown interval: ${options.interval}`);
    };
    self.client = client;
    self.markets = markets;
    self.findContract = findContract_fn;
    self.open = () => client.open();
    self.close = () => Promise.all([
        client.close(),
        adjustments.close()
    ]);
    return self;
};

function isNotEquity(markets, options) {
    const secType = (markets[options.market]||{}).secType;
    const secTypes = (markets[options.market]||{}).secTypes;
    return secType && secType != 'STK' || secTypes && !~secTypes.indexOf('STK');
}

async function lookup(markets, client, options) {
    const details = await listContractDetails(markets, client, options);
    const conIds = _.values(_.groupBy(details, detail => detail.summary.conId));
    return conIds.map(details => flattenContractDetails(details)).map(contract => _.omit({
        symbol: toSymbol(markets[options.market] || markets[contract.primaryExch], contract),
        market: options.market || markets[contract.primaryExch] && contract.primaryExch,
        security_type: contract.secType,
        name: contract.longName,
        currency: contract.currency,
        conId: contract.conId
    }, v => !v));
}

async function fundamental(markets, client, options) {
    const details = await listContractDetails(markets, client, options);
    const conIds = _.values(_.groupBy(details, detail => detail.summary.conId));
    return conIds.map(details => flattenContractDetails(details)).map(contract => _.omit({
        symbol: toSymbol(markets[options.market] || markets[contract.primaryExch], contract),
        market: options.market || markets[contract.primaryExch] && contract.primaryExch,
        security_type: contract.secType,
        name: contract.longName,
        ..._.omit(contract, 'conId', 'underConId', 'priceMagnifier')
    }, v => !v));
}

async function interday(findContract, markets, adjustments, client, options) {
    expect(options).to.have.property('market').that.is.oneOf(_.keys(markets));
    expect(options).to.have.property('tz').that.is.ok;
    const adjusts = adjustments && await adjustments(options);
    const market = markets[options.market];
    const contract = await findContract(options);
    const whatToShow = market.whatToShow || 'MIDPOINT';
    const prices = await reqHistoricalData(client, contract, whatToShow, 1, 1, options);
    const adjust =
        market.whatToShow == 'ADJUSTED_LAST' || market.whatToShow == 'TRADES' ? fromTrades :
        ~['MIDPOINT', 'ASK', 'BID', 'BID_ASK'].indexOf(market.whatToShow) ? fromMidpoint :
        withoutAdjClase;
    const result = adjust(prices, adjusts, options);
    const start = moment.tz(options.begin, options.tz).format(options.ending_format);
    const finish = moment.tz(options.end || options.now, options.tz).format(options.ending_format);
    let first = _.sortedIndex(result, {ending: start}, 'ending');
    let last = _.sortedIndex(result, {ending: finish}, 'ending');
    if (result[last]) last++;
    if (first <= 0 && last >= result.length) return result;
    else return result.slice(first, last);
}

async function intraday(findContract, markets, adjustments, client, options) {
    expect(options).to.have.property('market').that.is.oneOf(_.keys(markets));
    expect(options).to.have.property('tz').that.is.ok;
    const adjusts = adjustments && await adjustments(options);
    const market = markets[options.market];
    const contract = await findContract(options);
    const whatToShow = market.whatToShow || 'MIDPOINT';
    const prices = await reqHistoricalData(client, contract, whatToShow, 0, 2, options);
    const adjust =
        market.whatToShow == 'ADJUSTED_LAST' || market.whatToShow == 'TRADES' ? fromTrades :
        ~['MIDPOINT', 'ASK', 'BID', 'BID_ASK'].indexOf(market.whatToShow) ? fromMidpoint :
        withoutAdjClase;
    const result = adjust(prices, adjusts, options);
    const start = moment.tz(options.begin, options.tz).format(options.ending_format);
    const finish = moment.tz(options.end || options.now, options.tz).format(options.ending_format);
    let first = _.sortedIndex(result, {ending: start}, 'ending');
    let last = _.sortedIndex(result, {ending: finish}, 'ending');
    if (result[last]) last++;
    if (first <= 0 && last >= result.length) return result;
    else return result.slice(first, last);
}

async function findContract(lookupContract, markets, client, options) {
    const market = markets[options.market];
    const contract = toContract(market, options);
    if (contract.localSymbol && contract.secType && contract.currency &&
        (contract.primaryExch || contract.exchange)) return contract;
    return lookupContract(options);
}

async function lookupContract(markets, client, options) {
    const market = markets[options.market];
    const contract = toContract(market, options);
    const details = await listContractDetails(markets, client, options);
    const found = details.map(detail => detail.summary).find(_.matcher(contract));
    return found || contract;
}

async function listContractDetails(markets, client, options) {
    const market_set = (options.market ? [markets[options.market]] :
        _.values(markets)).reduce((market_set, market) => {
        if (market.secType) return market_set.concat(market);
        else if (!market.secTypes) return market_set;
        else return market_set.concat(market.secTypes.map(secType => Object.assign({}, market, {secType})));
    }, []);
    return _.flatten(await Promise.all(_.map(_.groupBy(market_set, market => {
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
}

async function reqHistoricalData(client, contract, whatToShow, useRTH, format, options) {
    const end = periods(options).ceil(options.end || options.now);
    const now = moment().tz(options.tz);
    const end_past = end && now.diff(end, 'days') > 0;
    const endDateTime = end_past ? end.utc().format('YYYYMMDD HH:mm:ss z') : '';
    const duration = toDurationString(endDateTime ? end : now, options);
    const barSize = toBarSizeSetting(options.interval);
    const reqHistoricalData = client.reqHistoricalData.bind(client, contract);
    if (whatToShow != 'ADJUSTED_LAST')
        return reqHistoricalData(endDateTime, duration, barSize, whatToShow, useRTH, format);
    const prices = await reqHistoricalData(endDateTime, duration, barSize, 'TRADES', useRTH, format);
    if (end_past) return prices;
    const adj_prices = await reqHistoricalData('', toDurationString(now, options), barSize, 'ADJUSTED_LAST', useRTH, format);
    let a = 0;
    return prices.map(bar => {
        while (a < adj_prices.length && adj_prices[a].time < bar.time) a++;
        if (a >= adj_prices.length || adj_prices[a].time != bar.time) return bar;
        else return {...bar, adj_close: adj_prices[a++].close};
    });
}

function fromTrades(prices, adjusts, options) {
    return adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: formatTime(datum.time, options),
        open: +Big(datum.open).div(adj_split_only),
        high: +Big(datum.high).div(adj_split_only),
        low: +Big(datum.low).div(adj_split_only),
        close: +Big(datum.close).div(adj_split_only),
        volume: datum.volume,
        adj_close: datum.adj_close || +Big(datum.close).div(adj_split_only).times(adj)
    }));
}

function fromMidpoint(prices, adjusts, options) {
    return adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: formatTime(datum.time, options),
        open: +Big(datum.open).div(adj_split_only),
        high: +Big(datum.high).div(adj_split_only),
        low: +Big(datum.low).div(adj_split_only),
        close: +Big(datum.close).div(adj_split_only),
        adj_close: +Big(datum.close).div(adj_split_only).times(adj)
    }));
}

function withoutAdjClose(prices, adjusts, options) {
    return adjRight(prices, adjusts, options, (datum) => ({
        ending: formatTime(datum.time, options),
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
    const picked = details
      .map(detail => Object.assign({}, detail.summary, _.omit(detail, ['summary', 'secIdList'])));
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
        includeExpired: market.secType == 'FUT' || ~(market.secTypes||[]).indexOf('FUT')
    }, v => !v);
}

function toLocalSymbol(market, symbol) {
    if (market.secType == 'FUT' || ~(market.secTypes||[]).indexOf('FUT'))
        return toFutSymbol(market, symbol);
    else if (market.secType == 'CASH' || ~(market.secTypes||[]).indexOf('CASH'))
        return toCashSymbol(market, symbol);
    else if (market.secType == 'OPT' || ~(market.secTypes||[]).indexOf('OPT'))
        return symbol;
    else if (market.secType || (market.secTypes||[]).length)
        return symbol;
    else if (symbol.match(/^(.*)([A-Z])(\d)(\d)$/))
        return toFutSymbol(market, symbol);
    else
        return symbol;
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
        const [, tradingClass, code, decade, year] = m;
        const space = '    '.substring(tradingClass.length);
        return `${tradingClass}${space} ${abbreviations[code]} ${decade}${year}`;
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

function adjRight(bars, adjustments, options, cb) {
    const parseDate = bar => bar.time.length == 8 ?
        moment.tz(bar.time, options.tz).format() : moment.tz(bar.time, 'X', options.tz).format()
    const result = [];
    let adj;
    let a = adjustments && adjustments.length;
    for (let i=bars.length -1; i>=0; i--) {
        if (adjustments && adjustments.length) {
            while (a > 0 && adjustments[a-1].exdate > parseDate(bars[i])) {
                adj = adjustments[--a];
            }
        }
        result[i] = cb(bars[i], Big(adj && adj.adj || 1), Big(adj && adj.adj_split_only || 1));
    }
    return result;
}

function formatTime(time, options) {
    if (options.interval == 'day') return endOfDay(time, options);
    const period = periods(options);
    const starting = moment.tz(time, 'X', options.tz);
    return period.floor(starting.add(period.millis, 'milliseconds')).format(options.ending_format);
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
    return closes.format(options.ending_format);
}

