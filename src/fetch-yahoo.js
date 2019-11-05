// fetch-yahoo.js
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

const _ = require('underscore');
const moment = require('moment-timezone');
const Big = require('big.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const yahooClient = require('./yahoo-client.js');
const Adjustments = require('./adjustments.js');
const cache = require('./memoize-cache.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

function help(settings = {}) {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: settings.markets
        },
        yahoo_symbol: {
            description: "Symbol for security as used by The Yahoo! Network"
        }
    };
    const lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/market using the given symbol prefix on the Yahoo! network",
        properties: ['symbol', 'yahoo_symbol', 'market', 'name', 'security_type', 'currency'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["lookup"]
            },
        })
    };
    const interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic data for a security on the Yahoo! network",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend(commonOptions, {
            interval: {
                usage: "day",
                description: "The bar timeframe for the results",
                values: ["day"]
            },
            begin: {
                example: "YYYY-MM-DD",
                description: "Sets the earliest date (or dateTime) to retrieve"
            },
            end: {
                example: "YYYY-MM-DD HH:MM:SS",
                description: "Sets the latest dateTime to retrieve"
            },
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
        })
    };
    return ~(settings.intervals||[]).indexOf('lookup') ? [lookup, interday] : [interday];
}

module.exports = function(settings = {}) {
    const helpInfo = help(settings);
    const markets = _.pick(config('markets'), settings.markets);
    const symbol = yahoo_symbol.bind(this, markets);
    const yahoo = _.mapObject(yahooClient(), (fn, name) => {
        if (!_.isFunction(fn) || name == 'close') return fn;
        else return cache(fn, function() {
            return JSON.stringify(_.toArray(arguments));
        });
    });
    const adjustments = new Adjustments(yahoo);
    return Object.assign(async(options) => {
        if (options.info=='help') return helpInfo;
        if (options.info=='version') return [{version}];
        switch(options.interval) {
            case 'lookup': return lookup(markets, yahoo, options);
            case 'fundamental': throw Error("Yahoo! fundamental service has been discontinued");
            case 'day': return interday(yahoo, adjustments, symbol(options), options);
            default: throw Error("Only daily is supported by this Yahoo! datasource");
        }
    }, {
        close() {
            return Promise.all(_.map(yahoo, (fn, name) => {
                if (_.isFunction(fn.close)) {
                    return fn.close();
                } else if (name == 'close') {
                    return fn();
                }
            }).concat(adjustments.close()));
        }
    });
};

function lookup(markets, yahoo, options) {
    const langs = _.uniq(_.compact(_.map(markets, (market, name) =>
            (!options.market || options.market == name) &&
            market.datasources.yahoo && market.datasources.yahoo.marketLang
        )));
    return Promise.all(langs.map(marketLang =>
        yahoo.lookup(yahoo_symbol(markets, options), marketLang)
    )).then(rows => _.flatten(rows, true)).then(rows => rows.filter(row => {
        const suffix = options.yahooSuffix || '';
        return !suffix || row.symbol.indexOf(suffix) == row.symbol.length - suffix.length;
    })).then(rows => rows.map(row => {
        const sym = row.symbol;
        const sources = _.pick(_.mapObject(markets, market =>
                Object.assign({currency: market.currency}, market.datasources.yahoo)
            ), (source, market) =>
                source && _.contains(source.exchs, row.exch) &&
                (!options.market || market == options.market)
            );
        const ds = _.find(sources);
        const suffix = ds && ds.yahooSuffix || '';
        const endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
        const symbol = endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
        return {
            symbol: symbol,
            yahoo_symbol: row.symbol,
            market: _.first(_.keys(sources)),
            name: row.name,
            security_type: row.type == 'S' || row.type == 'E' ? 'STK' : row.type,
            currency: (ds||{}).currency
        };
    })).then(rows => rows.filter(row => row.market));
}

function yahoo_symbol(markets, options) {
    if (options.yahoo_symbol) {
        expect(options).to.be.like({
            yahoo_symbol: /^\S+$/
        });
        return options.yahoo_symbol;
    } else if (markets[options.market] && markets[options.market].datasources.yahoo) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        const source = markets[options.market].datasources.yahoo;
        const suffix = source.yahooSuffix || '';
        if (!suffix && options.symbol.match(/^\w+$/))
            return options.symbol;
        else
            return options.symbol
                .replace(/\^/, '-P')
                .replace(/[\.\-\/]/, '-')
                .replace(/-PR./, '-P')
                .replace(/\./g, '') +
                suffix;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        return options.symbol;
    }
}

async function interday(yahoo, adjustments, symbol, options) {
    expect(options).to.be.like({
        interval: _.isString,
        symbol: /^\S+$/,
        begin: Boolean,
        marketClosesAt: _.isString,
        tz: _.isString
    });
    const now = moment().tz(options.tz);
    const [prices, adjusts] = await Promise.all([
        yahoo.day(symbol, options.begin, options.tz),
        adjustments(options)
    ]);
    const result = adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: endOf('day', datum.Date, options),
        open: +parseCurrency(datum.Open, adj_split_only),
        high: +parseCurrency(datum.High, adj_split_only),
        low: +parseCurrency(datum.Low, adj_split_only),
        close: +parseCurrency(datum.Close, adj_split_only),
        volume: parseFloat(datum.Volume) || 0,
        adj_close: +parseCurrency(datum.Close, adj_split_only).times(adj)
    })).filter(bar => bar.volume);
    if (_.last(result) && !_.last(result).close) result.pop();
    if (!options.end) return result;
    const final = moment.tz(options.end || options.now, options.tz).format(options.ending_format);
    if (moment(final).isAfter()) return result;
    let last = _.sortedIndex(result, {ending: final}, 'ending');
    if (result[last] && result[last].ending == final) last++;
    const results = last == result.length ? result : result.slice(0, last);
    const aWeek = 5 * 24 * 60 * 60 * 1000;
    const latest = _.last(results);
    if (results.length && moment(latest.ending).valueOf() > now.valueOf() - aWeek) {
        // latest bar might yet be incomplete (or not yet finalized/adjusted)
        latest.asof = now.format(options.ending_format);
    }
    return results;
}

function adjustment(base, bar) {
    if (!bar.adj_close || bar.adj_close == bar.close) return _.identity;
    const scale = bar.adj_close/bar.close * base.close / base.adj_close;
    return Math.abs(scale -1) > 0.000001 ? price => {
        return Math.round(price * scale * 1000000) / 1000000;
    } : price => {
        return Math.round(price * 100) / 100;
    };
}

function parseCurrency(string, adj_split_only) {
    return Big(_.isFinite(string) ? string : 0).div(adj_split_only);
}

function adjRight(bars, adjustments, options, cb) {
    const parseDate = bar => bar.Date;
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

function endOf(unit, begin, options) {
    const ending = moment.tz(begin, options.tz).endOf(unit);
    if (!ending.isValid()) throw Error("Invalid date " + begin);
    if (ending.days() === 0) ending.subtract(2, 'days');
    else if (ending.days() == 6) ending.subtract(1, 'days');
    const closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
    if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
    return closes.format(options.ending_format);
}

