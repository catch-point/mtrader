// mtrader-collect.spec.js
/*
 *  Copyright (c) 2017-2019 James Leigh, Some Rights Reserved
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

const path = require('path');
const _ = require('underscore');
const merge = require('../src/merge.js');
const Mtrader = require('../src/mtrader.js');
const Collect = require('../src/mtrader-collect.js');
const Broker = require('../src/broker-simulation.js');
const config = require('../src/config.js');
const Quote = require('../src/quote.js');
const Fetch = require('../src/fetch.js');
const readCallSave = require('../src/read-call-save.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("mtrader-collect", function() {
    this.timeout(1200000);
    var mtrader;
    before(function() {
        Mtrader.config('prefix', createTempDir('mtrader'));
        Mtrader.config('runInBand', true);
        mtrader = new Mtrader();
        mtrader.config.save('SPY', {
            portfolio: 'SPY.NYSE',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(day.close,5)'
            }
        });
        mtrader.config.save('SPY_NYSE', {
            portfolio: 'NYSE_SPY',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(day.close,5)'
            }
        });
        mtrader.config.save('NYSE_SPY', {
            portfolio: 'SPY_NYSE',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            }
        });
        process.emit('SIGHUP');
    });
    after(function() {
        Mtrader.config.unset('prefix');
        Mtrader.config.unset('runInBand');
        return mtrader.close();
    });
    it("by week should be the same as by month", function() {
        return mtrader.collect({
          portfolio: 'XLE.NYSE,XLF.NYSE,XLI.NYSE,XLK.NYSE,XLY.NYSE',
          pad_leading: 3,
          begin: "2016-10-30",
          end: "2016-12-03",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              cor: 'MAXCORREL(60,day.adj_close)',
              risk: 'CVAR(5, 60, day.adj_close)',
              weight: 'IF(cor<0.75 AND SUMPREC("weight")<=95, MIN(0.5/risk,100-SUMPREC("weight")), 0)',
              target: 'FLOOR(100000*(weight + SUMPREV("weight",2))/300/day.close)',
              shares: 'target-PREV("position")',
              position: 'PREV("position") + shares',
              price: 'day.close + 0.02 * IF(shares>0,1,-1)', // includes slippage
              proceeds: '-shares * price',
              commission: 'IF(shares=0,0, MAX(shares * 0.005, 1.00))'
          },
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          criteria: 'position OR shares'
        }).then(expected => mtrader.collect({
          portfolio: 'XLE.NYSE,XLF.NYSE,XLI.NYSE,XLK.NYSE,XLY.NYSE',
          pad_leading: 3,
          begin: "2016-10-30",
          end: "2016-12-03",
          duration: 'P7D',
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              cor: 'MAXCORREL(60,day.adj_close)',
              risk: 'CVAR(5, 60, day.adj_close)',
              weight: 'IF(cor<0.75 AND SUMPREC("weight")<=95, MIN(0.5/risk,100-SUMPREC("weight")), 0)',
              target: 'FLOOR(100000*(weight + SUMPREV("weight",2))/300/day.close)',
              shares: 'target-PREV("position")',
              position: 'PREV("position") + shares',
              price: 'day.close + 0.02 * IF(shares>0,1,-1)', // includes slippage
              proceeds: '-shares * price',
              commission: 'IF(shares=0,0, MAX(shares * 0.005, 1.00))'
          },
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          criteria: 'position OR shares'
        }).should.eventually.be.like(expected));
    });
    it("should call nested collect", function() {
        return readCallSave({
            portfolio: 'SPY',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).then(mtrader.collect).should.eventually.be.like([
            {date:"2017-01-03",close:225.24},
            {date:"2017-01-04",close:226.58},
            {date:"2017-01-05",close:226.4},
            {date:"2017-01-06",close:227.21},
            {date:"2017-01-09",close:226.46},
            {date:"2017-01-10",close:226.46},
            {date:"2017-01-11",close:227.1},
            {date:"2017-01-12",close:226.53},
            {date:"2017-01-13",close:227.05},
            {date:"2017-01-17",close:226.25},
            {date:"2017-01-18",close:226.75},
            {date:"2017-01-19",close:225.91},
            {date:"2017-01-20",close:226.74},
            {date:"2017-01-23",close:226.15},
            {date:"2017-01-24",close:227.6},
            {date:"2017-01-25",close:229.57},
            {date:"2017-01-26",close:229.33},
            {date:"2017-01-27",close:228.97},
            {date:"2017-01-30",close:227.55}
        ]);
    });
    it("should detect nested collect cycle", function() {
        return Promise.resolve().then(() => mtrader.collect({
            portfolio: 'SPY_NYSE',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        })).should.be.rejected;
    });
    describe("parameters", function() {
        var fetch, quote, broker, collect;
        before(async() => {
            fetch = Fetch(merge(config('fetch'), {
                files: {
                    enabled: true,
                    dirname: path.resolve(__dirname, 'data')
                }
            }));
            quote = new Quote(fetch);
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
            collect = new Collect({
                mock_broker: broker,
                mock_collect(options) {
                    return [options];
                }
            });
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
        after(function() {
            return Promise.all([
                broker.close(),
                fetch.close(),
                quote.close()
            ]);
        });
        it("working_duration", async() => {
            const options = await collect({
                now: "2019-01-04T17:00:00",
                working_duration: 'P1D',
                currency: 'USD',
                markets: ['NYSE']
            });
            options.should.be.like([{
                begin: '2019-01-03T17:00:00-05:00',
                parameters: { initial_deposit: 10000 }
            }]);
        });
        it("allocation_pct", async() => {
            const options = await collect({
                now: "2019-01-04T17:00:00",
                allocation_pct: 60,
                currency: 'USD',
                markets: ['NYSE']
            });
            options.should.be.like([{
                parameters: { initial_deposit: 6000 }
            }]);
        });
        it("allocation_peak_pct", async() => {
            const options = await collect({
                now: "2019-01-04T17:00:00",
                allocation_peak_pct: 90,
                currency: 'USD',
                markets: ['NYSE']
            });
            options.should.be.like([{
                parameters: { initial_deposit: 9000 }
            }]);
        });
        it("allocation_min", async() => {
            const options = await collect({
                now: "2019-01-04T17:00:00",
                allocation_pct: 60,
                allocation_min: 9000,
                currency: 'USD',
                markets: ['NYSE']
            });
            options.should.be.like([{
                parameters: { initial_deposit: 9000 }
            }]);
        });
        it("allocation_max", async() => {
            const options = await collect({
                now: "2019-01-04T17:00:00",
                allocation_pct: 60,
                allocation_max: 5000,
                currency: 'USD',
                markets: ['NYSE']
            });
            options.should.be.like([{
                parameters: { initial_deposit: 5000 }
            }]);
        });
        it("net_deposit", async() => {
            await broker({
                  asof: '2018-12-26',
                  action: 'BUY',
                  quant: '1',
                  order_type: 'MOC',
                  tif: 'DAY',
                  symbol: 'ZNH19',
                  market: 'CBOT',
                  security_type: 'FUT',
                  currency: 'USD',
                  multiplier: 1000
            });
            const balance = Math.floor(1000000+(122296875-121031250)/10-205)/100;
            const options = await collect({
                begin: '2018-12-26',
                now: "2019-01-04T17:00:00",
                currency: 'USD',
                markets: ['CBOT'],
                portfolio: 'ZNH19.CBOT',
                allocation_pct: 90
            });
            options.should.be.like([{
                parameters: {
                    // initial_deposit is balance after begin
                    initial_deposit: 9000,
                    // net_allocation is balance asof now
                    net_allocation: balance*100*0.9/100,
                    // net_deposit is net_allocation minus mtm since begin
                    net_deposit: balance*100*0.9/100-balance+10000,
                    // settled_cash is available local currency cash asof now
                    settled_cash: balance
                }
            }]);
        });
        it("settled_cash", async() => {
            await broker({asof: '2019-05-29T00:00:00-04:00',
                symbol: 'TRI',
                market: 'TSE',
                currency: 'CAD',
                security_type: 'STK',
                multiplier: '',
                action: 'BUY',
                quant: 100,
                position: 100,
                price: 85.77,
                order_type: 'MOC',
                tif: 'DAY'
            });
            const balance = 10000+(8500-8577)-1;
            const options = await collect({
                begin: '2019-05-29',
                now: "2019-06-04T16:00:00",
                currency: 'CAD',
                markets: ['TSE'],
                portfolio: 'TRI.TSE',
                allocation_pct: 90
            });
            options.should.be.like([{
                parameters: {
                    // initial_deposit is balance after begin
                    initial_deposit: 9000,
                    // net_allocation is balance asof now
                    net_allocation: balance*100*0.9/100,
                    // net_deposit is net_allocation minus mtm since begin
                    net_deposit: balance*100*0.9/100-balance+10000,
                    // settled_cash is available local currency cash asof now
                    settled_cash: 10000-8577-1
                }
            }]);
        });
        it("initial_deposit", async() => {
            await broker({
                asof: '2019-05-20',
                action: 'withdraw',
                currency: 'CAD',
                quant: 1000
            });
            await broker({asof: '2019-05-29T00:00:00-04:00',
                symbol: 'TRI',
                market: 'TSE',
                currency: 'CAD',
                security_type: 'STK',
                multiplier: '',
                action: 'BUY',
                quant: 100,
                position: 100,
                price: 85.77,
                order_type: 'MOC',
                tif: 'DAY'
            });
            const balance = 9000+(8500-8577)-1;
            const options = await collect({
                begin: '2019-05-01',
                now: "2019-06-04T16:00:00",
                currency: 'CAD',
                markets: ['TSE'],
                portfolio: 'TRI.TSE'
            });
            options.should.be.like([{
                parameters: {
                    // initial_deposit is balance after begin
                    initial_deposit: 9000,
                    // net_allocation is balance asof now
                    net_allocation: balance,
                    // net_deposit is net_allocation minus mtm since begin
                    net_deposit: 9000,
                    // settled_cash is available local currency cash asof now
                    settled_cash: 9000-8577-1
                }
            }]);
        });
    });
});
