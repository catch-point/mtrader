// bestsignals.spec.js
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
const Bestsignals = require('../src/bestsignals.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("bestsignals", function() {
    this.timeout(60000);
    var fetch, quote, collect, optimize, bestsignals;
    before(function() {
        config('config', path.resolve(__dirname, 'etc/ptrading.json'));
        config('prefix', createTempDir('bestsignals'));
        config(['iqfeed','enabled'], false);
        config(['google','enabled'], false);
        config(['yahoo','enabled'], false);
        config(['files','enabled'], true);
        config(['files','dirname'], path.resolve(__dirname, 'var'));
        fetch = Fetch();
        quote = Quote(fetch);
        collect = Collect(quote);
        optimize = Optimize(collect);
        bestsignals = Bestsignals(optimize);
    });
    beforeEach(function() {
        optimize.seed(27644437);
    });
    after(function() {
        config.unset('prefix');
        config.unset(['iqfeed','enabled']);
        config.unset(['google','enabled']);
        config.unset(['yahoo','enabled']);
        config.unset(['files','enabled']);
        config.unset(['files','dirname']);
        return Promise.all([
            bestsignals.close(),
            optimize.close(),
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    it("should find best trend cross parameters", function() {
        return bestsignals({
            portfolio: 'SPY.ARCA',
            begin: '2016-10-01',
            end: '2016-12-31',
            signal_variable: 'signal',
            eval_score: 'gain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("signal")'
            },
            signalset: {
                signals: ['sma_cross','ema_cross'],
                variables: {
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    ema_cross: 'SIGN(EMA(fast_len,day.adj_close)-EMA(slow_len,day.adj_close))'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200]
                }
            }
        }).should.eventually.be.like({
            signals: ['ema_cross'],
            parameters: {
                fast_len: 50,
                slow_len: 150
            }
        });
    });
    it("should find best sma cross and ema cross parameters", function() {
        return bestsignals({
            portfolio: 'SPY.ARCA',
            begin: '2015-01-01',
            end: '2015-12-31',
            signal_variable: 'signal',
            eval_validity: 'fast_len<slow_len',
            eval_score: 'gain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("signal")'
            },
            signalset: [{
                signals: ['sma_cross'],
                variables: {
                    sma_cross: 'SMA(fast_len,day.adj_close)>SMA(slow_len,day.adj_close)'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200]
                }
            }, {
                signals: ['ema_cross'],
                variables: {
                    ema_cross: 'EMA(fast_len,day.adj_close)>EMA(slow_len,day.adj_close)'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200]
                }
            }]
        }).should.eventually.be.like({
            signals: ['sma_cross', 'ema_cross'],
            variables: {
                sma_cross: 'SMA(fast_lenA,day.adj_close)>SMA(slow_lenA,day.adj_close)',
                ema_cross: 'EMA(fast_lenB,day.adj_close)>EMA(slow_lenB,day.adj_close)'
            },
            parameters: {
                fast_lenA: 15,
                slow_lenA: 25,
                fast_lenB: 20,
                slow_lenB: 50
            }
        });
    });
    it("should find best counter trend cross parameters", function() {
        return bestsignals({
            portfolio: 'SPY.ARCA',
            begin: '2016-10-01',
            end: '2016-12-31',
            signal_variable: 'signal',
            eval_score: '-gain',
            columns: {
                date: 'DATE(ending)',
                change: 'close - PREV("close")',
                close: 'day.adj_close',
                gain: 'PREC("gain") + change * PREV("signal")'
            },
            signalset: {
                signals: ['sma_cross','ema_cross'],
                variables: {
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    ema_cross: 'SIGN(EMA(fast_len,day.adj_close)-EMA(slow_len,day.adj_close))'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200]
                }
            }
        }).should.eventually.be.like({
            signals: ['sma_cross'],
            variables: {
                sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))'
            },
            parameters: {
                fast_len: 25,
                slow_len: 100
            }
        });
    });
    it("should find the two best relative strength STO parameters", function() {
        return bestsignals({
            portfolio: 'SPY.ARCA',
            begin: '2016-07-01',
            end: '2016-10-01',
            signal_count: 2,
            signal_variable: 'signal',
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
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)'
            },
            signalset: {
                signals: ['STO_signal'],
                variables: {
                    STO_signal: 'SIGN(K-D)',
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
            }
        }).should.eventually.be.like({
            signals: ['STO_signalA', 'STO_signalB'],
            variables: {
                STO_signalA: 'SIGN(K-DA)',
                STO_signalB: 'SIGN(K-DB)',
                STO: 'CHANGE(day.adj_close,LOWEST(lookback,day.low),HIGHEST(lookback,day.high)-LOWEST(lookback,day.low))',
                K: 'SMA(Ksmoothing,STO)',
                DA: 'SMA(DmovingA,K)',
                DB: 'SMA(DmovingB,K)'
            },
            parameters: {
                lookback: 20,
                Ksmoothing: 7,
                DmovingA: 5,
                DmovingB: 3
            }
        });
    });
    it("should find best signal parameters for each", function() {
        return bestsignals({
            portfolio: 'SPY.ARCA',
            begin: '2016-07-01',
            end: '2016-12-31',
            signal_variable: 'signal',
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
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)'
            },
            signalset: [{
                signals: ['sma_cross','ema_cross'],
                variables: {
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    ema_cross: 'SIGN(EMA(fast_len,day.adj_close)-EMA(slow_len,day.adj_close))'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200]
                }
            }, {
                signals: ['bollinger_signal'],
                variables: {
                    middle_band: 'SMA(len,day.adj_close)',
                    upper_band: 'middle_band+multiplier*STDEV(len,day.adj_close)',
                    lower_band: 'middle_band-multiplier*STDEV(len,day.adj_close)',
                    bollinger_signal: 'IF(day.adj_close<upper_band AND (PREV("bollinger_signal")>0 OR day.adj_close<lower_band),1,day.adj_close>lower_band AND (PREV("bollinger_signal")<0 OR day.adj_close>upper_band),-1,0)'
                },
                parameters: {
                    len: 20,
                    multiplier: 2
                },
                parameter_values: {
                    len: [5,10,15,20,25,50],
                    multiplier: [1,2,3]
                }
            }, {
                signals: ['STO_signal'],
                variables: {
                    STO_signal: 'SIGN(K-D)',
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
            }]
        }).should.eventually.be.like({
            signals: ['ema_cross', 'bollinger_signal', 'STO_signal'],
            parameters:  {
                fast_len: 25,
                slow_len: 100,
                len: 10,
                multiplier: 2,
                lookback: 10,
                Ksmoothing: 3,
                Dmoving: 5
            }
        });
    });
    it("should find best overall signal", function() {
        return bestsignals({
            portfolio: 'SPY.ARCA',
            begin: '2016-07-01',
            end: '2016-12-31',
            signal_variable: 'signal',
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
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)'
            },
            signalset: [{
                signals: ['sma_cross','ema_cross','bollinger_signal','STO_signal'],
                variables: {
                    sma_cross: 'SIGN(SMA(fast_len,day.adj_close)-SMA(slow_len,day.adj_close))',
                    ema_cross: 'SIGN(EMA(fast_len,day.adj_close)-EMA(slow_len,day.adj_close))',
                    middle_band: 'SMA(len,day.adj_close)',
                    upper_band: 'middle_band+multiplier*STDEV(len,day.adj_close)',
                    lower_band: 'middle_band-multiplier*STDEV(len,day.adj_close)',
                    bollinger_signal: 'IF(day.adj_close<upper_band AND (PREV("bollinger_signal")>0 OR day.adj_close<lower_band),1,day.adj_close>lower_band AND (PREV("bollinger_signal")<0 OR day.adj_close>upper_band),-1,0)',
                    STO_signal: 'SIGN(K-D)',
                    STO: 'CHANGE(day.adj_close,LOWEST(lookback,day.low),HIGHEST(lookback,day.high)-LOWEST(lookback,day.low))',
                    K: 'SMA(Ksmoothing,STO)',
                    D: 'SMA(Dmoving,K)'
                },
                parameters: {
                    fast_len: 50,
                    slow_len: 200,
                    len: 20,
                    multiplier: 2,
                    lookback: 14,
                    Ksmoothing: 3,
                    Dmoving: 3
                },
                parameter_values: {
                    fast_len: [1,5,10,15,20,25,50],
                    slow_len: [20,25,50,80,100,150,200],
                    len: [5,10,15,20,25,50],
                    multiplier: [1,2,3],
                    lookback: [7,10,14,20,28,50],
                    Ksmoothing: [1,3,5,7],
                    Dmoving: [3,5]
                }
            }]
        }).should.eventually.be.like({
            signals: ['bollinger_signal'],
            parameters: {
                len: 10,
                multiplier: 2,
            }
        });
    });
});

