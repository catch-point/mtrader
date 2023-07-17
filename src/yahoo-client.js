// yahoo-client.js
/*
 *  Copyright (c) 2014-2018 James Leigh, Some Rights Reserved
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
const url = require('url');
const moment = require('moment-timezone');
const throttlePromise = require('./throttle.js');
const promiseText = require('./promise-text.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

const quote = "https://finance.yahoo.com/lookup?s={symbol}";
const download = "https://query1.finance.yahoo.com/v7/finance/download/{symbol}?period1={period1}&period2={period2}&interval={interval}&events={events}&crumb={crumb}"
const search = "https://query1.finance.yahoo.com/v1/finance/search";

module.exports = function() {
    const agent = promiseHistoryAgent();
    const throttled = throttlePromise(agent, 2);
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
    const createAgent = async symbol => {
        const options = url.parse(quote.replace('{symbol}', encodeURIComponent(symbol)));
        const headers = options.headers = {};
        const body = await promiseText(options);
        const keyword = '"crumb":';
        let start = 0, end = 0;
        do {
            start = body.indexOf('"', body.indexOf(keyword, start) + keyword.length);
            end = body.indexOf('"', start+1)+1;
        } while (start > 0 && body.substring(start, end)=='"{crumb}"');
        if (start < 0) return promiseText;
        try {
            const crumb = encodeURIComponent(JSON.parse(body.substring(start, end)));
            return query => {
                const options = url.parse(query.replace('{crumb}', crumb));
                options.headers = headers;
                return promiseText(options);
            };
        } catch(err) {
            logger.error("Could not find yahoo crumb", symbol, body.substring(start, end));
            throw err;
        }
    };
    const agent = expire(createAgent, 60 * 1000);
    return query => {
        const url = _.keys(query).reduce((url, key) => {
            return url.replace('{' + key + '}', query[key]);
        }, download);
        return agent(query.symbol)
            .then(fn => fn(url)
            .catch(error => {
                if (error.message == 'Bad Request') return ""; // no data in period
                agent.close();
                return agent(query.symbol).then(fn => fn(url)); // try again?
            }))
            .then(parseCSV)
            .then(rows2objects);
    };
}

function expire(func, after) {
    let result;
    let previous = 0;
    return Object.assign(function() {
        const now = _.now();
        const remaining = after - (now - previous);
        if (!result || remaining <= 0 || remaining > after) {
            previous = now;
            result = func.apply(this, arguments);
        }
        return result;
    }, {
        close() {
            result = null;
        }
    });
  }

function loadTable(loadCSV, interval, events, symbol, begin, tz) {
    expect(loadCSV).to.be.a('function');
    expect(interval).to.be.oneOf(['1mo','1wk','1d']);
    expect(symbol).to.be.a('string').and.match(/^\S+$/);
    const options = _.extend({
        symbol: symbol,
        events: events
    }, periods(interval, begin, tz));
    return loadCSV(options);
}

function periods(interval, begin, tz) {
    expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    const mb = moment.tz(begin, tz);
    if (!mb.isValid()) throw Error("Invalid begin date " + begin);
    const start = interval == '1mo' ? mb.startOf('month') :
        interval == '1wk' ? mb.startOf('isoWeek') : mb.startOf('day');
    const end = moment().tz(tz).endOf('day');
    return {
        period1: Math.floor(start.valueOf()/1000),
        period2: Math.ceil(end.valueOf()/1000),
        interval: interval
    };
}

function lookupSymbol(listSymbols, symbol, marketLang) {
    const root = symbol.replace(/^\W+/, '').replace(/\W.*$/, '');
    const url = [
        search,
        "?q=", encodeURIComponent(root),
        "&lang=", marketLang || 'en-US',
        "&region=", marketLang ? marketLang.replace(/.*-/,'') : 'US',
        "&quotesCount=6&newsCount=0&listsCount=1&enableFuzzyQuery=false",
        "&quotesQueryId=tss_match_phrase_query&multiQuoteQueryId=multi_quote_single_token_query",
        "&newsQueryId=news_cie_vespa&enableCb=true&enableNavLinks=false",
        "&enableEnhancedTrivialQuery=true&enableResearchReports=false&researchReportsCount=0"
    ].join('');
    return listSymbols(url);
}

function listSymbols(url) {
    return promiseText(url).then(function(json) {
        if (!json) throw Error(`Empty response from ${url}`);
        return json;
    }).then(parseJSON).then(function(json) {
        return json.quotes.map(function(object){
            return _.mapObject(object, function(value) {
                return !value || !value.replace ? value :
                    value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
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
        const regex = /{"symbol":"([^{]*)","name": "([^{]*)","exch": "([^{]*)","type": "([^{]*)","exchDisp":"([^{]*)","typeDisp":"([^{]*)"}/g;
        const result = [];
        let m;
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
        let m;
        const row = [];
        const regex = /(?:,|^)(?:"([^"]*)"|([^",]*))/g;
        if (line.charAt(0) == ',') {
            row.push('');
        }
        while (m = regex.exec(line)) {
            const string = m[1] || m[2] || '';
            row.push(string.trim());
        }
        return row;
    });
}

function rows2objects(rows) {
    let headers = [];
    return rows.reduce(function(points, row){
        if (headers.length && headers.length == row.length) {
            points.push(_.object(headers, row));
        } else {
            headers = row;
        }
        return points;
    }, []);
}
