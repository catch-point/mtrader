// fetch-iqfeed.js
/*
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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

const _ = require('underscore');
const moment = require('moment-timezone');
const config = require('./config.js');
const iqfeed = require('./iqfeed-client.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

function help() {
    var commonOptions = {
        symbol: {
            description: "Ticker symbol used by the exchange"
        },
        exchange: {
            description: "Exchange market acronym",
            values: config('fetch.iqfeed.exchanges')
        },
        iqfeed_symbol: {
            description: "Symbol used in the DTN network"
        }
    };
    var tzOptions = {
        marketOpensAt: {
            description: "Time of day that the exchange options"
        },
        marketClosesAt: {
            description: "Time of day that the exchange closes"
        },
        tz: {
            description: "Timezone of the exchange formatted using the identifier in the tz database"
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
        description: "Looks up existing symbol/exchange using the given symbol prefix using the local IQFeed client",
        properties: ['symbol', 'iqfeed_symbol', 'exchange', 'name'],
        options: commonOptions
    };
    var fundamental = {
        name: "fundamental",
        usage: "fundamental(options)",
        description: "Details of a security on the local IQFeed client",
        properties: ['type', 'symbol', 'exchange_id', 'pe', 'average_volume', '52_week_high', '52_week_low', 'calendar_year_high', 'calendar_year_low', 'dividend_yield', 'dividend_amount', 'dividend_rate', 'pay_date', 'exdividend_date', 'reserved', 'reserved', 'reserved', 'short_interest', 'reserved', 'current_year_earnings_per_share', 'next_year_earnings_per_share', 'five_year_growth_percentage', 'fiscal_year_end', 'reserved', 'company_name', 'root_option_symbol', 'percent_held_by_institutions', 'beta', 'leaps', 'current_assets', 'current_liabilities', 'balance_sheet_date', 'long_term_debt', 'common_shares_outstanding', 'reserved', 'split_factor_1', 'split_factor_2', 'reserved', 'reserved', 'format_code', 'precision', 'sic', 'historical_volatility', 'security_type', 'listed_market', '52_week_high_date', '52_week_low_date', 'calendar_year_high_date', 'calendar_year_low_date', 'year_end_close', 'maturity_date', 'coupon_rate', 'expiration_date', 'strike_price', 'naics', 'exchange_root'],
        options: _.extend(commonOptions, tzOptions)
    };
    var interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic data for a security on the local IQFeed client",
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
        description: "Historic data for a security on the local IQFeed client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
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
    var exchanges = _.pick(config('exchanges'), config('fetch.iqfeed.exchanges'));
    var symbol = iqfeed_symbol.bind(this, exchanges);
    var launch = config('fetch.iqfeed.command');
    var iqclient = iqfeed(
        _.isArray(launch) ? launch : launch && launch.split(' '),
        config('fetch.iqfeed.env'),
        config('fetch.iqfeed.productId'),
        config('version')
    );
    return {
        open() {
            return iqclient.open();
        },
        close() {
            return iqclient.close();
        },
        help() {
            return Promise.resolve(helpInfo);
        },
        lookup(options) {
            var exchs = _.pick(_.mapObject(
                options.exchange ? _.pick(exchanges, [options.exchange]) : exchanges,
                exch => exch.datasources.iqfeed
            ), val => val);
            if (_.isEmpty(exchs)) return Promise.resolve([]);
            return iqclient.lookup(symbol(options), options.listed_market).then(rows => rows.map(row => {
                var sym = row.symbol;
                var sources = _.pick(exchs, ds => {
                    if (ds.listed_market != row.listed_market) return false;
                    var prefix = ds && ds.dtnPrefix || '';
                    var suffix = ds && ds.dtnSuffix || '';
                    var startsWith = !prefix || sym.indexOf(prefix) === 0;
                    var endsWith = !suffix || sym.indexOf(suffix) == sym.length - suffix.length;
                    return startsWith && endsWith;
                });
                var ds = _.find(sources);
                var prefix = ds && ds.dtnPrefix || '';
                var suffix = ds && ds.dtnSuffix || '';
                var startsWith = prefix && sym.indexOf(prefix) === 0;
                var endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
                var symbol = startsWith && endsWith ?
                    sym.substring(prefix.length, sym.length - prefix.length - suffix.length) :
                    startsWith ? sym.substring(prefix.length) :
                    endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
                return {
                    symbol: symbol,
                    iqfeed_symbol: row.symbol,
                    exchange: _.first(_.keys(sources)),
                    name: row.name
                };
            })).then(rows => rows.filter(row => row.exchange));
        },
        fundamental(options) {
            expect(options).to.be.like({
                symbol: /^\S+$/,
                marketClosesAt: _.isString,
                tz: _.isString
            });
            return iqclient.fundamental(symbol(options),
                options.marketClosesAt, options.tz
            ).then(fundamental => [fundamental]);
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
            switch(options.interval) {
                case 'year': return year(iqclient, symbol(options), options);
                case 'quarter': return quarter(iqclient, symbol(options), options);
                case 'month': return month(iqclient, symbol(options), options);
                case 'week': return week(iqclient, symbol(options), options);
                case 'day': return day(iqclient, symbol(options), options);
                default:
                    expect(options.interval).to.be.oneOf([
                        'year', 'quarter', 'month', 'week', 'day'
                    ]);
            }
        },
        intraday(options) {
            expect(options).to.be.like({
                minutes: _.isFinite,
                symbol: /^\S+$/,
                begin: Boolean,
                tz: _.isString
            });
            expect(options.tz).to.match(/^\S+\/\S+$/);
            return intraday(iqclient, symbol(options), options);
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
            return rollday(iqclient, options.interval, symbol(options), options);
        }
    };
};

function iqfeed_symbol(exchanges, options) {
    if (options.iqfeed_symbol) {
        expect(options).to.be.like({
            iqfeed_symbol: /^\S+$/
        });
        return options.iqfeed_symbol;
    } else if (exchanges[options.exchange] && exchanges[options.exchange].datasources.iqfeed) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var source = exchanges[options.exchange].datasources.iqfeed;
        var prefix = source.dtnPrefix || '';
        var suffix = source.dtnSuffix || '';
        if (prefix || suffix)
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

function year(iqclient, symbol, options) {
    return month(iqclient, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('year')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).year()))
      .then(years => _.map(years, bars => bars.reduce((year, month) => {
        return _.defaults({
            ending: endOf('year', month.ending, options),
            open: year.open,
            high: Math.max(year.high, month.high),
            low: month.low && month.low < year.low ? month.low : year.low,
            close: month.close,
            volume: year.volume + month.volume,
            adj_close: month.adj_close
        }, month, year);
      }, _.first(bars))));
}

function quarter(iqclient, symbol, options) {
    return month(iqclient, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('quarter')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('Y-Q')))
      .then(quarters => _.map(quarters, bars => bars.reduce((quarter, month) => {
        return _.defaults({
            ending: endOf('quarter', month.ending, options),
            open: quarter.open,
            high: Math.max(quarter.high, month.high),
            low: month.low && month.low < quarter.low ? month.low : quarter.low,
            close: month.close,
            volume: quarter.volume + month.volume,
            adj_close: month.adj_close
        }, month, quarter);
      }, _.first(bars))));
}

function month(iqclient, symbol, options) {
    return iqclient.month(symbol,
        options.begin, options.end,
        options.marketClosesAt, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: endOf('month', datum.Date_Stamp, options),
        open: parseFloat(datum.Open),
        high: parseFloat(datum.High),
        low: parseFloat(datum.Low),
        close: parseFloat(datum.Close),
        volume: parseFloat(datum.Period_Volume),
        open_interest: parseFloat(datum.Open_Interest)
    }))).then(bars => includeIntraday(iqclient, bars, 'month', symbol, options));
}

function week(iqclient, symbol, options) {
    return iqclient.week(symbol,
        options.begin, options.end,
        options.marketClosesAt, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: endOf('week', datum.Date_Stamp, options),
        open: parseFloat(datum.Open),
        high: parseFloat(datum.High),
        low: parseFloat(datum.Low),
        close: parseFloat(datum.Close),
        volume: parseFloat(datum.Period_Volume),
        open_interest: parseFloat(datum.Open_Interest)
    }))).then(bars => includeIntraday(iqclient, bars, 'week', symbol, options));
}

function day(iqclient, symbol, options) {
    return iqclient.day(symbol,
        options.begin, options.end,
        options.marketClosesAt, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: endOf('day', datum.Date_Stamp, options),
        open: parseFloat(datum.Open),
        high: parseFloat(datum.High),
        low: parseFloat(datum.Low),
        close: parseFloat(datum.Close),
        volume: parseFloat(datum.Period_Volume),
        open_interest: parseFloat(datum.Open_Interest)
    }))).then(bars => includeIntraday(iqclient, bars, 'day', symbol, options));
}

function intraday(iqclient, symbol, options) {
    return iqclient.minute(
        options.minutes, symbol,
        options.begin, options.end, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: moment.tz(datum.Time_Stamp, 'America/New_York').tz(options.tz).format(),
        open: parseFloat(datum.Open),
        high: parseFloat(datum.High),
        low: parseFloat(datum.Low),
        close: parseFloat(datum.Close),
        volume: parseFloat(datum.Period_Volume),
        total_volume: parseFloat(datum.Total_Volume)
    })).filter(result => result.close > 0 && result.close < 10000 && result.volume >= 0));
}

function includeIntraday(iqclient, bars, interval, symbol, options) {
    var now = moment(options.now).tz(options.tz);
    if (now.days() === 6 || !bars.length) return bars;
    var tz = options.tz;
    var opensAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketOpensAt, tz);
    var closesAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, tz);
    if (opensAt.isBefore(closesAt) && now.isBefore(opensAt)) return bars;
    if (!closesAt.isAfter(_.last(bars).ending)) return bars;
    var end = moment(options.end || now).tz(options.tz);
    return rollday(iqclient, interval, symbol, _.defaults({
        minutes: 30,
        begin: _.last(bars).ending,
        end: end.format(),
        tz: tz
    }, options)).then(intraday => intraday.reduce((bars, bar) => {
        if (_.last(bars).incomplete) return bars;
        if (bar.ending > _.last(bars).ending) bars.push(bar);
        return bars;
    }, bars));
}

function rollday(iqclient, interval, symbol, options) {
    var asof = moment().tz(options.tz).format();
    return intraday(iqclient, symbol, options).then(bars => bars.reduce((days, bar) => {
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
