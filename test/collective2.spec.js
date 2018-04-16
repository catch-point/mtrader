// collective2.spec.js
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

const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');
const Collect = require('../src/collect.js');
const Collective2 = require('../src/collective2.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("collective2", function() {
    this.timeout(60000);
    var fetch, quote, collect, collective2;
    var dir = createTempDir('collective2');
    var requestMarginEquity = path.resolve(dir, 'requestMarginEquity');
    var retrieveSystemEquity = path.resolve(dir, 'retrieveSystemEquity');
    var requestTrades = path.resolve(dir, 'requestTrades.json');
    var retrieveSignalsWorking = path.resolve(dir, 'retrieveSignalsWorking.json');
    var submitSignal = path.resolve(dir, 'submitSignal.json');
    var cancelSignal = path.resolve(dir, 'cancelSignal.json');
    before(function() {
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', createTempDir('collective2'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        config('collective2.requestMarginEquity', 'file://' + requestMarginEquity);
        config('collective2.retrieveSystemEquity', 'file://' + retrieveSystemEquity);
        config('collective2.requestTrades', 'file://' + requestTrades);
        config('collective2.retrieveSignalsWorking', 'file://' + retrieveSignalsWorking);
        config('collective2.submitSignal', 'file://' + submitSignal);
        config('collective2.cancelSignal', 'file://' + cancelSignal);
        config('collective2.apikey', 'test');
        fs.writeFileSync(requestMarginEquity, JSON.stringify({ok:1}));
        fs.writeFileSync(retrieveSystemEquity, JSON.stringify({ok:1,equity_data:[]}));
        fetch = Fetch();
        quote = Quote(fetch);
        collect = Collect(quote);
        collective2 = Collective2(collect);
    });
    after(function() {
        config.unset('prefix');
        config.unset('fetch.files.dirname');
        return Promise.all([
            collective2.close(),
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    describe("IBM long position", function() {
        it("IBM cross signals", function() {
            return collect({
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2018-03-31",
                columns: {
                    date: 'DATE(ending)',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("action")="BTO"), "BTO", sma_cross<0 AND PREV("action")="BTO", "STC", PREV("action"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action AND PREV("action")!=action'
                ]
            }).should.eventually.be.like([
                { date: '2015-02-17', close: 144.14, action: 'BTO', quant: 2 },
                { date: '2015-06-16', close: 150.53, action: 'STC', quant: 2 },
                { date: '2015-10-16', close: 136.82, action: 'BTO', quant: 2 },
                { date: '2015-10-27', close: 125.42, action: 'STC', quant: 2 },
                { date: '2016-03-01', close: 124.65, action: 'BTO', quant: 2 },
                { date: '2016-09-13', close: 147.19, action: 'STC', quant: 2 },
                { date: '2016-11-14', close: 150.82, action: 'BTO', quant: 2 },
                { date: '2017-03-24', close: 167.02, action: 'STC', quant: 2 },
                { date: '2017-06-28', close: 150.69, action: 'BTO', quant: 2 },
                { date: '2017-07-20', close: 143.26, action: 'STC', quant: 2 },
                { date: '2017-09-20', close: 143.03, action: 'BTO', quant: 2 },
                { date: '2018-02-13', close: 150.75, action: 'STC', quant: 2 }
            ]);
        });
        it("IBM submit BTO signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'BTO',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC'
                }
            });
        });
        it("Signal already working", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'BTO',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([]);
        });
        it("Signal already applied", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like(_.isEmpty);
        });
        it("IBM submit STC signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'STC',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC'
                }
            });
        });
        it("IBM submit no signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like(_.isEmpty);
        });
        it("IBM submit no signal as it is already posted", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([]);
        });
        it("IBM submit BTO on STC signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 'IF(action="BTO",2,1)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([{
                action: 'BTO',
                quant: 1,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY'
            }]);
        });
        it("IBM cancel working signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                status: 'working',
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([{
                signalid: "94974798"
            }]);
        });
        it("IBM update signal quant before posted", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'STC',
                quant: 3,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([{
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                xreplace: "94974798"
            }]);
        });
        it("IBM reduce signal quant after posted", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'STC',
                quant: 3,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:01", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'STC',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY'
                }
            });
        });
        it("IBM increase quant after filled", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "1",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T16:00:01", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(sma_cross>0 AND !(PREV("long_or_short")="long"), "BTO", sma_cross<0 AND PREV("long_or_short")="long", "STC")',
                    long_or_short: 'IF(action="BTO","long", action="STC","short", PREV("long_or_short"))',
                    quant: 2,
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                parameters: {
                    fast_len: 13,
                    slow_len: 50
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'BTO',
                    quant: 1,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY'
                }
            });
        });
        it("IBM submit BTO limit signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    typeofsymbol: 'stock',
                    limit: 130,
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: '1424206800'
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T15:59:59", 'America/New_York').valueOf(),
                begin: "2015-01-01",
                end: "2015-02-18"
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'BTO',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    limit: 130,
                    duration: 'GTC'
                }
            });
        });
        it("IBM submit BTO with working STC signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "IBM",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "4",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                duration: 'GTC',
                currency: 'USD',
                status: 'working'
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1424206800'
                }, {
                    action: 'STC',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1434484800'
                }, {
                    action: 'BTO',
                    quant: 2,
                    symbol: 'IBM',
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1445025600'
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-10-16T15:59:59", 'America/New_York').valueOf(),
                begin: "2015-01-01"
            }).should.eventually.be.like([{
                signalid: "94974798"
            }, {
                action: 'STC',
                quant: 4,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                duration: 'DAY'
            }, {
                action: 'BTO',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                duration: 'GTC',
                parkUntilSecs: '1445025600'
            }]);
        });
    });
    describe("Gold positions", function() {
        it("Gold stop and reverse signals", function() {
            return collect({
                now: moment("2016-12-31").valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("action"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([
                { date: '2016-10-03', close: 125.32, action: 'STO' },
                { date: '2016-10-13', close: 120.03, action: 'BTCBTO' },
                { date: '2016-10-24', close: 120.56, action: 'STCSTO' },
                { date: '2016-10-25', close: 121.47, action: 'BTCBTO' },
                { date: '2016-11-07', close: 122.15, action: 'STCSTO' },
                { date: '2016-12-06', close: 111.43, action: 'BTCBTO' },
                { date: '2016-12-09', close: 110.4, action: 'STCSTO' },
                { date: '2016-12-23', close: 107.93, action: 'BTCBTO' }
            ]);
        });
        it("GLD STO signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-03T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("action"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'STO',
                    quant: 2,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC'
                }
            });
        });
        it("GLD catch up on working BTCBTO signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-13T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("long_or_short"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([{
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY' // catch up
            }, {
                action: 'BTC',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC', // wait for confirmation before BTC
                parkUntilSecs: moment.tz("2016-10-13T16:00:00", 'America/New_York').format('X')
                // don't include BTO (yet) as double conditionals are not permitted
            }]);
        });
        it("GLD BTO signal catchup", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-13T16:00:01", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("long_or_short"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'BTO',
                    quant: 2,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY'
                }
            });
        });
        it("GLD STO signal with working BTO signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: '117389066',
                action: 'BTO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                long_or_short: 'long',
                parkUntilSecs: '1477339200'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-03T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("action"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([{
                signalid: '117389066'
            }, {
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]);
        });
        it("GLD STCSTO", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "GLD",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("long_or_short"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([{
                action: 'STC',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }, {
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]);
        });
        it("GLD STCSTO working", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "GLD",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                long_or_short: 'short',
                parkUntilSecs: '1477339200'
            }, {
                action: 'STC',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                long_or_short: 'long',
                parkUntilSecs: '1477339200'
            }]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("long_or_short"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).should.eventually.be.like([]);
        });
        it("GLD STCSTO miss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "GLD",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "GLD"
            }, {
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "short",
	          "quant_closed" : "2",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "GLD",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return collective2({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-24T16:00:01", 'America/New_York').valueOf(),
                portfolio: 'GLD.ARCA',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    action: 'IF(psar<day.low, IF(!PREV("long_or_short"),"BTO", PREV("long_or_short")="short", "BTCBTO"), psar>day.high, IF(!PREV("long_or_short"),"STO", PREV("long_or_short")="long", "STCSTO"), PREV("action"))',
                    long_or_short: 'IF(action="BTO" OR action="BTCBTO","long", action="STO" OR action="STCSTO","short", PREV("long_or_short"))',
                    quant: 'IF(PREV("long_or_short"), 4, 2)',
                    typeofsymbol: '"stock"',
                    market: '1',
                    duration: '"GTC"',
                    currency: '"USD"',
                    parkUntilSecs: "TEXT(ending,'X')"
                },
                variables: {
                    psar: 'day.PSAR(0.05, 0.2, 50)'
                },
                filter: [
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like({
                signal: {
                    action: 'STO',
                    quant: 2,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY'
                }
            });
        });
    });
    describe("StopLoss orders", function() {
        it("submit stoploss order", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130'
                }]);
            })({
                systemid: 'test'
            }).should.eventually.be.like([{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 130
            }]);
        });
        it("don't change stoploss order", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 1,
                quant_closed: 0,
                symbol: 'GLD',
                instrument: 'stock',
                long_or_short: 'long'
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                isLimitOrder: '0',
                strike: null,
                status: 'working',
                underlying: null,
                isMarketOrder: '0',
                tif: 'GTC',
                putcall: null,
                expiration: null,
                quant: '1',
                symbol: 'GLD',
                name: '',
                instrument: 'stock',
                isStopOrder: '130',
                limit: '130',
                posted_time_unix: '1522948540',
                action: 'STC',
                signal_id: '117389066',
                posted_time: '2018-04-05 13:15:40'
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130',
                    parkUntilSecs: moment.tz("2018-04-04", 'America/New_York').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2018-04-05", 'America/New_York').valueOf()
            }).should.eventually.be.like([]);
        });
        it("update stoploss order", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 1,
                quant_closed: 0,
                symbol: 'GLD',
                instrument: 'stock',
                long_or_short: 'long'
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                isLimitOrder: '0',
                strike: null,
                status: 'working',
                underlying: null,
                isMarketOrder: '0',
                tif: 'GTC',
                putcall: null,
                expiration: null,
                quant: '1',
                symbol: 'GLD',
                name: '',
                instrument: 'stock',
                isStopOrder: '130',
                posted_time_unix: '1522948540',
                action: 'STC',
                signal_id: '117389066',
                posted_time: '2018-04-05 13:15:40'
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: 130
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: 120
                }]);
            })({
                systemid: 'test'
            }).should.eventually.be.like([{
                duration: 'GTC',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                stop: 120,
                action: 'STC',
                xreplace: '117389066'
            }]);
        });
        it("don't update stoploss order unless effective", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 1,
                quant_closed: 0,
                symbol: 'GLD',
                instrument: 'stock',
                long_or_short: 'long'
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                isLimitOrder: '0',
                strike: null,
                status: 'working',
                underlying: null,
                isMarketOrder: '0',
                tif: 'GTC',
                putcall: null,
                expiration: null,
                quant: '1',
                symbol: 'GLD',
                name: '',
                instrument: 'stock',
                isStopOrder: '130',
                posted_time_unix: '1522948540',
                action: 'STC',
                signal_id: '117389066',
                posted_time: '2018-04-05 13:15:40'
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: 130,
                    parkUntilSecs: moment.tz("2018-04-05T15:00:00", 'America/New_York').format('X')
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: 120,
                    parkUntilSecs: moment.tz("2018-04-05T16:00:00", 'America/New_York').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2018-04-05T15:59:59", 'America/New_York').valueOf(),
            }).should.eventually.be.like([]);
        });
        it("Order not filled with stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'BTO',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                limit: 130,
                duration: 'GTC'
            }, {
                signal_id: "94974799",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isStopOrder: 120,
                duration: 'GTC'
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    typeofsymbol: 'stock',
                    market: 0,
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: '1424206800'
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                signalid: "94974798"
            }, {
                action: 'BTO',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY'
            }]);
        });
        it("Order cancelled with stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 2,
                quant_closed: 0,
                symbol: 'IBM',
                instrument: 'stock',
                long_or_short: 'long'
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isStopOrder: 120,
                duration: 'GTC'
            }, {
                signal_id: "94974799",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isLimitOrder: 140,
                duration: 'GTC'
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    typeofsymbol: 'stock',
                    market: 0,
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: '1424206800'
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                signalid: "94974799"
            }]);
        });
        it("catch up with multiple stoploss orders", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '120'
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '110'
                }]);
            })({
                systemid: 'test'
            }).should.eventually.be.like([{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 110
            }]);
        });
        it("triggered before catch up", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '120'
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '110'
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130'
                }]);
            })({
                systemid: 'test'
            }).should.eventually.be.like([{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 130
            }]);
        });
        it("triggered", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 1,
                quant_closed: 1,
                symbol: 'GLD',
                instrument: 'stock',
                long_or_short: 'long',
                closedWhenUnixTimeStamp: moment('2018-01-02').format('X')
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130',
                    parkUntilSecs: moment('2018-01-01').format('X')
                }]);
            })({
                systemid: 'test',
                now: '2018-01-02'
            }).should.eventually.be.like([]);
        });
        it("triggered and re-instated", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 1,
                quant_closed: 1,
                symbol: 'GLD',
                instrument: 'stock',
                long_or_short: 'long',
                closedWhenUnixTimeStamp: moment('2018-01-02').format('X')
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '130',
                    parkUntilSecs: moment('2018-01-01').format('X')
                }, {
                    action: 'BTO',
                    quant: 0,
                    symbol: 'GLD',
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'DAY',
                    stoploss: '120',
                    parkUntilSecs: moment('2018-01-03').format('X')
                }]);
            })({
                systemid: 'test',
                now: '2018-01-03'
            }).should.eventually.be.like([{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 120
                // parkUntilSecs: undefined
            }]);
        });
        it("GLD STCSTO without stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "0",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "GLD",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                typeofsymbol: 'stock',
                symbol: 'GLD',
                action: 'STC',
                quant: 2,
                duration: 'GTC',
                stop: 130,
                isStopOrder: 130
            }]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    action: 'STO',
                    long_or_short: 'short',
                    quant: 2,
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1475524800',
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    action: 'BTCBTO',
                    long_or_short: 'long',
                    quant: 4,
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1476388800',
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    action: 'STCSTO',
                    long_or_short: 'short',
                    quant: 4,
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1477339200',
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'STC',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }, {
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]);
        });
        it("GLD STCSTO with stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          "closeVWAP_timestamp" : "1434055203",
	          "strike" : "0",
	          "open_or_closed" : "open",
	          "expir" : "",
	          "openVWAP_timestamp" : "1434055203",
	          "underlying" : "",
	          "closing_price_VWAP" : "56.43",
	          "putcall" : "",
	          "long_or_short" : "long",
	          "quant_closed" : "2",
	          "markToMarket_time" : "2015-06-11 16:40:03",
	          "trade_id" : "94369671",
	          "symbol" : "GLD",
	          "opening_price_VWAP" : "58.23390",
	          "quant_opened" : "2",
	          "closedWhen" : "",
	          "instrument" : "stock",
	          "ptValue" : "1",
	          "PL" : "-451",
	          "closedWhenUnixTimeStamp" : "",
	          "openedWhen" : "2015-05-12 09:38:19",
	          "symbol_description" : "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Collective2(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    action: 'STO',
                    long_or_short: 'short',
                    quant: 2,
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1475524800',
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    action: 'BTCBTO',
                    long_or_short: 'long',
                    quant: 4,
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1476388800',
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    action: 'STCSTO',
                    long_or_short: 'short',
                    quant: 4,
                    typeofsymbol: 'stock',
                    market: 1,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: '1477339200',
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2016-10-24T16:00:00"
            }).should.eventually.be.like([{
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 130
            }]);
        });
    });
});
