// ptrading-collect.spec.js
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

describe("ptrading-collect", function() {
    this.timeout(1200000);
    before(function() {
        ptrading.config('config', path.resolve(__dirname, 'etc/ptrading.json'));
        ptrading.config('prefix', createTempDir('ptrading'));
        ptrading.config(['iqfeed','enabled'], false);
        ptrading.config(['google','enabled'], true);
        ptrading.config(['yahoo','enabled'], false);
        ptrading.config(['files','enabled'], false);
        ptrading.config(['files','dirname'], path.resolve(__dirname, 'var'));
        ptrading.config.save('SPY', {
            portfolio: 'SPY.ARCA',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(day.close,5)'
            }
        });
        ptrading.config.save('SPY_ARCA', {
            portfolio: 'ARCA_SPY',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(day.close,5)'
            }
        });
        ptrading.config.save('ARCA_SPY', {
            portfolio: 'SPY_ARCA',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            }
        });
    });
    after(function() {
        ptrading.config.unset('prefix');
        ptrading.config.unset(['iqfeed','enabled']);
        ptrading.config.unset(['google','enabled']);
        ptrading.config.unset(['yahoo','enabled']);
        ptrading.config.unset(['files','enabled']);
        ptrading.config.unset(['files','dirname']);
    });
    it("change", function() {
        return ptrading.collect({
          portfolio: 'AABA.NASDAQ,IBM.NYSE',
          pad_begin: 10,
          begin: "2017-01-13",
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
    it("profit", function() {
        return ptrading.collect({
          portfolio: 'AABA.NASDAQ,IBM.NYSE',
          begin: "2017-01-09",
          end: "2017-01-14",
          precedence: 'PF(120,day.adj_close)',
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              target: 'IF(COUNTPREC()<1,FLOOR(10000/(day.close)),0)',
              shares: 'IF(ABS(target-PREV("position"))>=10,target-PREV("position"), 0)',
              position: 'PREV("position") + shares',
              price: 'day.close + 0.02 * IF(shares>0,1,-1)', // includes slippage
              proceeds: '-shares * price',
              commission: 'IF(shares, MAX(shares * 0.005, 1.00), 0)',
              basis: 'IF(position=0,PREV("basis",price),(PREV("basis")*PREV("position")+price*shares)/position)',
              profit: 'PREV("profit") + (price - PREV("price")) * PREV("position") - commission'
          },
          criteria: 'position OR shares'
        }).should.eventually.be.like([
            {symbol:"AABA",date:"2017-01-09",target:241,shares:241,position:241,price:41.36,
                proceeds:-9967.76,commission:1.20,basis:41.36,profit:-1.20},
            {symbol:"IBM",date:"2017-01-10",target:60,shares:60,position:60,price:165.54,
                proceeds:-9932.40,commission:1,basis:165.54,profit:-1},
            {symbol:"AABA",date:"2017-01-10",target:0,shares:-241,position:0,price:42.27,
                proceeds:10189.48,commission:1,basis:41.36,profit:219.51},
            {symbol:"AABA",date:"2017-01-11",target:234,shares:234,position:234,price:42.61,
                proceeds:-9970.74,commission:1.17,basis:42.61,profit:218.34},
            {symbol:"IBM",date:"2017-01-11",target:0,shares:-60,position:0,price:167.73,
                proceeds:10063.8,commission:1,basis:165.54,profit:129.40},
            {symbol:"AABA",date:"2017-01-12",target:237,shares:0,position:234,price:42.09,
                proceeds:0,commission:0,basis:42.61,profit:96.66},
            {symbol:"IBM",date:"2017-01-13",target:59,shares:59,position:59,price:167.36,
                proceeds:-9874.24,commission:1,basis:167.36,profit:128.40},
            {symbol:"AABA",date:"2017-01-13",target:0,shares:-234,position:0,price:42.25,
                proceeds:9886.5,commission:1,basis:42.61,profit:133.10}
        ]);
    });
    it("by week should be the same as by month", function() {
        return ptrading.collect({
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
        }).then(expected => ptrading.collect({
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
        return ptrading.collect({
            portfolio: 'SPY',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).should.eventually.be.like([
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
        return Promise.resolve().then(() => ptrading.collect({
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
