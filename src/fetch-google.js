// fetch-google.js
/*
 *  Copyright (c) 2017 James Leigh, Some Rights Reserved
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
const googleClient = require('./google-client.js');
const cache = require('./cache.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

function help() {
    var commonOptions = {
        symbol: {
            description: "Ticker symbol used by the exchange"
        },
        exchange: {
            description: "Exchange market acronym",
            values: _.keys(_.pick(config('exchanges'), exch => exch.datasources.google))
        },
        google_symbol: {
            description: "Symbol used in the Google finance network"
        }
    };
    var lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/exchange using the given symbol prefix using the Google network",
        properties: ['symbol', 'google_symbol', 'exchange', 'name'],
        options: commonOptions
    };
    var fundamental = {
        name: "fundamental",
        usage: "fundamental(options)",
        description: "Details of a security on the Google network",
        properties: ['t', 'e', 'name', 'id', 'sname', 'iname', 'hi52', 'lo52', 'eps', 'beta', 'instown', 'mc', 'shares', 'overview'],
        options: commonOptions
    };
    var interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic data for a security on the Google network",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend({}, commonOptions, {
            yahoo_symbol: {
                description: "Symbol for security as used by The Yahoo! Network"
            },
            interval: {
                usage: "year|quarter|month|week|day",
                description: "The bar timeframe for the results",
                values: _.intersection(["year", "quarter", "month", "week", "day"],config('google.interday'))
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
                description: "Time of day that the exchange options"
            },
            marketClosesAt: {
                description: "Time of day that the exchange closes"
            },
            tz: {
                description: "Timezone of the exchange formatted using the identifier in the tz database"
            }
        })
    };
    return _.compact([
        config('google.lookup') && lookup,
        config('google.fundamental') && fundamental,
        interday
    ]);
}

module.exports = function() {
    var helpInfo = help();
    var exchanges = config('exchanges');
    var symbol = google_symbol.bind(this, exchanges);
    var google = googleClient();
    var yahoo = _.mapObject(yahooClient(), (fn, name) => {
        if (!_.isFunction(fn) || name == 'close') return fn;
        else return cache(fn, function() {
            return JSON.stringify(_.toArray(arguments));
        }, require('os').cpus().length*2);
    });
    return {
        close() {
            return Promise.all([google.close()].concat(_.map(yahoo, (fn, name) => {
                if (_.isFunction(fn.close)) {
                    return fn.close();
                } else if (name == 'close') {
                    return fn();
                }
            })));
        },
        help() {
            return Promise.resolve(helpInfo);
        },
        lookup(options) {
            return google.lookup(symbol(options)).then(rows => rows.map(row => {
                var sources = options.exchange ? {[options.exchange]: options} :
                    _.pick(_.mapObject(exchanges, exchange =>
                        exchange.datasources.google
                    ), source =>
                        source && source.e == row.e
                    );
                return {
                    symbol: row.symbol,
                    google_symbol: row.e + ':' + row.symbol,
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
            return google.fundamental(symbol(options)).then(security => [security]);
        },
        interday(options) {
            expect(options).to.be.like({
                interval: _.isString,
                symbol: /^\S+$/,
                begin: Boolean,
                marketClosesAt: _.isString,
                tz: _.isString
            });
            var opts = _.extend({
                google_symbol: google_symbol(exchanges, options),
                yahoo_symbol: yahoo_symbol(exchanges, options)
            }, options);
            switch(options.interval) {
                case 'year': return year(google, yahoo, opts);
                case 'quarter': return quarter(google, yahoo, opts);
                case 'month': return month(google, yahoo, opts);
                case 'week': return week(google, yahoo, opts);
                case 'day': return day(google, yahoo, opts);
                default:
                    expect(options.interval).to.be.oneOf([
                        'year', 'quarter', 'month', 'week', 'day'
                    ]);
            }
        },
        intraday(options) {
            throw Error("Intraday is not supported by this Google datasource");
        }
    };
};

function google_symbol(exchanges, options) {
    if (options.google_symbol) {
        expect(options).to.be.like({
            google_symbol: /^\S+$/
        });
        return options.google_symbol;
    } else if (exchanges[options.exchange] && exchanges[options.exchange].datasources.google) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var source = exchanges[options.exchange].datasources.google;
        return source.e + ':' + options.symbol;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        return options.symbol;
    }
}

function yahoo_symbol(exchanges, options) {
    if (options.yahoo_symbol) {
        expect(options).to.be.like({
            yahoo_symbol: /^\S+$/
        });
        return options.yahoo_symbol;
    } else if (exchanges[options.exchange] && exchanges[options.exchange].datasources.yahoo) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var source = exchanges[options.exchange].datasources.yahoo;
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

function year(google, yahoo, options) {
    return month(google, yahoo, _.defaults({
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

function quarter(google, yahoo, options) {
    return month(google, yahoo, _.defaults({
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

function month(google, yahoo, options) {
    return day(google, yahoo, _.defaults({
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

function week(google, yahoo, options) {
    return day(google, yahoo, _.defaults({
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

function day(google, yahoo, options) {
    var now = moment().tz(options.tz);
    var eod = now.days() === 6 || options.end && now.diff(options.end, 'days') >= 1;
    var final = endOf('day', options.end || now, options);
    var decade = (Math.floor(moment.tz(options.begin, options.tz).year()/10)*10)+'-01-01';
    return Promise.all([
        getPrices(google, options.google_symbol, options.begin, now, options.tz),
        yahoo.split(options.yahoo_symbol, decade, options.tz),
        yahoo.dividend(options.yahoo_symbol, decade, options.tz),
        eod ? [] : google.intraday(options.google_symbol, 300),
        eod ? [] : google.quote(options.google_symbol)
    ]).then(psdiq => {
        var prices = psdiq[0], split = psdiq[1], div = psdiq[2], intraday = psdiq[3], quote = psdiq[4];
        var bars = adjReverse(prices, split, div, options, (today, datum, date, splits, split, div) => ({
            ending: endOf('day', date, options),
            open: parseCurrency(datum.Open, splits),
            high: parseCurrency(datum.High, splits),
            low: parseCurrency(datum.Low, splits),
            close: parseCurrency(datum.Close, splits) || today.close,
            volume: parseFloat(datum.Volume) || 0,
            adj_close: Math.round((_.isEmpty(today) ?
                parseCurrency(datum.Close, splits)/split - div :
                today.adj_close + today.adj_close/today.close *
                    (parseCurrency(datum.Close, splits)/split - today.close - div)
                ) * 1000000) / 1000000 || today.adj_close
        })).filter(bar => bar.volume);
        var q = _.extend({volume: sumVolume(intraday)}, quote);
        return appendIntraday(bars, q, now, options);
    }).then(result => {
        if (_.last(result) && !_.last(result).close) result.pop();
        if (!options.end) return result;
        var last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

function getPrices(google, google_symbol, begin, end, tz) {
    return google.day(google_symbol, begin, end, tz).then(prices => {
        if (prices.length <= 0 || prices.length % 1000 !== 0) return prices;
        // data was likely truncated
        var earlier = moment.tz(_.last(prices).Date, 'D-MMM-YY', tz).subtract(1, 'days');
        if (earlier.isBefore(begin)) return prices; // it is all here
        return getPrices(google, google_symbol, begin, earlier, tz).then(predata => {
            return prices.concat(predata);
        });
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

function adjReverse(bars, _splits, _divs, options, cb) {
    var result = [];
    var splits = _.sortBy(_splits, 'Date');
    var divs = _.sortBy(_divs, 'Date');
    var today = null;
    var msplit = 1, gsplit = 1;
    for (var i=0; i<bars.length; i++) {
        var date = moment.tz(bars[i].Date, 'D-MMM-YY', options.tz);
        var format = date.format('Y-MM-DD');
        var div = 0;
        while (divs.length && _.last(divs).Date > format) {
            div += +divs.pop()['Dividends'] * msplit;
        }
        var ratio = 1;
        while (splits.length && _.last(splits).Date > format) {
            var nd = splits.pop()['Stock Splits'].split('/');
            ratio = ratio * +nd[0] / +nd[1];
        }
        msplit = msplit * ratio;
        // check if split is being used to adjust for a big dividend
        var split = !div || ratio < 1 || ratio > 2 ? ratio : 1;
        gsplit = gsplit * split;
        if (today) {
            today.split = split;
            today.dividend = div;
        } else {
            result[bars.length - i] = {
                split: split,
                dividend: div
            };
        }
        result[bars.length -1 - i] = today = cb(today, bars[i], date, gsplit, split, div);
        today.split = 1;
        today.dividend = 0;
    }
    return result;
}

function sumVolume(intraday, options) {
    return intraday.map(bar => parseFloat(bar.VOLUME)).reduce((a, b) => a+b, 0);
}

function appendIntraday(bars, quote, now, options) {
    if (_.isEmpty(quote) || _.isEmpty(bars)) return bars;
    if (!_.isFinite(quote.el || quote.l) || !_.isFinite(quote.c)) return bars;
    var pcls = +quote.l - +quote.c;
    var lt = quote.elt || quote.lt;
    var m = lt && lt.match(/(\w+) (\d+), (\d+):(\d\d)(AM|PM) (\w+)/);
    var tz = m && moment.tz.zone(m[6]) ? m[6] : options.tz;
    var marketClosesAt = options.marketClosesAt;
    var lastTrade = m ? moment.tz(lt, 'MMM D, H:mmA', tz) : moment().tz(tz);
    var ending = moment.tz(lastTrade.format('Y-MM-DD') + ' ' + marketClosesAt, tz).format();
    var open = _.isFinite(quote.op) ? +quote.op : undefined;
    var high = _.isFinite(quote.hi) ? +quote.hi : undefined;
    var low = _.isFinite(quote.lo) ? +quote.lo : undefined;
    var close = +(quote.el || quote.l);
    var volume = _.isFinite(quote.volume) ? +quote.volume : undefined;
    var latest = {};
    while (!_.last(bars).ending || _.last(bars).ending >= ending) latest = bars.pop();
    var prior_close = latest.adj_close || _.last(bars).adj_close || pcls;
    bars.push(_.defaults({
        ending: latest.ending || ending,
        open: latest.open || open,
        high: Math.max(latest.high, high) || latest.high || high,
        low: Math.min(latest.low, low) || latest.low || low,
        close: close,
        volume: latest.volume || volume || 0,
        adj_close: Math.round(close * prior_close / pcls * 1000000) / 1000000,
        split: latest.split || 1,
        dividend: latest.dividend || 0,
        lastTrade: lastTrade.format(),
        asof: now.format(),
        incomplete: true
    }, latest));
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

