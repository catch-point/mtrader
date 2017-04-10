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

module.exports = function() {
    var launch = config(['iqfeed', 'command']);
    var command = _.isArray(launch) ? launch : launch && launch.split(' ');
    var iqclient = iqfeed(
        command,
        config(['iqfeed', 'productId']),
        config('version')
    );
    return {
        close() {
            iqclient.close();
        },
        lookup(options) {
            var exchanges = config('exchanges');
            return iqclient.lookup(symbol(options), options.listed_market).then(rows => rows.map(row => {
                var sym = row.symbol;
                var sources = options.exchange ? {[options.exchange]: options} :
                    _.pick(_.mapObject(exchanges, exchange =>
                        exchange.datasources.iqfeed
                    ), source =>
                        source && source.listed_market == row.listed_market && _.contains(source.fetch, 'lookup')
                    );
                var ds = _.find(sources);
                var prefix = ds && ds.dtnPrefix || '';
                var suffix = ds && ds.dtnSuffix || '';
                var startsWith = prefix && sym.indexOf(prefix) === 0;
                var endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
                var symbol = startsWith && endsWith ?
                    sym.substring(prefix.length, sym.length - prefix.length - suffix.length) :
                    startsWith ? sym.substring(prefix.length) :
                    endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
                return _.defaults({
                    symbol: symbol,
                    iqfeed_symbol: row.symbol,
                    exchange: _.first(_.keys(sources))
                }, row);
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
            ).then(fundamental => {
                return [_.defaults({
                    iqfeed_symbol: fundamental.symbol,
                    name: fundamental.company_name
                }, fundamental)];
            });
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
        }
    };
};

function symbol(options) {
    if (options.iqfeed_symbol) {
        expect(options).to.be.like({
            iqfeed_symbol: /^\S+$/
        });
        return options.iqfeed_symbol;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var prefix = options.dtnPrefix || '';
        var suffix = options.dtnSuffix || '';
        if (prefix || suffix)
            return prefix + options.symbol + suffix;
        else
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
    var now = moment().tz(options.tz);
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
    }))).then(bars => includeIntraday(iqclient, bars, 'month', now, symbol, options));
}

function week(iqclient, symbol, options) {
    var now = moment().tz(options.tz);
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
    }))).then(bars => includeIntraday(iqclient, bars, 'week', now, symbol, options));
}

function day(iqclient, symbol, options) {
    var now = moment().tz(options.tz);
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
    }))).then(bars => includeIntraday(iqclient, bars, 'day', now, symbol, options));
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

function includeIntraday(iqclient, bars, interval, now, symbol, options) {
    if (now.days() === 6 || !bars.length) return bars;
    var tz = options.tz;
    var opensAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketOpensAt, tz);
    if (options.end && moment.tz(options.end, tz).isBefore(opensAt)) return bars;
    var closesAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, tz);
    if (now.isBefore(opensAt) || now.isAfter(closesAt)) return bars;
    return intraday(iqclient, symbol, {
        minutes: 30,
        begin: opensAt,
        end: closesAt,
        tz: tz
    }).then(intraday => {
        if (_.isEmpty(intraday)) return bars;
        var merging = _.last(bars).ending >= _.last(intraday).ending;
        var today = intraday.reduce((today, bar) => _.extend(today, {
            ending: today.ending || endOf(interval, _.last(intraday).ending, options),
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: bar.close,
            volume: bar.total_volume,
            asof: now.format(),
            incomplete: true
        }), merging ? _.clone(bars.pop()) : {});
        bars.push(today);
        return bars;
    });
}

function endOf(unit, date, options) {
    var ending = moment.tz(date, options.tz).endOf(unit);
    if (!ending.isValid()) throw Error("Invalid date " + date);
    if (ending.days() === 0) ending.subtract(2, 'days');
    else if (ending.days() == 6) ending.subtract(1, 'days');
    var closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
    if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
    return closes.format();
}
