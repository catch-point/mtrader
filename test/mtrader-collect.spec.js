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
const Mtrader = require('../src/mtrader.js');
const readCallSave = require('../src/read-call-save.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("mtrader-collect", function() {
    this.timeout(1200000);
    var mtrader;
    before(function() {
        mtrader = new Mtrader();
        mtrader.config('prefix', createTempDir('mtrader'));
        mtrader.config('fetch.iqfeed.enabled', false);
        mtrader.config('fetch.yahoo.enabled', true);
        mtrader.config('fetch.files.enabled', false);
        mtrader.config('runInBand', true);
        process.emit('SIGHUP');
        mtrader.config.save('SPY', {
            portfolio: 'SPY.ARCA',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(day.close,5)'
            }
        });
        mtrader.config.save('SPY_ARCA', {
            portfolio: 'ARCA_SPY',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(day.close,5)'
            }
        });
        mtrader.config.save('ARCA_SPY', {
            portfolio: 'SPY_ARCA',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            }
        });
    });
    after(function() {
        mtrader.config.unset('prefix');
        mtrader.config.unset('fetch.iqfeed.enabled');
        mtrader.config.unset('fetch.yahoo.enabled');
        mtrader.config.unset('fetch.files.enabled');
        mtrader.config.unset('runInBand');
        return mtrader.close();
    });
    it("by week should be the same as by month", function() {
        return mtrader.collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLY.ARCA',
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
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLY.ARCA',
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
            portfolio: 'SPY_ARCA',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        })).should.be.rejected;
    });
});
