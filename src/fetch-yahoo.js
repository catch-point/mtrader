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
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    var yahoo = yahooClient();
    return {
        close() {
            yahoo.close();
        },
        columns() {
            return ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close', 'lastTrade', 'asof', 'incomplete'];
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
            return yahoo.fundamental(symbol(options)).then(security => [{
                symbol: options.symbol,
                yahoo_symbol: security.symbol,
                name: security.name,
                exch: security.exch
            }]);
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
        return _.defaults({
            ending: month.ending,
            open: year.open,
            high: Math.max(year.high, month.high),
            low: month.low && month.low < year.low ? month.low : year.low,
            close: month.close,
            volume: year.volume + month.volume,
            adj_close: month.adj_close
        }, month, year);
      })));
}

function quarter(yahoo, symbol, options) {
    return month(yahoo, symbol, _.defaults({
        begin: moment(options.begin).tz(options.tz).startOf('quarter'),
        end: options.end && moment(options.end).tz(options.tz).endOf('quarter')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('Y-Q')))
      .then(quarters => _.map(quarters, bars => bars.reduce((quarter, month) => {
        return _.defaults({
            ending: month.ending,
            open: quarter.open,
            high: Math.max(quarter.high, month.high),
            low: month.low && month.low < quarter.low ? month.low : quarter.low,
            close: month.close,
            volume: quarter.volume + month.volume,
            adj_close: month.adj_close
        }, month, quarter);
      })));
}

function month(yahoo, symbol, options) {
    var now = moment().tz(options.tz);
    return yahoo.month(symbol,
        options.begin, options.end,
        options.marketClosesAt, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: endOf('month', datum.Date, options.marketClosesAt, options.tz),
        open: parseCurrency(datum.Open),
        high: parseCurrency(datum.High),
        low: parseCurrency(datum.Low),
        close: parseCurrency(datum.Close),
        volume: parseFloat(datum.Volume),
        adj_close: parseFloat(datum['Adj Close'] || datum['Adj_Close'])
    }))).then(bars => includeIntraday(yahoo, bars, now, symbol, options));
}

function week(yahoo, symbol, options) {
    var now = moment().tz(options.tz);
    return yahoo.week(symbol,
        options.begin, options.end,
        options.marketClosesAt, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: endOf('week', datum.Date, options.marketClosesAt, options.tz),
        open: parseCurrency(datum.Open),
        high: parseCurrency(datum.High),
        low: parseCurrency(datum.Low),
        close: parseCurrency(datum.Close),
        volume: parseFloat(datum.Volume),
        adj_close: parseFloat(datum['Adj Close'] || datum['Adj_Close'])
    }))).then(bars => includeIntraday(yahoo, bars, now, symbol, options));
}

function day(yahoo, symbol, options) {
    var now = moment().tz(options.tz);
    return yahoo.day(symbol,
        options.begin, options.end,
        options.marketClosesAt, options.tz
    ).then(data => data.reverse().map(datum => ({
        ending: endOf('day', datum.Date, options.marketClosesAt, options.tz),
        open: parseCurrency(datum.Open),
        high: parseCurrency(datum.High),
        low: parseCurrency(datum.Low),
        close: parseCurrency(datum.Close),
        volume: parseFloat(datum.Volume),
        adj_close: parseFloat(datum['Adj Close'] || datum['Adj_Close'])
    }))).then(bars => includeIntraday(yahoo, bars, now, symbol, options));
}

function includeIntraday(yahoo, bars, now, symbol, options) {
    if (options.end || now.days() === 6 || !bars.length) return bars;
    else return yahoo.fundamental(symbol).then(security => {
        var dateTime = security.date + ' ' + security.time;
        var m = dateTime.match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+)(am|pm)/);
        if (!m) return {};
        var tz = options.tz;
        var marketClosesAt = options.marketClosesAt;
        var hour = 'pm' == m[6] && 12 > +m[4] ? 12 + +m[4] : m[4];
        var date = (m[3]+'-'+m[1]+'-'+m[2]).replace(/\b(\d)\b/g,'0$1');
        var lastTrade = date + ' ' + (hour+':'+m[5]+':00').replace(/\b(\d)\b/g,'0$1');
        var low = security.range.replace(/[^\d\.].*$/,'');
        var high = security.range.replace(/^.*[^\d\.]/,'');
        return {
            ending: moment.tz(date + ' ' + marketClosesAt, tz).format(),
            open: _.isFinite(security.open) ? +security.open : undefined,
            high: _.isFinite(high) ? +high : undefined,
            low: _.isFinite(low) ? +low : undefined,
            close: _.isFinite(security.close) ? +security.close : undefined,
            volume: _.isFinite(security.volume) ? +security.volume : undefined,
            adj_close: +security.close,
            lastTrade: moment.tz(lastTrade, tz).format()
        };
    }).then(quote => {
        if (!_.isFinite(quote.close)) return bars;
        var latest = _.last(bars);
        if (latest.ending >= quote.ending) {
            // merge today with latest week/month
            bars[bars.length -1] = _.extend(latest, {
                high: Math.max(latest.high, quote.high),
                low: latest.low && latest.low < quote.low ? latest.low : quote.low,
                close: quote.close,
                volume: latest.volume + quote.volume,
                adj_close: quote.adj_close,
                lastTrade: quote.lastTrade,
                asof: now.format(),
                incomplete: true
            });
        } else {
            bars.push({
                ending: quote.ending,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                close: quote.close,
                volume: quote.volume,
                adj_close: quote.adj_close,
                lastTrade: quote.lastTrade,
                asof: now.format(),
                incomplete: true
            });
        }
        return bars;
    });
}

function endOf(unit, begin, marketClosesAt, tz) {
    var ending = moment.tz(begin, tz).endOf(unit);
    if (!ending.isValid()) throw Error("Invalid date " + begin);
    if (ending.days() === 0) ending.subtract(2, 'days');
    else if (ending.days() == 6) ending.subtract(1, 'days');
    var closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + marketClosesAt, tz);
    if (!closes.isValid()) throw Error("Invalid marketClosesAt " + marketClosesAt);
    return closes.format();
}

function parseCurrency(string) {
    return Math.round(parseFloat(string) * 100) / 100;
}

