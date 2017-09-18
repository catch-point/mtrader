// fetch-yahoo.js
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
const yahooClient = require('./yahoo-client.js');
const cache = require('./cache.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    var yahoo = _.mapObject(yahooClient(), (fn, name) => {
        if (!_.isFunction(fn) || name == 'close') return fn;
        else return cache(fn, function() {
            return JSON.stringify(_.toArray(arguments));
        }, require('os').cpus().length*2);
    });
    return {
        close() {
            return Promise.all(_.map(yahoo, (fn, name) => {
                if (_.isFunction(fn.close)) {
                    return fn.close();
                } else if (name == 'close') {
                    return fn();
                }
            }));
        },
        lookup(options) {
            var exchanges = config('exchanges');
            var langs = options.marketLang ? [options.marketLang] :
                _.uniq(_.compact(_.map(exchanges, exchange =>
                    exchange.datasources.yahoo && exchange.datasources.yahoo.marketLang
                )));
            return Promise.all(langs.map(marketLang =>
                yahoo.lookup(symbol(options), marketLang)
            )).then(rows => _.flatten(rows, true)).then(rows => rows.filter(row => {
                var suffix = options.yahooSuffix || '';
                if (suffix && row.symbol.indexOf(suffix) != row.symbol.length - suffix.length)
                    return false;
                return !options.exchs || _.contains(options.exchs, row.exch);
            })).then(rows => rows.map(row => {
                var sym = row.symbol;
                var sources = options.exchange ? {[options.exchange]: options} :
                    _.pick(_.mapObject(exchanges, exchange =>
                        exchange.datasources.yahoo
                    ), source =>
                        source && _.contains(source.exchs, row.exch) && _.contains(source.fetch, 'lookup')
                    );
                var ds = _.find(sources);
                var suffix = ds && ds.yahooSuffix || '';
                var endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
                var symbol = endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
                return _.defaults({
                    symbol: symbol,
                    yahoo_symbol: row.symbol,
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
            return yahoo.fundamental(symbol(options)).then(security => [_.defaults({
                yahoo_symbol: security.symbol
            }, _.omit(security, value => value == 'N/A'))]);
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
                case 'year': return year(yahoo, symbol(options), options);
                case 'quarter': return quarter(yahoo, symbol(options), options);
                case 'month': return month(yahoo, symbol(options), options);
                case 'week': return week(yahoo, symbol(options), options);
                case 'day': return day(yahoo, symbol(options), options);
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

function symbol(options) {
    if (options.yahoo_symbol) {
        expect(options).to.be.like({
            yahoo_symbol: /^\S+$/
        });
        return options.yahoo_symbol;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var suffix = options.yahooSuffix || '';
        if (!suffix && options.symbol.match(/^\w+$/))
            return options.symbol;
        else
            return options.symbol
                .replace(/\^/, '-P')
                .replace(/[\.\-\/]/, '-')
                .replace(/-PR./, '-P')
                .replace(/\./g, '') +
                suffix;
    }
}

function year(yahoo, symbol, options) {
    return month(yahoo, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('year'),
        end: options.end && moment(options.end).tz(options.tz).endOf('year')
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

function quarter(yahoo, symbol, options) {
    return month(yahoo, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('quarter'),
        end: options.end && moment(options.end).tz(options.tz).endOf('quarter')
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

function month(yahoo, symbol, options) {
    return day(yahoo, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('month'),
        end: options.end && moment(options.end).tz(options.tz).endOf('month')
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

function week(yahoo, symbol, options) {
    return day(yahoo, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('isoWeek'),
        end: options.end && moment(options.end).tz(options.tz).endOf('isoWeek')
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

function day(yahoo, symbol, options) {
    var now = moment().tz(options.tz);
    var eod = now.days() === 6 || options.end && now.diff(options.end, 'days') >= 1;
    var final = endOf('day', options.end || now, options);
    var decade = (Math.floor(moment.tz(options.begin, options.tz).year()/10)*10)+'-01-01';
    return Promise.all([
        yahoo.day(symbol, options.begin, options.tz),
        yahoo.split(symbol, decade, options.tz),
        yahoo.dividend(symbol, decade, options.tz),
        eod ? {} : yahoo.intraday(symbol)
    ]).then(psdi => {
        var prices = psdi[0], split = psdi[1], div = psdi[2], intraday = psdi[3];
        var bars = adjRight(prices, split, div, options, (today, datum, splits, split, div) => ({
            ending: endOf('day', datum.Date, options),
            open: parseCurrency(datum.Open, splits),
            high: parseCurrency(datum.High, splits),
            low: parseCurrency(datum.Low, splits),
            close: parseCurrency(datum.Close, 1) || today.close,
            volume: parseFloat(datum.Volume) || 0,
            adj_close: Math.round((_.isEmpty(today) ?
                parseCurrency(datum.Close, 1)/split - div :
                today.adj_close + today.adj_close/today.close *
                    (parseCurrency(datum.Close, 1)/split - today.close - div)
                ) * 1000000) / 1000000 || today.adj_close
        })).filter(bar => bar.volume);
        return appendIntraday(bars, intraday, now, options);
    }).then(result => {
        if (_.last(result) && !_.last(result).close) result.pop();
        if (!options.end) return result;
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

function adjRight(bars, _splits, _divs, options, cb) {
    var result = [];
    var splits = _.sortBy(_splits, 'Date');
    var divs = _.sortBy(_divs, 'Date');
    var today = null;
    var msplit = 1;
    for (var i=bars.length -1; i>=0; i--) {
        var div = 0;
        while (divs.length && _.last(divs).Date > bars[i].Date) {
            div += +divs.pop()['Dividends'] * msplit;
        }
        var ratio = 1;
        while (splits.length && _.last(splits).Date > bars[i].Date) {
            var nd = splits.pop()['Stock Splits'].split('/');
            ratio = ratio * +nd[0] / +nd[1];
        }
        msplit = msplit * ratio;
        // check if split is being used to adjust for a big dividend
        var split = !div || ratio < 1 || ratio > 2 ? ratio : 1;
        if (today) {
            today.split = split;
            today.dividend = div;
        } else {
            result[bars.length] = {
                split: split,
                dividend: div
            };
        }
        result[i] = today = cb(today, bars[i], msplit, split, div);
        today.split = 1;
        today.dividend = 0;
    }
    return result;
}

function appendIntraday(bars, intraday, now, options) {
    if (_.isEmpty(intraday) || _.isEmpty(bars)) return bars;
    var dateTime = intraday.date + ' ' + intraday.time;
    var m = dateTime.match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+)(am|pm)/);
    if (!m) return bars;
    var tz = options.tz;
    var marketClosesAt = options.marketClosesAt;
    var hour = 'pm' == m[6] && 12 > +m[4] ? 12 + +m[4] : m[4];
    var date = (m[3]+'-'+m[1]+'-'+m[2]).replace(/\b(\d)\b/g,'0$1');
    var lastTrade = date + ' ' + (hour+':'+m[5]+':00').replace(/\b(\d)\b/g,'0$1');
    var low = intraday.range.replace(/[^\d\.].*$/,'');
    var high = intraday.range.replace(/^.*[^\d\.]/,'');
    var quote = {
        ending: moment.tz(date + ' ' + marketClosesAt, tz).format(),
        open: _.isFinite(intraday.open) ? +intraday.open : undefined,
        high: _.isFinite(high) ? +high : undefined,
        low: _.isFinite(low) ? +low : undefined,
        close: _.isFinite(intraday.close) ? +intraday.close : undefined,
        prior_close: _.isFinite(intraday.prior_close) ? +intraday.prior_close : undefined,
        volume: _.isFinite(intraday.volume) ? +intraday.volume : undefined,
        lastTrade: moment.tz(lastTrade, tz).format()
    };
    if (!_.isFinite(quote.open)) return bars;
    var latest = {};
    while (!_.last(bars).ending || _.last(bars).ending >= quote.ending) latest = bars.pop();
    var prior_close = latest.adj_close || _.last(bars).adj_close || quote.prior_close;
    var intraday = _.defaults({
        ending: latest.ending || quote.ending,
        open: latest.open || quote.open,
        high: Math.max(latest.high, quote.high) || latest.high || quote.high,
        low: Math.min(latest.low, quote.low) || latest.low || quote.low,
        close: quote.close,
        volume: quote.volume + (latest.volume || 0),
        adj_close: Math.round(quote.close * prior_close / quote.prior_close * 1000000) / 1000000,
        split: latest.split || 1,
        dividend: latest.dividend || 0,
        lastTrade: quote.lastTrade,
        asof: now.format(),
        incomplete: true
    }, latest);
    bars.push(intraday);
    return bars;
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

