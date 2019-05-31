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
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("replicate-simulation", function() {
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
        broker = new Broker({...config(), simulation: 'test'});
    });
    beforeEach(async() => {
        await broker({action: 'reset'});
        await broker({
            asof: '2019-05-04T00:00:00-05:00',
            action: 'deposit', quant: 10000, currency: 'CAD'
        });
        await broker({
            asof: '2019-05-04T00:00:00-05:00',
            action: 'deposit', quant: 10000, currency: 'USD'
        });
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
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '111',
                    symbol: 'ENB',
                    market: 'TSE',
                    security_type: 'STK',
                    type: 'LOC',
                    limit: '49.18',
                    tif: 'DAY',
                    traded_at: '2019-05-24T16:00:00-04:00'
                }, {
                    action: 'SELL',
                    quant: '111',
                    symbol: 'ENB',
                    market: 'TSE',
                    security_type: 'STK',
                    type: 'LOC',
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
                type:          'MOC',
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
                type:          'LOC',
                limit:         '293.74',
                tif:           'DAY',
                status:        'working',
                order_ref:     '15d10148c.33',
                symbol:        'CP',
                market:        'TSE',
                currency:      'CAD',
                security_type:       'STK'
            });
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '36',
                    symbol: 'CP',
                    market: 'TSE',
                    security_type: 'STK',
                    type: 'LOC',
                    limit: '298.56',
                    tif: 'DAY',
                    traded_at: '2019-05-24T16:00:00-04:00'
                }, {
                    action: 'SELL',
                     quant: '19',
                     symbol: 'CP',
                     market: 'TSE',
                     security_type: 'STK',
                     type: 'LOC',
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
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-17T16:00:00-04:00',
                    action: 'BUY',
                    quant: '63',
                    type: 'LOC',
                    limit: '297.69',
                    traded_price: '307.99',
                    order_ref: 'buy-order'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-23T16:00:00-04:00',
                    action: 'SELL',
                    quant: '9',
                    type: 'LOC',
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
                type: 'LOC',
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
                type: 'MOC',
                tif: 'DAY',
                currency: 'CAD',
                security_type: 'STK'
            });
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-17T16:00:00-04:00',
                    action: 'BUY',
                    quant: '63',
                    type: 'LOC',
                    limit: '297.69',
                    traded_price: '307.99'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-23T16:00:00-04:00',
                    action: 'SELL',
                    quant: '9',
                    type: 'LOC',
                    limit: '293.94',
                    traded_price: '299'
                }, {
                    symbol: 'CP',
                    market: 'TSE',
                    traded_at: '2019-05-24T16:00:00-04:00',
                    action: 'BUY',
                    quant: '19',
                    type: 'LOC',
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
                type: 'LOC',
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
                type: 'MOC',
                tif: 'DAY'
            });
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                     quant: '6',
                     symbol: 'CSU',
                     market: 'TSE',
                     security_type: 'STK',
                     type: 'LOC',
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
                 type: 'LOC',
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
                type: 'MOC',
                tif: 'DAY'
            });
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    action: 'BUY',
                    quant: '281',
                    symbol: 'TRI',
                    market: 'TSE',
                    security_type: 'STK',
                    type: 'MOC',
                    tif: 'DAY',
                    traded_at: '2019-05-28T16:00:00-04:00',
                    traded_price: '85.77'
                }, {
                    action: 'BUY',
                    quant: '65',
                    symbol: 'TRI',
                    market: 'TSE',
                    security_type: 'STK',
                    type: 'LOC',
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
                    type: 'LOC',
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
                type: 'LOC',
                limit: '86.1',
                tif: 'DAY'
            }]);
        });
    });
    describe("Options", function() {
        it("submit BUY combo order", async() => {
            return Replicate(broker, function(options) {
                if (options.help) return collect(options);
                else return Promise.resolve([{
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: 100,
                    name: 'SPX Jun 2019 C 3075',
                    traded_at: '2019-05-29T16:15:00-04:00',
                    action: 'BUY',
                    quant: '3',
                    position: '0',
                    type: 'MKT',
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
                    action: 'SELL',
                    quant: '3',
                    position: '0',
                    type: 'MKT',
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
                action: 'BUY',
                quant: 3,
                type: 'MKT',
                tif: 'DAY'
            }, {
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'BUY',
                quant: 1,
                type: 'LEG',
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
                type: 'LEG',
                symbol: 'SPX   190621C03125000',
                market: 'OPRA',
                security_type: 'OPT',
                currency: 'USD',
                multiplier: '100'
            }]);
        });
        it("submit SELL combo order", async() => {
            return Replicate(broker, function(options) {
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
                    type: 'MKT',
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
                    type: 'MKT',
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
                type: 'MKT',
                tif: 'DAY'
            }, {
                posted_at: '2019-05-27T12:00:00-04:00',
                asof: '2019-05-27T12:00:00-04:00',
                action: 'BUY',
                quant: 1,
                type: 'LEG',
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
                type: 'LEG',
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
                type: 'MKT',
                tif: 'DAY',
                attached: [{
                    action: 'BUY',
                    quant: 1,
                    type: 'LEG',
                    symbol: 'SPX   190621C03075000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: '100'
                }, {
                    action: 'SELL',
                    quant: 1,
                    type: 'LEG',
                    symbol: 'SPX   190621C03125000',
                    market: 'OPRA',
                    security_type: 'OPT',
                    currency: 'USD',
                    multiplier: '100'
                }]
            });
            return Replicate(broker, function(options) {
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
                    type: 'MKT',
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
                    type: 'MKT',
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
});
