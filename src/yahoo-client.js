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
const moment = require('moment-timezone');
const throttlePromise = require('./throttle.js');
const promiseText = require('./promise-text.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

module.exports = function() {
    return {
        close() {},
        lookup: lookupSymbol.bind(this, _.memoize(throttlePromise(listSymbols, 2))),
        fundamental: queue(loadSecurity, 32),
        month: loadPriceTable.bind(this, throttlePromise(loadCSV, 2), 'm'),
        week: loadPriceTable.bind(this, throttlePromise(loadCSV, 2), 'w'),
        day: loadDailyPrice.bind(this,
            loadSymbol.bind(this, queue(loadQuotes.bind(this, {}), 10)),
            throttlePromise(loadCSV, 2)
        )
    };
};

function loadDailyPrice(loadSymbol, loadCSV, symbol, begin, end, marketClosesAt, tz) {
    expect(loadSymbol).to.be.a('function');
    expect(loadCSV).to.be.a('function');
    expect(symbol).to.be.a('string').and.match(/^\S+$/);
    expect(marketClosesAt).to.be.a('string').and.match(/^\d\d:\d\d(:00)?$/);
    expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    var mb = moment.tz(begin, tz);
    var me = moment.tz(end || new Date(), tz);
    if (!mb.isValid()) throw Error("Invalid begin date " + begin);
    if (!me.isValid()) throw Error("Invalid end date " + end);
    expect(mb.format()).to.be.below(me.format());
    if (me.diff(mb, 'years') > 0)
        return loadPriceTable(loadCSV, 'd', symbol, mb, me, marketClosesAt, tz);
    return loadSymbol(symbol, mb, me, marketClosesAt, tz).catch(err => {
        logger.debug("Could not query Yahoo! finance historicaldata", err);
        return loadPriceTable(loadCSV, 'd', symbol, mb, me, marketClosesAt, tz);
    });
}

function loadSymbol(loadQuotes, symbol, begin, end, marketClosesAt, tz){
    expect(loadQuotes).to.be.a('function');
    expect(symbol).to.be.a('string').and.match(/^\S+$/);
    expect(marketClosesAt).to.be.a('string').and.match(/^\d\d:\d\d(:00)?$/);
    expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    return loadQuotes([{
        symbol: symbol,
        start: begin,
        end: end,
        marketClosesAt: marketClosesAt,
        tz: tz
    }]).then(function(results){
        if (results && results.length) return results;
        throw Error("Empty results for " + symbol);
    });
}

function loadQuotes(rates, queue) {
    var filters = queue.reduce(function(filters, item) {
        var end = moment.tz(item.end || new Date(), item.tz);
        if (!end.isValid()) throw Error("Invalid end date " + item.end);
        var start = moment.tz(item.start, item.tz);
        if (!start.isValid()) throw Error("Invalid begin date " + item.start);
        var filter = [
            'startDate="', start.format('YYYY-MM-DD'), '"',
            ' and endDate="', end.format('YYYY-MM-DD'), '"'
        ].join('');
        var key = filter + item.marketClosesAt + item.tz;
        var group = filters[key];
        if (group) {
            if (group.symbols.indexOf(item.symbol) < 0) {
                group.symbols.push(item.symbol);
            }
        } else {
            filters[key] = {
                symbols: [item.symbol],
                filter: filter,
                marketClosesAt: item.marketClosesAt,
                tz: item.tz
            };
        }
        return filters;
    }, {});
    return _.reduce(filters, function(promise, group){
        if (rates.failure > 1 && !rates.success) {
            console.log("Yahoo! Query Language is temporarily disabled for finance historicaldata");
            return Promise.reject(rates.lastError);
        }
        var url = [
            "http://query.yahooapis.com/v1/public/yql?q=",
            encodeURIComponent([
                'select * from yahoo.finance.historicaldata where symbol in (',
                group.symbols.sort().reduce(function(sb, symbol) {
                    sb.push("'" + symbol.replace(/'/g, "\\'") + "'");
                    return sb;
                }, []).join(','),
                ') and ', group.filter
            ].join('')).replace(/%2C/g, ','),
            "&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys"
        ].join('');
        return promise.then(function(hash){
            return promiseText(url).then(parseJSON).then(function(result){
                if (result.query.results)
                    return result.query.results.quote;
                return [];
            }).then(function(results){
                if (_.isArray(results)) return results;
                else if (_.isObject(results)) return [results];
                else return [];
            }).then(function(results){
                return results.map(function(result){
                    if (isNaN(parseFloat(result.Close)) && isNaN(parseFloat(result.col6)))
                        throw Error("Not a quote: " + JSON.stringify(result));
                    if (result.Close) return result;
                    else return {
                        symbol: result.Symbol,
                        Date: result.col0,
                        Open: result.col1,
                        High: result.col2,
                        Low: result.col3,
                        Close: result.col4,
                        Volume: result.col5,
                        Adj_Close: result.col6
                    };
                });
            }).then(function(results){
                return results.reduce(function(hash, result){
                    if (!hash[result.symbol]) hash[result.symbol] = [];
                    hash[result.symbol].push(_.omit(result, 'symbol'));
                    return hash;
                }, hash);
            }).then(function(result){
                rates.success = 1 + (rates.success || 0);
                return result;
            }, function(error){
                rates.failure = 1 + (rates.failure || 0);
                rates.lastError = error;
                return Promise.reject(error);
            });
        });
    }, Promise.resolve({})).then(function(hash){
        return queue.map(function(item){
            return hash[item.symbol];
        });
    });
}

function loadPriceTable(loadCSV, g, symbol, begin, end, marketClosesAt, tz) {
    expect(loadCSV).to.be.a('function');
    expect(g).to.be.oneOf(['m','w','d']);
    expect(symbol).to.be.a('string').and.match(/^\S+$/);
    if (end) expect(begin).to.be.below(end);
    expect(marketClosesAt).to.be.a('string').and.match(/^\d\d:\d\d(:00)?$/);
    expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    var endMatch = _.first(_.sortBy(_.compact([
        moment(end).format('YYYY-MM-DD'),
        moment().tz(tz).format('YYYY-MM-DD')
    ]))).match(/(\d\d\d\d)-(\d\d)-(\d\d)/);
    var start = g == 'm' ? moment.tz(begin, tz).startOf('month') :
        g == 'w' ? moment.tz(begin, tz).startOf('isoWeek') :
        moment.tz(begin, tz);
    var startMatch = start.format('YYYY-MM-DD').match(/(\d\d\d\d)-(\d\d)-(\d\d)/);
    var url = [
        "http://ichart.finance.yahoo.com/table.csv?s=", encodeURIComponent(symbol),
        "&a=", parseInt(startMatch[2], 10) - 1, "&b=", startMatch[3], "&c=", startMatch[1],
        "&d=", parseInt(endMatch[2], 10) - 1, "&e=", endMatch[3], "&f=", endMatch[1],
        "&g=", g
    ].join('');
    return loadCSV(url);
}

function lookupSymbol(listSymbols, symbol, marketLang) {
    var root = symbol.replace(/^\W+/, '').replace(/\W.*$/, '');
    var url = [
        "http://d.yimg.com/aq/autoc?callback=YAHOO.util.ScriptNodeDataSource.callbacks",
        "&lang=", marketLang || 'en-US',
        "&region=", marketLang ? marketLang.replace(/.*-/,'') : 'US',
        "&query=", encodeURIComponent(root)
    ].join('');
    return listSymbols(url);
}

function listSymbols(url) {
    return promiseText(url).then(function(jsonp) {
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

function loadSecurity(symbols) {
    var url = "http://download.finance.yahoo.com/d/quotes.csv?f=snxd1t1ol1mv&s="
        + symbols.map(encodeURIComponent).join(',');
    return promiseText(url).then(parseCSV).then(rows => rows.map(row => _.object(
        ["symbol", "name", "exch", "date", "time", "open", "close", "range", "volume"],
        row
    ))).then(function(list){
        return list.reduce(function(hash, security){
            hash[security.symbol] = security;
            return hash;
        }, {});
    }).then(hash => symbols.map(symbol => hash[symbol]));
}

function queue(func, batchSize) {
    var context, promise = Promise.resolve();
    var queue = [], listeners = [];

    return function(items) {
        context = this;
        return new Promise(function(resolve, reject) {
            queue = queue.concat(items);
            listeners.push({resolve: resolve, reject: reject});
            promise = promise.then(function(){
                var taken = queue.splice(0, batchSize);
                var notifications = listeners.splice(0, batchSize);
                if (!taken.length) return undefined;
                return func.call(context, taken).then(function(result) {
                    for (var i=0; i<notifications.length; i++) {
                        notifications[i].resolve(result[i]);
                    }
                }, function(error) {
                    for (var i=0; i<notifications.length; i++) {
                        notifications[i].reject(error);
                    }
                });
            });
        });
    };
}

function loadCSV(url){
    return promiseText(url).then(parseCSV).then(rows2objects);
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

function titleOf(html, status) {
    var lower = html.toLowerCase();
    var start = lower.indexOf('<title');
    var end = lower.indexOf('</title>');
    if (start < 0 || end < 0) return status;
    var text = html.substring(html.indexOf('>', start) + 1, end);
    var decoded = text.replace('&lt;','<').replace('&gt;', '>').replace('&amp;', '&');
    if (decoded.indexOf(status) >= 0) return decoded;
    else return decoded + ' ' + status;
}
