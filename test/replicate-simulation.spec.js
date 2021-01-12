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
const merge = require('../src/merge.js');
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
const expect = require('chai').use(like).expect;

describe("replicate-simulation", function() {
    this.timeout(60000);
    var fetch, quote, collect, broker, snapshot, replicate;
    before(function() {
        config('runInBand', true);
        config('prefix', createTempDir('simulation'));
        fetch = Fetch(merge(config('fetch'), {
            files: {
                enabled: true,
                dirname: path.resolve(__dirname, 'data'),
                fetch: {
                    remote: {
                        enabled: true,
                        location: "wss://WildDog:1ooewjc@merritt.catchpointcapital.ca:443"
                    }
                }
            }
        }));
        quote = new Quote(fetch);
        collect = new Collect(fetch, quote);
        broker = new Broker({
            simulation: 'test',
            ...config('broker.simulation'),
            fetch: {
                files: {
                    enabled: true,
                    dirname: path.resolve(__dirname, 'data')
                }
            }
        }, quote);
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
        config.unset('runInBand');
        return Promise.all([
            broker.close(),
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    describe("Stocks", function() {
        it("Open and Close ENB", async() => {
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '111',
                    position: '111',
                    symbol: 'ENB',
                    market: 'TSE',
                    order_type: 'LOC',
                    limit: '49.18',
                    tif: 'DAY',
                    traded_at: '2019-05-24T16:00:00-04:00'
                }, {
                    action: 'SELL',
                    quant: '111',
                    position: '0',
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '36',
                    position: '36',
                    symbol: 'CP',
                    market: 'TSE',
                    order_type: 'LOC',
                    limit: '298.56',
                    tif: 'DAY',
                    traded_at: '2019-05-24T16:00:00-04:00'
                }, {
                    action: 'SELL',
                     quant: '19',
                    position: '17',
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-17T16:00:00-04:00',
                    action: 'BUY',
                    quant: '63',
                    position: '63',
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
                    position: '54',
                    order_type: 'LOC',
                    limit: '293.94',
                    traded_price: '299'
                }]);
            })({
                now: "2019-05-23T12:00:00",
                currency: 'CAD',
                markets: ['TSE'],
                default_order_type: 'MOC'
            }).should.eventually.be.like([{
                symbol: 'CP',
                market: 'TSE',
                action: 'BUY',
                quant: 54,
                order_type: 'MOC'
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-17T16:00:00-04:00',
                    action: 'BUY',
                    quant: '63',
                    position: '63',
                    order_type: 'LOC',
                    limit: '297.69',
                    traded_price: '307.99'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-23T16:00:00-04:00',
                    action: 'SELL',
                    quant: '9',
                    position: '54',
                    order_type: 'LOC',
                    limit: '293.94',
                    traded_price: '299'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-24T16:00:00-04:00',
                    action: 'BUY',
                    quant: '19',
                    position: '73',
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                     quant: '6',
                     position: '6',
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '281',
                    position: '281',
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
                    position: '346',
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
                    position: '394',
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
            return Replicate(async(options) => {
                    switch (options.info || options.action) {
                        case 'help':
                            return broker({info:'help'});
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '324',
                    position: '324',
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
                    position: '468',
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
            return Replicate(async(options) => {
                    switch (options.info || options.action) {
                        case 'help':
                            return broker({info:'help'});
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
                                tif: 'DAY'
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
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '1248',
                    position: '1248',
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
                    position: '903',
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
                    position: '378',
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
        it("Reduce HYMB", async() => {
            return Replicate(async(options) => {
                    switch (options.info || options.action) {
                        case 'help':
                            return broker({info:'help'});
                        case 'balances':
                            return Promise.resolve([
                                { currency: 'USD', net: '100000', rate: '1' }
                            ]);
                        case 'positions':
                            return Promise.resolve([{
                                asof: '2019-07-31T16:00:00-04:00',
                                acctNumber: 'U1664535',
                                sales: '0.00',
                                purchases: '0.00',
                                symbol: 'HYMB',
                                market: 'NYSE',
                                currency: 'USD',
                                security_type: 'STK',
                                multiplier: '',
                                action: 'LONG',
                                quant: null,
                                position: 538,
                                traded_at: null,
                                traded_price: null,
                                price: 58.63,
                                dividend: '0.00',
                                commission: '0.00',
                                mtm: 2.14,
                                value: '6273.41'
                            }]);
                        case 'orders':
                            return Promise.resolve([{
                                posted_at: '2019-08-01T11:30:03-04:00',
                                asof: '2019-08-01T15:48:27-04:00',
                                action: 'SELL',
                                quant: '194',
                                order_type: 'LOC',
                                limit: '58.25',
                                tif: 'DAY',
                                status: 'working',
                                order_ref: 'LOC.820c38d8.22',
                                attach_ref: '',
                                account: 'MKSTK',
                                symbol: 'HYMB',
                                market: 'NYSE',
                                currency: 'USD',
                                security_type: 'STK',
                                multiplier: ''
                            }]);
                        case 'SELL':
                            options.should.be.like({
                                quant: 538-177,
                                order_ref: 'LOC.820c38d8.22',
                                attach_ref: '',
                                action: 'SELL',
                                symbol: 'HYMB',
                                market: 'NYSE',
                                currency: 'USD',
                                security_type: 'STK',
                                order_type: 'LOC',
                                limit: '58.25',
                                tif: 'DAY'
                            });
                            return {
                                quant: 538-177,
                                order_ref: 'LOC.820c38d8.22',
                                attach_ref: '',
                                action: 'SELL',
                                symbol: 'HYMB',
                                market: 'NYSE',
                                currency: 'USD',
                                security_type: 'STK',
                                order_type: 'LOC',
                                limit: '58.25',
                                tif: 'DAY',
                                status: 'pending',
                                traded_at: '2019-08-01T16:00:00-04:00',
                                traded_price: '58.52'
                            };
                        default:
                            throw Error("Unexpected: " + util.inspect(options))
                    }
                }, fetch, function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    traded_at: '2019-07-30T16:00:00-04:00',
                    symbol: 'HYMB',
                    market: 'NYSE',
                    currency: 'USD',
                    security_type: 'STK',
                    quant: 343+446,
                    position: 343+446
                }, {
                    action: 'SELL',
                    quant: '446',
                    position: 343,
                    symbol: 'HYMB',
                    market: 'NYSE',
                    currency: 'USD',
                    security_type: 'STK',
                    order_type: 'LOC',
                    limit: '58.25',
                    tif: 'DAY',
                    traded_at: '2019-07-31T16:00:00-04:00',
                    traded_price: '58.63'
                }, {
                    action: 'SELL',
                    quant: '166',
                    position: 177,
                    symbol: 'HYMB',
                    market: 'NYSE',
                    currency: 'USD',
                    security_type: 'STK',
                    order_type: 'LOC',
                    limit: '58.25',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-08-01T16:00:00-04:00',
                    traded_price: '58.52'
                }]);
            })({
                now: "2019-08-01T15:48:31-04:00",
                currency: 'USD',
                markets: ['NYSE']
            }).should.eventually.be.like([{
                quant: 538-177,
                order_ref: 'LOC.820c38d8.22',
                attach_ref: '',
                action: 'SELL',
                symbol: 'HYMB',
                market: 'NYSE',
                currency: 'USD',
                security_type: 'STK',
                order_type: 'LOC',
                limit: '58.25',
                tif: 'DAY'
            }]);
        });
        it("Thrown error", async() => {
            return Replicate(async(options) => {
                    switch (options.info || options.action) {
                        case 'help':
                            return broker({info:'help'});
                        case 'balances':
                            return Promise.resolve([{ currency: 'USD' },
                                { currency: 'CAD', net: '10033.84', rate: '1' }
                            ])
                        case 'positions':
                            return Promise.resolve([])
                        case 'orders':
                            return Promise.resolve([]);
                        case 'BUY':
                            throw Error("thrown error");
                        default:
                            throw Error("Unexpected: " + util.inspect(options))
                    }
                }, fetch, function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '324',
                    position: 324,
                    symbol: 'XGB',
                    market: 'TSE',
                    currency: 'CAD',
                    security_type: 'STK',
                    order_type: 'MKT',
                    tif: 'DAY',
                    traded_at: '2019-06-03T16:00:00-04:00',
                    traded_price: '22.27'
                }]);
            })({
                begin: "2019-06-03T12:00:00",
                now: "2019-06-04T12:00:00",
                currency: 'CAD',
                markets: ['TSE']
            }).should.eventually.be.rejectedWith(Error);
        });
        it("Match adjustment orders", async() => {
            await broker({
                action: 'BUY',
                order_type: 'MKT',
                tif: 'DAY',
                quant: 678,
                asof: '2019-12-27T16:00:00-05:00',
                symbol: 'AMGN',
                market: 'NASDAQ',
                currency: 'USD',
                security_type: 'STK'
            });
            await broker({
                action: 'SELL',
                quant: '678',
                symbol: 'AMGN',
                market: 'NASDAQ',
                order_type: 'MKT',
                tif: 'DAY',
                order_ref: '1a3019e2',
                status: 'working',
                asof: "2020-01-31T09:30:09-05:00"
            });
            return Replicate(broker, fetch, function(options) {
                if (options.info=='help') return collect(options);
                else return Promise.resolve([]);
            })({
                begin: "2020-01-31T09:30:09-05:00",
                now: "2020-01-31T09:30:09-05:00",
                currency: 'USD',
                markets: ['NASDAQ'],
                portfolio: "AMGN.NASDAQ"
            }).should.eventually.be.like([]);
        });
    });
    describe("Options", function() {
        it("submit BUY combo order", async() => {
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    name: 'SPX Jun 2019 C 3075',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'BUY',
                    quant: '3',
                    position: '3',
                    order_type: 'MKT',
                    offset: '0',
                    order_ref: 'spx_combo',
                    traded_price: '0.15'
                }, {
                    symbol: 'SPX   190621C03125000',
                    market: 'OPRA',
                    name: 'SPX Jun 2019 C 3125',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'SELL',
                    quant: '3',
                    position: '-3',
                    order_type: 'MKT',
                    offset: '0',
                    order_ref: 'spx_combo',
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
                if (options.info=='help') return quote(options);
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
                    position: '-3',
                    order_type: 'MKT',
                    order_ref: 'spx_combo',
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
                    position: '3',
                    order_type: 'MKT',
                    order_ref: 'spx_combo',
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
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: 3,
                order_type: 'MKT',
                order_ref: 'combo_order',
                offset: '1',
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
                if (options.info=='help') return quote(options);
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
                    position: '-3',
                    order_type: 'MKT',
                    order_ref: 'combo_order',
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
                    position: '3',
                    order_type: 'MKT',
                    order_ref: 'combo_order',
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
                offset: '0',
                tif: 'DAY',
                order_ref: 'combo_order',
                currency: 'USD',
                multiplier: 100,
                status: 'working' },
                { posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'BUY',
                quant: '1',
                order_type: 'LEG',
                order_ref: null,
                attach_ref: 'combo_order',
                symbol: 'SPX   190621C03075000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100',
                status: 'pending' },
                { posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: '1',
                order_type: 'LEG',
                order_ref: null,
                attach_ref: 'combo_order',
                symbol: 'SPX   190621C03125000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100',
                status: 'pending'
            }]);
        });
        it("don't adjust combo order", async() => {
            await broker({
                order_ref: 'combo_order',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'SELL',
                quant: 3,
                order_type: 'MKT',
                order_ref: 'spx_combo',
                offset: '0',
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
                if (options.info=='help') return quote(options);
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
                    position: '-3',
                    order_type: 'MKT',
                    order_ref: 'spx_combo',
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
                    position: '3',
                    order_type: 'MKT',
                    order_ref: 'spx_combo',
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
        it("option position already closed", async() => {
            return Replicate(async(...args) => {
                if (args[0].info=='help') return broker({info:'help'});
                switch (args[0].action) {
                    case 'balances':
                        return Promise.resolve([{ currency: 'USD', net: '9995.65', rate: '1', settled: '9995.65' },
                            { currency: 'CAD' }
                        ]);
                    case 'positions':
                        return Promise.resolve([{
                            asof: '2019-06-14T15:51:18-04:00',
                            acctNumber: 'U1878120',
                            sales: '24.00',
                            purchases: '0.00',
                            symbol: 'SPX   190621P02575000',
                            market: 'OPRA',
                            currency: 'USD',
                            security_type: 'OPT',
                            multiplier: '100',
                            action: 'STC',
                            quant: 3,
                            position: 0,
                            traded_at: '2019-06-14T15:51:18-04:00',
                            traded_price: 0.08,
                            price: 0.15,
                            dividend: '0.00',
                            commission: '3.33',
                            mtm: -24.33,
                            value: '0.00'
                        }]);
                    case 'orders':
                        return Promise.resolve([]);
                    default:
                        throw Error(`Unexpected call ${util.inspect(args)}`);
                }
            }, fetch, function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '3',
                    position: '3',
                    symbol: 'SPX   190621P02575000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    order_type: 'MKT',
                    tif: 'DAY',
                    traded_at: '2019-06-11T16:15:00-04:00',
                    traded_price: '0.1'
                }, {
                    action: 'SELL',
                    quant: '2',
                    position: '1',
                    symbol: 'SPX   190621P02575000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    order_type: 'MKT',
                    tif: 'DAY',
                    traded_at: '2019-06-13T16:15:00-04:00',
                    traded_price: '0.1'
                }, {
                    action: 'SELL',
                    quant: '1',
                    position: '0',
                    symbol: 'SPX   190621P02575000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    order_type: 'MKT',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-06-14T16:15:00-04:00',
                    traded_price: '0.08'
                }]);
            })({
                now: '2019-06-14T15:51:18-04:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT']
            })
              .then(d=>d.forEach(d=>console.log(d))||d)
              .should.eventually.be.like([]);
        });
        it("option minTick", async() => {
            return Replicate(async(...args) => {
                if (args[0].info=='help') return broker({info:'help'});
                switch (args[0].action) {
                    case 'balances':
                        return Promise.resolve([{ currency: 'USD', net: '10000', rate: '1', settled: '10000' },
                            { currency: 'CAD' }
                        ]);
                    case 'positions':
                        return Promise.resolve([]);
                    case 'orders':
                        return Promise.resolve([]);
                    case 'BUY':
                        expect(args).to.be.like([{
                            currency: 'USD',
                            action: 'BUY',
                            quant: 2,
                            symbol: 'SPX   190920C02975000',
                            market: 'OPRA',
                            security_type: 'OPT',
                            minTick: '0.1',
                            order_type: 'SNAP STK',
                            offset: '3.67',
                            tif: 'DAY'
                        }]);
                        return Promise.resolve([{
                            currency: 'USD',
                            action: 'BUY',
                            quant: 2,
                            symbol: 'SPX   190920C02975000',
                            market: 'OPRA',
                            security_type: 'OPT',
                            order_type: 'SNAP STK',
                            offset: '3.67',
                            tif: 'DAY'
                        }]);
                    default:
                        throw Error(`Unexpected call ${util.inspect(args)}`);
                }
            }, fetch, function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '2',
                    position: '2',
                    symbol: 'SPX   190920C02975000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1',
                    order_type: 'SNAP STK',
                    offset: '3.67',
                    tif: 'DAY',
                    status: 'pending',
                    traded_at: '2019-06-20T16:15:00-04:00',
                    traded_price: '67.41'
                }]);
            })({
                now: '2019-06-14T15:51:18-04:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT']
            }).should.eventually.be.like([{
                currency: 'USD',
                action: 'BUY',
                quant: 2,
                symbol: 'SPX   190920C02975000',
                market: 'OPRA',
                security_type: 'OPT',
                order_type: 'SNAP STK',
                offset: '3.67',
                tif: 'DAY'
              }]);
        });
        it("filled working order", async() => {
            return Replicate(async(...args) => {
                if (args[0].info=='help') return broker({info:'help'});
                switch (args[0].action) {
                    case 'balances':
                        return Promise.resolve([{ currency: 'USD', net: '10000', rate: '1', settled: '10000' },
                            { currency: 'CAD' }
                        ]);
                    case 'positions':
                        return Promise.resolve([{
                            traded_at: '2018-04-05T16:00:00-04:00',
                            symbol: 'GLD',
                            market: 'NYSE',
                            currency: 'USD',
                            security_type: 'STK',
                            action: 'STC',
                            quant: 1,
                            position: 0,
                            traded_price: 125.8,
                            price: 125.8,
                            value: '125.80'
                        }]);
                    case 'orders':
                        return Promise.resolve([]);
                    default:
                        throw Error(`Unexpected call ${util.inspect(args)}`);
                }
            }, fetch, function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    symbol: 'GLD',
                    market: 'NYSE',
                    position: 1,
                    posted_at: "2018-04-04",
                    stc_action: 'SELL',
                    stc_quant: 1,
                    stc_order_type: 'LMT',
                    stc_limit: 125.8,
                    stc_order_ref: 'stc.GLD'
                }]);
            })({
                now: moment.tz("2018-04-05T16:00:00", 'America/New_York').valueOf(),
                currency: 'USD',
                markets: ['OPRA']
            }).should.eventually.be.like([]);
        });
        it("adjust position, but not a filled working order", async() => {
            return Replicate(async(...args) => {
                if (args[0].info=='help') return broker({info:'help'});
                switch (args[0].action) {
                    case 'balances':
                        return Promise.resolve([{ currency: 'USD', net: '10000', rate: '1', settled: '10000' },
                            { currency: 'CAD' }
                        ]);
                    case 'positions':
                        return Promise.resolve([{
                            traded_at: '2018-04-05T16:00:00-04:00',
                            symbol: 'GLD',
                            market: 'NYSE',
                            currency: 'USD',
                            security_type: 'STK',
                            action: 'STC',
                            quant: 1,
                            position: 1,
                            traded_price: 125.8,
                            price: 125.8,
                            value: '125.80'
                        }]);
                    case 'orders':
                        return Promise.resolve([]);
                    case 'SELL':
                        expect(args).to.be.like([{
                            action: 'SELL',
                            quant: 1,
                            order_type: 'LMT',
                            limit: 125.8,
                            order_ref: 'stc.GLD'
                        }]);
                        return Promise.resolve([{
                            action: 'SELL',
                            quant: 1,
                            order_type: 'LMT',
                            limit: 125.8,
                            order_ref: 'stc.GLD'
                        }]);
                    default:
                        throw Error(`Unexpected call ${util.inspect(args)}`);
                }
            }, fetch, function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    symbol: 'GLD',
                    market: 'NYSE',
                    position: 1,
                    posted_at: "2018-04-04",
                    stc_action: 'SELL',
                    stc_quant: 1,
                    stc_order_type: 'LMT',
                    stc_limit: 125.8,
                    stc_order_ref: 'stc.GLD'
                }]);
            })({
                now: moment.tz("2018-04-05T16:00:00", 'America/New_York').valueOf(),
                currency: 'USD',
                markets: ['OPRA']
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 1,
                order_type: 'LMT',
                limit: 125.8,
                order_ref: 'stc.GLD'
            }]);
        });
    });
    describe("Futures", function() {
        it("no position in ZNH19", async() => {
            const posted = await replicate(function(options) {
                if (options.info=='help') return quote(options);
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
                    date: '2018-12-26',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '120.59375',
                }]);
            })({
                now: "2018-12-26T16:00:00",
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
                  order_ref: (posted[0]||{}).order_ref,
                  status: 'working'
                }, {
                  action: 'SELL',
                  quant: '5',
                  order_type: 'STP',
                  stop: '120.59375',
                  tif: 'GTC',
                  attach_ref: (posted[0]||{}).order_ref,
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
                if (options.info=='help') return quote(options);
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
                    date: '2018-12-26',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '120.59375',
                }]);
            })({
                now: "2018-12-26T16:00:00",
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
                  multiplier: 1000,
                  order_ref: 'stp_ZNH19.test'
            });
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
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
                    date: '2018-12-26',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '120.59375',
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'BUY',
                    position: '5',
                    order_type: 'LIMIT',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    limit: '122.21875',
                    stp_stop: '122.25',
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
                markets: ['CBOT'],
                label: 'test'
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
                  multiplier: 1000,
                  order_ref: 'stp_ZNH19.test'
            });
            await replicate(function(options) {
                if (options.info=='help') return quote(options);
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
                    date: '2018-12-26',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '120.59375',
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'BUY',
                    order_type: 'LIMIT',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    position: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    limit: '122.21875',
                    stp_stop: '122.25',
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
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '122.25',
                    traded_price: '122.21875',
                    basis: '120.91',
                    commission: '10.25',
                    value: '0',
                    realized: '6385.75',
                    unrealized: '0',
                    date: '2019-01-04'
                }]);
            })({
                now: "2019-01-04T10:00:00",
                currency: 'USD',
                markets: ['CBOT'],
                label: 'test'
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
                multiplier: 1000,
                order_ref: 'stp_ZNH19.test'
            });
            await replicate(function(options) {
                if (options.info=='help') return quote(options);
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
                    date: '2018-12-26',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '120.59375',
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'BUY',
                    order_type: 'LIMIT',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    position: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    offset: '0',
                    limit: '122.21875',
                    stp_stop: '122.25',
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
                markets: ['CBOT'],
                label: 'test'
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
                multiplier: 1000,
                order_ref: 'stp_ZNH19.test'
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
                if (options.info=='help') return quote(options);
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
                    date: '2018-12-26',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    stp_stop: '120.59375',
                }, {
                    symbol: 'ZNH19',
                    market: 'CBOT',
                    name: 'ZN Mar 15 2019',
                    posted_at: '2019-01-04T09:00:00-05:00',
                    action: 'BUY',
                    order_type: 'LIMIT',
                    stp_action: 'SELL',
                    stp_quant: '5',
                    position: '5',
                    stp_order_type: 'STP',
                    stp_tif: 'GTC',
                    limit: '122.21875',
                    stp_stop: '122.25',
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
                markets: ['CBOT'],
                label: 'test'
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
        it("keep stoploss for ZNM20 when submiting profit order", async() => {
            await broker({
                asof: '2020-03-15',
                action: 'BUY',
                quant: '10',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'ZNM20',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            const stp = await broker({
                asof: '2020-03-16T18:00:00-04:00',
                action: 'SELL',
                quant: 10,
                order_type: 'STP',
                stop: 137.4375,
                tif: 'GTC',
                extended_hours: true,
                status: 'working',
                order_ref: 'stoploss.ZNM20.mksafe-orders',
                symbol: 'ZNM20',
                market: 'CBOT',
                currency: 'USD',
                security_type: 'FUT',
                multiplier: '1000'
            });
            await replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    posted_at: '2020-03-16T19:00:00-04:00',
                    action: 'SELL',
                    quant: '6',
                    position: '4',
                    order_type: 'LMT',
                    limit: '138.578125',
                    tif: 'DAY',
                    order_ref: 'LMT.ZNM20.mksafe-orders',
                    symbol: 'ZNM20',
                    market: 'CBOT',
                    currency: 'USD',
                    security_type: 'FUT',
                    stoploss: '137.4375'
                }]);
            })({
                now: "2020-03-16T20:00:00",
                currency: 'USD',
                markets: ['CBOT'],
                label: 'test'
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: 6,
                order_type: 'LMT',
                limit: 138.578125,
                symbol: 'ZNM20',
                market: 'CBOT'
            }]);
        });
        it("keep stoploss for ZNM20 while working profit order", async() => {
            await broker({
                asof: '2020-03-15',
                action: 'BUY',
                quant: '10',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'ZNM20',
                market: 'CBOT',
                security_type: 'FUT',
                currency: 'USD',
                multiplier: 1000
            });
            const stp = await broker({
                asof: '2020-03-16T18:00:00-04:00',
                action: 'SELL',
                quant: 10,
                order_type: 'STP',
                stop: 137.4375,
                tif: 'GTC',
                extended_hours: true,
                status: 'working',
                order_ref: 'stoploss.ZNM20.mksafe-orders',
                symbol: 'ZNM20',
                market: 'CBOT',
                currency: 'USD',
                security_type: 'FUT',
                multiplier: '1000'
            });
            const sell = await broker({
                asof: '2020-03-16T18:00:00-04:00',
                action: 'SELL',
                quant: 6,
                order_type: 'LMT',
                limit: 138.578125,
                tif: 'DAY',
                extended_hours: false,
                status: 'working',
                traded_price: null,
                order_ref: 'LMT.ZNM20.mksafe-orders',
                symbol: 'ZNM20',
                market: 'CBOT',
                currency: 'USD',
                security_type: 'FUT',
                multiplier: '1000'
            });
            await replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    posted_at: '2020-03-16T19:00:00-04:00',
                    action: 'SELL',
                    quant: '6',
                    position: '4',
                    order_type: 'LMT',
                    limit: '138.578125',
                    tif: 'DAY',
                    order_ref: 'LMT.ZNM20.mksafe-orders',
                    symbol: 'ZNM20',
                    market: 'CBOT',
                    currency: 'USD',
                    security_type: 'FUT',
                    stoploss: '137.4375'
                }]);
            })({
                now: "2020-03-16T20:00:00",
                currency: 'USD',
                markets: ['CBOT'],
                label: 'test'
            }).should.eventually.be.like([]);
        });
    });
    describe("combo orders", function() {
        it("should cancel combo order", async() => {
            await broker({
                asof: '2019-12-18T16:00:00-05:00',
                now: '2019-12-18T16:00:00-05:00',
                action: 'BUY',
                quant: '2',
                tif: 'DAY',
                order_type: 'MOC',
                symbol: 'SPX   200320C03225000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100',
                status: 'working'
            });
            await broker({
                order_ref: 'MOC.SPX200320C.mkspxorders',
                asof: '2019-12-19T12:00:00-05:00',
                now: '2019-12-19T12:00:00-05:00',
                action: 'BUY',
                quant: 2,
                order_type: 'MOC',
                tif: 'DAY',
                attached: [{
                    action: 'BUY',
                    quant: '1',
                    order_type: 'LEG',
                    symbol: 'SPX   200320C03200000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    status: 'working'
                }, {
                    action: 'SELL',
                    quant: '1',
                    order_type: 'LEG',
                    symbol: 'SPX   200320C03225000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    status: 'working'
                }]
            });
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: null,
                    position: '0',
                    order_type: 'MKT',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    traded_price: '81.4',
                    order_ref: 'MOC.SPX200320C03200000.mkspxorders',
                    symbol: 'SPX   200320C03200000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }, {
                    action: null,
                    position: '0',
                    order_type: 'MOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    traded_price: '66.2',
                    order_ref: 'MOC.SPX200320C03225000.mkspxorders',
                    symbol: 'SPX   200320C03225000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }]);
            })({
                label: 'mkspxorders',
                now: '2019-12-19T13:00:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MOC']
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: '2',
                order_type: 'MOC',
                tif: 'DAY',
                symbol: 'SPX   200320C03225000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                status: 'working'
            }, {
                order_type: 'MOC',
                order_ref: 'MOC.SPX200320C.mkspxorders',
                status: 'cancelled'
            }, {
                order_type: 'LEG',
                symbol: 'SPX   200320C03200000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                attach_ref: 'MOC.SPX200320C.mkspxorders',
                status: 'cancelled'
            }, {
                order_type: 'LEG',
                attach_ref: 'MOC.SPX200320C.mkspxorders',
                symbol: 'SPX   200320C03225000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                status: 'cancelled'
            }]);
        });
        it("should combine LMT orders", async() => {
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: 1,
                    position: '1',
                    order_type: 'LOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    limit: '81.4',
                    order_ref: 'MOC.SPX200320C.mkspxorders',
                    symbol: 'SPX   200320C03200000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }, {
                    action: 'SELL',
                    quant: 1,
                    position: '-1',
                    order_type: 'LOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    limit: '66.2',
                    order_ref: 'MOC.SPX200320C.mkspxorders',
                    symbol: 'SPX   200320C03225000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }]);
            })({
                label: 'mkspxorders',
                now: '2019-12-19T13:00:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MOC']
            }).should.eventually.be.like([{
                order_type: 'LOC',
                action: 'BUY'
            }, {
                action: 'BUY',
                order_type: 'LEG',
                limit: 81.4,
                symbol: 'SPX   200320C03200000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD'
            }, {
                action: 'SELL',
                order_type: 'LEG',
                limit: 66.2,
                symbol: 'SPX   200320C03225000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD'
            }]);
        });
        it("should roll LMT orders", async() => {
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: 1,
                    position: '1',
                    order_type: 'LOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    limit: '81.4',
                    order_ref: 'MOC.mkspxorders',
                    symbol: 'SPX   200320C03200000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }, {
                    action: 'SELL',
                    quant: 1,
                    position: '-1',
                    order_type: 'LOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    limit: '66.2',
                    order_ref: 'MOC.mkspxorders',
                    symbol: 'SPX   200221C03225000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }]);
            })({
                label: 'mkspxorders',
                now: '2019-12-19T13:00:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MOC']
            }).should.eventually.be.like([{
                order_type: 'LOC',
                action: 'BUY'
            }, {
                action: 'BUY',
                order_type: 'LEG',
                limit: 81.4,
                symbol: 'SPX   200320C03200000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD'
            }, {
                action: 'SELL',
                order_type: 'LEG',
                limit: 66.2,
                symbol: 'SPX   200221C03225000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD'
            }]);
        });
        it("should combine 2-to-1 orders", async() => {
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: 6,
                    position: '6',
                    order_type: 'LOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    limit: '81.4',
                    order_ref: 'MOC.SPX200320C.mkspxorders',
                    symbol: 'SPX   200320C03200000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }, {
                    action: 'SELL',
                    quant: 3,
                    position: '-3',
                    order_type: 'LOC',
                    tif: 'DAY',
                    traded_at: '2019-12-19T16:15:00-05:00',
                    limit: '66.2',
                    order_ref: 'MOC.SPX200320C.mkspxorders',
                    symbol: 'SPX   200320C03225000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    minTick: '0.1'
                }]);
            })({
                label: 'mkspxorders',
                now: '2019-12-19T13:00:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MOC']
            }).should.eventually.be.like([{
                order_type: 'LOC',
                action: 'BUY',
                quant: '3'
            }, {
                action: 'BUY',
                order_type: 'LEG',
                limit: 81.4,
                quant: '2',
                symbol: 'SPX   200320C03200000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD'
            }, {
                action: 'SELL',
                order_type: 'LEG',
                limit: 66.2,
                quant: '1',
                symbol: 'SPX   200320C03225000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD'
            }]);
        });
        it("should combine attched orders", async() => {
            await broker({
                asof: '2020-11-27T16:00:00-05:00',
                now: '2020-11-27T16:00:00-05:00',
                action: 'BUY',
                quant: '2',
                tif: 'DAY',
                order_type: 'MKT',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100',
                status: 'working'
            });
            const orders = await replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    position: 0,
                    buy_action: 'BUY',
                    buy_quant: 2,
                    buy_order_type: 'MKT',
                    traded_at: '2020-11-27T16:00:00-05:00',
                    buy_tif: 'DAY',
                    buy_order_ref: 'MID.FDX.mkleaps',
                    symbol: 'FDX   220121C00280000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 2,
                    buy_action: 'BUY',
                    buy_quant: 1,
                    buy_order_type: 'LMT',
                    buy_limit: 47,
                    buy_order_ref: 'below.FDX.mkleaps',
                    buy_tif: 'DAY',
                    sell_action: 'SELL',
                    sell_quant: 2,
                    sell_position: 0,
                    sell_order_type: 'LMT',
                    sell_limit: 58,
                    sell_order_ref: 'above.FDX.mkleaps',
                    sell_tif: 'DAY',
                    symbol: 'FDX   220121C00280000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 0,
                    buy_action: 'BUY',
                    buy_quant: 3,
                    buy_order_type: 'LMT',
                    buy_limit: 47.2,
                    buy_order_ref: 'above.FDX.mkleaps',
                    buy_tif: 'DAY',
                    symbol: 'FDX   220121C00300000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }]);
            })({
                label: 'fdxorders',
                now: '2020-12-01T09:30:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT']
            });
            orders.should.be.like([{
                action: 'BUY',
                quant: '1',
                order_type: 'LMT',
                limit: 47,
                order_ref: 'below.FDX.mkleaps',
                tif: 'DAY',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }, {
                action: 'BUY',
                quant: '1',
                order_type: 'LMT',
                order_ref: 'above.FDX.mkleaps',
                tif: 'DAY',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }, {
                action: 'SELL',
                quant: '2',
                order_type: 'LEG',
                limit: 58,
                attach_ref: 'above.FDX.mkleaps',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }, {
                action: 'BUY',
                quant: '3',
                order_type: 'LEG',
                limit: 47.2,
                attach_ref: 'above.FDX.mkleaps',
                symbol: 'FDX   220121C00300000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }]);
        });
        it("should handle order conditions", async() => {
            await broker({
                asof: '2020-11-27T16:00:00-05:00',
                now: '2020-11-27T16:00:00-05:00',
                action: 'BUY',
                quant: '2',
                tif: 'DAY',
                order_type: 'MKT',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100',
                status: 'working'
            });
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    position: 0,
                    buy_action: 'BUY',
                    buy_quant: 2,
                    buy_order_type: 'MKT',
                    traded_at: '2020-11-27T16:00:00-05:00',
                    buy_tif: 'DAY',
                    buy_order_ref: 'MID.FDX.mkleaps',
                    symbol: 'FDX   220121C00280000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 2,
                    buy_action: 'BUY',
                    buy_quant: 1,
                    buy_order_type: 'LMT',
                    buy_limit: 47,
                    buy_order_ref: 'below.FDX.mkleaps',
                    buy_tif: 'DAY',
                    sell_action: 'SELL',
                    sell_quant: 2,
                    sell_position: 0,
                    sell_order_type: 'LMT',
                    sell_limit: 58,
                    sell_order_ref: 'above.FDX.mkleaps',
                    sell_tif: 'DAY',
                    symbol: 'FDX   220121C00280000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 0,
                    buy_action: 'BUY',
                    buy_quant: 3,
                    buy_order_type: 'LMT',
                    buy_limit: 47.2,
                    buy_order_ref: 'roll.FDX.mkleaps',
                    buy_condition: 'symbol=FDX   220121C00280000;market=OPRA;isMore=true;price=58;type=Price',
                    buy_tif: 'DAY',
                    symbol: 'FDX   220121C00300000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }]);
            })({
                label: 'fdxorders',
                now: '2020-12-01T09:30:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT']
            }).should.eventually.be.like([{
                action: 'BUY',
                quant: '1',
                order_type: 'LMT',
                limit: 47,
                order_ref: 'below.FDX.mkleaps',
                tif: 'DAY',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }, {
                action: 'SELL',
                quant: '2',
                order_type: 'LMT',
                limit: 58,
                order_ref: 'above.FDX.mkleaps',
                symbol: 'FDX   220121C00280000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }, {
                action: 'BUY',
                quant: '3',
                order_type: 'LMT',
                limit: 47.2,
                order_ref: 'roll.FDX.mkleaps',
                condition: 'symbol=FDX   220121C00280000;market=OPRA;isMore=true;price=58;type=Price',
                symbol: 'FDX   220121C00300000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100'
            }]);
        });
        it("should combine orders with attached", async() => {
            await broker({
                asof: '2020-11-27T16:00:00-05:00',
                now: '2020-11-27T16:00:00-05:00',
                action: 'BUY',
                quant: '2',
                tif: 'DAY',
                order_type: 'MKT',
                symbol: 'FDX   220121C00260000',
                market: 'OPRA',
                currency: 'USD',
                security_type: 'OPT',
                multiplier: '100',
                status: 'working'
            });
            return replicate(function(options) {
                if (options.info=='help') return quote(options);
                else return Promise.resolve([{
                    position: 0,
                    order_type: 'MKT',
                    traded_at: '2020-11-27T16:00:00-05:00',
                    tif: 'DAY',
                    order_ref: 'MID.FDX.mkleaps',
                    symbol: 'FDX   220121C00260000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 0,
                    action: 'BUY',
                    quant: 2,
                    order_type: 'MKT',
                    traded_at: '2020-11-27T16:00:00-05:00',
                    tif: 'DAY',
                    order_ref: 'MID.FDX.mkleaps',
                    symbol: 'FDX   220121C00280000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 2,
                    buy_action: 'BUY',
                    buy_quant: 1,
                    buy_order_type: 'LMT',
                    buy_limit: 47,
                    buy_order_ref: 'below.FDX.mkleaps',
                    buy_tif: 'DAY',
                    sell_action: 'SELL',
                    sell_quant: 2,
                    sell_position: 0,
                    sell_order_type: 'LMT',
                    sell_limit: 58,
                    sell_order_ref: 'above.FDX.mkleaps',
                    sell_tif: 'DAY',
                    tif: 'DAY',
                    order_ref: 'MID.FDX.mkleaps',
                    symbol: 'FDX   220121C00280000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }, {
                    position: 0,
                    buy_action: 'BUY',
                    buy_quant: 3,
                    buy_order_type: 'LMT',
                    buy_limit: 47.2,
                    buy_order_ref: 'roll.FDX.mkleaps',
                    buy_attach_ref: 'above.FDX.mkleaps',
                    buy_tif: 'DAY',
                    tif: 'DAY',
                    order_ref: 'MID.FDX.mkleaps',
                    symbol: 'FDX   220121C00300000',
                    market: 'OPRA',
                    currency: 'USD',
                    security_type: 'OPT',
                    multiplier: '100',
                    minTick: '0.1'
                }]);
            })({
                label: 'fdxorders',
                now: '2020-12-01T09:30:00-05:00',
                currency: 'USD',
                markets: ['OPRA'],
                combo_order_types: ['MKT'],
                dry_run: true
            }).should.eventually.be.like([{
                action: 'SELL',
                quant: '2',
                order_type: 'MKT',
                tif: 'DAY',
                order_ref: 'MID.FDX.mkleaps',
                attached:
                 [ { action: 'BUY',
                     quant: '1',
                     order_ref: 'MID.FDX.mkleaps',
                     traded_at: '2020-11-27T16:00:00-05:00',
                     symbol: 'FDX   220121C00260000',
                     market: 'OPRA',
                     currency: 'USD',
                     security_type: 'OPT',
                     order_type: 'LEG' },
                   { action: 'SELL',
                     quant: '1',
                     order_ref: 'MID.FDX.mkleaps',
                     symbol: 'FDX   220121C00280000',
                     market: 'OPRA',
                     currency: 'USD',
                     security_type: 'OPT',
                     order_type: 'LEG' },
                    { action: 'BUY',
                      quant: '1',
                      order_type: 'LMT',
                      limit: 47,
                      tif: 'DAY',
                      order_ref: 'below.FDX.mkleaps',
                      symbol: 'FDX   220121C00280000',
                      market: 'OPRA',
                      currency: 'USD',
                      security_type: 'OPT' },
                    { action: 'SELL',
                      quant: '2',
                      order_type: 'LMT',
                      tif: 'DAY',
                      limit: 58,
                      order_ref: 'above.FDX.mkleaps',
                      symbol: 'FDX   220121C00280000',
                      market: 'OPRA',
                      currency: 'USD',
                      security_type: 'OPT',
                      attached:
                       [ { action: 'BUY',
                           quant: '3',
                           limit: 47.2,
                           order_ref: 'roll.FDX.mkleaps',
                           symbol: 'FDX   220121C00300000',
                           market: 'OPRA',
                           currency: 'USD',
                           security_type: 'OPT',
                           order_type: 'LMT' } ]
            }]}]);
        });
    });
});

function printEach(d) {
    d.forEach(d=>console.log(require('util').inspect(d,{breakLength:Infinity})));
    return d;
}
