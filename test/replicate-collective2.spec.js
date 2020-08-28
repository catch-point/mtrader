// replicate-collective2.spec.js
/*
 *  Copyright (c) 2018-2019 James Leigh, Some Rights Reserved
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
const util = require('util');
const _ = require('underscore');
const moment = require('moment-timezone');
const merge = require('../src/merge.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');
const Collect = require('../src/collect.js');
const Replicate = require('../src/replicate.js');
const Broker = require('../src/broker-collective2.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("replicate-collective2", function() {
    this.timeout(60000);
    var fetch, quote, collect, broker, replicate;
    var dir = createTempDir('collective2');
    var requestMarginEquity = path.resolve(dir, 'requestMarginEquity');
    var retrieveSystemEquity = path.resolve(dir, 'retrieveSystemEquity');
    var requestTrades = path.resolve(dir, 'requestTrades.json');
    var retrieveSignalsWorking = path.resolve(dir, 'retrieveSignalsWorking.json');
    var requestTradesOpen = path.resolve(dir, 'requestTrades.json');
    var retrieveSignalsAll = path.resolve(dir, 'retrieveSignalsAll.json');
    var submitSignal = path.resolve(dir, 'submitSignal.json');
    var cancelSignal = path.resolve(dir, 'cancelSignal.json');
    before(function() {
        config('prefix', createTempDir('collective2'));
        fetch = Fetch(merge(config('fetch'), {
            files: {
                enabled: true,
                dirname: path.resolve(__dirname, 'data')
            }
        }));
        quote = new Quote(fetch);
        collect = new Collect(fetch, quote);
        broker = new Broker({
            systemid: 'test',
            apikey: 'test',
            transmit: true,
            requestMarginEquity: `file://${requestMarginEquity}`,
            retrieveSystemEquity: `file://${retrieveSystemEquity}`,
            requestTrades: `file://${requestTrades}`,
            retrieveSignalsWorking: `file://${retrieveSignalsWorking}`,
            submitSignal: `file://${submitSignal}`,
            cancelSignal: `file://${cancelSignal}`,
            requestTradesOpen: `file://${requestTradesOpen}`,
            retrieveSignalsAll: `file://${retrieveSignalsAll}`,
            fetch: {
                files: {
                    enabled: true,
                    dirname: path.resolve(__dirname, 'data')
                }
            }
        });
        replicate = new Replicate(broker, fetch, collect);
    });
    beforeEach(function() {
        fs.writeFileSync(requestMarginEquity, JSON.stringify({ok:1}));
        fs.writeFileSync(retrieveSystemEquity, JSON.stringify({ok:1,equity_data:[]}));
        fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
        fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
        fs.writeFileSync(requestTradesOpen, JSON.stringify({ok:1,response:[]}));
        fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[]}));
    });
    after(function() {
        config.unset('prefix');
        return Promise.all([
            replicate.close(),
            broker.close(),
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
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                { date: '2015-02-17', close: 144.14, action: 'BUY', quant: 2 },
                { date: '2015-06-16', close: 150.53, action: 'SELL', quant: 2 },
                { date: '2015-10-16', close: 136.82, action: 'BUY', quant: 2 },
                { date: '2015-10-27', close: 125.42, action: 'SELL', quant: 2 },
                { date: '2016-03-01', close: 124.65, action: 'BUY', quant: 2 },
                { date: '2016-09-13', close: 147.19, action: 'SELL', quant: 2 },
                { date: '2016-11-14', close: 150.82, action: 'BUY', quant: 2 },
                { date: '2017-03-24', close: 167.02, action: 'SELL', quant: 2 },
                { date: '2017-06-28', close: 150.69, action: 'BUY', quant: 2 },
                { date: '2017-07-20', close: 143.26, action: 'SELL', quant: 2 },
                { date: '2017-09-20', close: 143.03, action: 'BUY', quant: 2 },
                { date: '2018-02-13', close: 150.75, action: 'SELL', quant: 2 }
            ]);
        });
        it("IBM submit BTO signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                duration: 'GTC',
                status: 'working'
            }]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).should.eventually.be.like([]);
        });
        it("Signal already applied", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like(_.isEmpty);
        });
        it("IBM submit STC signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8'))
              .then(JSON.parse)
              .should.eventually.be.like(_.isEmpty);
        });
        it("IBM submit no signal as it is already posted", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                status: 'working',
                signal_id: "94974798",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).should.eventually.be.like([]);
        });
        it("IBM submit BTO on STC signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }, {
                    date: '2015-06-16',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 150.53,
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 1,
                    position: 1,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: -1,
                    parkUntilSecs: moment('2015-06-16T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                duration: 'DAY'
            }});
        });
        it("IBM cancel working signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
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
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-02-18",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).should.eventually.be.like([{
                order_ref: "94974798",
                status: 'cancelled'
            }]);
        });
        it("IBM update signal quant before posted", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                action: 'STC',
                quant: 3,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                status: 'working'
            }]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                xreplace: "94974798"
            }});
        });
        it("IBM reduce signal quant after posted", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                status: 'working',
                action: 'STC',
                quant: 3,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-06-16T16:00:01", 'America/New_York').valueOf(),
                portfolio: 'IBM.NYSE',
                begin: "2015-01-01",
                end: "2015-06-17",
                columns: {
                    date: 'DATE(ending)',
                    symbol: 'symbol',
                    market: 'market',
                    close: 'ROUND(day.adj_close,2)',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(sma_cross>0,2,0)',
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
                    'action'
                ]
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
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
        it("IBM increase quant after filled", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "1",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                begin: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2015-02-17T16:00:01", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }});
        });
        it("IBM small increase quant after filled", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "100",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 102,
                    position: 102,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                quant_threshold: 5,
                begin: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2015-02-17T16:00:01", 'America/New_York').valueOf()
            }).should.eventually.be.like([]);
        });
        it("IBM small percent increase quant after filled", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "100",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 102,
                    position: 102,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                quant_threshold_percent: 5,
                begin: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2015-02-17T16:00:01", 'America/New_York').valueOf()
            }).should.eventually.be.like([]);
        });
        it("IBM small increase quant after filled with stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "100",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                status: 'working',
                signal_id: "94974799",
                action: 'STC',
                quant: 100,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isStopOrder: 120,
                duration: 'GTC'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 102,
                    position: 102,
                    typeofsymbol: 'stock',
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                quant_threshold_percent: 3,
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf()
            }).should.eventually.be.like([]);
        });
        it("IBM submit BTO limit signal", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    limit: 130,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-02-17T15:59:59", 'America/New_York').valueOf(),
                begin: "2015-01-01",
                end: "2015-02-18"
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
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
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "4",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                posted_time_unix: moment('2015-06-16T16:00:00-04:00').format('X'),
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                market: 1,
                typeofsymbol: 'stock',
                duration: 'DAY',
                currency: 'USD',
                status: 'working'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 2,
                    position: 2,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    duration: 'DAY',
                    currency: 'USD',
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }, {
                    action: 'STC',
                    quant: 2,
                    position: 0,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    duration: 'DAY',
                    currency: 'USD',
                    parkUntilSecs: moment('2015-06-16T16:00:00-04:00').format('X')
                }, {
                    action: 'BTO',
                    quant: 2,
                    position: 2,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    duration: 'DAY',
                    currency: 'USD',
                    parkUntilSecs: '1445025600'
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2015-10-16T15:59:59", 'America/New_York').valueOf(),
                begin: "2015-01-01"
            }).should.eventually.be.like([]);
        });
        it("IBM submit STC with different quant", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "100",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 102,
                    position: 102,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }, {
                    action: 'STC',
                    quant: 50,
                    position: 52,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2015-06-16T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                quant_threshold_percent: 2,
                now: moment.tz("2015-06-16T15:59:59", 'America/New_York').valueOf(),
                begin: "2015-01-01"
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'STC',
                quant: 48,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                duration: 'GTC'
            }});
        });
    });
    describe("Gold positions", function() {
        it("Gold stop and reverse signals", function() {
            return collect({
                now: moment("2016-12-31").valueOf(),
                portfolio: 'GLD.NYSE',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(psar<day.low,2, psar>day.high,-2, PREV("position"))',
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
                { date: '2016-10-03', close: 125.32, action: 'SELL' },
                { date: '2016-10-13', close: 120.03, action: 'BUY' },
                { date: '2016-10-24', close: 120.56, action: 'SELL' },
                { date: '2016-10-25', close: 121.47, action: 'BUY' },
                { date: '2016-11-07', close: 122.15, action: 'SELL' },
                { date: '2016-12-06', close: 111.43, action: 'BUY' },
                { date: '2016-12-09', close: 110.40, action: 'SELL' },
                { date: '2016-12-23', close: 107.93, action: 'BUY' }
            ]);
        });
        it("GLD STO signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-03T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.NYSE',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    market: 'market',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(psar<day.low,2, psar>day.high,-2, PREV("position"))',
                    typeofsymbol: '"stock"',
                    order_type: '"MKT"',
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
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
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
        it("GLD catch up on working BTCBTO signal", async() => {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            await Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-13T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                asof: '2016-10-13T15:59:59-04:00',
                action: 'BUY',
                quant: '2',
                order_type: 'MKT',
                tif: 'GTC',
                status: 'pending',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }]);
            await util.promisify(fs.readFile)(submitSignal, 'utf8').then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: '2',
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                parkUntilSecs: moment.tz("2016-10-13T16:00:00", 'America/New_York').format('X')
            }});
        });
        it("GLD BTO signal catchup", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                begin: moment.tz("2016-10-13T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2016-10-13T16:00:01", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }});
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
                status: 'working',
                parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X')
            }]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-03T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.NYSE',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    market: 'market',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(psar<day.low,2, psar>day.high,-2, PREV("position"))',
                    typeofsymbol: '"stock"',
                    order_type: '"MKT"',
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
                order_ref: '117389066',
                status: 'cancelled'
            }, {
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                order_type: 'MKT',
                tif: 'GTC'
            }]);
        });
        it("GLD STCSTO", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.NYSE',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    market: 'market',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(psar<day.low,2, psar>day.high,-2, PREV("position"))',
                    typeofsymbol: '"stock"',
                    order_type: '"MKT"',
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
                action: 'SELL',
                quant: 2,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }, {
                action: 'SELL',
                quant: 2,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }]);
        });
        it("GLD STCSTO working", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: 'a',
                status: 'working',
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                long_or_short: 'short',
                parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X')
            }, {
                signal_id: 'b',
                status: 'working',
                action: 'STC',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                long_or_short: 'long',
                parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X')
            }]}));
            return replicate({
                systemid: 'test',
                tz: 'America/New_York',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf(),
                portfolio: 'GLD.NYSE',
                begin: "2016-10-01",
                columns: {
                    date: 'DATE(ending)',
                    close: 'day.close',
                    symbol: 'symbol',
                    market: 'market',
                    action: 'IF(PREV("position")<position, "BUY", position<PREV("position"), "SELL")',
                    quant: 'ABS(PREV("position")-position)',
                    position: 'IF(psar<day.low,2, psar>day.high,-2, PREV("position"))',
                    typeofsymbol: '"stock"',
                    order_type: '"MKT"',
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
                // cancelled and resubmitted bc collective2 splits reversal signals
                status: 'cancelled',
                order_ref: 'a',
                action: 'SELL',
                quant: 2,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }, {
                attach_ref: 'b',
                action: 'SELL',
                quant: 2,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }]);
        });
        it("GLD STCSTO miss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[{
              action: 'STO',
              status: 'traded',
	          traded_time_unix: "1434055203",
	          symbol: "GLD",
	          traded_price: "58.23390",
	          quant: "2",
	          instrument: "stock",
	          ptValue: "1",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }, {
              action: 'STC',
              status: 'traded',
	          traded_time_unix: "1434055203",
	          traded_price: "56.43",
	          quant: "2",
	          symbol: "GLD",
	          instrument: "stock",
	          ptValue: "1",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'STO',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BTCBTO',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'STCSTO',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                begin: moment.tz("2016-10-24T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2016-10-24T16:00:01", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 2,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }, {
                action: 'SELL',
                quant: 2,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }]);
        });
    });
    describe("StopLoss orders", function() {
        it("submit stoploss order", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130'
                }]);
            })({
                systemid: 'test'
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 130
            }});
        });
        it("submit just stoploss order", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                quant_opened: 1,
                quant_closed: 0,
                symbol: 'GLD',
                instrument: 'stock',
                long_or_short: 'long'
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130'
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2018-04-05T16:00:00", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'STC',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                duration: 'GTC',
                stop: 130
            }});
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
                posted_time_unix: '1522948540',
                action: 'STC',
                signal_id: '117389066',
                posted_time: '2018-04-05 13:15:40'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130',
                    parkUntilSecs: moment.tz("2018-04-04", 'America/New_York').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2018-04-05T16:00:00", 'America/New_York').valueOf()
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
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: '1',
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BTO',
                    quant: '1',
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '120'
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2018-04-05T16:00:00", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                duration: 'GTC',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                stop: '120',
                action: 'STC',
                xreplace: '117389066'
            }});
        });
        it.skip("don't update stoploss order unless effective", function() {
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
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: 130,
                    parkUntilSecs: moment.tz("2018-04-05T15:00:00", 'America/New_York').format('X')
                }, {
                    action: '',
                    quant: 0,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
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
                quant: '2',
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: '0',
                limit: '130',
                duration: 'GTC',
                status: 'working'
            }, {
                signal_id: "94974799",
                action: 'STC',
                quant: '2',
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: '0',
                isStopOrder: '120',
                duration: 'GTC',
                status: 'working'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf()
            }).should.eventually.be.like([]);
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
                duration: 'GTC',
                status: 'working'
            }, {
                signal_id: "94974799",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isLimitOrder: 140,
                duration: 'GTC',
                status: 'working'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BTO',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                status: 'cancelled',
                order_ref: "94974799"
            }]);
        });
        it("IBM submit BTO with stoploss and different quant", async() => {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "100",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                status: 'working',
                signal_id: "94974798",
                action: 'STC',
                quant: 100,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isStopOrder: 120,
                duration: 'GTC'
            }]}));
            await Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 102,
                    position: 102,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }, {
                    action: 'BTO',
                    quant: 50,
                    position: 152,
                    symbol: 'IBM',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2015-06-16T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                quant_threshold: 5,
                now: moment.tz("2015-06-16T15:59:59", 'America/New_York').valueOf(),
                begin: "2015-01-01"
            }).should.eventually.be.like([{
                action: 'BUY',
                quant: 52,
                order_type: 'MKT',
                tif: 'GTC',
                symbol: 'IBM',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }]);
            await util.promisify(fs.readFile)(submitSignal, 'utf8').then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 52,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                duration: 'GTC'
            }});
        });
        it("catch up with multiple stoploss orders", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '120'
                }, {
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '110'
                }]);
            })({
                systemid: 'test'
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 110
            }});
        });
        it("triggered before catch up", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '120'
                }, {
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '110'
                }, {
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130'
                }]);
            })({
                systemid: 'test'
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 130
            }});
        });
        it("triggered before eod", function() {
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[{
                action: 'STC',
                status: 'traded',
                traded_time_unix: "1536093136",
                traded_price: "0.7587",
                currency: "CAD",
                fullSymbol: "@MCDU18",
                instrument: "future",
                quant: "1",
                symbol: "@MCDU8",
                market: 'CME'
            }, {
                action: 'BTO',
                status: 'traded',
                traded_time_unix: "1536093035",
                traded_price: "0.7587",
                currency: "CAD",
                fullSymbol: "@MCDU18",
                instrument: "future",
                quant: "1",
                symbol: "@MCDU8",
                market: 'CME'
            }, {
                action: 'STO',
                status: 'traded',
                traded_time_unix: "1533588901",
                traded_price: "0.76940",
                currency: "CAD",
                fullSymbol: "@MCDU18",
                instrument: "future",
                quant: "1",
                symbol: "@MCDU8",
                market: 'CME'
            }, {
                action: 'BTC',
                status: 'traded',
                traded_time_unix: "1534452856",
                traded_price: "0.76180",
                currency: "CAD",
                fullSymbol: "@MCDU18",
                instrument: "future",
                quant: "1",
                symbol: "@MCDU8",
                market: 'CME'
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: "BTO",
                    currency: "USD",
                    duration: "DAY",
                    isLimitOrder: 0.7752,
                    limit: 0.7672,
                    stoploss: 0.7594,
                    parkUntilSecs: "1535748900",
                    parkUntilYYYYMMDDHHMM: "201808291655",
                    quant: 1,
                    position: 1,
                    symbol: "MCDU18",
                    market: 'CME',
                    tif: "DAY",
                    typeofsymbol: "future",
                    underlying: "CAD"
                }]);
            })({
                systemid: 'test',
                now: '2018-09-04T16:45:00'
            }).should.eventually.be.like([]);
            // Working USD position has since been changed
        });
        it("triggered", function() {
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[{
                action: 'STC',
                status: 'traded',
                quant: 1,
                traded_price: 120,
                symbol: 'GLD',
                instrument: 'stock',
                traded_time_unix: moment('2018-01-02').format('X')
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
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
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '130',
                    parkUntilSecs: moment('2018-01-01').format('X')
                }, {
                    action: 'BTO',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'DAY',
                    stoploss: '120',
                    parkUntilSecs: moment('2018-01-03').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment('2018-01-03').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY',
                stoploss: 120
                // parkUntilSecs: undefined
            }});
        });
        it("GLD STCSTO without stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                typeofsymbol: 'stock',
                symbol: 'GLD',
                action: 'STC',
                quant: 2,
                duration: 'GTC',
                stop: 130,
                isStopOrder: 130,
                status: 'working'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                tif: 'GTC'
            }, {
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                tif: 'GTC'
            }]);
        });
        it("GLD STCSTO with STC", async() => {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
              market: 'CME',
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                typeofsymbol: 'stock',
                symbol: 'GLD',
                market: 'CME',
                action: 'STC',
                quant: 2,
                duration: 'GTC',
                market: 1,
                status: 'working'
            }]}));
            await Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                security_type: 'STK',
                order_type: 'STP',
                stop: 130,
                tif: 'GTC'
            }, {
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                security_type: 'STK',
                order_type: 'MKT',
                tif: 'GTC'
            }]);
            await util.promisify(fs.readFile)(submitSignal, 'utf8').then(JSON.parse)
              .should.eventually.be.like({signal:{
                conditionalupon: '94974798',
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }});
        });
        it("GLD STCSTO with wrong STC", async() => {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                typeofsymbol: 'stock',
                symbol: 'GLD',
                action: 'STC',
                quant: 1,
                duration: 'GTC',
                market: 1,
                status: 'working'
            }]}));
            await Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                security_type: 'STK',
                order_type: 'STP',
                stop: 130,
                tif: 'GTC'
            }, {
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                security_type: 'STK',
                order_type: 'MKT',
                tif: 'GTC'
            }]);
            await util.promisify(fs.readFile)(submitSignal, 'utf8').then(JSON.parse)
              .should.eventually.be.like({signal:{
                xreplace: '94974798',
                action: 'STC',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC'
            }});
        });
        it("GLD STCSTO with wrong STCSTO", async() => {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                signal_id: "94974798",
                typeofsymbol: 'stock',
                symbol: 'GLD',
                action: 'STC',
                quant: 2,
                duration: 'GTC',
                limit: 120.03,
                status: 'working'
            }, {
                signal_id: "94974799",
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                limit: 120.03,
                duration: 'GTC',
                status: 'working'
            }]}));
            await Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    limit: 120.56,
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-24T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                status: 'cancelled',
                order_ref: '94974799'
            }, {
                action: 'SELL',
                quant: 2,
                order_type: 'STP',
                stop: '130',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }, {
                action: 'SELL',
                quant: 2,
                order_type: 'LMT',
                limit: '120.56',
                tif: 'GTC',
                symbol: 'GLD',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK'
            }]);
        });
        it("GLD STCSTO with stoploss", async() => {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "2",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            await Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    close: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    close: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    close: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    long_or_short: 'short',
                    position: -2,
                    typeofsymbol: 'stock',
                    order_type: 'MKT',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2016-10-24T16:00:00"
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                security_type: 'STK',
                order_type: 'MKT',
                tif: 'GTC'
            }]);
            await util.promisify(fs.readFile)(submitSignal, 'utf8').then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'GTC',
                stoploss: 130
            }});
        });
        it("Don't wipe out stoploss when cancelling BTC order", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
                PL: "-9",
                closeVWAP_timestamp: "1536184821",
                closedWhen: "",
                closedWhenUnixTimeStamp: "",
                closing_price_VWAP: "0.75900",
                currency: "CAD",
                currencyMultiplierUSD: 0.759976592720944,
                expir: null,
                fullSymbol: "@MCDU18",
                instrument: "future",
                long_or_short: "short",
                markToMarket_time: "2018-09-05 18:00:21",
                openVWAP_timestamp: "1536184821",
                open_or_closed: "open",
                openedWhen: "2018-09-05 16:55:12",
                openedWhenUnixTimeStamp: "1536180912",
                opening_price_VWAP: "0.75900",
                ptValue: "10000",
                putcall: null,
                quant_closed: "0",
                quant_opened: "1",
                strike: null,
                symbol: "@MCDU8",
                symbol_description: "",
                trade_id: "119738014",
                underlying: "CAD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                action: "BTC",
                expiration: null,
                instrument: "future",
                isLimitOrder: "0",
                isMarketOrder: "0",
                isOrderParked: "0",
                isStopOrder: "0.7744",
                name: "",
                parked_releasewhen: "",
                posted_time: "2018-09-05 16:55:12",
                posted_time_unix: "1536180912",
                putcall: null,
                quant: "1",
                signal_id: "119737393",
                status: "working",
                strike: null,
                symbol: "@MCDU8",
                tif: "GTC",
                underlying: "CAD"
            }, {
                action: "BTC",
                expiration: null,
                instrument: "future",
                isLimitOrder: "0.7604",
                isMarketOrder: "0",
                isOrderParked: "1",
                isStopOrder: "0",
                name: "",
                parked_releasewhen: "2018-09-10 16:55:00",
                posted_time: "2018-09-10 12:15:33",
                posted_time_unix: "1536180912",
                putcall: null,
                quant: "1",
                signal_id: "119787763",
                status: "working",
                strike: null,
                symbol: "@MCDU8",
                tif: "DAY",
                underlying: "CAD"
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: "SELL",
                    currency: "USD",
                    duration: "DAY",
                    limit: 0.7596,
                    stoploss: 0.7744,
                    parkUntilSecs: "1536166500",
                    parkUntilYYYYMMDDHHMM: "201809051655",
                    quant: 1,
                    position: -1,
                    symbol: "MCDU18",
                    market: 'CME',
                    tif: "DAY",
                    typeofsymbol: "future",
                    underlying: "CAD"
                }, {
                    action: "SELL",
                    currency: "USD",
                    duration: "DAY",
                    limit: 0.7596,
                    stoploss: 0.7744,
                    parkUntilSecs: "1536166500",
                    parkUntilYYYYMMDDHHMM: "201809051655",
                    quant: 1,
                    position: -1,
                    symbol: "MCDU18",
                    market: 'CME',
                    tif: "DAY",
                    typeofsymbol: "future",
                    underlying: "CAD"
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2018-09-10T13:00:00"
            }).should.eventually.be.like([{
                order_ref: "119787763",
                status: 'cancelled'
            }]);
        });
        it("Correctly map @EU/6E futures", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ ok: '1',
              response:
               [ { closeVWAP_timestamp: '1558711805',
                   strike: null,
                   fullSymbol: '@EUM19',
                   open_or_closed: 'open',
                   expir: null,
                   openVWAP_timestamp: '1558711805',
                   currency: 'USD',
                   underlying: null,
                   closing_price_VWAP: '1.12280',
                   putcall: null,
                   openedWhenUnixTimeStamp: '1558710578',
                   quant_closed: '0',
                   markToMarket_time: '2019-05-24 11:30:05',
                   opening_price_VWAP: '1.12300',
                   trade_id: '123813141',
                   symbol: '@EUM9',
                   market: 'CME',
                   quant_opened: '1',
                   closedWhen: '',
                   instrument: 'future',
                   ptValue: '125000',
                   PL: '19',
                   closedWhenUnixTimeStamp: '',
                   currencyMultiplierUSD: 1,
                   openedWhen: '2019-05-24 11:09:38',
                   long_or_short: 'short',
                   symbol_description: 'EURO FX JUNE 2019',
                   exchange: 'CME' } ] }));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ ok: '1',
              response:
               [ { isLimitOrder: '0',
                   strike: null,
                   status: 'working',
                   underlying: null,
                   isMarketOrder: '0',
                   tif: 'GTC',
                   putcall: null,
                   expiration: null,
                   quant: '1',
                   parked_releasewhen: '',
                   symbol: '@EUM9',
                   market: 'CME',
                   name: '',
                   instrument: 'future',
                   isStopOrder: '1.1395',
                   posted_time_unix: '1558710578',
                   isOrderParked: '0',
                   action: 'BTC',
                   signal_id: '123812942',
                   posted_time: '2019-05-24 11:09:38' } ] }));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action:	'SELL',
                    quant: '1',
                    position: -1,
                    symbol:	'6EM19',
                    market:	'CME',
                    typeofsymbol:	'future',
                    underlying:	'EUR',
                    duration:	'DAY',
                    stoploss:	'1.1395',
                    limit:	'1.123',
                    currency:	'USD',
                    posted_time_unix:	'1558710000'
                }, {
                    "limit":"1.12345",
                    "stoploss":"1.1395",
                    "asof":"2019-05-24T15:00:00-04:00",
                    "status":"pending",
                    "action":"SELL",
                    "quant":"1",
                    position: -1,
                    "symbol":"6EM19",
                    "market":"CME",
                    "currency":"USD",
                    "security_type":"FUT",
                    "order_type":"LMT",
                    "tif":"DAY"
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2019-05-24T14:57:46"
            }).should.eventually.be.like([
            ]);
        });
    });
    describe("catch-up limit orders", function() {
        it("IBM submit BTO on STC signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    limit: 144.14,
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }, {
                    date: '2015-06-16',
                    symbol: 'IBM',
                    market: 'NYSE',
                    limit: 150.53,
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 1,
                    position: 1,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: -1,
                    parkUntilSecs: moment('2015-06-16T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-06-16T16:00:00", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 1,
                duration: 'DAY'
            }});
        });
        it("IBM increase quant after filled", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "IBM",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "1",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "IBM"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    limit: 144.14,
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                begin: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2015-02-17T16:00:01", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                limit: 144.14,
                duration: 'GTC'
            }});
        });
        it("GLD catch up on working BTCBTO signal", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    limit: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-13',
                    limit: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2016-10-13T15:59:59", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'BUY',
                quant: 2,
                symbol: 'GLD',
                limit: 120.03,
                tif: 'GTC',
            }]);
        });
        it("GLD BTO signal catchup", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    limit: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-13',
                    limit: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                begin: moment.tz("2016-10-13T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2016-10-13T16:00:01", 'America/New_York').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                limit: 120.03,
                duration: 'GTC'
            }});
        });
        it("GLD STCSTO miss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "0",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[{
	          action: 'STO',
	          status: 'traded',
	          traded_time_unix: "1434055203",
	          symbol: "GLD",
	          traded_price: "58.23390",
	          quant: "2",
	          instrument: "stock",
	          ptValue: "1",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }, {
              action: 'BTC',
              status: 'traded',
	          traded_time_unix: "1434055203",
	          traded_price: "56.43",
	          quant: "2",
	          symbol: "GLD",
	          instrument: "stock",
	          ptValue: "1",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    limit: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-13',
                    limit: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X')
                }, {
                    date: '2016-10-24',
                    limit: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X')
                }]);
            })({
                systemid: 'test',
                begin: moment.tz("2016-10-24T16:00:00", 'America/New_York').valueOf(),
                now: moment.tz("2016-10-24T16:00:01", 'America/New_York').valueOf()
            }).should.eventually.be.like([{
                action: 'SELL',
                tif: 'GTC',
                limit: 120.56,
                quant: 2,
                symbol: 'GLD'
            }, {
                action: 'SELL',
                quant: 2,
                symbol: 'GLD',
                limit: 120.56,
                tif: 'GTC'
            }]);
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
                duration: 'GTC',
                status: 'working'
            }, {
                signal_id: "94974799",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isStopOrder: 120,
                duration: 'GTC',
                status: 'working'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2015-02-17',
                    symbol: 'IBM',
                    market: 'NYSE',
                    close: 144.14,
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 2,
                    position: 2,
                    typeofsymbol: 'stock',
                    limit: 130,
                    stoploss: 120,
                    duration: 'GTC',
                    currency: 'USD',
                    sma_cross: 1,
                    parkUntilSecs: moment('2015-02-17T16:00:00-05:00').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment.tz("2015-02-17T16:00:00", 'America/New_York').valueOf()
            }).should.eventually.be.like([]);
        });
        it("catch up with multiple stoploss orders", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 145,
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 135,
                    duration: 'DAY',
                    stoploss: '120'
                }, {
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 125,
                    duration: 'DAY',
                    stoploss: '110'
                }]);
            })({
                systemid: 'test'
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                limit: 125,
                duration: 'DAY',
                stoploss: 110
            }});
        });
        it("triggered before catch up", function() {
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 145,
                    duration: 'DAY',
                    stoploss: '130'
                }, {
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 135,
                    duration: 'DAY',
                    stoploss: '120'
                }, {
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 125,
                    duration: 'DAY',
                    stoploss: '110'
                }, {
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 145,
                    duration: 'DAY',
                    stoploss: '130'
                }]);
            })({
                systemid: 'test'
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                limit: 145,
                duration: 'DAY',
                stoploss: 130
            }});
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
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 145,
                    duration: 'DAY',
                    stoploss: '130',
                    parkUntilSecs: moment('2018-01-01').format('X')
                }, {
                    action: 'BUY',
                    quant: 1,
                    position: 1,
                    symbol: 'GLD',
                    market: 'NYSE',
                    typeofsymbol: 'stock',
                    limit: 135,
                    duration: 'DAY',
                    stoploss: '120',
                    parkUntilSecs: moment('2018-01-03').format('X')
                }]);
            })({
                systemid: 'test',
                now: moment('2018-01-03').valueOf()
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'BTO',
                quant: 1,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                limit: 135,
                duration: 'DAY',
                stoploss: 120
                // parkUntilSecs: undefined
            }});
        });
        it("GLD STCSTO with stoploss", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[{
	          closeVWAP_timestamp: "1434055203",
	          strike: "0",
	          open_or_closed: "open",
	          expir: "",
	          openVWAP_timestamp: "1434055203",
	          underlying: "",
	          closing_price_VWAP: "56.43",
	          putcall: "",
	          long_or_short: "long",
	          quant_closed: "2",
	          markToMarket_time: "2015-06-11 16:40:03",
	          trade_id: "94369671",
	          symbol: "GLD",
	          opening_price_VWAP: "58.23390",
	          quant_opened: "2",
	          closedWhen: "",
	          instrument: "stock",
	          ptValue: "1",
	          PL: "-451",
	          closedWhenUnixTimeStamp: "",
	          openedWhen: "2015-05-12 09:38:19",
	          symbol_description: "GLD"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    date: '2016-10-03',
                    limit: 125.32,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 2,
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-03T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-13',
                    limit: 120.03,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'BUY',
                    long_or_short: 'long',
                    quant: 4,
                    position: 2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-13T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    limit: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    action: 'SELL',
                    long_or_short: 'short',
                    quant: 4,
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }, {
                    date: '2016-10-24',
                    limit: 120.56,
                    symbol: 'GLD',
                    market: 'NYSE',
                    long_or_short: 'short',
                    position: -2,
                    typeofsymbol: 'stock',
                    duration: 'GTC',
                    currency: 'USD',
                    parkUntilSecs: moment('2016-10-24T16:00:00-04:00').format('X'),
                    stoploss: 130
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2016-10-24T16:00:00"
            }).then(() => fs.readFileSync(submitSignal, 'utf8')).then(JSON.parse)
              .should.eventually.be.like({signal:{
                action: 'STO',
                quant: 2,
                symbol: 'GLD',
                typeofsymbol: 'stock',
                limit: 120.56,
                duration: 'GTC',
                stoploss: 130
            }});
        });
        it("MSF working BTCBTO stop and reverse", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok: '1',response: [{
                closeVWAP_timestamp: '1531428976',
                strike: null,
                fullSymbol: '@MSFU18',
                open_or_closed: 'open',
                expir: null,
                openVWAP_timestamp: '1531428976',
                currency: 'CHF',
                underlying: 'CHF',
                closing_price_VWAP: '1.00270',
                putcall: null,
                openedWhenUnixTimeStamp: '1531428908',
                quant_closed: '0',
                markToMarket_time: '2018-07-12 16:56:16',
                opening_price_VWAP: '1.00270',
                trade_id: '118904708',
                symbol: '@MSFU8',
                market: 'CME',
                quant_opened: '1',
                closedWhen: '',
                instrument: 'future',
                ptValue: '12500',
                PL: '-118',
                closedWhenUnixTimeStamp: '',
                currencyMultiplierUSD: 1.00731309305558,
                openedWhen: '2018-07-12 16:55:08',
                long_or_short: 'short',
                symbol_description: null
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                status: 'working',
                signal_id: 'xxx',
                action: 'BTC',
                duration: 'GTC',
                isStopOrder: 1.023,
                parkUntilSecs: 1532120100,
                quant: 1,
                signalid: 12240489,
                stop: 1.023,
                symbol: '@MSFU8',
                market: 'CME',
                typeofsymbol: 'future'
            }, {
                isLimitOrder: '1.011800000',
                strike: null,
                status: 'working',
                underlying: null,
                isMarketOrder: '0',
                tif: 'DAY',
                putcall: null,
                expiration: null,
                quant: '1',
                parked_releasewhen: '',
                symbol: '@MSFU8',
                market: 'CME',
                name: '',
                instrument: 'future',
                isStopOrder: '0',
                posted_time_unix: '1532385924',
                isOrderParked: '0',
                action: 'BTC',
                signal_id: '119080350',
                posted_time: '2018-07-23 18:45:24'
            }, {
                isLimitOrder: '1.011800000',
                strike: null,
                status: 'working',
                underlying: null,
                isMarketOrder: '0',
                tif: 'DAY',
                putcall: null,
                expiration: null,
                quant: '1',
                parked_releasewhen: '',
                symbol: '@MSFU8',
                market: 'CME',
                name: '',
                instrument: 'future',
                isStopOrder: '0',
                posted_time_unix: '1532385924',
                isOrderParked: '0',
                action: 'BTO',
                signal_id: '119080352',
                posted_time: '2018-07-23 18:45:24'
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: 'SELL',
                    quant: 1,
                    position: -1,
                    symbol: 'MSFU18',
                    market: 'CME',
                    typeofsymbol: 'future',
                    underlying: 'CHF',
                    duration: 'DAY',
                    stoploss: 1.023,
                    limit: 1.0122,
                    currency: 'USD',
                    parkUntilSecs: 1532120100,
                    parkUntilYYYYMMDDHHMM: 201807201655
                }, {
                    action: 'BUY',
                    quant: 2,
                    position: 1,
                    symbol: 'MSFU18',
                    market: 'CME',
                    typeofsymbol: 'future',
                    underlying: 'CHF',
                    duration: 'DAY',
                    stoploss: 0.9913,
                    limit: 1.0118,
                    currency: 'USD',
                    parkUntilSecs: 1532379300,
                    parkUntilYYYYMMDDHHMM: 201807231655
                }, {
                    position: 1,
                    symbol: 'MSFU18',
                    market: 'CME',
                    typeofsymbol: 'future',
                    underlying: 'CHF',
                    duration: 'DAY',
                    stoploss: 0.9913,
                    limit: 1.0118,
                    currency: 'USD',
                    parkUntilSecs: 1532379300,
                    parkUntilYYYYMMDDHHMM: 201807231655
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2018-07-23T19:00:00"
            }).should.eventually.be.like([{
                // buying more quant is not getting us closer to our desired position
                status: 'cancelled',
                order_ref: 'xxx'
            }, {
                // cancelled and resubmitted bc collective2 splits reversal signals
                status: 'cancelled',
                order_ref: '119080352'
            }, {
                action: 'BUY',
                quant: 1,
                order_type: 'LMT',
                limit: '1.0118',
                tif: 'DAY',
                symbol: 'MSFU18',
                market: 'CME',
                currency: 'USD',
                security_type: 'FUT',
                attach_ref: '119080350'
              }]);
        });
        it("VNQ update closing signal with slightly different quant", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok: '1',response: [{
                PL: "23",
                closeVWAP_timestamp: "1536091124",
                closedWhen: "",
                closedWhenUnixTimeStamp: "",
                closing_price_VWAP: "83.05000",
                currency: "USD",
                currencyMultiplierUSD: 1,
                expir: null,
                fullSymbol: "VNQ",
                instrument: "stock",
                long_or_short: "long",
                markToMarket_time: "2018-09-04 15:58:44",
                openVWAP_timestamp: "1536091124",
                open_or_closed: "open",
                openedWhen: "2018-09-04 15:55:12",
                openedWhenUnixTimeStamp: "1536090912",
                opening_price_VWAP: "83.00000",
                ptValue: "1",
                putcall: null,
                quant_closed: "0",
                quant_opened: "43",
                strike: null,
                symbol: "VNQ",
                symbol_description: "VANGUARD REAL ESTATE ETF",
                trade_id: "119721187",
                underlying: null
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                action: "STC",
                expiration: null,
                instrument: "stock",
                isLimitOrder: "83.54",
                isMarketOrder: "0",
                isOrderParked: "1",
                isStopOrder: "0",
                name: "VANGUARD REAL ESTATE ETF",
                parked_releasewhen: "2018-09-05 15:55:00",
                posted_time: "2018-09-05 15:47:07",
                posted_time_unix: "1536176827",
                putcall: null,
                quant: "43",
                signal_id: "119736956",
                status: "working",
                strike: null,
                symbol: "VNQ",
                tif: "DAY",
                underlying: null
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    action: "BUY",
                    duration: "DAY",
                    isLimitOrder: 83.06,
                    limit: 83.06,
                    parkUntilSecs: "1536090900",
                    parkUntilYYYYMMDDHHMM: "201809041555",
                    quant: 42,
                    position: 42,
                    symbol: "VNQ",
                    market: 'NYSE',
                    tif: "DAY",
                    typeofsymbol: "stock"
                }, {
                    action: "SELL",
                    duration: "DAY",
                    isLimitOrder: 83.54,
                    limit: 83.54,
                    parkUntilSecs: "1536177300",
                    parkUntilYYYYMMDDHHMM: "201809051555",
                    quant: 42,
                    position: 0,
                    symbol: "VNQ",
                    market: 'NYSE',
                    tif: "DAY",
                    typeofsymbol: "stock"
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2018-09-05T15:50:00",
                quant_threshold: 5
            }).should.eventually.be.like([]);
        });
        it("Quickly reversing signals", function() {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok: '1',response: [{
                closeVWAP_timestamp: "1551362703",
                strike: null,
                fullSymbol: "@CDH19",
                open_or_closed: "open",
                expir: null,
                openVWAP_timestamp: "1551362703",
                currency: "USD",
                underlying: null,
                closing_price_VWAP: "0.75835",
                putcall: null,
                openedWhenUnixTimeStamp: "1551362580",
                quant_closed: "0",
                markToMarket_time: "2019-02-28 09:05:03",
                opening_price_VWAP: "0.75815",
                trade_id: "122730309",
                symbol: "@CDH9",
                market: 'CME',
                quant_opened: "1",
                closedWhen: "",
                instrument: "future",
                ptValue: "100000",
                PL: "845",
                closedWhenUnixTimeStamp: "",
                currencyMultiplierUSD: 1,
                openedWhen: "2019-02-28 09:03:00",
                long_or_short: "short",
                symbol_description: "CANADIAN DOLLAR MARCH 2019",
                exchange: "CME"
            }]}));
            fs.writeFileSync(retrieveSignalsWorking, JSON.stringify({ok:1,response:[{
                isLimitOrder: "0.74915",
                strike: null,
                status: "working",
                underlying: null,
                isMarketOrder: "0",
                tif: "DAY",
                putcall: null,
                expiration: null,
                quant: "1",
                parked_releasewhen: "",
                symbol: "@CDH9",
                market: 'CME',
                name: "",
                instrument: "future",
                isStopOrder: "0",
                posted_time_unix: "1551794457",
                isOrderParked: "0",
                action: "BTC",
                signal_id: "122787034",
                posted_time: "2019-03-05 09:00:57"
            }, {
                isLimitOrder: "0.74915",
                strike: null,
                status: "working",
                underlying: null,
                isMarketOrder: "0",
                tif: "DAY",
                putcall: null,
                expiration: null,
                quant: "1",
                parked_releasewhen: "",
                symbol: "@CDH9",
                market: 'CME',
                name: "",
                instrument: "future",
                isStopOrder: "0",
                posted_time_unix: "1551794457",
                isOrderParked: "0",
                action: "BTO",
                signal_id: "122787036",
                posted_time: "2019-03-05 09:00:57"
            }]}));
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([{
                    limit: 0.74915,
                    action: "BUY",
                    typeofsymbol: "future",
                    duration: "DAY",
                    posted_time_unix: "1551790800",
                    underlying: "CAD",
                    quant: 1,
                    position: 1,
                    currency: "USD",
                    symbol: "6CH19",
                    market: 'CME',
                    tif: "DAY",
                    isLimitOrder: 0.74915
                }, {
                    typeofsymbol: "future",
                    symbol: "6CH19",
                    market: 'CME',
                    action: "SELL",
                    quant: 1,
                    position: 0,
                    currency: "USD",
                    duration: "GTC",
                    stop: 0.7383,
                    isStopOrder: 0.7383
                }]);
            })({
                systemid: 'test',
                tz: 'America/New_York',
                now: "2019-03-05T09:30:00"
            }).should.eventually.be.like([{
                status: 'cancelled',
                order_ref: '122787034'
            }, {
                status: 'cancelled',
                order_ref: '122787036'
            }, {
                action: 'BUY',
                quant: 1,
                order_type: 'MKT',
                tif: 'DAY',
                symbol: '6CH19',
                market: 'CME',
                currency: 'USD',
                security_type: 'FUT'
            }]);
        });
    });
});
