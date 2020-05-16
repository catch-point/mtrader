// mtrader.spec.js
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
const config = require('../src/config.js');
config('runInBand', true);
const Mtrader = require('../src/mtrader.js');
const readCallSave = require('../src/read-call-save.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("mtrader", function() {
    this.timeout(120000);
    var mtrader;
    before(function() {
        Mtrader.config('prefix', createTempDir('mtrader'));
        mtrader = new Mtrader();
    });
    after(function() {
        Mtrader.config.unset('prefix');
        return mtrader.close();
    });
    it("optimize SMA", function() {
        mtrader.seed(27644437);
        return mtrader.optimize({
            portfolio: 'SPY.ARCA',
            begin: '2000-01-01',
            end: '2010-01-01',
            population_size: 12,
            optimize_termination: 'PT5M',
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
                sma_cross: 'SMA(fast_len,day.adj_close)>SMA(slow_len,day.adj_close)',
                peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
                drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)'
            },
            parameters: { fast_len: 20, slow_len: 200 },
            parameter_values: {
                fast_len: [5,10,20,50],
                slow_len: [20,50,100,200]
            }
        }).should.eventually.be.like({
            parameters: { fast_len: 50, slow_len: 200 }
        });
    });
    it("should find best signal parameters for each", function() {
        mtrader.seed(27644437);
        mtrader.config.save('TREND', {
            population_size: 12,
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
        });
        mtrader.config.save('MEANREVERSION', {
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
        });
        mtrader.config.save('RELATIVESTRENGTH', {
            population_size: 12,
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
        });
        mtrader.config.save('BEST', {
            portfolio: 'SPY.ARCA',
            begin: '2016-07-01',
            end: '2016-12-31',
            signal_variable: 'signal',
            eval_score: 'gain/pain',
            solution_count: 2,
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
            signalset: ['TREND', 'MEANREVERSION', 'RELATIVESTRENGTH']
        });
        process.emit('SIGHUP');
        return readCallSave('BEST', mtrader.bestsignals).should.eventually.be.like([{
            variables: {
                signal: /bollinger_signal|STO_signal/
            },
            parameters:  {}
        }, {
            variables: {
                signal: /bollinger_signal|STO_signal/
            },
            parameters:  {}
        }]);
    });
});




