// replicate-simulation.spec.js
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
const util = require('util');
const _ = require('underscore');
const moment = require('moment-timezone');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');
const Collect = require('../src/collect.js');
const Replicate = require('../src/replicate.js');
const Broker = require('../src/broker-simulation.js');
const beautify = require('js-beautify');
const like = require('./should-be-like.js');
const Snapshot = require('./snapshot.js');
const createTempDir = require('./create-temp-dir.js');

describe("replicate-simulation", function() {
    this.timeout(60000);
    var fetch, quote, collect, broker, snapshot, replicate;
    before(function() {
        config('workers', 0);
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', createTempDir('simulation'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        fetch = new Fetch();
        quote = new Quote(fetch);
        collect = new Collect(quote);
        broker = new Broker({...config(), simulation: 'test'});
        replicate = Replicate.bind({}, broker, fetch);
    });
    beforeEach(async() => {
        await broker({action: 'reset'});
        await broker({
            asof: '2018-12-01T00:00:00-05:00',
            action: 'deposit', quant: 10000, currency: 'CAD'
        });
        await broker({
            asof: '2018-12-01T00:00:00-05:00',
            action: 'deposit', quant: 10000, currency: 'USD'
        });
    });
    beforeEach(async() => {
        snapshot = new Snapshot(broker);
    });
    afterEach(async() => {
        if (snapshot) {
            const code = beautify(util.inspect(snapshot, {depth: Infinity}), {
                brace_style: 'none,preserve-inline'
            });
            if (!code.match(/^[()=>{}\s]*$/)) console.log(code);
        }
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
    describe("TSE", function() {
        it("Open and Close ENB", async() => {
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '111',
                    symbol: 'ENB',
                    market: 'TSE',
                    order_type: 'LOC',
                    limit: '49.18',
                    tif: 'DAY',
                    traded_at: '2019-05-24T16:00:00-04:00'
                }, {
                    action: 'SELL',
                    quant: '111',
                    symbol: 'ENB',
                    market: 'TSE',
                    order_type: 'LOC',
                    limit: '48.4',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-05-27T16:00:00-04:00'
                }]);
            })({
                now: "2019-05-27T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([]);
        });
        it("Early closing of CP", async() => {
            await broker({
                posted_at:     '2019-05-27T00:00:00-04:00',
                asof:          '2019-05-27T00:00:00-04:00',
                action:        'BUY',
                quant:         '17',
                order_type:          'MOC',
                tif:           'DAY',
                status:        'working',
                symbol:        'CP',
                market:        'TSE',
                currency:      'CAD',
                security_type:       'STK'
            });
            await broker({
                posted_at:     '2019-05-28T10:02:04-04:00',
                asof:          '2019-05-28T11:42:27-04:00',
                action:        'SELL',
                quant:         '17',
                order_type:          'LOC',
                limit:         '293.74',
                tif:           'DAY',
                status:        'working',
                order_ref:     '15d10148c.33',
                symbol:        'CP',
                market:        'TSE',
                currency:      'CAD',
                security_type:       'STK'
            });
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '36',
                    symbol: 'CP',
                    market: 'TSE',
                    order_type: 'LOC',
                    limit: '298.56',
                    tif: 'DAY',
                    traded_at: '2019-05-24T16:00:00-04:00'
                }, {
                    action: 'SELL',
                     quant: '19',
                     symbol: 'CP',
                     market: 'TSE',
                     order_type: 'LOC',
                     limit: '293.84',
                     tif: 'DAY',
                     status: 'pending',
                     traded_at: '2019-05-28T16:00:00-04:00'
                }]);
            })({
                now: "2019-05-28T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                status: 'cancelled',
                order_ref: '15d10148c.33'
            }]);
        });
        it("Reduce after BUY miss of CP", async() => {
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-17T16:00:00-04:00',
                    action: 'BUY',
                    quant: '63',
                    order_type: 'LOC',
                    limit: '297.69',
                    traded_price: '307.99',
                    order_ref: 'buy-order'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-23T16:00:00-04:00',
                    action: 'SELL',
                    quant: '9',
                    order_type: 'LOC',
                    limit: '293.94',
                    traded_price: '299'
                }]);
            })({
                now: "2019-05-23T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                symbol: 'CP',
                market: 'TSE',
                action: 'BUY',
                quant: 54,
                order_type: 'LOC',
                limit: '297.69'
            }]);
        });
        it("Replace after SELL miss of CP", async() => {
            await broker({
                symbol: 'CP',
                market: 'TSE',
                now: '2019-05-17T00:00:00-04:00',
                action: 'BUY',
                quant: '63',
                order_type: 'MOC',
                tif: 'DAY',
                currency: 'CAD',
                security_type: 'STK'
            });
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-17T16:00:00-04:00',
                    action: 'BUY',
                    quant: '63',
                    order_type: 'LOC',
                    limit: '297.69',
                    traded_price: '307.99'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-23T16:00:00-04:00',
                    action: 'SELL',
                    quant: '9',
                    order_type: 'LOC',
                    limit: '293.94',
                    traded_price: '299'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-24T16:00:00-04:00',
                    action: 'BUY',
                    quant: '19',
                    order_type: 'LOC',
                    limit: '305',
                    traded_price: '300.21'
                }]);
            })({
                now: "2019-05-24T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                symbol: 'CP',
                market: 'TSE',
                action: 'BUY',
                quant: 10,
                order_type: 'LOC',
                limit: '305'
            }]);
        });
        it("Combine default order with LOC order for CSU", async() => {
            await broker({
                asof: '2019-05-29T00:00:00-04:00',
                symbol: 'CSU',
                market: 'TSE',
                currency: 'CAD',
                security_type: 'STK',
                multiplier: '',
                action: 'BUY',
                quant: 4,
                order_type: 'MOC',
                tif: 'DAY'
            });
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                     quant: '6',
                     symbol: 'CSU',
                     market: 'TSE',
                     order_type: 'LOC',
                     limit: '1171.24',
                     tif: 'DAY',
                     status: 'pending',
                     traded_at: '2019-05-30T16:00:00-04:00',
                     traded_price: '1175.215'
                }]);
            })({
                now: "2019-05-30T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                action: 'BUY',
                 quant: 2,
                 symbol: 'CSU',
                 market: 'TSE',
                 security_type: 'STK',
                 order_type: 'LOC',
                 limit: '1171.24',
                 tif: 'DAY'
            }]);
        });
        it("Combine same side orders for TRI", async() => {
            await broker({asof: '2019-05-29T00:00:00-04:00',
                symbol: 'TRI',
                market: 'TSE',
                currency: 'CAD',
                security_type: 'STK',
                multiplier: '',
                action: 'BUY',
                quant: 283,
                position: 283,
                price: 85.77,
                order_type: 'MOC',
                tif: 'DAY'
            });
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '281',
                    symbol: 'TRI',
                    market: 'TSE',
                    security_type: 'STK',
                    order_type: 'MOC',
                    tif: 'DAY',
                    traded_at: '2019-05-28T16:00:00-04:00',
                    traded_price: '85.77'
                }, {
                    action: 'BUY',
                    quant: '65',
                    symbol: 'TRI',
                    market: 'TSE',
                    security_type: 'STK',
                    order_type: 'LOC',
                    limit: '85.92',
                    tif: 'DAY',
                    traded_at: '2019-05-29T16:00:00-04:00',
                    traded_price: '85.77'
                }, {
                    action: 'BUY',
                    quant: '48',
                    symbol: 'TRI',
                    market: 'TSE',
                    security_type: 'STK',
                    order_type: 'LOC',
                    limit: '86.1',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-05-30T16:00:00-04:00',
                    traded_price: '85.835'
                }]);
            })({
                now: "2019-05-30T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                action: 'BUY',
                quant: 111,
                symbol: 'TRI',
                market: 'TSE',
                security_type: 'STK',
                order_type: 'LOC',
                limit: '86.1',
                tif: 'DAY'
            }]);
        });
        it("Already filled XGB", async() => {
            return Replicate((options) => {
                    switch (options.help ? 'help' : options.action) {
                        case 'help':
                            return broker({help:true});
                        case 'balances':
                            return Promise.resolve([{ currency: 'USD' },
                                { currency: 'CAD', net: '10033.84', rate: '1' }
                            ])
                        case 'positions':
                            return Promise.resolve([{
                                symbol: 'XGB',
                                market: 'TSE',
                                position: 564,
                                traded_at: '2019-06-04T10:00:00-04:00'
                            }])
                        case 'orders':
                            return Promise.resolve([]);
                        case 'SELL':
                            return {
                            currency: 'CAD',
                            markets: [ 'TSE' ],
                            action: 'SELL',
                            quant: 96,
                            symbol: 'XGB',
                            market: 'TSE',
                            security_type: 'STK',
                            order_type: 'MKT',
                            tif: 'DAY',
                            status: 'pending',
                            traded_at: '2019-06-04T16:00:00-04:00',
                            traded_price: '22.215'
                        };
                        default:
                            throw Error("Unexpected: " + util.inspect(options))
                    }
                }, fetch, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '324',
                    symbol: 'XGB',
                    market: 'TSE',
                    currency: 'CAD',
                    security_type: 'STK',
                    order_type: 'MKT',
                    tif: 'DAY',
                    traded_at: '2019-06-03T16:00:00-04:00',
                    traded_price: '22.27'
                }, {
                    action: 'BUY',
                    quant: '144',
                    symbol: 'XGB',
                    market: 'TSE',
                    currency: 'CAD',
                    security_type: 'STK',
                    order_type: 'MKT',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-06-04T16:00:00-04:00',
                    traded_price: '22.215'
                }]);
            })({
                now: "2019-06-04T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                currency: 'CAD',
                markets: [ 'TSE' ],
                action: 'SELL',
                quant: 96,
                symbol: 'XGB',
                market: 'TSE',
                security_type: 'STK',
                order_type: 'MKT',
                tif: 'DAY',
                status: 'pending',
                traded_at: '2019-06-04T16:00:00-04:00',
                traded_price: '22.215'
            }]);
        });
        it("Already filled XHB", async() => {
            return Replicate((options) => {
                    switch (options.help ? 'help' : options.action) {
                        case 'help':
                            return broker({help:true});
                        case 'balances':
                            return Promise.resolve([{ currency: 'USD' },
                                { currency: 'CAD', net: '10033.84', rate: '1' }
                            ]);
                        case 'positions':
                            return Promise.resolve([{
                                asof: '2019-06-04T10:38:36-04:00',
                                acctNumber: 'U1664535',
                                sales: '2076.00',
                                purchases: '0.00',
                                symbol: 'XHB',
                                market: 'TSE',
                                currency: 'CAD',
                                security_type: 'STK',
                                multiplier: '',
                                action: 'STC',
                                quant: 100,
                                position: 399,
                                traded_at: '2019-06-04T10:38:36-04:00',
                                traded_price: 20.76,
                                price: 20.77,
                                dividend: '0.00',
                                commission: '1.00',
                                mtm: -2,
                                value: '1661.60'
                            }]);
                        case 'orders':
                            return Promise.resolve([{
                                posted_at: '2019-06-04T10:06:21-04:00',
                                asof: '2019-06-04T14:08:16-04:00',
                                action: 'SELL',
                                quant: '22',
                                order_type: 'SNAP MID',
                                stop: '0.01',
                                offset: '0.01',
                                tif: 'DAY',
                                status: 'working',
                                traded_price: '20.76',
                                order_ref: 'SNAPPRIM.1c3b555f2.112',
                                account: 'MKSTK',
                                symbol: 'XHB',
                                market: 'TSE',
                                currency: 'CAD',
                                security_type: 'STK'
                            }]);
                        case 'SELL':
                            options.should.be.like({
                                currency: 'CAD',
                                markets: [ 'TSE' ],
                                quant: 21,
                                order_ref: 'SNAPPRIM.1c3b555f2.112',
                                action: 'SELL',
                                symbol: 'XHB',
                                market: 'TSE',
                                security_type: 'STK',
                                order_type: 'SNAP MID',
                                tif: 'DAY',
                                status: 'pending',
                                traded_at: '2019-06-04T16:00:00-04:00',
                                traded_price: '20.755'
                            });
                            return {
                                currency: 'CAD',
                                markets: [ 'TSE' ],
                                quant: 21,
                                order_ref: 'SNAPPRIM.1c3b555f2.112',
                                action: 'SELL',
                                symbol: 'XHB',
                                market: 'TSE',
                                security_type: 'STK',
                                order_type: 'SNAP MID',
                                tif: 'DAY',
                                status: 'pending',
                                traded_at: '2019-06-04T16:00:00-04:00',
                                traded_price: '20.755'
                            };
                        default:
                            throw Error("Unexpected: " + util.inspect(options))
                    }
                }, fetch, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '1248',
                    symbol: 'XHB',
                    market: 'TSE',
                    currency: 'CAD',
                    security_type: 'STK',
                    order_type: 'SNAP MID',
                    tif: 'DAY',
                    traded_at: '2019-06-02T16:00:00-04:00'
                }, {
                    action: 'SELL',
                    quant: '345',
                    symbol: 'XHB',
                    market: 'TSE',
                    currency: 'CAD',
                    security_type: 'STK',
                    order_type: 'SNAP MID',
                    tif: 'DAY',
                    traded_at: '2019-06-03T16:00:00-04:00',
                    traded_price: '20.77'
                }, {
                    action: 'SELL',
                    quant: '525',
                    symbol: 'XHB',
                    market: 'TSE',
                    currency: 'CAD',
                    security_type: 'STK',
                    order_type: 'SNAP MID',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-06-04T16:00:00-04:00',
                    traded_price: '20.755'
                }]);
            })({
                now: "2019-06-04T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.like([{
                currency: 'CAD',
                markets: [ 'TSE' ],
                quant: 21,
                order_ref: 'SNAPPRIM.1c3b555f2.112',
                action: 'SELL',
                symbol: 'XHB',
                market: 'TSE',
                security_type: 'STK',
                order_type: 'SNAP MID',
                tif: 'DAY',
                status: 'pending',
                traded_at: '2019-06-04T16:00:00-04:00',
                traded_price: '20.755'
            }]);
        });
    });
    describe("Options", function() {
        it("submit BUY combo order", async() => {
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    name: 'SPX Jun 2019 C 3075',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'BUY',
                    quant: '3',
                    position: '0',
                    order_type: 'MKT',
                    offset: '0',
                    traded_price: '0.15'
                }, {
                    symbol: 'SPX   190621C03125000',
                    market: 'OPRA',
                    name: 'SPX Jun 2019 C 3125',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'SELL',
                    quant: '3',
                    position: '0',
                    order_type: 'MKT',
                    offset: '0',
                    traded_price: '0.05'
                }]);
            })({
                now: "2019-05-27T12:00:00",
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT'],
                default_multiplier: 100
            }).should.eventually.be.like([{
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'BUY',
                quant: 3,
                order_type: 'MKT',
                tif: 'DAY'
            }, {
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'BUY',
                quant: 1,
                order_type: 'LEG',
                symbol: 'SPX   190621C03075000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100'
            }, {
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: 1,
                order_type: 'LEG',
                symbol: 'SPX   190621C03125000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100'
            }]);
        });
        it("submit SELL combo order", async() => {
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: 100,
                    name: 'SPX Jun 2019 C 3075',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'SELL',
                    quant: '3',
                    position: '0',
                    order_type: 'MKT',
                    offset: '0',
                    traded_price: '0.15',
                    basis: '0.3',
                    commission: '4',
                    value: '0',
                    realized: '-7.4',
                    unrealized: '0',
                    date: '2019-05-29',
                    year: '2019',
                    qtr: '2',
                    month: '5',
                    day: '107'
                }, {
                    symbol: 'SPX   190621C03125000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: 100,
                    name: 'SPX Jun 2019 C 3125',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'BUY',
                    quant: '3',
                    position: '0',
                    order_type: 'MKT',
                    offset: '0',
                    traded_price: '0.05',
                    basis: '0.18',
                    commission: '4',
                    value: '0',
                    realized: '-8.24',
                    unrealized: '0',
                    date: '2019-05-29',
                    year: '2019',
                    qtr: '2',
                    month: '5',
                    day: '107'
                }]);
            })({
                now: "2019-05-27T12:00:00",
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT']
            }).should.eventually.be.like([{
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: 3,
                order_type: 'MKT',
                tif: 'DAY'
            }, {
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'BUY',
                quant: 1,
                order_type: 'LEG',
                symbol: 'SPX   190621C03075000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100'
            }, {
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: 1,
                order_type: 'LEG',
                symbol: 'SPX   190621C03125000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100'
            }]);
        });
        it("adjust combo order", async() => {
            await broker({
                order_ref: 'combo_order',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: 3,
                order_type: 'MKT',
                tif: 'DAY',
                attached: [{
                    action: 'BUY',
                    quant: 1,
                    order_type: 'LEG',
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: '100'
                }, {
                    action: 'SELL',
                    quant: 1,
                    order_type: 'LEG',
                    symbol: 'SPX   190621C03125000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: '100'
                }]
            });
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: 100,
                    name: 'SPX Jun 2019 C 3075',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'SELL',
                    quant: '3',
                    position: '0',
                    order_type: 'MKT',
                    offset: '0',
                    traded_price: '0.15',
                    basis: '0.3',
                    commission: '4',
                    value: '0',
                    realized: '-7.4',
                    unrealized: '0',
                    date: '2019-05-29',
                    year: '2019',
                    qtr: '2',
                    month: '5',
                    day: '107'
                }, {
                    symbol: 'SPX   190621C03125000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: 100,
                    name: 'SPX Jun 2019 C 3125',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'BUY',
                    quant: '3',
                    position: '0',
                    order_type: 'MKT',
                    offset: '0',
                    traded_price: '0.05',
                    basis: '0.18',
                    commission: '4',
                    value: '0',
                    realized: '-8.24',
                    unrealized: '0',
                    date: '2019-05-29',
                    year: '2019',
                    qtr: '2',
                    month: '5',
                    day: '107'
                }]);
            })({
                now: "2019-05-27T12:00:00",
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT']
            })
              .then(d=>d.forEach(d=>console.log(d))||d)
              .should.eventually.be.like([]);
        });
    });
    describe("Futures", function() {
        it("no position in ZNH19", async() => {
            const posted = await replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T16:00:00-05:00',
                    action: 'BUY',
                    quant: '5',
                    position: '5',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '120.9375',
                    basis: '120.94',
                    commission: '10.25',
                    value: '604531.25',
                    realized: '2.25',
                    unrealized: '-168.75',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '120.5625',
                    stop: '120.59375',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '604687.5',
                    realized: '2.25',
                    unrealized: '-12.5',
                    date: '2018-12-26'
                }]);
            })({
                now: "2018-12-26T17:00:00",
                currency: 'USD',
                markets: ['CBOT']
            });
            posted.should.be.like([{
                  action: 'BUY',
                  quant: '5',
                  order_type: 'MOC',
                  tif: 'DAY',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  order_ref: posted[0].order_ref,
                  status: 'working'
                }, {
                  action: 'SELL',
                  quant: '5',
                  order_type: 'STP',
                  stop: '120.59375',
                  tif: 'GTC',
                  attach_ref: posted[0].order_ref,
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  status: 'pending'
            }]);
        });
        it("no stoploss in ZNH19", async() => {
            await broker({
                  asof: '2018-12-26',
                  action: 'BUY',
                  quant: '5',
                  order_type: 'MOC',
                  tif: 'DAY',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  multiplier: 1000
            });
            const posted = await replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T16:00:00-05:00',
                    action: 'BUY',
                    quant: '5',
                    position: '5',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '120.9375',
                    basis: '120.94',
                    commission: '10.25',
                    value: '604531.25',
                    realized: '2.25',
                    unrealized: '-168.75',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '120.5625',
                    stop: '120.59375',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '604687.5',
                    realized: '2.25',
                    unrealized: '-12.5',
                    date: '2018-12-26'
                }]);
            })({
                now: "2018-12-26T17:00:00",
                currency: 'USD',
                markets: ['CBOT']
            });
            posted.should.be.like([{
                  action: 'SELL',
                  quant: 5,
                  order_type: 'STP',
                  stop: '120.59375',
                  tif: 'GTC',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  status: 'working'
            }]);
        });
        it("update stoploss ZNH19", async() => {
            await broker({
                  asof: '2018-12-26',
                  action: 'BUY',
                  quant: '5',
                  order_type: 'MOC',
                  tif: 'DAY',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  multiplier: 1000
            });
            const stp = await broker({
                  asof: '2018-12-26T17:00:00',
                  action: 'SELL',
                  quant: 5,
                  order_type: 'STP',
                  stop: '120.59375',
                  tif: 'GTC',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  multiplier: 1000
            });
            return replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T16:00:00-05:00',
                    action: 'BUY',
                    quant: '5',
                    position: '5',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '120.9375',
                    basis: '120.94',
                    commission: '10.25',
                    value: '604531.25',
                    realized: '2.25',
                    unrealized: '-168.75',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '120.5625',
                    stop: '120.59375',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '604687.5',
                    realized: '2.25',
                    unrealized: '-12.5',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '122.21875',
                    stop: '122.25',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '612890.625',
                    realized: '2.25',
                    unrealized: '8190.63',
                    date: '2019-01-04'
                }]);
            })({
                now: "2019-01-04T09:00:00",
                currency: 'USD',
                markets: ['CBOT']
            }).should.eventually.be.like([{
                  order_ref: stp[0].order_ref,
                  action: 'SELL',
                  quant: 5,
                  order_type: 'STP',
                  stop: '122.25',
                  tif: 'GTC',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD'
            }]);
        });
        it("close position for ZNH19", async() => {
            await broker({
                  asof: '2018-12-26',
                  action: 'BUY',
                  quant: '5',
                  order_type: 'MOC',
                  tif: 'DAY',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  multiplier: 1000
            });
            const stp = await broker({
                  asof: '2019-01-04',
                  action: 'SELL',
                  quant: 5,
                  order_type: 'STP',
                  stop: '122.25',
                  tif: 'GTC',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  multiplier: 1000
            });
            await replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T16:00:00-05:00',
                    action: 'BUY',
                    quant: '5',
                    position: '5',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '120.9375',
                    basis: '120.94',
                    commission: '10.25',
                    value: '604531.25',
                    realized: '2.25',
                    unrealized: '-168.75',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '120.5625',
                    stop: '120.59375',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '604687.5',
                    realized: '2.25',
                    unrealized: '-12.5',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '122.21875',
                    stop: '122.25',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '612890.625',
                    realized: '2.25',
                    unrealized: '8190.63',
                    date: '2019-01-04'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T11:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '122.21875',
                    basis: '120.91',
                    commission: '10.25',
                    value: '0',
                    realized: '6385.75',
                    unrealized: '0',
                    date: '2019-01-04'
                }]);
            })({
                now: "2019-01-04T11:00:00",
                currency: 'USD',
                markets: ['CBOT']
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: '5',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD'
            }]);
        });
        it("check position is closed for ZNH19", async() => {
            await broker({
                asof: '2018-12-26',
                action: 'BUY',
                quant: '5',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            const stp = await broker({
                asof: '2019-01-04',
                action: 'SELL',
                quant: 5,
                order_type: 'STP',
                stop: '122.25',
                tif: 'GTC',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            await replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T16:00:00-05:00',
                    action: 'BUY',
                    quant: '5',
                    position: '5',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '120.9375',
                    basis: '120.94',
                    commission: '10.25',
                    value: '604531.25',
                    realized: '2.25',
                    unrealized: '-168.75',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '120.5625',
                    stop: '120.59375',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '604687.5',
                    realized: '2.25',
                    unrealized: '-12.5',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '122.21875',
                    stop: '122.25',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '612890.625',
                    realized: '2.25',
                    unrealized: '8190.63',
                    date: '2019-01-04'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T11:00:00-05:00',
                    traded_at: '2019-01-04T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '122.21875',
                    basis: '120.91',
                    commission: '10.25',
                    value: '0',
                    realized: '6385.75',
                    unrealized: '0',
                    date: '2019-01-04'
                }]);
            })({
                now: "2019-01-04T17:00:00",
                currency: 'USD',
                markets: ['CBOT']
            })
              .then(d=>d.forEach(d=>console.log(d))||d)
              .should.eventually.be.like([]);
        });
        it("cancel stoploss for ZNH19", async() => {
            await broker({
                asof: '2018-12-26',
                action: 'BUY',
                quant: '5',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            const stp = await broker({
                asof: '2019-01-04',
                action: 'SELL',
                quant: 5,
                order_type: 'STP',
                stop: '122.00',
                tif: 'GTC',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            await broker({
                asof: '2019-01-04',
                action: 'SELL',
                quant: '5',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            await replicate(function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T16:00:00-05:00',
                    action: 'BUY',
                    quant: '5',
                    position: '5',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '120.9375',
                    basis: '120.94',
                    commission: '10.25',
                    value: '604531.25',
                    realized: '2.25',
                    unrealized: '-168.75',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2018-12-26T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '120.5625',
                    stop: '120.59375',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '604687.5',
                    realized: '2.25',
                    unrealized: '-12.5',
                    date: '2018-12-26'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '5',
                    order_type: 'STP',
                    tif: 'GTC',
                    offset: '0',
                    limit: '122.21875',
                    stop: '122.25',
                    traded_price: '',
                    basis: '120.94',
                    commission: '',
                    value: '612890.625',
                    realized: '2.25',
                    unrealized: '8190.63',
                    date: '2019-01-04'
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T11:00:00-05:00',
                    traded_at: '2019-01-04T17:00:00-05:00',
                    action: 'SELL',
                    quant: '5',
                    position: '',
                    order_type: 'MOC',
                    tif: 'DAY',
                    offset: '0',
                    limit: '',
                    stop: '',
                    traded_price: '122.21875',
                    basis: '120.91',
                    commission: '10.25',
                    value: '0',
                    realized: '6385.75',
                    unrealized: '0',
                    date: '2019-01-04'
                }]);
            })({
                now: "2019-01-04T17:00:00",
                currency: 'USD',
                markets: ['CBOT']
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 5,
                order_type: 'STP',
                stop: '122.00',
                tif: 'GTC',
                symbol: 'ZNH19',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000,
                order_ref: stp[0].order_ref,
                status: 'cancelled'
            }]);
        });
    });
});
