// yahoo-client.js
/*
 *  Copyright (c) 2014-2017 James Leigh, Some Rights Reserved
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
const url = require('url');
const moment = require('moment-timezone');
const throttlePromise = require('./throttle.js');
const promiseText = require('./promise-text.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

const quote = "https://finance.yahoo.com/lookup?s={symbol}";
const download = "https://query1.finance.yahoo.com/v7/finance/download/{symbol}?period1={period1}&period2={period2}&interval={interval}&events={events}&crumb={crumb}"
const autoc = "http://d.yimg.com/aq/autoc";
const quotes = "http://download.finance.yahoo.com/d/quotes.csv";

module.exports = function() {
    var agent = promiseHistoryAgent();
    var throttled = throttlePromise(agent, 2);
    return {
        close() {},
        lookup: lookupSymbol.bind(this, _.memoize(throttlePromise(listSymbols, 2))),
        month: loadTable.bind(this, throttled, '1mo', 'history'),
        day: loadTable.bind(this, throttled, '1d', 'history'),
        dividend: loadTable.bind(this, throttled, '1d', 'div'),
        split: loadTable.bind(this, throttled, '1d', 'split')
    };
};

function promiseHistoryAgent() {
    var createAgent = symbol => {
        var options = url.parse(quote.replace('{symbol}', encodeURIComponent(symbol)));
        var headers = options.headers = {};
        return promiseText(options).then(body => {
            var keyword = '{"crumb":"';
            var start = 0, end = 0;
            do {
                start = body.indexOf(keyword, start) + keyword.length;
                end = body.indexOf('"', start);
            } while (start > 0 && body.substring(start-1, end+1)=='"{crumb}"');
            if (start < 0 && end < 0) return promiseText;
            try {
                var crumb = encodeURIComponent(JSON.parse(body.substring(start-1, end+1)));
                return query => {
                    var options = url.parse(query.replace('{crumb}', crumb));
                    options.headers = headers;
                    return promiseText(options);
                };
            } catch(err) {
                logger.error("Could not find yahoo crumb", body.substring(start-1, end+1));
                throw err;
            }
        });
    };
    var agent = expire(createAgent, 60 * 1000);
    return query => {
        var url = _.keys(query).reduce((url, key) => {
            return url.replace('{' + key + '}', query[key]);
        }, download);
        return agent(query.symbol)
            .then(fn => fn(url)
            .catch(error => {
                if (error.message == 'Bad Request') return ""; // no data in period
                if (error.message == 'Unauthorized') return fn(url); // try again?
                else throw error;
            }))
            .then(parseCSV)
            .then(rows2objects);
    };
}

function expire(func, after) {
    var result;
    var previous = 0;
    return function() {
        var now = _.now();
        var remaining = after - (now - previous);
        if (remaining <= 0 || remaining > after) {
            previous = now;
            result = func.apply(this, arguments);
        }
        return result;
    };
  }

function loadTable(loadCSV, interval, events, symbol, begin, tz) {
    expect(loadCSV).to.be.a('function');
    expect(interval).to.be.oneOf(['1mo','1wk','1d']);
    expect(symbol).to.be.a('string').and.match(/^\S+$/);
    var options = _.extend({
        symbol: symbol,
        events: events
    }, periods(interval, begin, tz));
    return loadCSV(options);
}

function periods(interval, begin, tz) {
    expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    var mb = moment.tz(begin, tz);
    if (!mb.isValid()) throw Error("Invalid begin date " + begin);
    var start = interval == '1mo' ? mb.startOf('month') :
        interval == '1wk' ? mb.startOf('isoWeek') : mb.startOf('day');
    var end = moment().tz(tz).startOf('day');
    return {
        period1: start.valueOf()/1000,
        period2: end.valueOf()/1000,
        interval: interval
    };
}

function lookupSymbol(listSymbols, symbol, marketLang) {
    var root = symbol.replace(/^\W+/, '').replace(/\W.*$/, '');
    var url = [
        autoc,
        "?callback=YAHOO.util.ScriptNodeDataSource.callbacks",
        "&lang=", marketLang || 'en-US',
        "&region=", marketLang ? marketLang.replace(/.*-/,'') : 'US',
        "&query=", encodeURIComponent(root)
    ].join('');
    return listSymbols(url);
}

function listSymbols(url) {
    return promiseText(url).then(function(jsonp) {
        if (!jsonp) throw Error(`Empty response from ${url}`);
        return jsonp.replace(/^\s*YAHOO.util.ScriptNodeDataSource.callbacks\((.*)\);?\s*$/, '$1');
    }).then(parseJSON).then(function(json) {
        return json.ResultSet.Result.map(function(object){
            return _.mapObject(object, function(value) {
                return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            });
        });
    });
}

function parseJSON(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        // Yahoo does not escape special characters in company name
        // like double quotes or control chars, causing the block to end abruptly
        var regex = /{"symbol":"([^{]*)","name": "([^{]*)","exch": "([^{]*)","type": "([^{]*)","exchDisp":"([^{]*)","typeDisp":"([^{]*)"}/g;
        var m, result = [];
        while (m = regex.exec(text)) {
            result.push({
                symbol: m[1],
                name: m[2],
                exch: m[3],
                type: m[4],
                exchDisp: m[5],
                typeDisp: m[6]
            });
        }
        return {ResultSet:{Result:result}};
    }
}

function parseCSV(text) {
    if (!text) return [];
    return _.compact(text.split(/\r?\n/)).map(function(line) {
        if (line.indexOf(',') < 0) return [line];
        var m;
        var row = [];
        var regex = /(?:,|^)(?:"([^"]*)"|([^",]*))/g;
        if (line.charAt(0) == ',') {
            row.push('');
        }
        while (m = regex.exec(line)) {
            var string = m[1] || m[2] || '';
            row.push(string.trim());
        }
        return row;
    });
}

function rows2objects(rows) {
    var headers = [];
    return rows.reduce(function(points, row){
        if (headers.length && headers.length == row.length) {
            points.push(_.object(headers, row));
        } else {
            headers = row;
        }
        return points;
    }, []);
}
