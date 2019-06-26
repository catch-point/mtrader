// broker-collective2.spec.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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
const Broker = require('../src/broker-collective2.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("broker-collective2", function() {
    this.timeout(60000);
    var fetch, quote, collect, broker;
    var dir = createTempDir('collective2');
    var requestMarginEquity = path.resolve(dir, 'requestMarginEquity');
    var retrieveSystemEquity = path.resolve(dir, 'retrieveSystemEquity');
    var requestTrades = path.resolve(dir, 'requestTrades.json');
    var retrieveSignalsWorking = path.resolve(dir, 'retrieveSignalsWorking.json');
    var requestTradesOpen = path.resolve(dir, 'requestTradesOpen.json');
    var retrieveSignalsAll = path.resolve(dir, 'retrieveSignalsAll.json');
    var submitSignal = path.resolve(dir, 'submitSignal.json');
    var cancelSignal = path.resolve(dir, 'cancelSignal.json');
    before(function() {
        config('workers', 0);
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', createTempDir('collective2'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        config('broker.collective2.requestMarginEquity', 'file://' + requestMarginEquity);
        config('broker.collective2.retrieveSystemEquity', 'file://' + retrieveSystemEquity);
        config('broker.collective2.requestTrades', 'file://' + requestTrades);
        config('broker.collective2.retrieveSignalsWorking', 'file://' + retrieveSignalsWorking);
        config('broker.collective2.submitSignal', 'file://' + submitSignal);
        config('broker.collective2.cancelSignal', 'file://' + cancelSignal);
        config('broker.collective2.requestTradesOpen', 'file://' + requestTradesOpen);
        config('broker.collective2.retrieveSignalsAll', 'file://' + retrieveSignalsAll);
        fetch = new Fetch();
        quote = new Quote(fetch);
        collect = new Collect(quote);
        broker = new Broker({
            systemid: 'test',
            apikey: 'test'
        });
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
        config.unset('fetch.files.dirname');
        return Promise.all([
            broker.close(),
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    describe("empty", function() {
        it("no orders", async() => {
            return broker({action: 'orders'}).should.eventually.be.like([]);
        });
        it("no positions", async() => {
            return broker({action: 'positions'}).should.eventually.be.like([]);
        });
        it("no balance", async() => {
            return broker({action: 'balances'}).should.eventually.be.like([]);
        });
    });
    describe("present", function() {
        beforeEach(function() {
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ok: '1', response: [{
                closeVWAP_timestamp: '1557342004', strike: null, fullSymbol: 'XLP', open_or_closed: 'open', expir: null, openVWAP_timestamp: '1557342004', currency: 'USD', underlying: null, closing_price_VWAP: '56.95000', putcall: null, openedWhenUnixTimeStamp: '1557335386', quant_closed: '0', markToMarket_time: '2019-05-08 15:00:04', opening_price_VWAP: '56.88000', trade_id: '123576928', symbol: 'XLP', quant_opened: '158', closedWhen: '', instrument: 'stock', ptValue: '1', PL: '-17', closedWhenUnixTimeStamp: '', currencyMultiplierUSD: 1, openedWhen: '2019-05-08 13:09:46', long_or_short: 'long', symbol_description: 'SPDR CONSUMER STAPLES SELECT', exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1555606804', strike: null, fullSymbol: 'VNQ', open_or_closed: 'open', expir: null, openVWAP_timestamp: '1555693204', currency: 'USD', underlying: null, closing_price_VWAP: '85.48500', putcall: null, openedWhenUnixTimeStamp: '1555530901', quant_closed: '0', markToMarket_time: '2019-04-18 13:00:04', opening_price_VWAP: '85.17522', trade_id: '123349135', symbol: 'VNQ', quant_opened: '89', closedWhen: '', instrument: 'stock', ptValue: '1', PL: '142', closedWhenUnixTimeStamp: '', currencyMultiplierUSD: 1, openedWhen: '2019-04-17 15:55:01', long_or_short: 'long', symbol_description: 'VANGUARD REAL ESTATE ETF', exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1555520404', strike: null, fullSymbol: 'IHI', open_or_closed: 'open', expir: null, openVWAP_timestamp: '1555606804', currency: 'USD', underlying: null, closing_price_VWAP: '215.10940', putcall: null, openedWhenUnixTimeStamp: '1555444501', quant_closed: '0', markToMarket_time: '2019-04-17 13:00:04', opening_price_VWAP: '218.19500', trade_id: '123333337', symbol: 'IHI', quant_opened: '28', closedWhen: '', instrument: 'stock', ptValue: '1', PL: '-4', closedWhenUnixTimeStamp: '', currencyMultiplierUSD: 1, openedWhen: '2019-04-16 15:55:01', long_or_short: 'long', symbol_description: 'ISHARES DOW JONES US MEDICAL D', exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1557777302', strike: null, fullSymbol: 'XLU', open_or_closed: 'open', expir: null, openVWAP_timestamp: '1554750004', currency: 'USD', underlying: null, closing_price_VWAP: '58.3476188679245', putcall: null, openedWhenUnixTimeStamp: '1551300901', quant_closed: '27', markToMarket_time: '2019-05-13 15:55:02', opening_price_VWAP: '56.95021', trade_id: '122723097', symbol: 'XLU', quant_opened: '159', closedWhen: '', instrument: 'stock', ptValue: '1', PL: '184', closedWhenUnixTimeStamp: '', currencyMultiplierUSD: 1, openedWhen: '2019-02-27 15:55:01', long_or_short: 'long', symbol_description: 'UTILITIES SELECT SECTOR SPDR', exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1557507604', strike: null, fullSymbol: 'SOXX', open_or_closed: 'open', expir: null, openVWAP_timestamp: '1557507604', currency: 'USD', underlying: null, closing_price_VWAP: '198.94000', putcall: null, openedWhenUnixTimeStamp: '1557431701', quant_closed: '0', markToMarket_time: '2019-05-10 13:00:04', opening_price_VWAP: '200.76000', trade_id: '123597947', symbol: 'SOXX', quant_opened: '19', closedWhen: '', instrument: 'stock', ptValue: '1', PL: '-170', closedWhenUnixTimeStamp: '', currencyMultiplierUSD: 1, openedWhen: '2019-05-09 15:55:01', long_or_short: 'long', symbol_description: 'ISHARES PHLX SEMICONDUCTOR ETF', exchange: 'NASDAQ'
            }]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok: '1', response: [{
                canceled_time_unix: '0', isLimitOrder: '73.980000000', strike: null, status: 'traded', expired_time_unix: '0', traded_time: '2019-05-13 15:55:01', expired_time: '0', underlying: null, isMarketOrder: '0', putcall: null, tif: 'DAY', expiration: null, quant: '31', canceled_time: '', symbol: 'XLI', name: 'INDUSTRIAL SELECT SECTOR SPDR', instrument: 'stock', isStopOrder: '0', posted_time_unix: '1557777300', trade_id_closing: '123579027', traded_price: '74.090000000', action: 'STC', trade_id_opening: '', traded_time_unix: '1557777301', signal_id: '123652206', posted_time: '2019-05-13 15:55:00'
            }, {
                canceled_time_unix: '0', isLimitOrder: '75.800000000', strike: null, status: 'traded', expired_time_unix: '0', traded_time: '2019-05-09 15:55:01', expired_time: '0', underlying: null, isMarketOrder: '0', putcall: null, tif: 'DAY', expiration: null, quant: '51', canceled_time: '', symbol: 'XLI', name: 'INDUSTRIAL SELECT SECTOR SPDR', instrument: 'stock', isStopOrder: '0', posted_time_unix: '1557431700', trade_id_closing: '123579027', traded_price: '75.910000000', action: 'STC', trade_id_opening: '', traded_time_unix: '1557431701', signal_id: '123597789', posted_time: '2019-05-09 15:55:00'
            }, {
                canceled_time_unix: '0', isLimitOrder: '200.760000000', strike: null, status: 'traded', expired_time_unix: '0', traded_time: '2019-05-09 15:55:01', expired_time: '0', underlying: null, isMarketOrder: '0', putcall: null, tif: 'DAY', expiration: null, quant: '19', canceled_time: '', symbol: 'SOXX', name: 'ISHARES PHLX SEMICONDUCTOR ETF', instrument: 'stock', isStopOrder: '0', posted_time_unix: '1557431700', trade_id_closing: '', traded_price: '200.760000000', action: 'BTO', trade_id_opening: '123597947', traded_time_unix: '1557431701', signal_id: '123597791', posted_time: '2019-05-09 15:55:00'
            }]}));
            fs.writeFileSync(retrieveSystemEquity, JSON.stringify({
                ok: '1',
                systemname: 'Meerkat Sectors',
                initial_index_to_equity_scaling_factor: '12.1047789667361',
                equity_data: [{
                    strategy_with_cost: 34273,
                    unix_timestamp: '1557764856',
                    index_price: '2821.44',
                    YYYYMMDD: '20190513',
                    strategy_raw: 36408
                }, {
                    strategy_with_cost: 34385,
                    unix_timestamp: '1557777325',
                    index_price: '2821.44',
                    YYYYMMDD: '20190513',
                    strategy_raw: 36520
                }]
            }));
        });
        it("orders", async() => {
            return broker({action: 'orders'})
              .then(d=>d.forEach(d=>console.log(d))||d)
              .should.eventually.be.like([]);
        });
        it("positions", async() => {
            return broker({action: 'positions', now: '2019-05-15'})
              .should.eventually.be.like([{
                sales: '0',
                purchases: '0.00',
                symbol: 'XLP',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 158,
                traded_at: null,
                traded_price: null
            }, {
                sales: '0',
                purchases: '0.00',
                symbol: 'VNQ',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 89,
                traded_at: null,
                traded_price: null
            }, {
                sales: '0',
                purchases: '0.00',
                symbol: 'IHI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 28,
                traded_at: null,
                traded_price: null
            }, {
                sales: '0',
                purchases: '0.00',
                symbol: 'XLU',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 132,
                traded_at: null,
                traded_price: null
            }, {
                sales: '0',
                purchases: '0.00',
                symbol: 'SOXX',
                market: 'NASDAQ',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 19,
                traded_at: null,
                traded_price: null
            }]);
        });
        it("balance", async() => {
            return broker({action: 'balances'})
              .should.eventually.be.like([{
                currency: 'USD',
                rate: '1.0',
                net: 36520
            }]);
        });
    });
    describe("past", function() {
        beforeEach(function() {
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ ok: '1', response: [{
                closeVWAP_timestamp: '1557342004',  strike: null,  fullSymbol: 'XLP',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1557342004',  currency: 'USD',  underlying: null,  closing_price_VWAP: '56.95000',  putcall: null,  openedWhenUnixTimeStamp: '1557335386',  quant_closed: '0',  markToMarket_time: '2019-05-08 15:00:04',  opening_price_VWAP: '56.88000',  trade_id: '123576928',  symbol: 'XLP',  quant_opened: '158',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '25',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-05-08 13:09:46',  long_or_short: 'long',  symbol_description: 'SPDR CONSUMER STAPLES SELECT',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: null,  strike: null,  fullSymbol: 'ITA',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: null,  currency: 'USD',  underlying: null,  closing_price_VWAP: '203.99',  putcall: null,  openedWhenUnixTimeStamp: '1557863745',  quant_closed: '0',  markToMarket_time: '',  opening_price_VWAP: '204.15',  trade_id: '123670407',  symbol: 'ITA',  quant_opened: '9',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '-1',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-05-14 15:55:45',  long_or_short: 'long',  symbol_description: 'I SHARES US AEROSPACE & DEFENSE',  exchange: 'BATS'
            }, {
                closeVWAP_timestamp: '1555606804',  strike: null,  fullSymbol: 'VNQ',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1555693204',  currency: 'USD',  underlying: null,  closing_price_VWAP: '85.48500',  putcall: null,  openedWhenUnixTimeStamp: '1555530901',  quant_closed: '0',  markToMarket_time: '2019-04-18 13:00:04',  opening_price_VWAP: '85.17522',  trade_id: '123349135',  symbol: 'VNQ',  quant_opened: '89',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '170',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-04-17 15:55:01',  long_or_short: 'long',  symbol_description: 'VANGUARD REAL ESTATE ETF',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1555520404',  strike: null,  fullSymbol: 'IHI',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1555606804',  currency: 'USD',  underlying: null,  closing_price_VWAP: '215.10940',  putcall: null,  openedWhenUnixTimeStamp: '1555444501',  quant_closed: '0',  markToMarket_time: '2019-04-17 13:00:04',  opening_price_VWAP: '218.19500',  trade_id: '123333337',  symbol: 'IHI',  quant_opened: '28',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '61',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-04-16 15:55:01',  long_or_short: 'long',  symbol_description: 'ISHARES DOW JONES US MEDICAL D',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1557863702',  strike: null,  fullSymbol: 'XLU',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1554750004',  currency: 'USD',  underlying: null,  closing_price_VWAP: '58.0238452830189',  putcall: null,  openedWhenUnixTimeStamp: '1551300901',  quant_closed: '27',  markToMarket_time: '2019-05-14 15:55:02',  opening_price_VWAP: '56.95021',  trade_id: '122723097',  symbol: 'XLU',  quant_opened: '159',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '142',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-02-27 15:55:01',  long_or_short: 'long',  symbol_description: 'UTILITIES SELECT SECTOR SPDR',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1557507604',  strike: null,  fullSymbol: 'SOXX',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1557507604',  currency: 'USD',  underlying: null,  closing_price_VWAP: '198.94000',  putcall: null,  openedWhenUnixTimeStamp: '1557431701',  quant_closed: '0',  markToMarket_time: '2019-05-10 13:00:04',  opening_price_VWAP: '200.76000',  trade_id: '123597947',  symbol: 'SOXX',  quant_opened: '19',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '-86',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-05-09 15:55:01',  long_or_short: 'long',  symbol_description: 'ISHARES PHLX SEMICONDUCTOR ETF',  exchange: 'NASDAQ'
            }]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ ok: '1', response: [{
                canceled_time_unix: '0',  isLimitOrder: '73.980000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-13 15:55:01',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '31',  canceled_time: '',  symbol: 'XLI',  name: 'INDUSTRIAL SELECT SECTOR SPDR',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557777300',  trade_id_closing: '123579027',  traded_price: '74.090000000',  action: 'STC',  trade_id_opening: '',  traded_time_unix: '1557777301',  signal_id: '123652206',  posted_time: '2019-05-13 15:55:00'
            }, {
                canceled_time_unix: '0',  isLimitOrder: '75.800000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-09 15:55:01',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '51',  canceled_time: '',  symbol: 'XLI',  name: 'INDUSTRIAL SELECT SECTOR SPDR',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557431700',  trade_id_closing: '123579027',  traded_price: '75.910000000',  action: 'STC',  trade_id_opening: '',  traded_time_unix: '1557431701',  signal_id: '123597789',  posted_time: '2019-05-09 15:55:00'
            }, {
                canceled_time_unix: '0',  isLimitOrder: '204.200000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-14 15:55:45',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '9',  canceled_time: '',  symbol: 'ITA',  name: 'I SHARES US AEROSPACE & DEFENSE',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557863745',  trade_id_closing: '',  traded_price: '204.150000000',  action: 'BTO',  trade_id_opening: '123670407',  traded_time_unix: '1557863745',  signal_id: '123670405',  posted_time: '2019-05-14 15:55:45'
            }, {
                canceled_time_unix: '0',  isLimitOrder: '200.760000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-09 15:55:01',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '19',  canceled_time: '',  symbol: 'SOXX',  name: 'ISHARES PHLX SEMICONDUCTOR ETF',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557431700',  trade_id_closing: '',  traded_price: '200.760000000',  action: 'BTO',  trade_id_opening: '123597947',  traded_time_unix: '1557431701',  signal_id: '123597791',  posted_time: '2019-05-09 15:55:00'
            }]}));
            fs.writeFileSync(retrieveSystemEquity, JSON.stringify({ok: '1', equity_data: [
                { strategy_with_cost: 34315, unix_timestamp: '1557764036', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36450 },
                { strategy_with_cost: 34272, unix_timestamp: '1557764809', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36407 },
                { strategy_with_cost: 34273, unix_timestamp: '1557764856', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36408 },
                { strategy_with_cost: 34385, unix_timestamp: '1557777325', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36520 },
                { strategy_with_cost: 34379, unix_timestamp: '1557783057', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557789755', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557796110', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557802398', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557808867', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557816061', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557821861', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557828350', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557834826', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557840580', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34415, unix_timestamp: '1557840630', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36550 },
                { strategy_with_cost: 34584, unix_timestamp: '1557844775', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36719 },
                { strategy_with_cost: 34652, unix_timestamp: '1557850459', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36787 },
                { strategy_with_cost: 34678, unix_timestamp: '1557856471', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36813 },
                { strategy_with_cost: 34603, unix_timestamp: '1557862333', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36738 },
                { strategy_with_cost: 34559, unix_timestamp: '1557863844', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36694 }
            ]}));
        });
        it("orders", async() => {
            return broker({asof: '2019-05-13T15:59:00-04:00', action: 'orders'})
              .should.eventually.be.like([{
                posted_at: '2019-05-13T15:55:00-04:00',
                asof: '2019-05-13T15:55:01-04:00',
                action: 'SELL',
                quant: '31',
                order_type: 'LMT',
                limit: 73.98,
                tif: 'DAY',
                status: 'filled',
                traded_price: '74.090000000',
                order_ref: '123652206',
                symbol: 'XLI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1
            }]);
        });
        it("positions", async() => {
            return broker({asof: '2019-05-14', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'XLP',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 158,
                traded_at: null,
                traded_price: null,
                price: 56.77,
                dividend: '0.00',
                mtm: -85.32,
                value: '8969.66'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'ITA',
                market: 'BATS',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 9,
                traded_at: null,
                traded_price: null,
                price: 201.93,
                dividend: '0.00',
                mtm: -54.36,
                value: '1817.37'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'VNQ',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 89,
                traded_at: null,
                traded_price: null,
                price: 86.769997,
                dividend: '0.00',
                mtm: -8.01,
                value: '7722.53'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'IHI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 28,
                traded_at: null,
                traded_price: null,
                price: 218.059998,
                dividend: '0.00',
                mtm: -129.08,
                value: '6105.68'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'XLU',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 132,
                traded_at: null,
                traded_price: null,
                price: 58.580002,
                dividend: '0.00',
                mtm: 81.84,
                value: '7732.56'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'SOXX',
                market: 'NASDAQ',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 19,
                traded_at: null,
                traded_price: null,
                price: 191.789993,
                dividend: '0.00',
                mtm: -178.79,
                value: '3644.01'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '2296.79',
                purchases: '0.00',
                symbol: 'XLI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'STC',
                quant: 31,
                position: 0,
                traded_at: '2019-05-13T15:55:01-04:00',
                traded_price: 74.09,
                price: 74.099998,
                dividend: '0.00',
                mtm: -67.58,
                value: '0.00'
            }]);
        });
        it("balance", async() => {
            return broker({asof: '2019-05-13T15:59:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2019-05-13T15:55:25-04:00',
                currency: 'USD',
                rate: '1.0',
                net: 36520
            }]);
        });
    });
    describe("range", function() {
        beforeEach(function() {
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ ok: '1', response: [{
                closeVWAP_timestamp: '1557342004',  strike: null,  fullSymbol: 'XLP',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1557342004',  currency: 'USD',  underlying: null,  closing_price_VWAP: '56.95000',  putcall: null,  openedWhenUnixTimeStamp: '1557335386',  quant_closed: '0',  markToMarket_time: '2019-05-08 15:00:04',  opening_price_VWAP: '56.88000',  trade_id: '123576928',  symbol: 'XLP',  quant_opened: '158',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '25',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-05-08 13:09:46',  long_or_short: 'long',  symbol_description: 'SPDR CONSUMER STAPLES SELECT',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: null,  strike: null,  fullSymbol: 'ITA',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: null,  currency: 'USD',  underlying: null,  closing_price_VWAP: '203.99',  putcall: null,  openedWhenUnixTimeStamp: '1557863745',  quant_closed: '0',  markToMarket_time: '',  opening_price_VWAP: '204.15',  trade_id: '123670407',  symbol: 'ITA',  quant_opened: '9',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '-1',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-05-14 15:55:45',  long_or_short: 'long',  symbol_description: 'I SHARES US AEROSPACE & DEFENSE',  exchange: 'BATS'
            }, {
                closeVWAP_timestamp: '1555606804',  strike: null,  fullSymbol: 'VNQ',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1555693204',  currency: 'USD',  underlying: null,  closing_price_VWAP: '85.48500',  putcall: null,  openedWhenUnixTimeStamp: '1555530901',  quant_closed: '0',  markToMarket_time: '2019-04-18 13:00:04',  opening_price_VWAP: '85.17522',  trade_id: '123349135',  symbol: 'VNQ',  quant_opened: '89',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '170',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-04-17 15:55:01',  long_or_short: 'long',  symbol_description: 'VANGUARD REAL ESTATE ETF',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1555520404',  strike: null,  fullSymbol: 'IHI',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1555606804',  currency: 'USD',  underlying: null,  closing_price_VWAP: '215.10940',  putcall: null,  openedWhenUnixTimeStamp: '1555444501',  quant_closed: '0',  markToMarket_time: '2019-04-17 13:00:04',  opening_price_VWAP: '218.19500',  trade_id: '123333337',  symbol: 'IHI',  quant_opened: '28',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '61',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-04-16 15:55:01',  long_or_short: 'long',  symbol_description: 'ISHARES DOW JONES US MEDICAL D',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1557863702',  strike: null,  fullSymbol: 'XLU',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1554750004',  currency: 'USD',  underlying: null,  closing_price_VWAP: '58.0238452830189',  putcall: null,  openedWhenUnixTimeStamp: '1551300901',  quant_closed: '27',  markToMarket_time: '2019-05-14 15:55:02',  opening_price_VWAP: '56.95021',  trade_id: '122723097',  symbol: 'XLU',  quant_opened: '159',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '142',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-02-27 15:55:01',  long_or_short: 'long',  symbol_description: 'UTILITIES SELECT SECTOR SPDR',  exchange: 'NYSE'
            }, {
                closeVWAP_timestamp: '1557507604',  strike: null,  fullSymbol: 'SOXX',  open_or_closed: 'open',  expir: null,  openVWAP_timestamp: '1557507604',  currency: 'USD',  underlying: null,  closing_price_VWAP: '198.94000',  putcall: null,  openedWhenUnixTimeStamp: '1557431701',  quant_closed: '0',  markToMarket_time: '2019-05-10 13:00:04',  opening_price_VWAP: '200.76000',  trade_id: '123597947',  symbol: 'SOXX',  quant_opened: '19',  closedWhen: '',  instrument: 'stock',  ptValue: '1',  PL: '-86',  closedWhenUnixTimeStamp: '',  currencyMultiplierUSD: 1,  openedWhen: '2019-05-09 15:55:01',  long_or_short: 'long',  symbol_description: 'ISHARES PHLX SEMICONDUCTOR ETF',  exchange: 'NASDAQ'
            }]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ ok: '1', response: [{
                canceled_time_unix: '0',  isLimitOrder: '73.980000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-13 15:55:01',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '31',  canceled_time: '',  symbol: 'XLI',  name: 'INDUSTRIAL SELECT SECTOR SPDR',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557777300',  trade_id_closing: '123579027',  traded_price: '74.090000000',  action: 'STC',  trade_id_opening: '',  traded_time_unix: '1557777301',  signal_id: '123652206',  posted_time: '2019-05-13 15:55:00'
            }, {
                canceled_time_unix: '0',  isLimitOrder: '75.800000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-09 15:55:01',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '51',  canceled_time: '',  symbol: 'XLI',  name: 'INDUSTRIAL SELECT SECTOR SPDR',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557431700',  trade_id_closing: '123579027',  traded_price: '75.910000000',  action: 'STC',  trade_id_opening: '',  traded_time_unix: '1557431701',  signal_id: '123597789',  posted_time: '2019-05-09 15:55:00'
            }, {
                canceled_time_unix: '0',  isLimitOrder: '204.200000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-14 15:55:45',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '9',  canceled_time: '',  symbol: 'ITA',  name: 'I SHARES US AEROSPACE & DEFENSE',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557863745',  trade_id_closing: '',  traded_price: '204.150000000',  action: 'BTO',  trade_id_opening: '123670407',  traded_time_unix: '1557863745',  signal_id: '123670405',  posted_time: '2019-05-14 15:55:45'
            }, {
                canceled_time_unix: '0',  isLimitOrder: '200.760000000',  strike: null,  status: 'traded',  expired_time_unix: '0',  traded_time: '2019-05-09 15:55:01',  expired_time: '0',  underlying: null,  isMarketOrder: '0',  putcall: null,  tif: 'DAY',  expiration: null,  quant: '19',  canceled_time: '',  symbol: 'SOXX',  name: 'ISHARES PHLX SEMICONDUCTOR ETF',  instrument: 'stock',  isStopOrder: '0',  posted_time_unix: '1557431700',  trade_id_closing: '',  traded_price: '200.760000000',  action: 'BTO',  trade_id_opening: '123597947',  traded_time_unix: '1557431701',  signal_id: '123597791',  posted_time: '2019-05-09 15:55:00'
            }]}));
            fs.writeFileSync(retrieveSystemEquity, JSON.stringify({ok: '1', equity_data: [
                { strategy_with_cost: 34315, unix_timestamp: '1557764036', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36450 },
                { strategy_with_cost: 34272, unix_timestamp: '1557764809', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36407 },
                { strategy_with_cost: 34273, unix_timestamp: '1557764856', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36408 },
                { strategy_with_cost: 34385, unix_timestamp: '1557777325', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36520 },
                { strategy_with_cost: 34379, unix_timestamp: '1557783057', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557789755', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557796110', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557802398', index_price: '2811.87', YYYYMMDD: '20190513', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557808867', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557816061', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557821861', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557828350', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557834826', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34379, unix_timestamp: '1557840580', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36514 },
                { strategy_with_cost: 34415, unix_timestamp: '1557840630', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36550 },
                { strategy_with_cost: 34584, unix_timestamp: '1557844775', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36719 },
                { strategy_with_cost: 34652, unix_timestamp: '1557850459', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36787 },
                { strategy_with_cost: 34678, unix_timestamp: '1557856471', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36813 },
                { strategy_with_cost: 34603, unix_timestamp: '1557862333', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36738 },
                { strategy_with_cost: 34559, unix_timestamp: '1557863844', index_price: '2844.61', YYYYMMDD: '20190514', strategy_raw: 36694 }
            ]}));
        });
        it("orders", async() => {
            return broker({begin: '2019-05-13', asof: '2019-05-14T15:59:00-04:00', action: 'orders'})
              .should.eventually.be.like([{
                posted_at: '2019-05-13T15:55:00-04:00',
                asof: '2019-05-13T15:55:01-04:00',
                action: 'SELL',
                quant: '31',
                order_type: 'LMT',
                limit: 73.98,
                tif: 'DAY',
                status: 'filled',
                traded_price: '74.090000000',
                order_ref: '123652206',
                symbol: 'XLI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1
            }, {
                posted_at: '2019-05-14T15:55:45-04:00',
                asof: '2019-05-14T15:55:45-04:00',
                action: 'BUY',
                quant: '9',
                order_type: 'LMT',
                limit: 204.2,
                tif: 'DAY',
                status: 'filled',
                traded_price: '204.150000000',
                order_ref: '123670405',
                symbol: 'ITA',
                market: 'BATS',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1
            }]);
        });
        it("positions", async() => {
            return broker({begin: '2019-05-13', asof: '2019-05-14T16:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'XLP',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 158,
                traded_at: null,
                traded_price: null,
                price: 56.77,
                dividend: '0.00',
                mtm: -85.32,
                value: '8969.66'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'VNQ',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 89,
                traded_at: null,
                traded_price: null,
                price: 86.769997,
                dividend: '0.00',
                mtm: -8.01,
                value: '7722.53'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'IHI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 28,
                traded_at: null,
                traded_price: null,
                price: 218.059998,
                dividend: '0.00',
                mtm: -129.08,
                value: '6105.68'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'XLU',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 132,
                traded_at: null,
                traded_price: null,
                price: 58.580002,
                dividend: '0.00',
                mtm: 81.84,
                value: '7732.56'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'SOXX',
                market: 'NASDAQ',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 19,
                traded_at: null,
                traded_price: null,
                price: 191.789993,
                dividend: '0.00',
                mtm: -178.79,
                value: '3644.01'
            }, {
                asof: '2019-05-13T16:00:00-04:00',
                sales: '2296.79',
                purchases: '0.00',
                symbol: 'XLI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'STC',
                quant: 31,
                position: 0,
                traded_at: '2019-05-13T15:55:01-04:00',
                traded_price: 74.09,
                price: 74.099998,
                dividend: '0.00',
                mtm: -67.58,
                value: '0.00'
            }, {
                asof: '2019-05-14T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'XLP',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 158,
                traded_at: null,
                traded_price: null,
                price: 57.040001,
                dividend: '0.00',
                mtm: 42.66,
                value: '9012.32'
            }, {
                asof: '2019-05-14T16:00:00-04:00',
                sales: '0',
                purchases: '1837.35',
                symbol: 'ITA',
                market: 'BATS',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'BTO',
                quant: 9,
                position: 9,
                traded_at: '2019-05-14T15:55:45-04:00',
                traded_price: 204.15,
                price: 203.99,
                dividend: '0.00',
                mtm: -1.44,
                value: '1835.91'
            }, {
                asof: '2019-05-14T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'VNQ',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 89,
                traded_at: null,
                traded_price: null,
                price: 87.089996,
                dividend: '0.00',
                mtm: 28.48,
                value: '7751.01'
            }, {
                asof: '2019-05-14T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'IHI',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 28,
                traded_at: null,
                traded_price: null,
                price: 220.360001,
                dividend: '0.00',
                mtm: 64.4,
                value: '6170.08'
            }, {
                asof: '2019-05-14T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'XLU',
                market: 'ARCA',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 132,
                traded_at: null,
                traded_price: null,
                price: 58.189999,
                dividend: '0.00',
                mtm: -51.48,
                value: '7681.08'
            }, {
                asof: '2019-05-14T16:00:00-04:00',
                sales: '0',
                purchases: '0.00',
                symbol: 'SOXX',
                market: 'NASDAQ',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1,
                action: 'LONG',
                quant: null,
                position: 19,
                traded_at: null,
                traded_price: null,
                price: 196.210007,
                dividend: '0.00',
                mtm: 83.98,
                value: '3727.99'
            }]);
        });
        it("balance", async() => {
            return broker({begin: '2019-05-14', asof: '2019-05-14T15:59:00-04:00', action: 'balances'})
              .then(d=>[_.first(d), _.last(d)])
              .should.eventually.be.like([{
                asof: '2019-05-14T00:41:07-04:00',
                currency: 'USD',
                rate: '1.0',
                net: 36514
            }, {
                asof: '2019-05-14T15:57:24-04:00',
                currency: 'USD',
                rate: '1.0',
                net: 36694
            }]);
        });
    });
    describe("attached", function() {
        it("MSF working BTCBTO stop and reverse", async() => {
            fs.writeFileSync(requestTradesOpen, JSON.stringify({ok: '1',response: [{
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
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[{
                signal_id: 'xxx',
                action: 'BTC',
                duration: 'GTC',
                status: 'working',
                isStopOrder: 1.023,
                posted_time_unix: '1532385924',
                parkUntilSecs: 1532120100,
                quant: 1,
                signalid: 12240489,
                stop: 1.023,
                fullSymbol: '@MSFU18',
                symbol: '@MSFU8',
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
                fullSymbol: '@MSFU18',
                symbol: '@MSFU8',
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
                fullSymbol: '@MSFU18',
                symbol: '@MSFU8',
                name: '',
                instrument: 'future',
                isStopOrder: '0',
                posted_time_unix: '1532385924',
                isOrderParked: '0',
                action: 'BTO',
                signal_id: '119080352',
                posted_time: '2018-07-23 18:45:24'
            }]}));
            await broker({asof: '2018-07-23T18:45:24-04:00', action: 'orders'})
              .should.eventually.be.like([{
                posted_at: '2018-07-23T18:45:24-04:00',
                asof: '2018-07-23T18:45:24-04:00',
                action: 'BUY',
                quant: 1,
                order_type: 'STP',
                stop: 1.023,
                tif: 'GTC',
                status: 'working',
                order_ref: 'xxx',
                symbol: 'MSFU18',
                market: 'CME',
                currency: 'USD',
                security_type: 'FUT',
                multiplier: 1
            }, {
                posted_at: '2018-07-23T18:45:24-04:00',
                asof: '2018-07-23T18:45:24-04:00',
                action: 'BUY',
                quant: '1',
                order_type: 'LMT',
                limit: 1.0118,
                tif: 'DAY',
                status: 'working',
                order_ref: '119080350',
                symbol: 'MSFU18',
                market: 'CME',
                currency: 'USD',
                security_type: 'FUT',
                multiplier: 1
            }, {
                posted_at: '2018-07-23T18:45:24-04:00',
                asof: '2018-07-23T18:45:24-04:00',
                action: 'BUY',
                quant: '1',
                order_type: 'LMT',
                limit: 1.0118,
                tif: 'DAY',
                status: 'pending',
                order_ref: '119080352',
                attach_ref: '119080350',
                symbol: 'MSFU18',
                market: 'CME',
                currency: 'USD',
                security_type: 'FUT',
                multiplier: 1
            }]);
        });
        it("Order not filled with stoploss", async() => {
            fs.writeFileSync(submitSignal, JSON.stringify({}));
            fs.writeFileSync(requestTrades, JSON.stringify({ok:1,response:[]}));
            fs.writeFileSync(retrieveSignalsAll, JSON.stringify({ok:1,response:[{
                status: 'working',
                posted_time_unix: '1532385924',
                signal_id: "94974798",
                action: 'BTO',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                limit: 130,
                duration: 'GTC'
            }, {
                status: 'working',
                posted_time_unix: '1532385924',
                signal_id: "94974799",
                action: 'STC',
                quant: 2,
                symbol: 'IBM',
                typeofsymbol: 'stock',
                market: 0,
                isStopOrder: 120,
                duration: 'GTC'
            }]}));
            await broker({asof: '2018-07-23T18:45:24-04:00', action: 'orders'})
              .should.eventually.be.like([{
                posted_at: '2018-07-23T18:45:24-04:00',
                asof: '2018-07-23T18:45:24-04:00',
                action: 'BUY',
                quant: 2,
                order_type: 'LMT',
                limit: 130,
                tif: 'GTC',
                status: 'working',
                order_ref: '94974798',
                symbol: 'IBM',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1
            }, {
                posted_at: '2018-07-23T18:45:24-04:00',
                asof: '2018-07-23T18:45:24-04:00',
                action: 'SELL',
                quant: 2,
                order_type: 'STP',
                stop: 120,
                tif: 'GTC',
                status: 'pending',
                order_ref: '94974799',
                attach_ref: '94974798',
                symbol: 'IBM',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK',
                multiplier: 1
            }]);
        });
    });
});
