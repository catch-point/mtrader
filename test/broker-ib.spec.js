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
const like = require('./should-be-like.js');
const Snapshot = require('./snapshot.js');
const config = require('../src/config.js');
const IB = require('../src/ib-client.js');
const Broker = require('../src/broker-ib.js');
const createTempDir = require('./create-temp-dir.js');
const expect = require('chai').use(like).expect

describe("broker-ib", function() {
    this.timeout(100000);
    var client, ib = new IB();
    before(function() {
        return ib.open().catch(err => {
            ib = null;
        });
    });
    beforeEach(async() => {
        if (ib) client = new Snapshot(ib);
    });
    afterEach(async() => {
        if (client) {
            const mocking_code = util.inspect(client, {depth: Infinity, compact: false});
            if (mocking_code != '{}') console.log(mocking_code);
        }
    });
    after(function() {
        if (ib) return ib.close();
    });
    before(function() {
        config('workers', 0);
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', createTempDir('broker-ib'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
    });
    after(function() {
        config.unset('prefix');
        config.unset('fetch.files.dirname');
    });
    it("should list balances", async() => {
        const broker = new Broker({account: 'test'}, { reqManagedAccts: () => Promise.resolve([ 'test' ]),
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
            settled: '1777.70',
            accrued: '0',
            realized: '0.00',
            unrealized: '-223.15',
            margin: null } ]);
        await broker.close();
    });
    it("should list positions", async() => {
        const broker = new Broker({account: 'test'}, {
            reqPositionsMulti: () => Promise.resolve({ test: {
                '4215235': { position: 64 }
            } }),
          reqExecutions: () => Promise.resolve([]),
          reqContract: (arg) => {switch(arg) {
            case 4215235: return Promise.resolve({ secType: 'STK',
                 localSymbol: 'XLU',
                 exchange: 'ARCA',
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
            market: 'ARCA',
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
        const broker = new Broker({account: 'test'}, { reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          reqOpenOrders: () => Promise.resolve([ { posted_time: '20190601 14:48:27',
               faGroup: '',
               faProfile: '',
               account: 'test',
               conId: 756733,
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
               ocaGroup: '' } ]),
          reqContract: (...args) => {expect(args).to.be.like([ 756733 ]);return Promise.resolve({ secType: 'STK',
             localSymbol: 'SPY',
             exchange: 'SMART',
             currency: 'USD',
             conId: 756733,
             multiplier: '' });},
          reqContractDetails: (...args) => {expect(args).to.be.like([ { conId: 756733 } ]);return Promise.resolve([ { summary: { exchange: 'SMART',
                  currency: 'USD',
                  secType: 'STK',
                  primaryExch: 'ARCA' } } ]);},
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: '',
            attch_ref: '' } ]);
        await broker.close();
    });
    it("should submit order", async() => {
        const broker = new Broker({account: 'test'}, { reqId: () => Promise.resolve(1),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 1,
             { localSymbol: 'SPY',
               secType: 'STK',
               primaryExch: 'ARCA',
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
             action: 'BUY',
             totalQuantity: 1,
             orderType: 'LMT',
             lmtPrice: 270,
             tif: 'DAY',
             account: 'test' });},
          close: () => Promise.resolve() });
        const order = await broker({action: 'BUY', quant: 1, limit: 270, order_type: 'LMT', tif: 'DAY', symbol: 'SPY', market: 'ARCA'})
          .should.eventually.be.like([ {
            status: 'pending',
            symbol: 'SPY',
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK' } ]);
        await broker.close();
    });
    it("should submit attached order", async() => {
        const broker = new Broker({account: 'test'}, { reqId: () => Promise.resolve(1),
              reqManagedAccts: () => Promise.resolve([ 'test' ]),
              requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
              placeOrder: (()=>{let count=0;return(...args) => {switch(count++) {
            case 0: expect(args).to.be.like([ 1,
                 { localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'ARCA',
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
                   smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'ApiPending',
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
                   primaryExch: 'ARCA',
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
                   smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'ApiPending',
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
            action: 'BUY', quant: 1, limit: 270, order_type: 'LMT', tif: 'DAY', symbol: 'SPY', market: 'ARCA',
            attached:[{
                action: 'SELL', quant: 1, order_type: 'STP', stop: 260, tif: 'DAY', symbol: 'SPY', market: 'ARCA'
            }]
        });
        orders.should.be.like([ { posted_at: null,
            asof: null,
            traded_at: null,
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined },
          { posted_at: null,
            asof: null,
            traded_at: null,
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should submit to attach an order", async() => {
        const broker = new Broker({account: 'test'}, {
            reqRecentOrders: () => Promise.resolve([ { orderRef: 'LMT.32f027a8.1', orderId: 1 }, {} ]),
            reqId: () => Promise.resolve(3),
            reqManagedAccts: () => Promise.resolve([ 'test' ]),
            requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
            requestGroups: () => Promise.resolve([ ]),
            requestProfiles: () => Promise.resolve([ ]),
            placeOrder: (...args) => {expect(args).to.be.like([ 3,
             { localSymbol: 'SPY',
               secType: 'STK',
               primaryExch: 'ARCA',
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
               smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'ApiPending',
             action: 'SELL',
             totalQuantity: 1,
             orderType: 'LMT',
             lmtPrice: 280,
             tif: 'DAY',
             account: 'test' });},
            close: () => Promise.resolve() });
        const profit = await broker({
            attach_ref: 'LMT.32f027a8.1',
            action: 'SELL', quant: 1, order_type: 'LMT', limit: 280, tif: 'DAY', symbol: 'SPY', market: 'ARCA'
        }).should.eventually.be.like([ { posted_at: null,
            asof: null,
            traded_at: null,
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should submit OCA order", async() => {
        const broker = new Broker({account: 'test'}, {
              reqId: () => Promise.resolve(1),
              reqManagedAccts: () => Promise.resolve([ 'test' ]),
              requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
              placeOrder: (()=>{let count=0;return(...args) => {switch(count++) {
            case 0: expect(args).to.be.like([ 1,
                 { localSymbol: 'SPY',
                   secType: 'STK',
                   primaryExch: 'ARCA',
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
                   smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'ApiPending',
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
                   primaryExch: 'ARCA',
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
                   smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'ApiPending',
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
                   primaryExch: 'ARCA',
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
                   smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'ApiPending',
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
                action: 'BUY', quant: 1, limit: 270, order_type: 'LMT', tif: 'DAY', symbol: 'SPY', market: 'ARCA'
            }, {
                action: 'BUY', quant: 1, limit: 50, order_type: 'LMT', tif: 'DAY', symbol: 'XLU', market: 'ARCA'
            }]
        }).should.eventually.be.like([ { posted_at: null,
            asof: null,
            traded_at: null,
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined },
          { posted_at: null,
            asof: null,
            traded_at: null,
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        const xlp = await broker({
            attach_ref: _.first(orders).attach_ref,
            action: 'BUY', quant: 1, limit: 50, order_type: 'LMT', tif: 'DAY', symbol: 'XLP', market: 'ARCA'
        }).should.eventually.be.like([ { posted_at: null,
            asof: null,
            traded_at: null,
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
            market: 'ARCA',
            currency: 'USD',
            security_type: 'STK',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should submit SELL combo order", async() => {
        const broker = new Broker({account: 'test'}, {
          reqId: () => Promise.resolve(1),
          reqContractDetails: (()=>{let count=0;return(...args) => {switch(count++) {
        case 0: expect(args).to.be.like([ { localSymbol: 'SPX   190719P02400000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);return Promise.resolve([ { summary: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conId: 354278083 } } ])
        case 1: expect(args).to.be.like([ { localSymbol: 'SPX   190719P02450000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);return Promise.resolve([ { summary: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conId: 354278089 } } ])
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
                [ { action: 'SELL', ratio: 1, conId: 354278083, exchange: 'SMART' },
                  { action: 'BUY', ratio: 1, conId: 354278089, exchange: 'SMART' } ] },
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
               smartComboRoutingParams: [ { tag: 'NonGuaranteed', value: '1' } ] } ]);return Promise.resolve({ status: 'ApiPending',
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
        }).should.eventually.be.like([ { posted_at: null,
            asof: null,
            traded_at: null,
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
          { posted_at: null,
            asof: null,
            traded_at: null,
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
          { posted_at: null,
            asof: null,
            traded_at: null,
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
    it("should submit BUY combo order", async() => {
        const broker = new Broker({account: 'test'}, {
          reqId: () => Promise.resolve(1),
          reqContractDetails: (()=>{let count=0;return(...args) => {switch(count++) {
        case 0: expect(args).to.be.like([ { localSymbol: 'SPX   190621C03075000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);return Promise.resolve([ { summary: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conId: 304784993 } } ])
        case 1: expect(args).to.be.like([ { localSymbol: 'SPX   190621C03125000',
               secType: 'OPT',
               exchange: 'SMART',
               currency: 'USD' } ]);return Promise.resolve([ { summary: { currency: 'USD',
                  exchange: 'SMART',
                  symbol: 'SPX',
                  conId: 304784996 } } ])
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
                [ { action: 'BUY', ratio: 1, conId: 304784993, exchange: 'SMART' },
                  { action: 'SELL', ratio: 1, conId: 304784996, exchange: 'SMART' } ] },
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
               smartComboRoutingParams: [ { tag: 'NonGuaranteed', value: '1' } ] } ]);return Promise.resolve({ status: 'ApiPending',
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
        }).should.eventually.be.like([ { posted_at: null,
            asof: null,
            traded_at: null,
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
          { posted_at: null,
            asof: null,
            traded_at: null,
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
          { posted_at: null,
            asof: null,
            traded_at: null,
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
    it("should ibalog order", async() => {
        const broker = new Broker({account: 'test'}, {
          reqId: () => Promise.resolve(3),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          requestAliases: () => Promise.resolve([ { alias: 'test' } ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 3,
             { localSymbol: 'ESM9',
               secType: 'FUT',
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
               orderRef: /Adaptive|IBALGO/,
               account: 'test',
               orderId: 3,
               parentId: null,
               ocaGroup: null,
               ocaType: 0,
               smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'PreSubmitted',
             posted_time: '20190601 15:43:10',
             time: '20190601 15:43:10',
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
          close: () => Promise.resolve() });
        const orders = await broker({
            action: 'BUY', quant: 1, limit: 2700,
            order_type: 'Adaptive (IBALGO) adaptivePriority=Patient', tif: 'DAY',
            symbol: 'ESM19', market: 'CME'
        }).should.eventually.be.like([ { posted_at: '2019-06-01T15:43:10-04:00',
            asof: '2019-06-01T15:43:10-04:00',
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
            order_ref: /Adaptive|IBALGO/,
            attach_ref: undefined,
            account: 'test',
            symbol: 'ESM19',
            market: 'CME',
            currency: 'USD',
            security_type: 'FUT',
            multiplier: undefined } ]);
        await broker.close();
    });
    it("should ibalog order", async() => {
        const broker = new Broker({account: 'test'}, {
          reqId: () => Promise.resolve(1),
          reqManagedAccts: () => Promise.resolve([ 'test' ]),
          placeOrder: (...args) => {expect(args).to.be.like([ 1,
             { localSymbol: 'MESM9',
               secType: 'FUT',
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
               smartComboRoutingParams: [] } ]);return Promise.resolve({ status: 'PreSubmitted',
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
               conId: 362699310,
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
          reqContract: (...args) => {expect(args).to.be.like([ 362699310 ]);return Promise.resolve({ secType: 'FUT',
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
            attch_ref: '' } ]);
        await broker.close();
    });
});
