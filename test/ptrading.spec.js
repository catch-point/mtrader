// ptrading.spec.js
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
const ptrading = require('../src/ptrading.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("ptrading", function() {
    this.timeout(60000);
    before(function() {
        ptrading.config.load(path.resolve(__dirname, '../etc/ptrading.json'));
        ptrading.config('prefix', createTempDir('ptrading'));
        ptrading.config('iqfeed.enabled', false);
        ptrading.config('google.enabled', true);
        ptrading.config('yahoo.enabled', false);
        ptrading.config('files.enabled', false);
        process.emit('SIGHUP');
    });
    after(function() {
        ptrading.config.unset('prefix');
        ptrading.config.unset('iqfeed.enabled');
        ptrading.config.unset('google.enabled');
        ptrading.config.unset('yahoo.enabled');
        ptrading.config.unset('files.enabled');
    });
    it("lookup", function() {
        return ptrading.lookup({symbol: 'AABA'}).then(_.first).then(suggestion => {
            suggestion.symbol.should.eql('AABA');
            suggestion.exchange.should.eql('NASDAQ');
        });
    });
    it("fundamental", function() {
        return ptrading.fundamental({
          symbol: 'AABA',
          exchange: 'NASDAQ'
        }).should.eventually.be.like({
            name: /Altaba Inc/,
            eps: _.isFinite
        });
    });
    it("fetch", function() {
        return ptrading.fetch({
          interval: 'day',
          symbol: 'AABA',
          exchange: 'NASDAQ',
          begin: "2017-01-13",
          end: "2017-01-14",
        }).then(_.first).should.eventually.be.like({
            ending: _.isString,
            open: _.isFinite,
            high: _.isFinite,
            low: _.isFinite,
            close: _.isFinite,
            volume: _.isFinite,
        });
    });
    it("quote", function() {
        return ptrading.quote({
          symbol: 'AABA',
          exchange: 'NASDAQ',
          begin: "2017-01-13",
          pad_begin: 9,
          end: "2017-01-14",
          columns: {
              Date: 'DATE(ending)',
              Close: 'day.close',
              Change: '(day.adj_close - OFFSET(1, day.adj_close))*100/OFFSET(1,day.adj_close)'
          },
          criteria: 'day.adj_close > OFFSET(1, day.adj_close)'
        }).should.eventually.be.like([
            {Date:"2016-12-30",Close:38.67,Change:0.0776},
            {Date:"2017-01-03",Close:38.90,Change:0.5947},
            {Date:"2017-01-04",Close:40.06,Change:2.9820},
            {Date:"2017-01-05",Close:41.34,Change:3.1952},
            {Date:"2017-01-09",Close:41.34,Change:0.2667},
            {Date:"2017-01-10",Close:42.30,Change:2.3222},
            {Date:"2017-01-11",Close:42.59,Change:0.6855},
            {Date:"2017-01-13",Close:42.27,Change:0.3799}
        ]);
    });
    it("collect change", function() {
        return ptrading.collect({
          portfolio: 'AABA.NASDAQ,IBM.NYSE',
          begin: "2016-12-29",
          end: "2017-01-14",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              close: 'day.close',
              change: 'CHANGE(day.adj_close, OFFSET(1, day.adj_close))'
          },
          criteria: 'day.adj_close > OFFSET(1, day.adj_close) AND COUNTPREC()<1',
          precedence: 'DESC(PF(120,day.adj_close))'
        }).should.eventually.be.like([
            {symbol:'IBM',date:"2016-12-29",close:166.6,change:0.25},
            {symbol:'AABA',date:"2016-12-30",close:38.67,change:0.08},
            {symbol:'IBM',date:"2017-01-03",close:167.19,change:0.72},
            {symbol:'IBM',date:"2017-01-04",close:169.26,change:1.24},
            {symbol:'AABA',date:"2017-01-05",close:41.34,change:3.20},
            {symbol:'IBM',date:"2017-01-06",close:169.53,change:0.49},
            {symbol:'AABA',date:"2017-01-09",close:41.34,change:0.27},
            {symbol:'AABA',date:"2017-01-10",close:42.3,change:2.32},
            {symbol:'IBM',date:"2017-01-11",close:167.75,change:1.35},
            {symbol:'IBM',date:"2017-01-12",close:167.95,change:0.12},
            {symbol:'AABA',date:"2017-01-13",close:42.27,change:0.38}
        ]);
    });
    it("optimize SMA", function() {
        ptrading.optimize.seed(27644437);
        return ptrading.optimize({
            portfolio: 'SPY.ARCA',
            begin: '2000-01-01',
            end: '2010-01-01',
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
            parameters: { fast_len: 25, slow_len: 200 },
            parameter_values: {
                fast_len: [5,10,15,20,25,50],
                slow_len: [20,25,50,80,100,150,200]
            }
        }).should.eventually.be.like({
            parameters: { fast_len: 50, slow_len: 200 }
        });
    });
    it("should find best signal parameters for each", function() {
        ptrading.optimize.seed(27644437);
        ptrading.config.save('TREND', {
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
        ptrading.config.save('MEANREVERSION', {
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
        ptrading.config.save('RELATIVESTRENGTH', {
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
        return ptrading.bestsignals({
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
        }).should.eventually.be.like([{
            variables: {
                signal: 'STO_signal'
            },
            parameters:  {
                lookback: 10,
                Ksmoothing: 5,
                Dmoving: 3
            }
        }, {
            variables: {
                signal: 'bollinger_signal'
            },
            parameters:  {
                len: 10,
                multiplier: 2
            }
        }]);
    });
});




