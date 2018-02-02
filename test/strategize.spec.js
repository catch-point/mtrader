// strategize.spec.js
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

const path = require('path');
const _ = require('underscore');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');
const Collect = require('../src/collect.js');
const Optimize = require('../src/optimize.js');
const Bestsignals = require('../src/bestsignals.js');
const Strategize = require('../src/strategize.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("strategize", function() {
    this.timeout(240000);
    var fetch, quote, collect, optimize, bestsignals;
    before(function() {
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', path.resolve(__dirname, '../tmp/strategize'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        fetch = Fetch();
        quote = Quote(fetch);
        collect = Collect(quote);
        optimize = Optimize(collect);
        bestsignals = Bestsignals(optimize);
        strategize = Strategize(bestsignals);
    });
    beforeEach(function() {
        optimize.seed(27644437);
        strategize.seed(27644437);
    });
    after(function() {
        config.unset('prefix');
        config.unset('fetch.files.dirname');
        return Promise.all([
            strategize.close(),
            bestsignals.close(),
            optimize.close(),
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    it("should find best trend cross signal", function() {
        return strategize({
            portfolio: 'SPY.ARCA',
            begin: '2016-10-01',
            end: '2016-12-31',
            strategy_variable: 'strategy',
            max_signals: 1,
            eval_score: 'profit',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                profit: 'PREC("profit") + change * PREV("strategy")'
            },
            signalset: {
                signals: ['sma_cross'],
                variables: {
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200]
                },
                eval_validity: 'fast_len < slow_len'
            }
        }).should.eventually.be.like({
            variables: {
                strategy: '-1*sma_crossA'
            },
            parameters: {
                fast_lenA: 25,
                slow_lenA: 100
            },
            eval_validity: ['fast_lenA<slow_lenA'],
            score: 14.186871
        });
    });
    it("should find complex strategy", function() {
        return strategize({
            portfolio: 'SPY.ARCA',
            begin: '2011-01-01',
            end: '2011-12-31',
            strategy_variable: 'strategy',
            max_signals: 2,
            population_size: 4,
            signal_cost: 1,
            eval_score: 'profit',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                profit: 'PREC("profit") + change * PREV("strategy")'
            },
            signalset: [{
                signals: ['trend'],
                variables: {
                    trend: "IF(high=low, high, 0)",
                    high: "DIRECTION(trend_len,highest)",
                    low: "DIRECTION(trend_len,lowest)",
                    highest: "HIGHEST(trend_len,day.high*scale)",
                    lowest: "LOWEST(trend_len,day.low*scale)",
                    scale: "day.adj_close/day.close"
                },
                parameters: {
                    trend_len: 50,
                },
                parameter_values: {
                    trend_len: [5,10,20,50]
                }
            }]
        }).should.eventually.be.like({
            variables: {
                strategy: '-1*trendA OR -1*trendB'
            },
            parameters: {
                trend_lenA: 5, trend_lenB: 50,
            },
            score: 30.280018
        });
    });
    it("should find dip buying opportunities", function() {
        return strategize({
            portfolio: 'SPY.ARCA',
            begin: '2011-01-01',
            end: '2011-12-31',
            strategy_variable: 'strategy',
            max_signals: 3,
            population_size: 4,
            eval_score: 'profit',
            transient: false,
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                profit: 'PREC("profit") + change * PREV("strategy")'
            },
            signalset: [{
                signals: ['trend'],
                variables: {
                    trend: "IF(high=low, high, 0)",
                    high: "DIRECTION(trend_len,highest)",
                    low: "DIRECTION(trend_len,lowest)",
                    highest: "HIGHEST(trend_len,day.high*scale)",
                    lowest: "LOWEST(trend_len,day.low*scale)",
                    scale: "day.adj_close/day.close"
                },
                parameter_values: {
                    trend_len: [5,50,150]
                }
            }]
        }).should.eventually.be.like({
            variables: {
                strategy: '-1*trendA OR trendB!=-1*trendC AND -1*trendC'
            },
            parameters: { trend_lenA: 5, trend_lenB: 150, trend_lenC: 50 },
            score: 34.095606
        });
    });
});

