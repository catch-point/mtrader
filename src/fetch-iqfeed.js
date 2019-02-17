// fetch-iqfeed.js
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
const logger = require('./logger.js');
const config = require('./config.js');
const iqfeed = require('./iqfeed-client.js');
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
            values: config('fetch.iqfeed.markets')
        },
        iqfeed_symbol: {
            description: "Symbol used in the DTN network"
        }
    };
    var tzOptions = {
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
    var durationOptions = {
        begin: {
            example: "YYYY-MM-DD",
            description: "Sets the earliest date (or dateTime) to retrieve"
        },
        end: {
            example: "YYYY-MM-DD HH:MM:SS",
            description: "Sets the latest dateTime to retrieve"
        }
    };
    var lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/market using the given symbol prefix using the local IQFeed client",
        properties: ['symbol', 'iqfeed_symbol', 'market', 'name', 'listed_market', 'security_type'],
        options: commonOptions
    };
    var fundamental = {
        name: "fundamental",
        usage: "fundamental(options)",
        description: "Details of a security on the local IQFeed client",
        properties: ['type', 'symbol', 'market_id', 'pe', 'average_volume', '52_week_high', '52_week_low', 'calendar_year_high', 'calendar_year_low', 'dividend_yield', 'dividend_amount', 'dividend_rate', 'pay_date', 'exdividend_date', 'reserved', 'reserved', 'reserved', 'short_interest', 'reserved', 'current_year_earnings_per_share', 'next_year_earnings_per_share', 'five_year_growth_percentage', 'fiscal_year_end', 'reserved', 'company_name', 'root_option_symbol', 'percent_held_by_institutions', 'beta', 'leaps', 'current_assets', 'current_liabilities', 'balance_sheet_date', 'long_term_debt', 'common_shares_outstanding', 'reserved', 'split_factor_1', 'split_factor_2', 'reserved', 'reserved', 'format_code', 'precision', 'sic', 'historical_volatility', 'security_type', 'listed_market', '52_week_high_date', '52_week_low_date', 'calendar_year_high_date', 'calendar_year_low_date', 'year_end_close', 'maturity_date', 'coupon_rate', 'expiration_date', 'strike_price', 'naics', 'market_root'],
        options: _.extend(commonOptions, tzOptions)
    };
    var interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic interday data for a security on the local IQFeed client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend(commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "year|quarter|month|week|day",
                description: "The bar timeframe for the results",
                values: _.intersection(["year", "quarter", "month", "week", "day"],config('fetch.iqfeed.interday'))
            },
        })
    };
    var intraday = {
        name: "intraday",
        usage: "intraday(options)",
        description: "Historic intraday data for a security on the local IQFeed client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'total_volume', 'adj_close'],
        options: _.extend(commonOptions, durationOptions, tzOptions, {
            minutes: {
                description: "Number of minutes in a single bar length",
                values: config('fetch.iqfeed.intraday')
                    .filter(interval => /^m\d+$/.test(interval))
                    .map(interval => parseInt(interval.substring(1)))
            }
        })
    };
    return _.compact([
        config('fetch.iqfeed.lookup') && lookup,
        config('fetch.iqfeed.fundamental') && fundamental,
        config('fetch.iqfeed.interday') && interday,
        config('fetch.iqfeed.intraday') && intraday
    ]);
}

module.exports = function() {
    var helpInfo = help();
    var self = new.target ? this : {};
    return register(Object.assign(self, {
        close() {
            return unregister(self);
        },
        help() {
            return Promise.resolve(helpInfo);
        },
        open: sharedInstance.bind(self, 'open'),
        lookup: sharedInstance.bind(self, 'lookup'),
        fundamental: sharedInstance.bind(self, 'fundamental'),
        interday: sharedInstance.bind(self, 'interday'),
        intraday: sharedInstance.bind(self, 'intraday'),
        rollday: sharedInstance.bind(self, 'rollday'),
    }));
};

var shared_instance, instance_timer;
var last_used = 0, elapsed_time = 0;
var references = [];
var instance_lock = Promise.resolve();

/** Track the references to this model */
function register(ref) {
    references.push(ref);
    return ref;
}

/** If this is the last reference, release shared instance */
function unregister(ref) {
    ref.closed = true;
    var idx = references.indexOf(ref);
    if (idx < 0) return Promise.resolve();
    references.splice(idx, 1)
    return instance_lock = instance_lock.catch(_.noop).then(() => {
        if (references.length) return Promise.resolve();
        else return releaseInstance();
    });
}

/** Use the shared instance, creating a new one if needed */
function sharedInstance(cmd, options) {
    if (this.closed) throw Error("IQFeed has closed");
    last_used = elapsed_time;
    if (shared_instance) return shared_instance[cmd](options);
    else return instance_lock = instance_lock.catch(_.noop).then(() => {
        shared_instance = createInstance();
        instance_timer = setInterval(() => {
            if (last_used < elapsed_time++) {
                releaseInstance().catch(logger.error);
            }
        }, config('fetch.iqfeed.timeout') || 600000);
        instance_timer.unref();
        return shared_instance[cmd](options);
    });
}

/** Free up shared instance */
function releaseInstance() {
    if (instance_timer) clearInterval(instance_timer);
    var instance = shared_instance;
    shared_instance = null;
    instance_timer = null;
    return instance ? instance.close() : Promise.resolve();
}

/** Create a new instance */
function createInstance() {
    var helpInfo = help();
    var markets = _.pick(config('markets'), config('fetch.iqfeed.markets'));
    var symbol = iqfeed_symbol.bind(this, markets);
    var launch = config('fetch.iqfeed.command');
    var iqclient = iqfeed(
        _.isArray(launch) ? launch : launch && launch.split(' '),
        config('fetch.iqfeed.env'),
        config('fetch.iqfeed.productId'),
        config('version')
    );
    var adjustments = Adjustments();
    var lookupCached = cache(lookup.bind(this, iqclient), (exchs, symbol, listed_markets) => {
        return symbol + ' ' + _.compact(_.flatten([listed_markets])).join(' ');
    }, 10);
    return {
        open() {
            return iqclient.open();
        },
        close() {
            return Promise.all([
                lookupCached.close(),
                iqclient.close(),
                adjustments.close()
            ]);
        },
        help() {
            return Promise.resolve(helpInfo);
        },
        lookup(options) {
            var exchs = _.pick(_.mapObject(
                options.market ? _.pick(markets, [options.market]) : markets,
                exch => exch.datasources.iqfeed
            ), val => val);
            var listed_markets = options.listed_market ? [options.listed_market] :
                _.compact(_.flatten(_.map(exchs, exch => exch.listed_markets)));
            if (_.isEmpty(exchs)) return Promise.resolve([]);
            else return lookupCached(exchs, symbol(options), listed_markets);
        },
        fundamental(options) {
            expect(options).to.be.like({
                symbol: /^\S+$/,
                marketClosesAt: _.isString,
                tz: _.isString
            });
            return iqclient.fundamental(symbol(options),
                options.marketClosesAt, options.tz
            ).then(fundamental => [_.extend({name: fundamental.company_name}, fundamental)]);
        },
        interday(options) {
            expect(options).to.be.like({
                interval: _.isString,
                symbol: /^\S+$/,
                begin: Boolean,
                marketOpensAt: /^\d\d:\d\d(:00)?$/,
                marketClosesAt: /^\d\d:\d\d(:00)?$/,
                tz: /^\S+\/\S+$/
            });
            expect(options.interval).to.be.oneOf(['year', 'quarter', 'month', 'week', 'day']);
            var adj = isNotEquity(markets, options) ? null : adjustments;
            return interday(iqclient, adj, symbol(options), options);
        },
        intraday(options) {
            expect(options).to.be.like({
                minutes: _.isFinite,
                symbol: /^\S+$/,
                begin: Boolean,
                tz: _.isString
            });
            expect(options.tz).to.match(/^\S+\/\S+$/);
            var adj = isNotEquity(markets, options) ? null : adjustments;
            return intraday(iqclient, adj, symbol(options), options);
        },
        rollday(options) {
            expect(options).to.be.like({
                interval: _.isString,
                minutes: _.isFinite,
                symbol: /^\S+$/,
                begin: Boolean,
                tz: _.isString
            });
            expect(options.tz).to.match(/^\S+\/\S+$/);
            var adj = isNotEquity(markets, options) ? null : adjustments;
            return rollday(iqclient, adj, options.interval, symbol(options), options);
        }
    };
}

function iqfeed_symbol(markets, options) {
    if (options.iqfeed_symbol) {
        expect(options).to.be.like({
            iqfeed_symbol: /^\S+$/
        });
        return options.iqfeed_symbol;
    } else if (markets[options.market] && markets[options.market].datasources.iqfeed) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var source = markets[options.market].datasources.iqfeed;
        var prefix = source.dtnPrefix || '';
        var suffix = source.dtnSuffix || '';
        var map = source.dtnPrefixMap || {};
        var three = options.symbol.substring(0, 3);
        var two = options.symbol.substring(0, 2);
        if (map[three])
            return map[three] + options.symbol.substring(3);
        else if (map[two])
            return map[two] + options.symbol.substring(2);
        else if (prefix || suffix)
            return prefix + options.symbol + suffix;
        else
            return options.symbol;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        return options.symbol;
    }
}

function isNotEquity(markets, options) {
    if (markets[options.market] && markets[options.market].datasources.iqfeed) {
        var source = markets[options.market].datasources.iqfeed;
        if (source.security_types) {
            return source.security_types.indexOf('EQUITY') < 0;
        }
    }
}

function lookup(iqclient, exchs, symbol, listed_markets) {
    var map = _.reduce(exchs, (map, ds) => {
        if (!_.isEmpty(listed_markets) && !_.intersection(ds.listed_markets, listed_markets).length)
            return map;
        return _.extend(ds && ds.dtnPrefixMap || {}, map);
    }, {});
    var three = symbol.substring(0, 3);
    var two = symbol.substring(0, 2);
    var mapped_symbol = map[three] ? map[three] + symbol.substring(3) :
        map[two] ? map[two] + symbol.substring(2) : symbol;
    return iqclient.lookup(mapped_symbol, listed_markets).then(rows => rows.map(row => {
        var sym = row.symbol;
        var sources = _.pick(exchs, ds => {
            if (!~ds.listed_markets.indexOf(row.listed_market)) return false;
            var prefix = ds && ds.dtnPrefix || '';
            var suffix = ds && ds.dtnSuffix || '';
            var map = ds && ds.dtnPrefixMap || {};
            var three = sym.substring(0, 3);
            var two = sym.substring(0, 2);
            if (map[three] || map[two]) return true;
            var startsWith = !prefix || sym.indexOf(prefix) === 0;
            var endsWith = !suffix || sym.indexOf(suffix) == sym.length - suffix.length;
            return startsWith && endsWith;
        });
        var ds = _.find(sources);
        var prefix = ds && ds.dtnPrefix || '';
        var suffix = ds && ds.dtnSuffix || '';
        var map = _.invert(ds && ds.dtnPrefixMap || {});
        var four = sym.substring(0, 4);
        var three = sym.substring(0, 3);
        var startsWith = prefix && sym.indexOf(prefix) === 0;
        var endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
        var symbol = map[four] ? map[four] + sym.substring(4) :
            map[three] ? map[three] + sym.substring(3) :
            startsWith && endsWith ?
                sym.substring(prefix.length, sym.length - prefix.length - suffix.length) :
            startsWith ? sym.substring(prefix.length) :
            endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
        return {
            symbol: symbol,
            iqfeed_symbol: row.symbol,
            market: _.first(_.keys(sources)),
            name: row.name,
            listed_market: row.listed_market,
            security_type: row.security_type
        };
    })).then(rows => rows.filter(row => row.market));
}

function interday(iqclient, adjustments, symbol, options) {
    switch(options.interval) {
        case 'year': return year(iqclient, adjustments, symbol, options);
        case 'quarter': return quarter(iqclient, adjustments, symbol, options);
        case 'month': return month(iqclient, adjustments, symbol, options);
        case 'week': return week(iqclient, adjustments, symbol, options);
        case 'day': return day(iqclient, adjustments, symbol, options);
        default:
            expect(options.interval).to.be.oneOf([
                'year', 'quarter', 'month', 'week', 'day'
            ]);
    }
}

function year(iqclient, adjustments, symbol, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return month(iqclient, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('year'),
        end: end && (end.isAfter(moment(end).startOf('year')) ? end.endOf('year') : end)
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

function quarter(iqclient, adjustments, symbol, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return month(iqclient, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('quarter'),
        end: end && (end.isAfter(moment(end).startOf('quarter')) ? end.endOf('quarter') : end)
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

function month(iqclient, adjustments, symbol, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return day(iqclient, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('month'),
        end: end && (end.isAfter(moment(end).startOf('month')) ? end.endOf('month') : end)
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

function week(iqclient, adjustments, symbol, options) {
    var begin = moment.tz(options.begin, options.tz);
    return day(iqclient, adjustments, symbol, _.defaults({
        begin: begin.day() === 0 || begin.day() == 6 ? begin.startOf('day') :
            begin.startOf('isoWeek').subtract(1, 'days'),
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

function day(iqclient, adjustments, symbol, options) {
    return Promise.all([
        iqclient.day(symbol, options.begin, null, options.tz),
        adjustments && adjustments(options)
    ]).then(prices_adjustments => {
        var prices = prices_adjustments[0], adjustments = prices_adjustments[1];
        return adjRight(prices, adjustments, options, (today, datum, splits, adj) => ({
            ending: endOf('day', datum.Date_Stamp, options),
            open: parseCurrency(datum.Open, splits),
            high: parseCurrency(datum.High, splits),
            low: parseCurrency(datum.Low, splits),
            close: parseCurrency(datum.Close, splits) || today.close,
            volume: parseFloat(datum.Period_Volume) || 0,
            adj_close: Math.round(
                parseCurrency(datum.Close, splits) * adj
                * 1000000) / 1000000 || today.adj_close
        }));
    }).then(result => {
        if (_.last(result) && !_.last(result).close) result.pop();
        if (!options.end) return result;
        var end = moment.tz(options.end || now, options.tz);
        if (end.isAfter()) return result;
        var final = end.format();
        var last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    }).then(bars => includeIntraday(iqclient, adjustments, bars, symbol, options));
}

function intraday(iqclient, adjustments, symbol, options) {
    return Promise.all([
        iqclient.minute(options.minutes, symbol, options.begin, options.end, options.tz),
        adjustments && adjustments(options)
    ]).then(prices_adjustments => {
        var prices = prices_adjustments[0], adjustments = prices_adjustments[1];
        return adjRight(prices, adjustments, options, (today, datum, splits, adj) => ({
            ending: moment.tz(datum.Time_Stamp, 'America/New_York').tz(options.tz).format(),
            open: parseFloat(datum.Open),
            high: parseFloat(datum.High),
            low: parseFloat(datum.Low),
            close: parseFloat(datum.Close) || today.close,
            volume: parseFloat(datum.Period_Volume) || 0,
            total_volume: parseFloat(datum.Total_Volume),
            adj_close: Math.round(
                parseFloat(datum.Close) * adj
                * 1000000) / 1000000 || today.adj_close
        })).filter(bar => bar.volume);
    }).then(result => {
        if (_.last(result) && !_.last(result).close) result.pop();
        if (!options.end) return result;
        var end = moment.tz(options.end, options.tz);
        if (end.isAfter()) return result;
        var final = end.format();
        var last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

function includeIntraday(iqclient, adjustments, bars, symbol, options) {
    var now = moment.tz(options.now, options.tz);
    if (now.days() === 6 || !bars.length) return bars;
    var tz = options.tz;
    var opensAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketOpensAt, tz);
    var closesAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, tz);
    if (!opensAt.isBefore(closesAt)) opensAt.subtract(1, 'day');
    if (now.isBefore(opensAt)) return bars;
    if (!closesAt.isAfter(_.last(bars).ending)) return bars;
    var end = moment.tz(options.end || now, options.tz);
    if (end.isBefore(opensAt)) return bars;
    var adj = _.last(bars).adj_close / _.last(bars).close;
    var test_size = bars.length;
    return mostRecentTrade(iqclient, adjustments, symbol, _.defaults({
        begin: _.last(bars).ending,
        end: end.format(),
        tz: tz
    }, options)).then(intraday => intraday.reduce((bars, bar) => {
        if (_.last(bars).incomplete) bars.pop(); // remove incomplete (holi)days
        if (adjustments && bar.ending == _.last(bars).ending) {
            adj = _.last(bars).adj_close / bar.close;
        } else if (bar.ending > _.last(bars).ending) {
            bars.push(_.extend({}, bar, {adj_close: bar.close * adj}));
        }
        return bars;
    }, bars));
}

async function mostRecentTrade(iqclient, adjustments, symbol, options) {
    if (options.market == 'OPRA' && isOptionExpired(symbol)) {
        return [];
    } else if (options.market == 'OPRA') {
        return summarize(iqclient, symbol, options);
    } else {
        var [m30, currently] = await Promise.all([
            rollday(iqclient, adjustments, 'day', symbol, _.defaults({
                minutes: 30
            }, options)),
            summarize(iqclient, symbol, options)
        ]);
        var bar = _.last(m30);
        var today = _.last(currently);
        if (!bar) return currently;
        else if (!today) return m30;
        else if (bar.ending == options.begin && today.ending > options.begin) return today;
        else if (bar.ending != today.ending) return m30;
        return _.initial(m30).concat(Object.assign({
            ending: today.ending,
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: today.close,
            volume: today.total_volume || bar.total_volume,
            asof: today.asof,
            incomplete: true
        }));
    }
}

function rollday(iqclient, adjustments, interval, symbol, options) {
    var asof = moment().tz(options.tz).format();
    return intraday(iqclient, adjustments, symbol, options).then(bars => bars.reduce((days, bar) => {
        var merging = days.length && _.last(days).ending >= bar.ending;
        if (!merging && isBeforeOpen(bar.ending, options)) return days;
        var today = merging ? days.pop() : {};
        days.push({
            ending: today.ending || endOf(interval, bar.ending, options),
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: bar.close,
            volume: bar.total_volume,
            asof: asof,
            incomplete: true
        });
        return days;
    }, []));
}

var months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
function isOptionExpired(symbol) {
    var m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return null;
    var yy = m[2];
    var cc = +yy<50 ? 2000 : 1900;
    var year = cc + +yy;
    var day = m[3];
    var mo = months[m[4]];
    var expiration_date = `${year}-${mo}-${day}`;
    var exdate = moment(expiration_date).endOf('day');
    return exdate.isValid() && exdate.isBefore();
}

function summarize(iqclient, symbol, options) {
    var now = moment();
    var asof = moment(now).tz(options.tz).format();
    return iqclient.summary(symbol).then(summary => {
        var use_mid = summary.decimal_precision && summary.ask && summary.bid;
        var date = use_mid ? now.tz('America/New_York') :
            moment.tz(summary.most_recent_trade_date, 'MM/DD/YYYY', 'America/New_York');
        var time = use_mid ? _.last(_.sortBy([summary.bid_timems, summary.ask_timems])) :
            summary.most_recent_trade_timems;
        var ending = moment.tz(date.format('YYYY-MM-DD') + ' ' + time, 'America/New_York').tz(options.tz);
        var ten = use_mid && Math.pow(10, +summary.decimal_precision);
        var close = use_mid ? Math.round((+summary.ask + +summary.bid)/2 * ten)/ten :
            summary.most_recent_trade;
        if (!close || !ending.isValid() || ending.isAfter(now)) return [];
        else return [{
            ending: endOf('day', ending, options),
            open: +summary.open,
            high: +summary.high,
            low: +summary.low,
            close: close,
            volume: +summary.total_volume,
            asof: asof,
            incomplete: true
        }];
    });
}

function adjustment(base, bar) {
    var scale = bar.adj_close/bar.close * base.close / base.adj_close;
    if (Math.abs(scale -1) < 0.000001) return _.identity;
    else return price => Math.round(price * scale * 10000) / 10000;
}

function parseCurrency(string, split) {
    if (Math.abs(split -1) < 0.000001) return parseFloat(string);
    else return Math.round(parseFloat(string) * split * 10000) / 10000;
}

function adjRight(bars, adjustments, options, cb) {
    var result = [];
    var today = null;
    var msplit = 1;
    var a = adjustments && adjustments.length;
    for (var i=bars.length -1; i>=0; i--) {
        var div = 0;
        var split = 1;
        if (adjustments && adjustments.length) {
            while (a > 0 && adjustments[a-1].exdate > (bars[i].Date_Stamp || bars[i].Time_Stamp)) {
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
        }
        result[i] = today = cb(today, bars[i], msplit, adj ? adj.adj : 1);
        if (adjustments && adjustments.length) {
            today.split = 1;
            today.dividend = 0;
        }
    }
    return result;
}

function endOf(unit, date, options) {
    var start = moment.tz(date, options.tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    var ending = moment(start).endOf(unit);
    var days = 0;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        var closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.format();
}

function isBeforeOpen(ending, options) {
    var time = ending.substring(11, 19);
    if (options.marketOpensAt < options.marketClosesAt) {
        return time > options.marketClosesAt || time < options.marketOpensAt;
    } else if (options.marketClosesAt < options.marketOpensAt) {
        return time > options.marketClosesAt && time < options.marketOpensAt;
    } else {
        return false; // 24 hour market
    }
}
