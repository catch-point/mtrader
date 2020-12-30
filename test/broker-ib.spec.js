// broker-ib.spec.js
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

const util = require('util');
const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const beautify = require('js-beautify');
const like = require('./should-be-like.js');
const Snapshot = require('./snapshot.js');
const config = require('../src/config.js');
const IB = require('../src/ib-client.js');
const Broker = require('../src/broker-ib.js');
const createTempDir = require('./create-temp-dir.js');
const expect = require('chai').use(like).expect;

describe("broker-ib", function() {
    this.timeout(120000);
    var client, ib;
    const settings = {
        account: 'test',
        fetch: {
            files: {
                enabled: true,
                dirname: path.resolve(__dirname, 'data')
            }
        }
    };
    before(async function() {
        ib = await IB().catch(err => {
            return null;
        });
    });
    beforeEach(async() => {
        if (ib) client = new Snapshot(ib);
    });
    afterEach(async() => {
        if (client) {
            const code = beautify(util.inspect(client, {depth: Infinity}), {brace_style: 'none,preserve-inline'});
            if (!code.match(/^\s*{\s*}\s*$/)) console.log(code);
        }
    });
    after(function() {
        if (ib) return ib.close();
    });
    before(function() {
        config('runInBand', true);
        config('prefix', createTempDir('broker-ib'));
    });
    after(function() {
        config.unset('runInBand');
        config.unset('prefix');
    });
    it("should list balances", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          reqAccountHistory: () => Promise.resolve([]),
          reqAccountUpdate: () => Promise.resolve({ time: '20190601 10:48:00',
             Currency: [ 'BASE', 'CAD', 'USD', 'BASE' ],
             ExchangeRate: { CAD: '1.00', USD: '1.3516001' },
             NetLiquidationByCurrency: { CAD: '36908.0005', USD: '26159.30' },
             CashBalance: { CAD: '6713.77', USD: '1777.70' },
             AccruedCash: { CAD: '0.00', USD: '0.00' },
             AccruedDividend: { CAD: '142.66' },
             FuturesPNL: { CAD: '0.00', USD: '0.00' },
             RealizedPnL: { CAD: '0.00', USD: '0.00' },
             UnrealizedPnL: { CAD: '1312.16', USD: '-223.15' },
             TotalCashValue: { CAD: '9116.51' },
             BuyingPower: { CAD: '9116.51' } }),
          close: () => Promise.resolve()
        });
        await broker({action: 'balances'}).should.eventually.be.like([ { asof: '2019-06-01T10:48:00-04:00',
            acctNumber: 'test',
            currency: 'CAD',
            rate: '1.00',
            net: '36908.0005',
            settled: '6713.77',
            accrued: '142.66',
            realized: '0.00',
            unrealized: '1312.16',
            margin: null },
          { asof: '2019-06-01T10:48:00-04:00',
            acctNumber: 'test',
            currency: 'USD',
            rate: '1.3516001',
            net: '26159.30',
            settled: '1777.7',
            accrued: '0',
            realized: '0.00',
            unrealized: '-223.15',
            margin: null } ]);
        await broker.close();
    });
    it("should list positions", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
            reqPositionsMulti: () => Promise.resolve({ test: {
                '4215235': { position: 64 }
            } }),
          reqExecutions: () => Promise.resolve([]),
          reqContract: (arg) => {switch(arg) {
            case 4215235: return Promise.resolve({ secType: 'STK',
                 localSymbol: 'XLU',
                 exchange: 'NYSE',
                 currency: 'USD',
                 multiplier: '' })
            }},
          reqContractDetails: (arg) => {switch(arg.conid) {
            case 4215235: return Promise.resolve({ secType: 'STK',
                 localSymbol: 'XLU',
                 exchange: 'NYSE',
                 currency: 'USD',
                 multiplier: '' })
            }},
          close: () => Promise.resolve()
        });
        await broker({action: 'positions', now: '2019-05-18'})
          .should.eventually.be.like([ {
            asof: '2019-05-17T16:00:00-04:00',
            acctNumber: 'test',
            sales: '0.00',
            purchases: '0.00',
            symbol: 'XLU',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: '',
            action: 'LONG',
            quant: null,
            position: 64,
            traded_at: null,
            traded_price: null,
            price: 58.78,
            dividend: '0.00',
            commission: '0.00',
            mtm: 19.2,
            value: '3761.92' } ]);
        await broker.close();
    });
    it("should list open orders", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          reqOpenOrders: () => Promise.resolve([ { posted_time: '20190601 14:48:27',
            faGroup: '',
            faProfile: '',
            account: 'test',
            secType: 'STK',
            localSymbol: 'SPY',
            exchange: 'SMART',
            currency: 'USD',
            conid: 756733,
            status: 'PreSubmitted',
            time: '20190601 14:48:27',
            action: 'BUY',
            totalQuantity: 1,
            algoStrategy: '',
            orderType: 'LMT',
            lmtPrice: 270,
            auxPrice: null,
            tif: 'DAY',
            avgFillPrice: 0,
            orderRef: 'LMT.5ef8dbb8.1',
            parentId: 0,
            remaining: 1,
            ocaGroup: ''
            } ]),
          reqContract: (...args) => {expect(args).to.be.like([ 756733 ]);
          return Promise.resolve({ secType: 'STK',
             localSymbol: 'SPY',
             exchange: 'SMART',
             currency: 'USD',
             conid: 756733,
             multiplier: '' });},
          reqContractDetails: (...args) => {expect(args).to.be.like([ { conid: 756733 } ]);
          return Promise.resolve([ { contract: { exchange: 'SMART',
                  currency: 'USD',
                  secType: 'STK',
                  primaryExch: 'NYSE' } } ]);},
          close: () => Promise.resolve() });
        await broker({action: 'orders'}).should.eventually.be.like([ { posted_at: '2019-06-01T14:48:27-04:00',
            asof: '2019-06-01T14:48:27-04:00',
            traded_at: null,
            action: 'BUY',
            quant: 1,
            order_type: 'LMT',
            limit: 270,
            stop: null,
            offset: null,
            tif: 'DAY',
            status: 'working',
            traded_price: null,
            order_ref: 'LMT.5ef8dbb8.1',
            attach_ref: undefined,
            account: 'test',
            symbol: 'SPY',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            attach_ref: '' } ]);
        await broker.close();
    });
    it("should submit order", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
          reqId: cb => cb(1),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 1,
             { localSymbol: 'SPY',
               secType: 'STK',
               primaryExch: 'NYSE',
               exchange: 'SMART',
               currency: 'USD' },
             { action: 'BUY',
               totalQuantity: 1,
               orderType: 'LMT',
               lmtPrice: 270,
               tif: 'DAY',
               account: 'test',
               orderId: 1,
               ocaType: 0,
               smartComboRoutingParams: [] } ]);
           return Promise.resolve({ status: 'ApiPending',
             localSymbol: 'SPY',
             secType: 'STK',
             primaryExch: 'NYSE',
             exchange: 'SMART',
             currency: 'USD',
             action: 'BUY',
             totalQuantity: 1,
             orderType: 'LMT',
             lmtPrice: 270,
             tif: 'DAY',
             account: 'test' });},
          close: () => Promise.resolve() });
        const order = await broker({action: 'BUY', quant: 1, limit: 270, order_type: 'LMT', tif: 'DAY', symbol: 'SPY', market: 'NYSE'})
          .should.eventually.be.like([ {
            status: 'pending',
            symbol: 'SPY',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK' } ]);
        await broker.close();
    });
    it("should submit attached order", async() => {
        const broker = await Broker(settings, {
              async open() { return this; },
              reqId: cb => cb(1),
              reqManagedAccts: () => Promise.resolve([ 'test' ]),
              requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
              placeOrder: (()=>{let count=0;return(...args) => {switch(count++) {
            case 0: expect(args).to.be.like([ 1,
                 { localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD' },
                 { action: 'BUY',
                   totalQuantity: 1,
                   orderType: 'LMT',
                   lmtPrice: 270,
                   auxPrice: undefined,
                   tif: 'DAY',
                   orderRef: args[2].orderRef,
                   account: 'test',
                   orderId: 1,
                   parentId: null,
                   ocaGroup: null,
                   ocaType: 0,
                   smartComboRoutingParams: [] } ]);
                 return Promise.resolve({ status: 'ApiPending',
                   localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD',
                 orderId: 1,
                 action: 'BUY',
                 totalQuantity: 1,
                 orderType: 'LMT',
                 lmtPrice: 270,
                 tif: 'DAY',
                 orderRef: args[2].orderRef,
                 account: 'test' })
            case 1: expect(args).to.be.like([ 1,
                 { localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD' },
                 { action: 'SELL',
                   totalQuantity: 1,
                   orderType: 'STP',
                   lmtPrice: undefined,
                   auxPrice: 260,
                   tif: 'DAY',
                   orderRef: args[2].orderRef,
                   account: 'test',
                   orderId: 1,
                   parentId: 1,
                   ocaGroup: null,
                   ocaType: 0,
                   smartComboRoutingParams: [] } ]);
                 return Promise.resolve({ status: 'ApiPending',
                   localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD',
                 action: 'SELL',
                 totalQuantity: 1,
                 orderType: 'STP',
                 auxPrice: 260,
                 tif: 'DAY',
                 orderRef: args[2].orderRef,
                 account: 'test' })
            default: throw Error("Too many times")
            }}})(),
              close: () => Promise.resolve() });
        const orders = await broker({
            action: 'BUY', quant: 1, limit: 270, order_type: 'LMT', tif: 'DAY', symbol: 'SPY', market: 'NYSE',
            attached:[{
                action: 'SELL', quant: 1, order_type: 'STP', stop: 260, tif: 'DAY', symbol: 'SPY', market: 'NYSE'
            }]
        });
        orders.should.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'LMT',
            limit: 270,
            stop: undefined,
            offset: undefined,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: orders[0].order_ref,
            attach_ref: undefined,
            account: 'test',
            symbol: 'SPY',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'STP',
            limit: undefined,
            stop: 260,
            offset: null,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            attach_ref: orders[0].order_ref,
            account: 'test',
            symbol: 'SPY',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should submit to attach an order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqRecentOrders: () => Promise.resolve([ { orderRef: 'LMT.32f027a8.1', orderId: 1 }, {} ]),
            reqId: cb => cb(3),
            reqManagedAccts: () => Promise.resolve([ 'test' ]),
            requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
            requestGroups: () => Promise.resolve([ ]),
            requestProfiles: () => Promise.resolve([ ]),
            placeOrder: (...args) => {expect(args).to.be.like([ 3,
             { localSymbol: 'SPY',
               secType: 'STK',
               primaryExch: 'NYSE',
               exchange: 'SMART',
               currency: 'USD' },
             { action: 'SELL',
               totalQuantity: 1,
               orderType: 'LMT',
               lmtPrice: 280,
               auxPrice: undefined,
               tif: 'DAY',
               account: 'test',
               orderId: 3,
               parentId: 1,
               ocaGroup: null,
               ocaType: 0,
               smartComboRoutingParams: [] } ]);
               return Promise.resolve({ status: 'ApiPending',
               localSymbol: 'SPY',
               secType: 'STK',
               primaryExch: 'NYSE',
               exchange: 'SMART',
               currency: 'USD',
             action: 'SELL',
             totalQuantity: 1,
             orderType: 'LMT',
             lmtPrice: 280,
             tif: 'DAY',
             account: 'test' });},
            close: () => Promise.resolve() });
        const profit = await broker({
            attach_ref: 'LMT.32f027a8.1',
            action: 'SELL', quant: 1, order_type: 'LMT', limit: 280, tif: 'DAY', symbol: 'SPY', market: 'NYSE'
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 1,
            order_type: 'LMT',
            limit: 280,
            stop: undefined,
            offset: undefined,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            attach_ref: 'LMT.32f027a8.1',
            account: 'test',
            symbol: 'SPY',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should submit OCA order", async() => {
        const broker = await Broker(settings, {
              async open() { return this; },
              reqId: cb => (cb || _.identity)(1),
              reqManagedAccts: () => Promise.resolve([ 'test' ]),
              requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
              placeOrder: (()=>{let count=0;return(...args) => {switch(count++) {
            case 0: expect(args).to.be.like([ 1,
                 { localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD' },
                 { action: 'BUY',
                   totalQuantity: 1,
                   orderType: 'LMT',
                   lmtPrice: 270,
                   auxPrice: undefined,
                   tif: 'DAY',
                   orderRef: /LMT/,
                   account: 'test',
                   orderId: 1,
                   parentId: null,
                   ocaGroup: /OCA/,
                   ocaType: 1,
                   smartComboRoutingParams: [] } ]);
                   return Promise.resolve({ status: 'ApiPending',
                   localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD',
                 action: 'BUY',
                 totalQuantity: 1,
                 orderType: 'LMT',
                 lmtPrice: 270,
                 tif: 'DAY',
                 orderRef: args[2].orderRef,
                 account: 'test' })
            case 1: expect(args).to.be.like([ 1,
                 { localSymbol: 'XLU',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD' },
                 { action: 'BUY',
                   totalQuantity: 1,
                   orderType: 'LMT',
                   lmtPrice: 50,
                   auxPrice: undefined,
                   tif: 'DAY',
                   orderRef: /LMT/,
                   account: 'test',
                   orderId: 1,
                   parentId: null,
                   ocaGroup: /OCA/,
                   ocaType: 1,
                   smartComboRoutingParams: [] } ]);
                   return Promise.resolve({ status: 'ApiPending',
                   localSymbol: 'XLU',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD',
                 action: 'BUY',
                 totalQuantity: 1,
                 orderType: 'LMT',
                 lmtPrice: 50,
                 tif: 'DAY',
                 orderRef: args[2].orderRef,
                 account: 'test' })
            case 2: expect(args).to.be.like([ 1,
                 { localSymbol: 'XLP',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD' },
                 { action: 'BUY',
                   totalQuantity: 1,
                   orderType: 'LMT',
                   lmtPrice: 50,
                   auxPrice: undefined,
                   tif: 'DAY',
                   orderRef: /LMT/,
                   account: 'test',
                   orderId: 1,
                   parentId: null,
                   ocaGroup: /^OCA.*/,
                   ocaType: 1,
                   smartComboRoutingParams: [] } ]);
                   return Promise.resolve({ status: 'ApiPending',
                   localSymbol: 'XLP',
                   secType: 'STK',
                   primaryExch: 'NYSE',
                   exchange: 'SMART',
                   currency: 'USD',
                 action: 'BUY',
                 totalQuantity: 1,
                 orderType: 'LMT',
                 lmtPrice: 50,
                 tif: 'DAY',
                 orderRef: args[2].orderRef,
                 account: 'test' })
            default: throw Error("Too many times")
            }}})(),
          reqRecentOrders: () => Promise.resolve([ {
               orderRef: orders[0].order_ref,
               orderId: 1,
               ocaGroup: orders[1].attach_ref } ]),
          close: () => Promise.resolve() });
        var orders = await broker({
            action: 'OCA',
            attached: [{
                action: 'BUY', quant: 1, limit: 270, order_type: 'LMT', tif: 'DAY', symbol: 'SPY', market: 'NYSE'
            }, {
                action: 'BUY', quant: 1, limit: 50, order_type: 'LMT', tif: 'DAY', symbol: 'XLU', market: 'NYSE'
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'LMT',
            limit: 270,
            stop: undefined,
            offset: undefined,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /LMT/,
            attach_ref: /OCA/,
            account: 'test',
            symbol: 'SPY',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LMT',
            limit: 50,
            stop: undefined,
            offset: undefined,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /LMT/,
            attach_ref: /OCA/,
            account: 'test',
            symbol: 'XLU',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        const xlp = await broker({
            attach_ref: _.first(orders).attach_ref,
            action: 'BUY', quant: 1, limit: 50, order_type: 'LMT', tif: 'DAY', symbol: 'XLP', market: 'NYSE'
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'LMT',
            limit: 50,
            stop: undefined,
            offset: undefined,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /LMT/,
            attach_ref: /OCA/,
            account: 'test',
            symbol: 'XLP',
            market: 'NYSE',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should submit nested OCA order", async() => {
        const broker = await Broker(settings, {
            open: () => Promise.resolve({}),
            reqRecentOrders: () => Promise.resolve([]),
            reqOpenOrders: () => Promise.resolve([]),
            reqId: (...args) => {
                return Promise.resolve({
                    orderId: 1,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 284,
                    orderRef: 'MOC.KL.mktsxorders',
                    orderType: 'MOC',
                    tif: 'GTC',
                    outsideRth: false,
                    account: 'U1878120',
                    secType: 'STK',
                    localSymbol: 'KL',
                    currency: 'CAD'
                });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([1,
                {
                    localSymbol: 'KL',
                    secType: 'STK',
                    primaryExch: 'TSE',
                    exchange: 'SMART',
                    currency: 'CAD'
                },
                {
                    action: 'BUY',
                    totalQuantity: 284,
                    orderType: 'MOC',
                    lmtPrice: undefined,
                    auxPrice: undefined,
                    tif: 'GTC',
                    outsideRth: false,
                    orderRef: 'MOC.KL.mktsxorders',
                    transmit: false,
                    account: 'U1878120',
                    orderId: 1,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    orderId: 1,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 284,
                    orderRef: 'MOC.KL.mktsxorders',
                    orderType: 'MOC',
                    tif: 'GTC',
                    outsideRth: false,
                    account: 'U1878120',
                    secType: 'STK',
                    localSymbol: 'KL',
                    currency: 'CAD'
                });
            },
            close: () => Promise.resolve()
        });
        var orders = await broker({
            action: 'BUY',
            quant: 284,
            tif: 'GTC',
            order_type: 'MOC',
            order_ref: 'MOC.KL.mktsxorders',
            symbol: 'KL',
            market: 'TSE',
            currency: 'CAD',
            security_type: 'STK',
            traded_at: '2019-11-19T16:00:00-05:00',
            attached: [
              {
                action: "OCA",
                attached: [
                  {
                    action: "BUY",
                    quant: "483",
                    limit: 61.65,
                    tif: "GTC",
                    order_type: "MOC",
                    order_ref: "bto_KL.mktsxorders",
                    symbol: "KL",
                    market: "TSE",
                    currency: "CAD",
                    security_type: "STK"
                  },
                  {
                    action: "SELL",
                    quant: "284",
                    limit: 67.61,
                    tif: "GTC",
                    order_type: "MOC",
                    order_ref: "stc_KL.mktsxorders",
                    symbol: "KL",
                    market: "TSE",
                    currency: "CAD",
                    security_type: "STK"
                  }
                ],
                symbol: "KL",
                market: "TSE",
                currency: "CAD",
                security_type: "STK"
              }
            ]
        }).should.eventually.be.like([
            {
              action: "BUY",
              currency: "CAD",
              market: "TSE",
              order_ref: "MOC.KL.mktsxorders",
              order_type: "MOC",
              quant: 284,
              security_type: "STK",
              status: "pending",
              symbol: "KL",
              tif: "GTC"
            },
            {
              action: "BUY",
              attach_ref: "MOC.KL.mktsxorders",
              currency: "CAD",
              market: "TSE",
              order_type: "MOC",
              quant: 284,
              security_type: "STK",
              status: "pending",
              symbol: "KL",
              tif: "GTC"
            },
            {
              action: "BUY",
              attach_ref: "MOC.KL.mktsxorders",
              currency: "CAD",
              market: "TSE",
              order_type: "MOC",
              quant: 284,
              security_type: "STK",
              status: "pending",
              symbol: "KL",
              tif: "GTC"
            }
        ]);
        await broker.close();
    });
    it("should submit SELL combo order", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
          reqId: cb => cb(1),
          reqContractDetails: (()=>{let count=0;return(...args) => {switch(count++) {
        case 0: expect(args).to.be.like([ { localSymbol: 'SPX   190719P02400000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);
               return Promise.resolve([ { contract: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conid: 354278083 } } ])
        case 1: expect(args).to.be.like([ { localSymbol: 'SPX   190719P02450000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);
               return Promise.resolve([ { contract: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conid: 354278089 } } ])
        default: throw Error("Too many times")
        }}})(),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 1,
             { secType: 'BAG',
               symbol: 'SPX',
               currency: 'USD',
               exchange: 'SMART',
               comboLegs: 
                [ { action: 'SELL', ratio: 1, conid: 354278083, exchange: 'SMART' },
                  { action: 'BUY', ratio: 1, conid: 354278089, exchange: 'SMART' } ] },
             { action: 'SELL',
               totalQuantity: 1,
               orderType: 'LMT',
               lmtPrice: 3,
               auxPrice: undefined,
               tif: 'DAY',
               orderRef: /LMT/,
               account: 'test',
               orderId: 1,
               parentId: null,
               ocaGroup: null,
               ocaType: 0,
               smartComboRoutingParams: [ { tag: 'NonGuaranteed', value: '1' } ] } ]);
             return Promise.resolve({ status: 'ApiPending',
               secType: 'BAG',
               symbol: 'SPX',
               currency: 'USD',
               exchange: 'SMART',
               comboLegs: 
                [ { action: 'SELL', ratio: 1, conid: 354278083, currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX', },
                  { action: 'BUY', ratio: 1, conid: 354278089, currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX', } ],
             action: 'SELL',
             totalQuantity: 1,
             orderType: 'LMT',
             lmtPrice: 3,
             tif: 'DAY',
             orderRef: args[2].orderRef,
             account: 'test' });},
          close: () => Promise.resolve() });
        const orders = await broker({
            action: 'SELL', quant: 1, limit: 3, order_type: 'LMT', tif: 'DAY',
            attached: [{
                action: 'SELL', quant: 1, order_type: 'LEG', symbol: 'SPX   190719P02400000', market: 'OPRA'
            }, {
                action: 'BUY', quant: 1, order_type: 'LEG', symbol: 'SPX   190719P02450000', market: 'OPRA'
            }]
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 1,
            order_type: 'LMT',
            limit: 3,
            stop: undefined,
            offset: undefined,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /LMT/,
            attach_ref: undefined,
            account: 'test',
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /LMT/,
            account: 'test',
            symbol: 'SPX   190719P02400000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /LMT/,
            account: 'test',
            symbol: 'SPX   190719P02450000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined } ])
        await broker.close();
    });
    it("should submit BUY SNAP MID combo order", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
          reqId: cb => cb(1),
          reqContractDetails: (()=>{let count=0;return(...args) => {switch(count++) {
        case 0: expect(args).to.be.like([ { localSymbol: 'SPX   190621C03075000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);
               return Promise.resolve([ { contract: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conid: 304784993 } } ])
        case 1: expect(args).to.be.like([ { localSymbol: 'SPX   190621C03125000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);
               return Promise.resolve([ { contract: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conid: 304784996 } } ])
        default: throw Error("Too many times")
        }}})(),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 1,
             { secType: 'BAG',
               symbol: 'SPX',
               currency: 'USD',
               exchange: 'SMART',
               comboLegs: 
                [ { action: 'BUY', ratio: 1, conid: 304784993, exchange: 'SMART' },
                  { action: 'SELL', ratio: 1, conid: 304784996, exchange: 'SMART' } ] },
             { action: 'BUY',
               totalQuantity: 1,
               orderType: 'SNAP MID',
               lmtPrice: undefined,
               auxPrice: 0,
               tif: 'DAY',
               orderRef: /SNAPMID/,
               account: 'test',
               orderId: 1,
               parentId: null,
               ocaGroup: null,
               ocaType: 0,
               smartComboRoutingParams: [ { tag: 'NonGuaranteed', value: '1' } ] } ]);
             return Promise.resolve({ status: 'ApiPending',
               secType: 'BAG',
               symbol: 'SPX',
               currency: 'USD',
               exchange: 'SMART',
               comboLegs: 
                [ { action: 'BUY', ratio: 1, currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conid: 304784993 },
                  { action: 'SELL', ratio: 1, currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conid: 304784996 } ],
             action: 'BUY',
             totalQuantity: 1,
             orderType: 'SNAP MID',
             auxPrice: 0,
             tif: 'DAY',
             orderRef: args[2].orderRef,
             account: 'test' });},
          close: () => Promise.resolve() });
        const orders = await broker({
            action: 'BUY', quant: 1, offset: 0, order_type: 'SNAP MID', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190621C03075000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190621C03125000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'SNAP MID',
            limit: undefined,
            stop: 0,
            offset: 0,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPMID/,
            attach_ref: undefined,
            account: 'test',
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPMID/,
            account: 'test',
            symbol: 'SPX   190621C03075000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPMID/,
            account: 'test',
            symbol: 'SPX   190621C03125000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
        await broker.close();
    });
    it("should round trip ibalog order", async() => {
        const broker = await Broker(settings, {
          async open() { return this; },
          reqId: cb => cb(1),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 1,
             { localSymbol: 'MESM9',
               exchange: 'GLOBEX',
               currency: 'USD',
               includeExpired: true },
             { action: 'BUY',
               totalQuantity: 1,
               orderType: 'LMT',
               algoStrategy: 'Adaptive',
               algoParams: [ { tag: 'adaptivePriority', value: 'Patient' } ],
               lmtPrice: 2700,
               auxPrice: undefined,
               tif: 'DAY',
               orderRef: /Adaptive/,
               account: 'test',
               orderId: 1,
               parentId: null,
               ocaGroup: null,
               ocaType: 0,
               smartComboRoutingParams: [] } ]);
             return Promise.resolve({ status: 'PreSubmitted',
               localSymbol: 'MESM9',
               secType: 'FUT',
               exchange: 'GLOBEX',
               currency: 'USD',
             posted_time: '20190601 15:57:41',
             time: '20190601 15:57:41',
             action: 'BUY',
             totalQuantity: 1,
             algoStrategy: 'Adaptive',
             algoParams: [ { tag: 'adaptivePriority', value: 'Patient' } ],
             lmtPrice: 2700,
             auxPrice: 1.7976931348623157e+308,
             tif: 'DAY',
             orderRef: args[2].orderRef,
             faGroup: '',
             faProfile: '',
             account: 'test' });},
          reqOpenOrders: () => Promise.resolve([ { posted_time: '20190601 15:57:41',
               faGroup: '',
               faProfile: '',
               account: 'test',
               conid: 362699310,
               secType: 'FUT',
               localSymbol: 'MESM9',
               exchange: 'GLOBEX',
               currency: 'USD',
               multiplier: '5',
               status: 'PreSubmitted',
               time: '20190601 15:57:41',
               action: 'BUY',
               totalQuantity: 1,
               algoStrategy: 'Adaptive',
               algoParams: [ { tag: 'adaptivePriority', value: 'Patient' } ],
               lmtPrice: 2700,
               auxPrice: null,
               orderType: 'LMT',
               tif: 'DAY',
               avgFillPrice: 0,
               orderRef: 'Adaptive.1947c062c.1',
               parentId: 0,
               remaining: 1,
               ocaGroup: '' } ]),
          reqContract: (...args) => {expect(args).to.be.like([ 362699310 ]);
          return Promise.resolve({ secType: 'FUT',
             localSymbol: 'MESM9',
             exchange: 'GLOBEX',
             currency: 'USD',
             multiplier: '5' });},
          close: () => Promise.resolve() });
        const orders = await broker({
            action: 'BUY', quant: 1, limit: 2700,
            order_type: 'Adaptive (IBALGO) adaptivePriority=Patient', tif: 'DAY',
            symbol: 'MESM19', market: 'CME'
        }).should.eventually.be.like([ { posted_at: '2019-06-01T15:57:41-04:00',
            asof: '2019-06-01T15:57:41-04:00',
            traded_at: null,
            action: 'BUY',
            quant: 1,
            order_type: 'Adaptive (IBALGO) adaptivePriority=Patient',
            limit: 2700,
            stop: null,
            offset: null,
            tif: 'DAY',
            status: 'working',
            traded_price: null,
            order_ref: /Adaptive/,
            attach_ref: undefined,
            account: 'test',
            symbol: 'MESM19',
            market: 'CME',
            currency: 'USD',
            security_type: 'FUT',
            multiplier: undefined } ]);
        await broker({action: 'orders'}).should.eventually.be.like([ { posted_at: '2019-06-01T15:57:41-04:00',
            asof: '2019-06-01T15:57:41-04:00',
            traded_at: null,
            action: 'BUY',
            quant: 1,
            order_type: 'Adaptive (IBALGO) adaptivePriority=Patient',
            limit: 2700,
            stop: null,
            offset: null,
            tif: 'DAY',
            status: 'working',
            traded_price: null,
            order_ref: /Adaptive/,
            attach_ref: undefined,
            account: 'test',
            symbol: 'MESM19',
            market: 'CME',
            currency: 'USD',
            security_type: 'FUT',
            multiplier: '5',
            attach_ref: '' } ]);
        await broker.close();
    });
    it("should submit BUY Call SNAP STK MID offset options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(1),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'C', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 16.25,
                                ask: 17
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738.25,
                                ask: 2738.5
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([1,
                {
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    includeExpired: true,
                    multiplier: 50
                },
                {
                    action: 'BUY',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 16.60,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 1,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 16.60,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'BUY', quant: 1, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 C2800', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 16.60,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 C2800',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit BUY Call SNAP STK limit options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(1),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'C', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 16.25,
                                ask: 17,
                                model_option: {
                                    optPrice: 16.625,
                                    undPrice: 2738.375,
                                    iv: 0.1602330880202159
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738.25,
                                ask: 2738.5
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (...args) => {
                expect(args).to.be.like([{
                        localSymbol: 'ESM9 C2800',
                        secType: 'FOP',
                        exchange: 'GLOBEX',
                        currency: 'USD',
                        includeExpired: true,
                        multiplier: 50
                    },
                    0.1602330880202159,
                    2723.375
                ]);
                return Promise.resolve({ optPrice: 12.55977560633167 });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([1,
                {
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    includeExpired: true,
                    multiplier: 50
                },
                {
                    action: 'BUY',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 12.55,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 1,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 12.55,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'BUY', quant: 1, limit: 2738.375-15, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 C2800', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 12.55,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 C2800',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit SELL Call SNAP STK limit options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(2),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'C', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 16.25,
                                ask: 17,
                                model_option: {
                                    optPrice: 16.625,
                                    undPrice: 2738.375,
                                    iv: 0.1596098191933759
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738.25,
                                ask: 2738.5
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (...args) => {
                expect(args).to.be.like([{
                        localSymbol: 'ESM9 C2800',
                        secType: 'FOP',
                        exchange: 'GLOBEX',
                        currency: 'USD',
                        includeExpired: true,
                        multiplier: 50
                    },
                    0.1596098191933759,
                    2753.375
                ]);
                return Promise.resolve({ optPrice: 20.734445781477927 });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([2,
                {
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50
                },
                {
                    action: 'SELL',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 20.75,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 2,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 20.75,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'SELL', quant: 1, limit: 2738.375+15, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 C2800', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 20.75,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 C2800',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit BUY Call SNAP STK offset options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(1),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'C', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 16.25,
                                ask: 17,
                                model_option: {
                                    optPrice: 16.625,
                                    undPrice: 2738.375,
                                    iv: 0.1602330880202159
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738.25,
                                ask: 2738.5
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (...args) => {
                expect(args).to.be.like([{
                        localSymbol: 'ESM9 C2800',
                        secType: 'FOP',
                        exchange: 'GLOBEX',
                        currency: 'USD',
                        includeExpired: true,
                        multiplier: 50
                    },
                    0.1602330880202159,
                    2723.375
                ]);
                return Promise.resolve({ optPrice: 12.55977560633167 });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([1,
                {
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    includeExpired: true,
                    multiplier: 50
                },
                {
                    action: 'BUY',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 12.55,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 1,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 12.55,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'BUY', quant: 1, offset: 15, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 C2800', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 12.55,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 C2800',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit SELL Call SNAP STK offset options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(2),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'C', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 C2800',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 16.25,
                                ask: 17,
                                model_option: {
                                    optPrice: 16.625,
                                    undPrice: 2738.375,
                                    iv: 0.1596098191933759
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738.25,
                                ask: 2738.5
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (...args) => {
                expect(args).to.be.like([{
                        localSymbol: 'ESM9 C2800',
                        secType: 'FOP',
                        exchange: 'GLOBEX',
                        currency: 'USD',
                        includeExpired: true,
                        multiplier: 50
                    },
                    0.1596098191933759,
                    2753.375
                ]);
                return Promise.resolve({ optPrice: 20.734445781477927 });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([2,
                {
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50
                },
                {
                    action: 'SELL',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 20.75,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 2,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 C2800',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 20.75,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'SELL', quant: 1, offset: 15, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 C2800', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 20.75,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 C2800',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit BUY Put SNAP STK offset options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(3),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 P2625',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'P', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 P2625',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 13.5,
                                ask: 14.25,
                                model_option: {
                                    optPrice: (13.5+14.25)/2,
                                    undPrice: 2738.375,
                                    iv: (0.21510238654276234+0.2105016705605929)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738.25,
                                ask: 2738.5
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (...args) => {
                expect(args).to.be.like([{
                        localSymbol: 'ESM9 P2625',
                        secType: 'FOP',
                        exchange: 'GLOBEX',
                        currency: 'USD',
                        includeExpired: true,
                        multiplier: 50
                    },
                    0.21280202855167762,
                    2753.375
                ]);
                return Promise.resolve({ optPrice: 10.634610868329078 });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([3,
                {
                    localSymbol: 'ESM9 P2625',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50
                },
                {
                    action: 'BUY',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 10.6,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 3,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 P2625',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 10.6,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'BUY', quant: 1, offset: 15, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 P2625', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 10.6,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 P2625',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit SELL Put SNAP STK offset options order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(4),
            reqContractDetails: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 P2625',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve([{
                                contract: { right: 'P', exchange: 'GLOBEX' },
                                minTick: 0.05,
                                underConid: 310629209
                            }]);
                        case 1:
                            expect(args).to.be.like([{
                                conid: 310629209
                            }]);
                            return Promise.resolve([{
                                contract: {
                                    conid: 310629209,
                                    localSymbol:'ESM9',
                                    currency:'USD',
                                    secType:'FUT',
                                    exchange:'GLOBEX'
                                }
                            }]);
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqContract: (...args) => {
                expect(args).to.be.like([310629209]);
                return Promise.resolve({
                    conid: 310629209,
                    localSymbol:'ESM9',
                    currency:'USD',
                    secType:'FUT',
                    exchange:'GLOBEX'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'ESM9 P2625',
                                secType: 'FOP',
                                exchange: 'GLOBEX',
                                currency: 'USD',
                                includeExpired: true,
                                multiplier: 50
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 13.5,
                                ask: 14.25,
                                model_option: {
                                    optPrice: (13.5+14.25)/2,
                                    undPrice: 2738.125,
                                    iv: (0.21510238654276234+0.2105016705605929)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 310629209, exchange: 'GLOBEX' }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 2738,
                                ask: 2738.25
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (...args) => {
                expect(args).to.be.like([{
                        localSymbol: 'ESM9 P2625',
                        secType: 'FOP',
                        exchange: 'GLOBEX',
                        currency: 'USD',
                        includeExpired: true,
                        multiplier: 50
                    },
                    0.21280202855167762,
                    2723.125
                ]);
                return Promise.resolve({ optPrice: 16.248681847747832 });
            },
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([4,
                {
                    localSymbol: 'ESM9 P2625',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50
                },
                {
                    action: 'SELL',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 16.25,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 4,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'ESM9 P2625',
                    secType: 'FOP',
                    exchange: 'GLOBEX',
                    currency: 'USD',
                    multiplier: 50,
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 16.25,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            now: '2019-06-01T12:00:00',
            action: 'SELL', quant: 1, offset: 15, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'ESM19 P2625', market: 'CME',
            currency: 'USD', security_type: 'FOP', multiplier: 50
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 16.25,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'ESM19 P2625',
            market: 'CME',
            currency: 'USD',
            security_type: 'FOP',
            multiplier: 50 } ]);
    });
    it("should submit BUY Call SNAP STK MID combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(1),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719C03025000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03025000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719C03075000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03075000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'CBOE',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.65,
                                ask: 0.8
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.25,
                                ask: 0.4
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([1,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354277718, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354277733, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'BUY',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: 0.4,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 1,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354277718, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354277733, exchange: 'SMART' }
                    ],
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: 0.4,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            action: 'BUY', quant: 2, offset: 0, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03025000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03075000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 2,
            order_type: 'SNAP STK',
            limit: 0.4,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03025000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03075000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit BUY Call SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(2),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719C03025000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03025000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719C03075000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03075000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.65,
                                ask: 0.8,
                                model_option: {
                                    optPrice: (0.65+0.8)/2,
                                    undPrice: 2740.9700000000003,
                                    iv: (0.13006607892009805+0.1262915111028727)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.25,
                                ask: 0.4,
                                model_option: {
                                    optPrice: (0.25+0.4)/2,
                                    undPrice: 2740.9700000000003,
                                    iv: (0.13551392396412848+0.12820479340292215)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277718,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3025,
                                    localSymbol: 'SPX   190719C03025000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.12817879501148538,
                                2720.9700000000003
                            ]);
                            return Promise.resolve({ optPrice: 0.4624150890037491 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277733,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3075,
                                    localSymbol: 'SPX   190719C03075000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.1318593586835253,
                                2720.9700000000003
                            ]);
                            return Promise.resolve({ optPrice: 0.20077526295075646 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([2,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354277718, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354277733, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'BUY',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: 0.25,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 2,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, 
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03025000',
                                multiplier: '100' },
                        { action: 'SELL', ratio: 1,
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277733,
                                    secType: 'OPT',
                                    localSymbol: 'SPX   190719C03075000',
                                    multiplier: '100', }
                    ],
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: 0.25,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            action: 'BUY', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03025000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03075000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 2,
            order_type: 'SNAP STK',
            limit: 0.25,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03025000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03075000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit SELL Call SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(3),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719C03025000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03025000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719C03075000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03075000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.65,
                                ask: 0.8,
                                model_option: {
                                    optPrice: (0.65+0.8)/2,
                                    undPrice: 2741.89,
                                    iv: (0.13006607892009805+0.1262915111028727)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.25,
                                ask: 0.4,
                                model_option: {
                                    optPrice: (0.25+0.4)/2,
                                    undPrice: 2741.89,
                                    iv: (0.13551392396412848+0.12820479340292215)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1, ask: 1 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277718,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3025,
                                    localSymbol: 'SPX   190719C03025000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.12817879501148538,
                                2761.89
                            ]);
                            return Promise.resolve({ optPrice: 1.167425734276265 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277733,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3075,
                                    localSymbol: 'SPX   190719C03075000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.1318593586835253,
                                2761.89
                            ]);
                            return Promise.resolve({ optPrice: 0.5339095094356251 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([3,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354277718, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354277733, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'SELL',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: 0.65,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 3,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03025000',
                                multiplier: '100', },
                        { action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03075000',
                                multiplier: '100', }
                    ],
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: 0.65,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        }
);
        const orders = await broker({
            action: 'SELL', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03025000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03075000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 2,
            order_type: 'SNAP STK',
            limit: 0.65,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03025000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03075000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit BUY Put SNAP STK MID combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(4),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719P02450000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02450000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719P02400000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02400000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 8.6,
                                ask: 8.9
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 6.1,
                                ask: 6.3
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([4,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354278089, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354278083, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'BUY',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: 2.55,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 4,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02450000',
                                multiplier: '100', },
                        { action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02400000',
                                multiplier: '100', }
                    ],
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: 2.55,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        }
);
        const orders = await broker({
            action: 'BUY', quant: 2, offset: 0, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 2,
            order_type: 'SNAP STK',
            limit: 2.55,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02450000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02400000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit BUY Put SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(5),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719P02450000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02450000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719P02400000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02400000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 8.6,
                                ask: 9,
                                model_option: {
                                    optPrice: 8.8,
                                    undPrice: 2742.8,
                                    iv: (0.2389572882162499+0.2369029900679141)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 6.1,
                                ask: 6.3,
                                model_option: {
                                    optPrice: 6.2,
                                    undPrice: 2742.8,
                                    iv: (0.2506591242473686+0.24800008651105912)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278089,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2450,
                                    localSymbol: 'SPX   190719P02450000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.237930139142082,
                                2762.8
                            ]);
                            return Promise.resolve({ optPrice: 7.64625344873318 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278083,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2400,
                                    localSymbol: 'SPX   190719P02400000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.2493296053792138,
                                2762.8
                            ]);
                            return Promise.resolve({ optPrice: 5.412282738263329 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([5,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354278089, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354278083, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'BUY',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: 2.2,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 5,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02450000',
                                multiplier: '100', },
                        { action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02400000',
                                multiplier: '100', }
                    ],
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: 2.2,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        }
);
        const orders = await broker({
            action: 'BUY', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 2,
            order_type: 'SNAP STK',
            limit: 2.2,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02450000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02400000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit SELL Put SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(6),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719P02450000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02450000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719P02400000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02400000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 8.7,
                                ask: 9,
                                model_option: {
                                    optPrice: 8.85,
                                    undPrice: 2742.4500000000003,
                                    iv: (0.2389572882162499+0.2369029900679141)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 6.1,
                                ask: 6.4,
                                model_option: {
                                    optPrice: 6.25,
                                    undPrice: 2742.4500000000003,
                                    iv: (0.2506591242473686+0.24800008651105912)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278089,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2450,
                                    localSymbol: 'SPX   190719P02450000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.237930139142082,
                                2722.4500000000003
                            ]);
                            return Promise.resolve({ optPrice: 11 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278083,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2400,
                                    localSymbol: 'SPX   190719P02400000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.2493296053792138,
                                2722.4500000000003
                            ]);
                            return Promise.resolve({ optPrice: 7.85420228206661 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([6,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1, conid: 354278089, exchange: 'SMART' },
                        { action: 'SELL', ratio: 1, conid: 354278083, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'SELL',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: 3.2,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 6,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                // check that it is using the minTick of the legs (0.1) and not of the contract (0.05)
                expect(args[2].lmtPrice).to.equal(3.2);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02450000',
                                multiplier: '100' },
                        { action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02400000',
                                multiplier: '100', }
                    ],
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: 3.2,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        }
);
        const orders = await broker({
            action: 'SELL', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100, minTick: 0.1
            }, {
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100, minTick: 0.1
            }]
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 2,
            order_type: 'SNAP STK',
            limit: 3.2,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02450000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02400000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit SELL negative Call SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(7),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719C03025000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03025000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719C03075000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03075000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.65,
                                ask: 0.8,
                                model_option: {
                                    optPrice: (0.65+0.8)/2,
                                    undPrice: 2742.82,
                                    iv: (0.12955905702544818+0.12579601226956683)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.25,
                                ask: 0.4,
                                model_option: {
                                    optPrice: (0.25+0.4)/2,
                                    undPrice: 2742.82,
                                    iv: (0.13505035428115236+0.12776162661981025)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277718,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3025,
                                    localSymbol: 'SPX   190719C03025000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.1276775346475075,
                                2762.82
                            ]);
                            return Promise.resolve({ optPrice: 1.1618763644926278 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277733,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3075,
                                    localSymbol: 'SPX   190719C03075000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.1314059904504813,
                                2762.82
                            ]);
                            return Promise.resolve({ optPrice: 0.5311375098878429 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([7,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1, conid: 354277718, exchange: 'SMART' },
                        { action: 'BUY', ratio: 1, conid: 354277733, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'SELL',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: -0.65,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 7,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03025000',
                                multiplier: '100' },
                        { action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03075000',
                                multiplier: '100' }
                    ],
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: -0.65,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        }
);
        const orders = await broker({
            action: 'SELL', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03025000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03075000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 2,
            order_type: 'SNAP STK',
            limit: -0.65,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03025000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03075000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit BUY negative Call SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(8),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719C03025000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03025000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719C03075000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719C03075000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3025,
                                localSymbol: 'SPX   190719C03025000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.65,
                                ask: 0.8,
                                model_option: {
                                    optPrice: (0.65+0.8)/2,
                                    undPrice: 2743.09,
                                    iv: (0.12955905702544818+0.12579601226956683)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                right: 'C',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 3075,
                                localSymbol: 'SPX   190719C03075000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 0.25,
                                ask: 0.4,
                                model_option: {
                                    optPrice: (0.25+0.4)/2,
                                    undPrice: 2743.09,
                                    iv: (0.13505035428115236+0.12776162661981025)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277718,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3025,
                                    localSymbol: 'SPX   190719C03025000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.1276775346475075,
                                2763.09
                            ]);
                            return Promise.resolve({ optPrice: 1.1686262677531172 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354277733,
                                    right: 'C',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 3075,
                                    localSymbol: 'SPX   190719C03075000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.1314059904504813,
                                2763.09
                            ]);
                            return Promise.resolve({ optPrice: 0.5344093370911238 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([8,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1, conid: 354277718, exchange: 'SMART' },
                        { action: 'BUY', ratio: 1, conid: 354277733, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'BUY',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: -0.6,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 8,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277718,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03025000',
                                multiplier: '100', },
                        { action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354277733,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719C03075000',
                                multiplier: '100' }
                    ],
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: -0.6,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        }
);
        const orders = await broker({
            action: 'BUY', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03025000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719C03075000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 2,
            order_type: 'SNAP STK',
            limit: -0.6,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03025000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719C03075000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit SELL negative Put SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(9),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719P02450000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02450000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719P02400000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02400000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 8.7,
                                ask: 9,
                                model_option: {
                                    optPrice: 8.85,
                                    undPrice: 2743.08,
                                    iv: (0.2389572882162499+0.2369029900679141)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 6.1,
                                ask: 6.4,
                                model_option: {
                                    optPrice: 6.25,
                                    undPrice: 2743.08,
                                    iv: (0.2506591242473686+0.24800008651105912)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278089,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2450,
                                    localSymbol: 'SPX   190719P02450000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.237930139142082,
                                2763.08
                            ]);
                            return Promise.resolve({ optPrice: 7.6260736839595085 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278083,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2400,
                                    localSymbol: 'SPX   190719P02400000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.2493296053792138,
                                2763.08
                            ]);
                            return Promise.resolve({ optPrice: 5.397829871426259 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            requestAliases: () => Promise.resolve([{ alias: 'Master' },
                { alias: 'TFSA35' },
                { alias: 'TFSA37' },
                { alias: 'RRSP29' },
                { alias: 'test', account: 'test' }
            ]),
            placeOrder: (...args) => {
                expect(args).to.be.like([9,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1, conid: 354278089, exchange: 'SMART' },
                        { action: 'BUY', ratio: 1, conid: 354278083, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'SELL',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: -2.25,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 9,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02450000',
                                multiplier: '100' },
                        { action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02400000',
                                multiplier: '100' }
                    ],
                    status: 'ApiPending',
                    action: 'SELL',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: -2.25,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            action: 'SELL', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'SELL',
            quant: 2,
            order_type: 'SNAP STK',
            limit: -2.25,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02450000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02400000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit BUY negative Put SNAP STK combo order", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(10),
            reqContractDetails: (...args) => {
                switch (args[0].localSymbol || args[0].conid) {
                    case 'SPX   190719P02450000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02450000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            },
                            minTick: 0.05,
                            validExchanges: 'SMART,CBOE',
                            underConid: 416904
                        }])
                    case 'SPX   190719P02400000':
                        expect(args).to.be.like([{
                            localSymbol: 'SPX   190719P02400000',
                            secType: 'OPT',
                            exchange: 'SMART',
                            currency: 'USD',
                            multiplier: 100
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }
                        }])
                    case 416904:
                        expect(args).to.be.like([{
                            conid: 416904
                        }]);
                        return Promise.resolve([{
                            contract: {
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 416904,
                                secType: 'IND'
                            },
                            validExchanges: 'SMART,CBOE'
                        }])
                    default:
                        throw Error("Too many times")
                }
            },
            reqContract: (...args) => {
                expect(args).to.be.like([416904]);
                return Promise.resolve({
                    currency: 'USD',
                    exchange: 'CBOE',
                    symbol: 'SPX',
                    conid: 416904,
                    secType: 'IND'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2450,
                                localSymbol: 'SPX   190719P02450000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 8.7,
                                ask: 9,
                                model_option: {
                                    optPrice: 8.85,
                                    undPrice: 2742.76,
                                    iv: (0.2389572882162499+0.2369029900679141)/2
                                }
                            })
                        case 1:
                            expect(args).to.be.like([{
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                right: 'P',
                                secType: 'OPT',
                                expiry: '20190718',
                                strike: 2400,
                                localSymbol: 'SPX   190719P02400000',
                                tradingClass: 'SPX',
                                multiplier: '100',
                                primaryExch: ''
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 6.1,
                                ask: 6.4,
                                model_option: {
                                    optPrice: 6.25,
                                    undPrice: 2742.76,
                                    iv: (0.2506591242473686+0.24800008651105912)/2
                                }
                            })
                        case 2:
                            expect(args).to.be.like([{
                                conid: 416904
                            }]);
                            return Promise.resolve({
                                last_timestamp: moment('2019-06-01T12:00:00').format('X'),
                                bid: 1,
                                ask: 1
                            })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            calculateOptionPrice: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278089,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2450,
                                    localSymbol: 'SPX   190719P02450000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.237930139142082,
                                2762.76
                            ]);
                            return Promise.resolve({ optPrice: 7.648878214443029 })
                        case 1:
                            expect(args).to.be.like([{
                                    currency: 'USD',
                                    exchange: 'SMART',
                                    symbol: 'SPX',
                                    conid: 354278083,
                                    right: 'P',
                                    secType: 'OPT',
                                    expiry: '20190718',
                                    strike: 2400,
                                    localSymbol: 'SPX   190719P02400000',
                                    tradingClass: 'SPX',
                                    multiplier: '100',
                                    primaryExch: ''
                                },
                                0.2493296053792138,
                                2762.76
                            ]);
                            return Promise.resolve({ optPrice: 5.414138139395032 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            requestAliases: () => Promise.resolve([{ alias: 'Master' },
                { alias: 'TFSA35' },
                { alias: 'TFSA37' },
                { alias: 'RRSP29' },
                { alias: 'test', account: 'test' }
            ]),
            placeOrder: (...args) => {
                expect(args).to.be.like([10,
                {
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1, conid: 354278089, exchange: 'SMART' },
                        { action: 'BUY', ratio: 1, conid: 354278083, exchange: 'SMART' }
                    ]
                },
                {
                    action: 'BUY',
                    totalQuantity: 2,
                    orderType: 'LMT',
                    lmtPrice: -2.2,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 10,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: [{ tag: 'NonGuaranteed', value: '1' }]
                }]);
                return Promise.resolve({
                    secType: 'BAG',
                    symbol: 'SPX',
                    currency: 'USD',
                    exchange: 'SMART',
                    comboLegs: [{ action: 'SELL', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278089,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02450000',
                                multiplier: '100' },
                        { action: 'BUY', ratio: 1,
                                currency: 'USD',
                                exchange: 'SMART',
                                symbol: 'SPX',
                                conid: 354278083,
                                secType: 'OPT',
                                localSymbol: 'SPX   190719P02400000',
                                multiplier: '100' }
                    ],
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 2,
                    orderRef: args[2].orderRef,
                    lmtPrice: -2.2,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            action: 'BUY', quant: 2, offset: 20, order_type: 'SNAP STK', tif: 'DAY',
            attached: [{
                action: 'SELL', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02450000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }, {
                action: 'BUY', quant: 1, order_type: 'LEG',
                symbol: 'SPX   190719P02400000', market: 'OPRA',
                currency: 'USD', security_type: 'OPT', multiplier: 100
            }]
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 2,
            order_type: 'SNAP STK',
            limit: -2.2,
            tif: 'DAY',
            status: 'pending',
            traded_price: null,
            order_ref: /SNAPSTK/,
            attach_ref: undefined,
            symbol: 'SPX',
            market: null,
            currency: 'USD',
            security_type: 'BAG',
            multiplier: undefined },
          {
            action: 'SELL',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02450000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 },
          {
            action: 'BUY',
            quant: 1,
            order_type: 'LEG',
            tif: 'DAY',
            status: 'pending',
            attach_ref: /SNAPSTK/,
            symbol: 'SPX   190719P02400000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'BAG',
            multiplier: 100 } ]);
    });
    it("should submit BUY Call SNAP STK MID offset OPT order after hours", async() => {
        const broker = await Broker(settings, {
            async open() { return this; },
            reqId: cb => cb(1),
            reqContractDetails: (...args) => {
                expect(args).to.be.like([{
                    localSymbol: 'NVDA  210115C00300000',
                    secType: 'OPT',
                    exchange: 'SMART',
                    currency: 'USD',
                    multiplier: 100
                }]);
                return Promise.resolve([{
                    contract: { right: 'C', exchange: 'SMART' },
                    minTick: 0.01,
                    underConid: 4815747
                }]);
            },
            reqContract: (...args) => {
                expect(args).to.be.like([4815747]);
                return Promise.resolve({
                    conid: 4815747, exchange: 'SMART'
                });
            },
            reqMktData: (() => {
                let count = 0;
                return (...args) => {
                    switch (count++) {
                        case 0:
                            expect(args).to.be.like([{
                                localSymbol: 'NVDA  210115C00300000',
                                secType: 'OPT',
                                exchange: 'SMART',
                                currency: 'USD',
                                multiplier: 100
                            }]);
                            return Promise.resolve({
                                bid_size: 0,
                                ask_size: 0,
                                last: 78.15,
                                last_size: 3,
                                volume: 194,
                                high: 78.15,
                                low: 60.9,
                                close: 62.75,
                                last_timestamp: '1589572644',
                                halted: 0
                            })
                        case 1:
                            expect(args).to.be.like([{ conid: 4815747, exchange: 'SMART' }]);
                            return Promise.resolve({ close: 321.22 })
                        default:
                            throw Error("Too many times")
                    }
                }
            })(),
            reqManagedAccts: () => Promise.resolve(['test']),
            placeOrder: (...args) => {
                expect(args).to.be.like([1,
                {
                    localSymbol: 'NVDA  210115C00300000',
                    secType: 'OPT',
                    exchange: 'SMART',
                    currency: 'USD',
                    multiplier: 100
                },
                {
                    action: 'BUY',
                    totalQuantity: 1,
                    orderType: 'LMT',
                    lmtPrice: 78.15,
                    tif: 'DAY',
                    orderRef: /SNAPSTK/,
                    account: 'test',
                    orderId: 1,
                    parentId: null,
                    ocaGroup: null,
                    ocaType: 0,
                    smartComboRoutingParams: []
                }]);
                return Promise.resolve({
                    localSymbol: 'NVDA  210115C00300000',
                    secType: 'OPT',
                    exchange: 'SMART',
                    currency: 'USD',
                    multiplier: 100,
                    status: 'ApiPending',
                    action: 'BUY',
                    totalQuantity: 1,
                    orderRef: args[2].orderRef,
                    lmtPrice: 78.15,
                    orderType: 'LMT',
                    tif: 'DAY',
                    account: 'test'
                });
            }
        });
        const orders = await broker({
            action: 'BUY', quant: 1, order_type: 'SNAP STK', tif: 'DAY',
            symbol: 'NVDA  210115C00300000', market: 'OPRA',
            currency: 'USD', security_type: 'OPT', multiplier: 100
        }).should.eventually.be.like([ {
            action: 'BUY',
            quant: 1,
            order_type: 'SNAP STK',
            limit: 78.15,
            tif: 'DAY',
            status: 'pending',
            order_ref: /SNAPSTK/,
            account: 'test',
            symbol: 'NVDA  210115C00300000',
            market: 'OPRA',
            currency: 'USD',
            security_type: 'OPT',
            multiplier: 100 } ]);
    });
});
