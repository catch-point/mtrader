// fetch-ivolatility.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
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

const fs = require('graceful-fs');
const path = require('path');
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const d3 = require('d3-format');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const logger = require('./logger.js');
const Ivolatility = require('./ivolatility-client.js');
const expect = require('chai').expect;

function help() {
    var commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: config('fetch.ivolatility.markets')
        },
        iv_symbol: {
            description: "Symbol used by ivolatility.com"
        }
    };
    var tzOptions = {
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
    var interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic interday data for options using an ivolatility.com account",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend(commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "year|quarter|month|week|day",
                description: "The bar timeframe for the results",
                values: _.intersection(["year", "quarter", "month", "week", "day"], config('fetch.ivolatility.interday'))
            },
        })
    };
    return _.compact([
        interday
    ]);
}

module.exports = function() {
    var dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    var ivolatility = Ivolatility(dir);
    return {
        close() {
            return Promise.resolve();
        },
        help() {
            return Promise.resolve(help());
        },
        interday: options => {
            expect(options).to.have.property('marketClosesAt');
            expect(options.interval).to.be.oneOf(['year', 'quarter', 'month', 'week', 'day']);
            var dayFn = day.bind(this, loadIvolatility.bind(this, ivolatility));
            switch(options.interval) {
                case 'year': return year(dayFn, options);
                case 'quarter': return quarter(dayFn, options);
                case 'month': return month(dayFn, options);
                case 'week': return week(dayFn, options);
                case 'day': return dayFn(options);
                default:
                    expect(options.interval).to.be.oneOf([
                        'year', 'quarter', 'month', 'week', 'day'
                    ]);
            }
        }
    };
};

var calls = {
    A: 'JAN', B: 'FEB', C: 'MAR', D: 'APR', E: 'MAY', F: 'JUN',
    G: 'JUL', H: 'AUG', I: 'SEP', J: 'OCT', K: 'NOV', L: 'DEC'
};
var puts = {
    M: 'JAN', N: 'FEB', O: 'MAR', P: 'APR', Q: 'MAY', R: 'JUN',
    S: 'JUL', T: 'AUG', U: 'SEP', V: 'OCT', W: 'NOV', X: 'DEC'
};
var months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
var strike_format = d3.format("08d");
function loadIvolatility(ivolatility, options) {
    var symbol = options.symbol;
    var m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) throw Error(`Unknown option symbol format ${symbol}`);
    var underlying = m[1];
    var yy = +m[2];
    var cc = yy<50 ? 2000 : 1900;
    var year = cc + yy;
    var day = m[3];
    var mo = months[m[4]];
    var cmonth = calls[m[4]];
    var pmonth = puts[m[4]];
    var cp = cmonth ? 'C' : 'P';
    var strike = strike_format(+m[5] * 1000);
    var iv_symbol = `${underlying}${yy}${mo}${day}${cp}${strike}`;
    return ivolatility(_.defaults({}, options, {iv_symbol}))
      .then(data => data.map(datum => {
        var mid = Math.round((datum.ask + datum.bid)*100/2)/100;
        var mdy = datum.date.match(/^(\d\d)\/(\d\d)\/(\d\d\d\d)$/);
        var closes = moment.tz(`${mdy[3]}-${mdy[1]}-${mdy[2]} ${options.marketClosesAt}`, options.tz);
        return {
            ending: closes.format(),
            open: mid,
            high: mid,
            low: mid,
            close: mid,
            volume: datum.volume,
            adj_close: mid
        };
    }));
}

function day(readTable, options) {
    return readTable(options).then(result => {
        var begin = moment.tz(options.begin, options.tz);
        var start = begin.format();
        var first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        var end = moment.tz(options.end || now, options.tz);
        if (end.isAfter()) return result;
        var final = end.format();
        var last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

function year(day, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return month(day, _.defaults({
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
            adj_close: month.adj_close
        }, month, year);
      }, {})));
}

function quarter(day, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return month(day, _.defaults({
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
            adj_close: month.adj_close
        }, month, quarter);
      }, {})));
}

function month(day, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return day(_.defaults({
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
            adj_close: day.adj_close
        }, day, month);
      }, {})));
}

function week(day, options) {
    var begin = moment.tz(options.begin, options.tz);
    return day(_.defaults({
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
            adj_close: day.adj_close
        }, day, week);
      }, {})));
}

function adjustment(base, bar) {
    var scale = bar.adj_close/bar.close * base.close / base.adj_close;
    if (Math.abs(scale -1) < 0.000001) return _.identity;
    else return price => Math.round(price * scale * 10000) / 10000;
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
