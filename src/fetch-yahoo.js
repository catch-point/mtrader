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
const config = require('./config.js');
const yahooClient = require('./yahoo-client.js');
const Adjustments = require('./adjustments.js');
const cache = require('./memoize-cache.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

function help() {
    var commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: config('fetch.yahoo.markets')
        },
        yahoo_symbol: {
            description: "Symbol for security as used by The Yahoo! Network"
        }
    };
    var lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/market using the given symbol prefix on the Yahoo! network",
        properties: ['symbol', 'yahoo_symbol', 'market', 'name', 'type', 'typeDisp'],
        options: commonOptions
    };
    var interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic data for a security on the Yahoo! network",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend(commonOptions, {
            interval: {
                usage: "year|quarter|month|week|day",
                description: "The bar timeframe for the results",
                values: _.intersection(["year", "quarter", "month", "week", "day"], config('fetch.yahoo.interday'))
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
            }
        })
    };
    return config('fetch.yahoo.lookup') ? [lookup, interday] : [interday];
}

module.exports = function() {
    var helpInfo = help();
    var markets = _.pick(config('markets'), config('fetch.yahoo.markets'));
    var symbol = yahoo_symbol.bind(this, markets);
    var yahoo = _.mapObject(yahooClient(), (fn, name) => {
        if (!_.isFunction(fn) || name == 'close') return fn;
        else return cache(fn, function() {
            return JSON.stringify(_.toArray(arguments));
        });
    });
    var adjustments = Adjustments(yahoo);
    return {
        close() {
            return Promise.all(_.map(yahoo, (fn, name) => {
                if (_.isFunction(fn.close)) {
                    return fn.close();
                } else if (name == 'close') {
                    return fn();
                }
            }).concat(adjustments.close()));
        },
        help() {
            return Promise.resolve(helpInfo);
        },
        lookup(options) {
            var langs = _.uniq(_.compact(_.map(markets, market =>
                    market.datasources.yahoo && market.datasources.yahoo.marketLang
                )));
            return Promise.all(langs.map(marketLang =>
                yahoo.lookup(symbol(options), marketLang)
            )).then(rows => _.flatten(rows, true)).then(rows => rows.filter(row => {
                var suffix = options.yahooSuffix || '';
                return !suffix || row.symbol.indexOf(suffix) == row.symbol.length - suffix.length;
            })).then(rows => rows.map(row => {
                var sym = row.symbol;
                var sources = options.market ? {[options.market]: options} :
                    _.pick(_.mapObject(markets, market =>
                        market.datasources.yahoo
                    ), source =>
                        source && _.contains(source.exchs, row.exch)
                    );
                var ds = _.find(sources);
                var suffix = ds && ds.yahooSuffix || '';
                var endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
                var symbol = endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
                return {
                    symbol: symbol,
                    yahoo_symbol: row.symbol,
                    market: _.first(_.keys(sources)),
                    name: row.name,
                    type: row.type,
                    typeDisp: row.typeDisp
                };
            })).then(rows => rows.filter(row => row.market));
        },
        fundamental(options) {
            throw Error("Yahoo! fundamental service has been discontinued");
        },
        interday(options) {
            expect(options).to.be.like({
                interval: _.isString,
                symbol: /^\S+$/,
                begin: Boolean,
                marketClosesAt: _.isString,
                tz: _.isString
            });
            switch(options.interval) {
                case 'year': return year(yahoo, adjustments, symbol(options), options);
                case 'quarter': return quarter(yahoo, adjustments, symbol(options), options);
                case 'month': return month(yahoo, adjustments, symbol(options), options);
                case 'week': return week(yahoo, adjustments, symbol(options), options);
                case 'day': return day(yahoo, adjustments, symbol(options), options);
                default:
                    expect(options.interval).to.be.oneOf([
                        'year', 'quarter', 'month', 'week', 'day'
                    ]);
            }
        },
        intraday(options) {
            throw Error("Intraday is not supported by this Yahoo! datasource");
        }
    };
};

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
        var source = markets[options.market].datasources.yahoo;
        var suffix = source.yahooSuffix || '';
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

function year(yahoo, adjustments, symbol, options) {
    return month(yahoo, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('year'),
        end: options.end && moment.tz(options.end, options.tz).endOf('year')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).year()))
      .then(years => _.map(years, bars => bars.reduce((year, month) => {
        var adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('year', month.ending, options),
            open: year.open || adj(month.open),
            high: Math.max(year.high, adj(month.high)) || year.high || adj(month.high),
            low: Math.min(year.low, adj(month.low)) || year.low || adj(month.low),
            close: month.close,
            volume: year.volume + month.volume || year.volume || month.volume,
            adj_close: month.adj_close,
            split: (year.split || 1) * (month.split || 1),
            dividend: (year.dividend || 0) + (month.dividend || 0)
        }, month, year);
      }, {})));
}

function quarter(yahoo, adjustments, symbol, options) {
    return month(yahoo, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('quarter'),
        end: options.end && moment.tz(options.end, options.tz).endOf('quarter')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('Y-Q')))
      .then(quarters => _.map(quarters, bars => bars.reduce((quarter, month) => {
        var adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('quarter', month.ending, options),
            open: quarter.open || adj(month.open),
            high: Math.max(quarter.high, adj(month.high)) || quarter.high || adj(month.high),
            low: Math.min(quarter.low, adj(month.low)) || quarter.low || adj(month.low),
            close: month.close,
            volume: quarter.volume + month.volume || quarter.volume || month.volume,
            adj_close: month.adj_close,
            split: (quarter.split || 1) * (month.split || 1),
            dividend: (quarter.dividend || 0) + (month.dividend || 0)
        }, month, quarter);
      }, {})));
}

function month(yahoo, adjustments, symbol, options) {
    return day(yahoo, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('month'),
        end: options.end && moment.tz(options.end, options.tz).endOf('month')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('Y-MM')))
      .then(months => _.map(months, bars => bars.reduce((month, day) => {
        var adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('month', day.ending, options),
            open: month.open || adj(day.open),
            high: Math.max(month.high, adj(day.high)) || month.high || adj(day.high),
            low: Math.min(month.low, adj(day.low)) || month.low || adj(day.low),
            close: day.close,
            volume: month.volume + day.volume || month.volume || day.volume,
            adj_close: day.adj_close,
            split: (month.split || 1) * (day.split || 1),
            dividend: (month.dividend || 0) + (day.dividend || 0)
        }, day, month);
      }, {})));
}

function week(yahoo, adjustments, symbol, options) {
    return day(yahoo, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('isoWeek').subtract(1, 'days'),
        end: options.end && moment.tz(options.end, options.tz).endOf('isoWeek').subtract(2, 'days')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('gggg-WW')))
      .then(weeks => _.map(weeks, bars => bars.reduce((week, day) => {
        var adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('isoWeek', day.ending, options),
            open: week.open || adj(day.open),
            high: Math.max(week.high, adj(day.high)) || week.high || adj(day.high),
            low: Math.min(week.low, adj(day.low)) || week.low || adj(day.low),
            close: day.close,
            volume: week.volume + day.volume || week.volume || day.volume,
            adj_close: day.adj_close,
            split: (week.split || 1) * (day.split || 1),
            dividend: (week.dividend || 0) + (day.dividend || 0)
        }, day, week);
      }, {})));
}

function day(yahoo, adjustments, symbol, options) {
    return Promise.all([
        yahoo.day(symbol, options.begin, options.tz),
        adjustments(options)
    ]).then(prices_adjustments => {
        var prices = prices_adjustments[0], adjustments = prices_adjustments[1];
        return adjRight(prices, adjustments, options, (today, datum, splits, adj) => ({
            ending: endOf('day', datum.Date, options),
            open: parseCurrency(datum.Open, splits),
            high: parseCurrency(datum.High, splits),
            low: parseCurrency(datum.Low, splits),
            close: parseCurrency(datum.Close, splits) || today.close,
            volume: parseFloat(datum.Volume) || 0,
            adj_close: Math.round(
                parseCurrency(datum.Close, splits) * adj
                * 1000000) / 1000000 || today.adj_close
        })).filter(bar => bar.volume);
    }).then(result => {
        if (_.last(result) && !_.last(result).close) result.pop();
        if (!options.end) return result;
        var final = endOf('day', options.end, options);
        if (moment(final).isAfter()) return result;
        var last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

function adjustment(base, bar) {
    var scale = bar.adj_close/bar.close * base.close / base.adj_close;
    return Math.abs(scale -1) > 0.000001 ? price => {
        return Math.round(price * scale * 1000000) / 1000000;
    } : price => {
        return Math.round(price * 100) / 100;
    };
}

function adjRight(bars, adjustments, options, cb) {
    var result = [];
    var today = null;
    var msplit = 1;
    var a = adjustments.length;
    for (var i=bars.length -1; i>=0; i--) {
        var div = 0;
        var split = 1;
        while (a > 0 && adjustments[a-1].exdate > bars[i].Date) {
            var adj = adjustments[--a];
            div += adj.dividend;
            split = split * adj.split;
            msplit = adj.cum_close / bars[i].Close || 1;
        }
        if (today) {
            today.split = split;
            today.dividend = div;
        } else {
            result[bars.length] = {
                split: split,
                dividend: div
            };
        }
        result[i] = today = cb(today, bars[i], msplit, adj ? adj.adj : 1);
        today.split = 1;
        today.dividend = 0;
    }
    return result;
}

function endOf(unit, begin, options) {
    var ending = moment.tz(begin, options.tz).endOf(unit);
    if (!ending.isValid()) throw Error("Invalid date " + begin);
    if (ending.days() === 0) ending.subtract(2, 'days');
    else if (ending.days() == 6) ending.subtract(1, 'days');
    var closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
    if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
    return closes.format();
}

function parseCurrency(string, split) {
    return Math.round(parseFloat(string) * split * 100) / 100;
}

