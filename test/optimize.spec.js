// optimize.spec.js
/*
 *  Copyright (c) 2017 James Leigh, Some Rights Reserved
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
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("optimize", function() {
    this.timeout(60000);
    var fetch, quote, collect, optimize;
    before(function() {
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('prefix', createTempDir('optimize'));
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        fetch = Fetch();
        quote = Quote(fetch);
        collect = Collect(quote);
        optimize = Optimize(collect);
    });
    beforeEach(function() {
        optimize.seed(27644437);
    });
    after(function() {
        config.unset('prefix');
        config.unset('fetch.files.dirname');
        return Promise.all([
            optimize.close(),
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    it("should find best trend sma cross parameters", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2015-01-01',
            end: '2015-12-31',
            eval_validity: 'fast_len<slow_len',
            eval_score: 'gain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("sma_cross")'
            },
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
            }
        }).should.eventually.be.like({
            parameters: {
                fast_len: 15,
                slow_len: 25
            }
        });
    });
    it("should find best counter trend sma cross parameters", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2016-10-01',
            end: '2016-12-31',
            eval_score: '-gain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("sma_cross")'
            },
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
            }
        }).should.eventually.be.like({
            parameters: {
                fast_len: 25,
                slow_len: 100
            }
        });
    });
    it("should find best sma cross parameters with gain/pain", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2016-01-01',
            end: '2016-12-31',
            eval_validity: 'fast_len<slow_len',
            eval_score: 'gain/pain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("sma_cross")',
                pain: 'drawdown'
            },
            variables: {
                sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)'
            },
            parameter_values: {
                fast_len: [5,10,15,20,25,50],
                slow_len: [20,25,50,80,100,150,200]
            }
        }).should.eventually.be.like({
            parameters: {
                fast_len: 5,
                slow_len: 200
            }
        });
    });
    it("should find best mean reversion bollinger parameters", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2016-01-01',
            end: '2016-12-31',
            eval_score: 'gain/pain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("signal")',
                pain: 'drawdown'
            },
            variables: {
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)',
                middle_band: 'SMA(len,day.adj_close)',
                upper_band: 'middle_band+multiplier*STDEV(len,day.adj_close)',
                lower_band: 'middle_band-multiplier*STDEV(len,day.adj_close)',
                signal: 'IF(day.adj_close<upper_band AND (PREV("signal")>0 OR day.adj_close<lower_band),1,day.adj_close>lower_band AND (PREV("signal")<0 OR day.adj_close>upper_band),-1,0)'
            },
            parameters: {
                len: 20,
                multiplier: 2
            },
            parameter_values: {
                len: [5,10,15,20,25,50],
                multiplier: [1,2,3]
            }
        }).should.eventually.be.like({
            parameters: {
                len: 15,
                multiplier: 2
            },
        });
    });
    it("should find best relative strength STO parameters", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2016-10-01',
            end: '2016-12-31',
            eval_score: 'gain/pain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("signal")',
                pain: 'drawdown'
            },
            variables: {
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)',
                signal: 'SIGN(K-D)',
                STO: 'CHANGE(day.adj_close,LOWEST(lookback,day.low),HIGHEST(lookback,day.high)-LOWEST(lookback,day.low))',
                K: 'SMA(Ksmoothing,STO)',
                D: 'SMA(Dmoving,K)'
            },
            parameters: {
                lookback: 14,
                Ksmoothing: 3,
                Dmoving: 3
            },
            parameter_values: {
                lookback: [7,10,14,20,28,50],
                Ksmoothing: [1,3,5,7],
                Dmoving: [3,5]
            }
        }).should.eventually.be.like({
            parameters: {
                lookback: 10,
                Ksmoothing: 5,
                Dmoving: 3
            }
        });
    });
    it("should find the two best relative strength STO parameters", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2016-07-01',
            end: '2016-10-01',
            solution_count: 2,
            eval_score: 'gain/pain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("signal")',
                pain: 'drawdown'
            },
            variables: {
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)',
                signal: 'SIGN(K-D)',
                STO: 'CHANGE(day.adj_close,LOWEST(lookback,day.low),HIGHEST(lookback,day.high)-LOWEST(lookback,day.low))',
                K: 'SMA(Ksmoothing,STO)',
                D: 'SMA(Dmoving,K)'
            },
            parameters: {
                lookback: 14,
                Ksmoothing: 3,
                Dmoving: 3
            },
            parameter_values: {
                lookback: [7,10,14,20,28,50],
                Ksmoothing: [1,3,5,7],
                Dmoving: [3,5]
            }
        }).should.eventually.be.like([{
            parameters: {
                lookback: 20,
                Ksmoothing: 7,
                Dmoving: 5
            }
        }, {
            parameters: {
                lookback: 20,
                Ksmoothing: 7,
                Dmoving: 3
            }
        }]);
    });
    it("should find best momentum MACD parameters", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2016-11-01',
            end: '2016-12-01',
            eval_score: 'gain/pain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("macd_cross")',
                pain: 'drawdown'
            },
            variables: {
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)',
                line: 'EMA(fast_len,day.adj_close)-EMA(slow_len,day.adj_close)',
                signal_line: 'EMA(signal_len,line)',
                histogram: 'line-signal_line',
                macd_cross: 'SIGN(histogram)'
            },
            parameters: {
                fast_len: 12,
                slow_len: 26,
                signal_len: 9
            },
            population_size: 8,
            parameter_values: {
                fast_len: [3,5,9,12],
                slow_len: [10,26,35],
                signal_len: [2,5,9,16]
            }
        }).should.eventually.be.like({
            score: 1.336956395
        });
    });
    it("should find best mean reversion bollinger parameters by sampling periods", function() {
        return optimize({
            portfolio: 'SPY.ARCA',
            begin: '2013-01-01',
            end: '2016-12-31',
            sample_duration: 'P1Y',
            eval_score: '(gain + SUMPREC("gain", 5))/(pain + SUMPREC("pain", 5))',
            reset_every: 'P1Y',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                proceeds: 'change * PREV("signal")',
                gain: 'PREC("gain") + proceeds',
                pain: 'drawdown'
            },
            variables: {
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)',
                middle_band: 'SMA(len,day.adj_close)',
                upper_band: 'middle_band+multiplier*STDEV(len,day.adj_close)',
                lower_band: 'middle_band-multiplier*STDEV(len,day.adj_close)',
                signal: 'IF(day.adj_close<upper_band AND (PREV("signal")>0 OR day.adj_close<lower_band),1,day.adj_close>middle_band AND (PREV("signal")<0 OR day.adj_close>upper_band),-1,0)'
            },
            parameters: {
                len: 20,
                multiplier: 2
            },
            parameter_values: {
                len: [5,10,15,20,25,50],
                multiplier: [1,2,3]
            }
        }).should.eventually.be.like({
            parameters: {
                len: 10,
                multiplier: 2
            },
        });
    });
});

