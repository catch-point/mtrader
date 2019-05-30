// broker-simulation.spec.js
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
const Broker = require('../src/broker-simulation.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("broker-simulation", function() {
    this.timeout(60000);
    var fetch, quote, collect, broker;
    before(function() {
        config('workers', 0);
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', createTempDir('simulation'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        fetch = new Fetch();
        quote = new Quote(fetch);
        collect = new Collect(quote);
        broker = new Broker({simulation: 'test', ...config()});
    });
    beforeEach(async() => {
        await broker({action: 'reset'});
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
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'orders'}).should.eventually.be.like([]);
        });
        
        it("no positions", async() => {
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'positions'}).should.eventually.be.like([]);
        });
        it("no balance", async() => {
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'}).should.eventually.be.like([]);
        });
    });
    describe("deposits", function() {
        it("but no orders", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'orders'}).should.eventually.be.like([]);
        });
        it("but no positions", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'positions'}).should.eventually.be.like([]);
        });
        it("and cash balance", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'USD', rate: 1, net: 1000, settled: 1000
            }]);
        });
        it("and withdraw", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'withdraw', quant: 1000, currency: 'USD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'}).should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'USD', rate: 1, net: 0, settled: 0
            }]);
        });
        it("CAD USD", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'CAD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'USD', rate: 1.24646, net: 1000, settled: 1000
            }, {
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'CAD', rate: 1, net: 1000, settled: 1000
            }]);
        });
        it("CAD USD withdraw CAD", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'CAD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'withdraw', quant: 1000, currency: 'CAD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'}).should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'USD', rate: 1.24646, net: 1000, settled: 1000
            }, {
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'CAD', rate: 1, net: 0, settled: 0
            }]);
        });
        it("USD CAD", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'CAD'
            });
            return broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'}).should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'USD', rate: 1, net: 1000, settled: 1000
            }, {
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'CAD', rate: 0.802272, net: 1000, settled: 1000
            }]);
        });
    });
    describe("IBM orders", function() {
        it("BTO working", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00', currency: 'USD', secType: 'STK',
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MOC', tif: 'DAY'
            });
            await broker({asof: '2015-02-16T17:00:00-05:00', action: 'orders'}).should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00', currency: 'USD', secType: 'STK',
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MOC', tif: 'DAY',
                status: 'working'
            }]);
            await broker({asof: '2015-02-16T17:00:00-05:00', action: 'positions'}).should.eventually.be.like([]);
            await broker({asof: '2015-02-16T17:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-16T17:00:00-05:00',
                currency: 'USD', rate: 1, net: 1000, settled: 1000
            }]);
        });
        it("BTO filled", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00', currency: 'USD', secType: 'STK',
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MOC', tif: 'DAY'
            });
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MOC', tif: 'DAY',
                traded_price: 160.96, status: 'filled', currency: 'USD', secType: 'STK'
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BTO', quant: 2, symbol: 'IBM', market: 'NYSE',
                traded_price: 160.96, position: 2
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                currency: 'USD', rate: 1, net: 999, settled: (99900 - 2*16096)/100
            }]);
        });
    });
    describe("IBM long position", function() {
        it("IBM submit BTO signal", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-18',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({asof: '2015-02-18', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2015-02-18T00:00:00-05:00',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                status: 'working',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
        });
        it("IBM submit STC signal", async() => {
            await broker({
                asof: '2015-05-17',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-05-17',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({
                asof: '2015-06-17',
                action: 'SELL', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({asof: '2015-06-17', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2015-06-17T00:00:00-04:00',
                action: 'SELL', quant: 2, type: 'MOC', tif: 'DAY',
                status: 'working',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            await broker({asof: '2015-05-19', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-05-18T16:00:00-04:00',
                action: 'BTO', quant: 2, position: 2,
                traded_at: '2015-05-18T16:00:00-04:00',
                traded_price: '173.06', price: 173.06, value: 2*173.06,
                sales: 0, purchases: '346.12', commission: 1, mtm: -1, value: 2*173.06,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            await broker({asof: '2015-06-17T00:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-06-16T16:00:00-04:00',
                action: 'LONG', quant: 0, position: 2, mtm: 1.16, price: 166.84, value: 2*166.84,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            const net = (50000-17306+16684-50)*2;
            await broker({asof: '2015-06-17T00:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-06-16T16:00:00-04:00',
                currency: 'USD', rate: 1, net: net/100, settled: (net - 2*16684)/100
            }]);
        });
        it("IBM submit STC filled", async() => {
            await broker({
                asof: '2015-05-17',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-05-17',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({
                asof: '2015-06-17',
                action: 'SELL', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({asof: '2015-06-18', action: 'orders'})
              .should.eventually.be.like([]);
            await broker({asof: '2015-06-17T16:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-06-17T16:00:00-04:00',
                action: 'STC', quant: 2, position: 0,
                traded_at: '2015-06-17T16:00:00-04:00',
                traded_price: 167.17, price: 167.17, value: 0,
                sales: 2*167.17, purchases: 0, commission: 1, mtm: (16717-16684-50)*2/100, value: 0,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            const net = (50000-17306+16717-100)*2/100;
            await broker({asof: '2015-06-17T16:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-06-17T16:00:00-04:00',
                currency: 'USD', rate: 1, net, settled: net
            }]);
        });
        it("IBM cancel working signal", async() => {
            await broker({
                asof: '2015-05-17',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-05-17',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            const stc = await broker({
                asof: '2015-06-17',
                action: 'SELL', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({
                asof: '2015-06-17',
                action: 'cancel', order_ref: stc[0].order_ref
            });
            await broker({asof: '2015-06-18', action: 'orders'})
              .should.eventually.be.like([]);
            await broker({asof: '2015-06-17', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-06-16T16:00:00-04:00',
                action: 'LONG', quant: 0, position: 2, mtm: 1.16, price: 166.84, value: 2*166.84,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            const net = (50000-17306+16684-50)*2;
            await broker({asof: '2015-06-17', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-06-16T16:00:00-04:00',
                currency: 'USD', rate: 1, net: net/100, settled: (net - 2*16684)/100
            }]);
        });
        it("IBM update signal quant before posted", async() => {
            await broker({
                asof: '2015-05-17',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-05-17',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            const stc = await broker({
                asof: '2015-06-17',
                action: 'SELL', quant: 1, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({
                asof: '2015-06-17', order_ref: stc[0].order_ref,
                action: 'SELL', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({asof: '2015-06-17', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2015-06-17T00:00:00-04:00',
                action: 'SELL', quant: 2, type: 'MOC', tif: 'DAY',
                status: 'working',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            await broker({asof: '2015-05-19', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-05-18T16:00:00-04:00',
                action: 'BTO', quant: 2, position: 2,
                traded_at: '2015-05-18T16:00:00-04:00',
                traded_price: '173.06', price: 173.06, value: 2*173.06,
                sales: 0, purchases: '346.12', commission: 1, mtm: -1, value: 2*173.06,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            await broker({asof: '2015-06-17T00:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-06-16T16:00:00-04:00',
                action: 'LONG', quant: 0, position: 2, mtm: 1.16, price: 166.84, value: 2*166.84,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            const net = (50000-17306+16684-50)*2;
            await broker({asof: '2015-06-17T00:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-06-16T16:00:00-04:00',
                currency: 'USD', rate: 1, net: net/100, settled: (net - 2*16684)/100
            }]);
        });
        it("IBM increase quant after filled", async() => {
            await broker({
                asof: '2015-05-17',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-05-17',
                action: 'BUY', quant: 2, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({
                asof: '2015-06-17',
                action: 'SELL', quant: 1, type: 'MOO', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({
                asof: '2015-06-17T12:00:00',
                action: 'SELL', quant: 1, type: 'MOC', tif: 'DAY',
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            });
            await broker({asof: '2015-06-18', action: 'orders'})
              .should.eventually.be.like([]);
            await broker({asof: '2015-06-17T16:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-06-17T16:00:00-04:00',
                action: 'STC', quant: 2, position: 0,
                traded_at: '2015-06-17T16:00:00-04:00',
                traded_price: 167.085, price: 167.17, value: 0,
                sales: (16700+16717)/100, purchases: 0, commission: 2,
                mtm: (16700+16717-16684*2-200)/100, value: 0,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK'
            }]);
            const net = (100000-17306*2+16700+16717-300)/100;
            await broker({asof: '2015-06-17T16:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-06-17T16:00:00-04:00',
                currency: 'USD', rate: 1, net, settled: net
            }]);
        });
        it("IBM submit BTO limit signal", async() => {
            await broker({
                asof: '2015-02-16T17:00:00-05:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T17:00:00-05:00', currency: 'USD', secType: 'STK',
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'DAY',
                limit: 161.00
            });
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'DAY',
                traded_price: 161, status: 'filled', currency: 'USD', secType: 'STK', limit: 161.00
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BTO', quant: 2, symbol: 'IBM', market: 'NYSE',
                traded_price: 161, position: 2
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                currency: 'USD', rate: 1, net: 999, settled: (99900 - 2*16100)/100
            }]);
        });
    });
    describe("Gold positions", function() {
        it("GLD STO signal", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 10000, currency: 'USD'
            });
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'DAY'
            });
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-03T17:00:00-04:00',
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'DAY',
                status: 'working', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([]);
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-03T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 10000, settled: 10000
            }]);
        });
        it("GLD catch up on working BTCBTO signal", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 10000, currency: 'USD'
            });
            const orders = await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY',
                attached: [{
                    asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                    action: 'BUY', quant: 4, symbol: 'GCZ16', market: 'COMEX', type: 'LMT', tif: 'GTC',
                    limit: 120
                }]
            });
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-03T17:00:00-04:00',
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY',
                status: 'working', currency: 'USD', secType: 'FUT', multiplier: 100,
                order_ref: _.first(orders).order_ref
            }, {
                asof: '2016-10-03T17:00:00-04:00',
                action: 'BUY', quant: 4, symbol: 'GCZ16', market: 'COMEX', type: 'LMT', tif: 'GTC',
                status: 'pending', currency: 'USD', secType: 'FUT', multiplier: 100,
                attach_ref: _.first(orders).order_ref
            }]);
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([]);
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-03T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 10000, settled: 10000
            }]);
        });
        it("GLD BTO signal catchup", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 10000, currency: 'USD'
            });
            const order_ref = 'sell-gc';
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY',
                order_ref
            });
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 4, symbol: 'GCZ16', market: 'COMEX', type: 'LMT', tif: 'GTC',
                limit: 120,
                attach_ref: order_ref
            });
            await broker({asof: '2016-10-05', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'BUY', quant: 4, symbol: 'GCZ16', market: 'COMEX', type: 'LMT', tif: 'GTC',
                status: 'working', currency: 'USD', secType: 'FUT', multiplier: 100,
                limit: 120
            }]);
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'STO', quant: 2, position: -2,
                traded_at: '2016-10-04T17:00:00-04:00',
                traded_price: '1315', price: 1269.7,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: 2*131500-2*126970-4.10, value: -2*126970,
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 10000+2*131500-2*126970-4.10, settled: 10000+2*131500-2*126970-4.10
            }]);
        });
        it("GLD STO signal with working BTO signal", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 10000, currency: 'USD'
            });
            const order_ref = 'sell-gold';
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY',
                order_ref
            });
            await broker({
                asof: '2016-10-03T18:00:00-04:00',
                action: 'cancel', order_ref
            });
            await broker({
                asof: '2016-10-04T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'DAY'
            });
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'BUY', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'DAY',
                status: 'working', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([]);
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                currency: 'USD', rate: 1, net: 10000, settled: 10000
            }]);
        });
    });
    describe("StopLoss orders", function() {
        it("submit stoploss order", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 10000, currency: 'USD'
            });
            const order_ref = 'sell-gold';
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY',
                order_ref
            });
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 4, symbol: 'GCZ16', market: 'COMEX', type: 'STP', tif: 'GTC',
                stop: 120,
                attach_ref: order_ref
            });
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-03T17:00:00-04:00',
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY',
                status: 'working', currency: 'USD', secType: 'FUT', multiplier: 100,
                order_ref: order_ref
            }, {
                asof: '2016-10-03T17:00:00-04:00',
                action: 'BUY', quant: 4, symbol: 'GCZ16', market: 'COMEX', type: 'STP', tif: 'GTC',
                status: 'pending', currency: 'USD', secType: 'FUT', multiplier: 100,
                stop: 120,
                attach_ref: order_ref
            }]);
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([]);
            await broker({asof: '2016-10-03T17:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-03T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 10000, settled: 10000
            }]);
        });
        it("update stoploss order", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 100000, currency: 'USD'
            });
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY'
            });
            const stp = await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'STP', tif: 'GTC',
                stop: 1350
            });
            await broker({
                asof: '2016-10-04T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'STP', tif: 'GTC',
                stop: 1300,
                order_ref: stp[0].order_ref
            });
            await broker({asof: '2016-10-05', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'STP', tif: 'GTC',
                stop: 1300,
                order_ref: stp[0].order_ref
            }]);
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'BTO', quant: 2, position: 2,
                traded_at: '2016-10-04T17:00:00-04:00',
                traded_price: '1315', price: 1269.7,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: '-9064.10', value: '253940.00',
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-04T17:00:00-04:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 90935.9, settled: 90935.9
            }]);
        });
        it("Bracket Order", async() => {
            await broker({
                asof: '2015-02-16T16:00:00-04:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            const mkt = await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MOC', tif: 'DAY'
            });
            const stp = await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 160,
                attach_ref: mkt[0].order_ref
            });
            await broker({
                asof: '2015-02-16T16:00:00-05:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'GTC',
                limit: 170,
                attach_ref: mkt[0].order_ref
            });
            await broker({asof: '2015-02-18', action: 'orders'})
              .should.eventually.be.like([{
                currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 160,
                order_ref: stp[0].order_ref,
                status: 'working'
            }, {
                currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'GTC',
                limit: 170,
                attach_ref: mkt[0].order_ref,
                status: 'working'
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BTO', position: 2,
                price: 160.96,
                dividend: '0.00', commission: 1,
                mtm: -1, value: 2*16096/100,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK', multiplier: 1
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                currency: 'USD', rate: 1, net: 999, settled: (100000-2*16096-100)/100
            }]);
        });
        it("Cancel Bracket Order", async() => {
            await broker({
                asof: '2015-02-16T16:00:00-04:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            const mkt = await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MOC', tif: 'DAY'
            });
            const stp = await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 160,
                attach_ref: mkt[0].order_ref
            });
            await broker({
                asof: '2015-02-16T16:00:00-05:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'GTC',
                limit: 170,
                attach_ref: mkt[0].order_ref
            });
            await broker({asof: '2015-02-16T16:00:00-05:00', action: 'cancel', order_ref: mkt[0].order_ref});
            await broker({asof: '2015-02-18', action: 'orders'})
              .should.eventually.be.like([]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'positions'})
              .should.eventually.be.like([]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                currency: 'USD', rate: 1, net: 1000, settled: 1000
            }]);
        });
        it("OCA Order", async() => {
            await broker({
                asof: '2015-02-16T16:00:00-04:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MKT', tif: 'DAY'
            });
            const oca = await broker({
                asof: '2015-02-17T16:00:00-04:00',
                action: 'OCA',
                attached: [{
                    currency: 'USD', secType: 'STK', multiplier: 1,
                    action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                    stop: 150
                }, {
                    currency: 'USD', secType: 'STK', multiplier: 1,
                    action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'GTC',
                    limit: 170
                }]
            });
            await broker({asof: '2015-02-18', action: 'orders'})
              .should.eventually.be.like([{
                currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 150,
                attach_ref: oca[0].attach_ref,
                status: 'working'
            }, {
                currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'GTC',
                limit: 170,
                attach_ref: oca[0].attach_ref,
                status: 'working'
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BTO', position: 2,
                price: 160.96,
                dividend: '0.00', commission: 1,
                mtm: (2*16096-2*15975-100)/100, value: 2*16096/100,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK', multiplier: 1
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                currency: 'USD', rate: 1, net: (100000+2*16096-2*15975-100)/100, settled: (100000-2*15975-100)/100
            }]);
        });
        it("Order cancelled with stoploss", async() => {
            await broker({
                asof: '2015-02-16T16:00:00-04:00',
                action: 'deposit', quant: 1000, currency: 'USD'
            });
            const mkt = await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'MKT', tif: 'DAY'
            });
            const stp = await broker({
                asof: '2015-02-16T16:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 150,
                attach_ref: mkt[0].order_ref
            });
            const lmt = await broker({
                asof: '2015-02-16T16:00:00-05:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'LMT', tif: 'DAY',
                limit: 170,
                attach_ref: mkt[0].order_ref
            });
            await broker({
                asof: '2015-02-17T16:00:00-05:00',
                action: 'cancel',
                order_ref: lmt[0].order_ref
            });
            await broker({asof: '2015-02-18', action: 'orders'})
              .should.eventually.be.like([{
                currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 2, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 150,
                order_ref: stp[0].order_ref,
                status: 'working'
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                action: 'BTO', position: 2,
                price: 160.96,
                dividend: '0.00', commission: 1,
                mtm: (2*16096-2*15975-100)/100, value: 2*16096/100,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK', multiplier: 1
            }]);
            await broker({asof: '2015-02-17T16:00:00-05:00', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-02-17T16:00:00-05:00',
                currency: 'USD', rate: 1, net: (100000+2*16096-2*15975-100)/100, settled: (100000-2*15975-100)/100
            }]);
        });
        it("IBM submit BTO with stoploss and different quant", async() => {
            await broker({
                asof: '2015-05-18',
                action: 'deposit', quant: 10000, currency: 'USD'
            });
            const mkt = await broker({
                asof: '2015-05-18', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 100, symbol: 'IBM', market: 'NYSE', type: 'MKT', tif: 'DAY'
            });
            const stp = await broker({
                asof: '2015-05-18', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 100, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 120,
                attach_ref: mkt[0].order_ref
            });
            await broker({
                asof: '2015-05-19', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 50, symbol: 'IBM', market: 'NYSE', type: 'MKT', tif: 'DAY'
            });
            await broker({asof: '2015-05-19', action: 'orders'})
              .should.eventually.be.like([{
                currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'SELL', quant: 100, symbol: 'IBM', market: 'NYSE', type: 'STP', tif: 'GTC',
                stop: 120,
                order_ref: stp[0].order_ref,
                status: 'working'
            }, {
                posted_at: '2015-05-19T00:00:00-04:00', currency: 'USD', secType: 'STK', multiplier: 1,
                action: 'BUY', quant: 50, symbol: 'IBM', market: 'NYSE', type: 'MKT', tif: 'DAY',
                status: 'working'
            }]);
            await broker({asof: '2015-05-19', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2015-05-18T16:00:00-04:00',
                action: 'BTO', position: 100,
                traded_price: 173.44, price: 173.06,
                dividend: '0.00', commission: 1,
                mtm: (100*17306-100*17344-100)/100, value: 100*17306/100,
                symbol: 'IBM', market: 'NYSE', currency: 'USD', secType: 'STK', multiplier: 1
            }]);
            await broker({asof: '2015-05-19', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2015-05-18T16:00:00-04:00',
                currency: 'USD', rate: 1, net: (1000000+100*17306-100*17344-100)/100, settled: (1000000-100*17344-100)/100
            }]);
        });
        it("GLD STCSTO with STC", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 100000, currency: 'USD'
            });
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY'
            });
            const sell = await broker({
                asof: '2016-10-05', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'GTC'
            });
            await broker({
                asof: '2016-10-05', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOO', tif: 'GTC',
                attach_ref: sell[0].order_ref
            });
            // first day
            await broker({asof: '2016-10-05', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-05T00:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'GTC',
                order_ref: sell[0].order_ref
            }, {
                asof: '2016-10-05T00:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOO', tif: 'GTC',
                attach_ref: sell[0].order_ref
            }]);
            await broker({asof: '2016-10-05', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'BTO', quant: 2, position: 2,
                traded_at: '2016-10-04T17:00:00-04:00',
                traded_price: '1315', price: 1269.7,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: '-9064.10', value: '253940.00',
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-05', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 90935.9, settled: 90935.9
            }]);
            // second day
            await broker({asof: '2016-10-06', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-05T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOO', tif: 'GTC',
                attach_ref: sell[0].order_ref
            }]);
            await broker({asof: '2016-10-06', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2016-10-05T17:00:00-04:00',
                action: 'STC', quant: 2, position: 0,
                traded_at: '2016-10-05T17:00:00-04:00',
                traded_price: '1268.6', price: 1268.6,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: '-224.10', value: '0.00',
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-06', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-05T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 90711.8, settled: 90711.8
            }]);
            // both days
            await broker({begin: '2016-10-04', asof: '2016-10-06', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY'
            }, {
                asof: '2016-10-05T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOC', tif: 'GTC',
                order_ref: sell[0].order_ref
            }, {
                asof: '2016-10-05T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MOO', tif: 'GTC',
                attach_ref: sell[0].order_ref
            }]);
            await broker({begin: '2016-10-04', asof: '2016-10-06', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'BTO', quant: 2, position: 2,
                traded_at: '2016-10-04T17:00:00-04:00',
                traded_price: '1315', price: 1269.7,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: '-9064.10', value: '253940.00',
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }, {
                asof: '2016-10-05T17:00:00-04:00',
                action: 'STC', quant: 2, position: 0,
                traded_at: '2016-10-05T17:00:00-04:00',
                traded_price: '1268.6', price: 1268.6,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: '-224.10', value: '0.00',
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({begin: '2016-10-04', asof: '2016-10-06', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 90935.9, settled: 90935.9
            }, {
                asof: '2016-10-05T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 90711.8, settled: 90711.8
            }]);
        });
        it("GLD STCSTO with wrong STC", async() => {
            await broker({
                asof: '2016-10-03T17:00:00-04:00',
                action: 'deposit', quant: 100000, currency: 'USD'
            });
            await broker({
                asof: '2016-10-03T17:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'BUY', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'DAY'
            });
            const sell = await broker({
                asof: '2016-10-05', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 1, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'GTC'
            });
            await broker({
                asof: '2016-10-05', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'GTC',
                order_ref: sell[0].order_ref
            });
            await broker({asof: '2016-10-05', action: 'orders'})
              .should.eventually.be.like([{
                asof: '2016-10-05T00:00:00-04:00', currency: 'USD', secType: 'FUT', multiplier: 100,
                action: 'SELL', quant: 2, symbol: 'GCZ16', market: 'COMEX', type: 'MKT', tif: 'GTC',
                order_ref: sell[0].order_ref
            }]);
            await broker({asof: '2016-10-05', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                action: 'BTO', quant: 2, position: 2,
                traded_at: '2016-10-04T17:00:00-04:00',
                traded_price: '1315', price: 1269.7,
                sales: 0, purchases: 0, dividend: '0.00', commission: '4.10',
                mtm: '-9064.10', value: '253940.00',
                symbol: 'GCZ16', market: 'COMEX', currency: 'USD', secType: 'FUT', multiplier: 100
            }]);
            await broker({asof: '2016-10-05', action: 'balances'})
              .should.eventually.be.like([{
                asof: '2016-10-04T17:00:00-04:00',
                currency: 'USD', rate: 1, net: 90935.9, settled: 90935.9
            }]);
        });
    });
    describe("Combo orders", function() {
        it("create option spread", async() => {
            await broker({
                asof: '2019-05-28',
                action: 'deposit', quant: 100000, currency: 'USD'
            });
            const spread = await broker({
                asof: '2019-05-28',
                action: 'BUY', quant: 1, type: 'MKT', limit: '', tif: 'DAY',
                attached: [{
                    action: 'SELL', quant: 1, type: 'LEG',
                    symbol: 'SPX   190719P02400000', market: 'OPRA',
                    currency: 'USD', secType: 'OPT', multiplier: 100
                }, {
                    action: 'BUY', quant: 1, type: 'LEG',
                    symbol: 'SPX   190719P02450000', market: 'OPRA',
                    currency: 'USD', secType: 'OPT', multiplier: 100
                }]
            });
            spread.should.be.like([{
                order_ref: spread[0].order_ref,
                action: 'BUY', quant: 1, type: 'MKT', limit: '', tif: 'DAY',
            }, {
                attach_ref: spread[0].order_ref,
                action: 'SELL', quant: 1, type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', secType: 'OPT', multiplier: 100
            }, {
                attach_ref: spread[0].order_ref,
                action: 'BUY', quant: 1, type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', secType: 'OPT', multiplier: 100
            }]);
        });
        it("cancel option spread", async() => {
            await broker({
                asof: '2019-05-28',
                action: 'deposit', quant: 100000, currency: 'USD'
            });
            const spread = await broker({
                asof: '2019-05-28',
                action: 'BUY', quant: 1, type: 'MKT', limit: '', tif: 'DAY',
                attached: [{
                    action: 'SELL', quant: 1, type: 'LEG',
                    symbol: 'SPX   190719P02400000', market: 'OPRA',
                    currency: 'USD', secType: 'OPT', multiplier: 100
                }, {
                    action: 'BUY', quant: 1, type: 'LEG',
                    symbol: 'SPX   190719P02450000', market: 'OPRA',
                    currency: 'USD', secType: 'OPT', multiplier: 100
                }]
            });
            await broker({asof: '2019-05-28', action: 'cancel', order_ref: spread[1].order_ref});
            await broker({asof: '2019-05-28', action: 'cancel', order_ref: spread[2].order_ref});
            await broker({asof: '2019-05-28', action: 'orders'})
              .should.eventually.be.like([{
                status: 'cancelled',
                action: 'SELL', quant: 1, type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', secType: 'OPT', multiplier: 100
            }, {
                status: 'cancelled',
                action: 'BUY', quant: 1, type: 'MKT', limit: '', tif: 'DAY',
            }, {
                status: 'cancelled',
                action: 'BUY', quant: 1, type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', secType: 'OPT', multiplier: 100
            }]);
        });
        it("fill option spread", async() => {
            await broker({
                asof: '2019-05-28',
                action: 'deposit', quant: 100000, currency: 'USD'
            });
            const spread = await broker({
                asof: '2019-05-28',
                action: 'BUY', quant: 1, type: 'MKT', limit: '', tif: 'DAY',
                attached: [{
                    action: 'SELL', quant: 1, type: 'LEG',
                    symbol: 'SPX   190719P02400000', market: 'OPRA',
                    currency: 'USD', secType: 'OPT', multiplier: 100
                }, {
                    action: 'BUY', quant: 1, type: 'LEG',
                    symbol: 'SPX   190719P02450000', market: 'OPRA',
                    currency: 'USD', secType: 'OPT', multiplier: 100
                }]
            });
            await broker({asof: '2019-05-28T16:15:00-04:00', action: 'positions'})
              .should.eventually.be.like([{
                asof: '2019-05-28T16:15:00-04:00',
                action: 'STO',
                quant: 1,
                position: -1,
                traded_at: '2019-05-28T16:15:00-04:00',
                traded_price: '3.7',
                price: 4.65,
                sales: '370.00',
                purchases: '0.00',
                dividend: '0.00',
                commission: '1.00',
                mtm: '-96.00',
                value: '-465.00',
                symbol: 'SPX   190719P02400000',
                market: 'OPRA',
                currency: 'USD',
                secType: 'OPT',
                multiplier: 100
            }, {
                asof: '2019-05-28T16:15:00-04:00',
                action: 'BTO',
                quant: 1,
                position: 1,
                traded_at: '2019-05-28T16:15:00-04:00',
                traded_price: '5.03',
                price: 6.44,
                sales: '0.00',
                purchases: '503.00',
                dividend: '0.00',
                commission: '1.00',
                mtm: '140.00',
                value: '644.00',
                symbol: 'SPX   190719P02450000',
                market: 'OPRA',
                currency: 'USD',
                secType: 'OPT',
                multiplier: 100
            }]);
        });
    });
});
