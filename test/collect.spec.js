// collect.spec.js
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
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("collect", function() {
    this.timeout(60000);
    var fetch, quote, collect;
    before(function() {
        config('config', path.resolve(__dirname, 'etc/ptrading.json'));
        config('prefix', createTempDir('collect'));
        config(['iqfeed','enabled'], false);
        config(['google','enabled'], true);
        config(['yahoo','enabled'], true);
        config(['files','enabled'], true);
        config(['files','dirname'], path.resolve(__dirname, 'var'));
        fetch = Fetch();
        quote = Quote(fetch);
        collect = Collect(quote);
    });
    after(function() {
        config.unset('prefix');
        config.unset(['iqfeed','enabled']);
        config.unset(['google','enabled']);
        config.unset(['yahoo','enabled']);
        config.unset(['files','enabled']);
        config.unset(['files','dirname']);
        return Promise.all([
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    it("count", function() {
        return collect({
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
          retain: 'day.adj_close > OFFSET(1, day.adj_close) AND COUNTPREC(0, "symbol")<1',
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
    it("sum", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLK.ARCA,XLV.ARCA,XLY.ARCA',
          begin: "2016-12-01",
          end: "2016-12-02",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              Price: 'day.close',
              Weight: 'MIN(0.5/CVAR(5, 60, day.close), 100)'
          },
          retain: 'SUMPREC(0, "Weight")+Weight <= 100',
          precedence: 'DESC(MAX(PF(120,day.adj_close),PF(200,day.adj_close)))'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-12-01",Price:22.9,Weight:2.7401},
            {symbol:"XLE",date:"2016-12-01",Price:74.61,Weight:17.1398},
            {symbol:"XLK",date:"2016-12-01",Price:46.52,Weight:26.1815},
            {symbol:"XLY",date:"2016-12-01",Price:81.89,Weight:26.0778},
            {symbol:"XLV",date:"2016-12-01",Price:68.25,Weight:22.4790}
        ]);
    });
    it("balance", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLY.ARCA',
          begin: "2016-11-14",
          end: "2016-11-25",
          variables: {
              cor: 'MAXCORREL(60,day.adj_close)',
              risk: 'CVAR(5, 60, day.adj_close)',
              weight: 'IF(cor<0.75 AND SUMPREC(0,"weight")<=95, MIN(0.5/risk,100-SUMPREC(0,"weight")), 0)',
              target: 'FLOOR(100000*(weight + SUMPREV(2,"weight"))/300/day.close)',
              shares: 'IF(ABS(target-PREV("position",0))<50,0,target-PREV("position",0))',
              proceeds: '-shares * price',
              commission: 'IF(shares=0,0, MAX(shares * 0.005, 1.00))',
              basis: 'IF(position=0,PREV("basis"),(PREV("basis")*PREV("position")+price*shares)/position)',
              mtm: '(price - PREV("price",0)) * PREV("position",0)'
          },
          columns: {
              date: 'DATE(ending)',
              symbol: 'symbol',
              position: 'PREV("position",0) + shares',
              price: 'day.close + 0.02 * SIGN(shares)', // includes slippage
              cash: 'PREC("cash",100000)+proceeds-commission',
              value: 'PREC("value",100000)+mtm-commission'
          },
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          retain: 'position OR shares'
        }).should.eventually.be.like([
            {date:"2016-11-14",symbol:"XLF",position:429,price:22.22,cash:90465.475,value:99997.855},
            {date:"2016-11-14",symbol:"XLI",position:126,price:61.33,cash:82736.895,value:99996.855},
            {date:"2016-11-14",symbol:"XLE",position:81,price:69.87,cash:77076.425,value:99995.855},
            {date:"2016-11-14",symbol:"XLK",position:194,price:46.04,cash:68143.665,value:99994.855},
            {date:"2016-11-15",symbol:"XLF",position:859,price:22.2,cash:58595.515,value:99984.125},
            {date:"2016-11-15",symbol:"XLI",position:126,price:61.54,cash:58595.515,value:100010.585},
            {date:"2016-11-15",symbol:"XLE",position:159,price:71.84,cash:52990.995,value:100169.155},
            {date:"2016-11-15",symbol:"XLK",position:384,price:46.69,cash:44118.895,value:100294.255},
            {date:"2016-11-15",symbol:"XLY",position:108,price:80.06,cash:35471.415,value:100293.255},
            {date:"2016-11-16",symbol:"XLI",position:253,price:61.21,cash:27696.745,value:100250.675},
            {date:"2016-11-16",symbol:"XLF",position:859,price:21.86,cash:27696.745,value:99958.615},
            {date:"2016-11-16",symbol:"XLK",position:571,price:47.12,cash:18884.305,value:100122.735},
            {date:"2016-11-16",symbol:"XLE",position:240,price:71.34,cash:13104.765,value:100042.235},
            {date:"2016-11-16",symbol:"XLY",position:216,price:80.5,cash:4409.765,value:100088.755},
            {date:"2016-11-17",symbol:"XLF",position:859,price:22.16,cash:4409.765,value:100346.455},
            {date:"2016-11-17",symbol:"XLI",position:126,price:61.3,cash:12193.865,value:100368.225},
            {date:"2016-11-17",symbol:"XLK",position:571,price:47.4,cash:12193.865,value:100528.105},
            {date:"2016-11-17",symbol:"XLE",position:240,price:70.84,cash:12193.865,value:100408.105},
            {date:"2016-11-17",symbol:"XLY",position:320,price:81.47,cash:3719.985,value:100616.625},
            {date:"2016-11-18",symbol:"XLF",position:859,price:22.16,cash:3719.985,value:100616.625},
            {date:"2016-11-18",symbol:"XLI",position:126,price:61.3,cash:3719.985,value:100616.625},
            {date:"2016-11-18",symbol:"XLK",position:571,price:47.36,cash:3719.985,value:100593.785},
            {date:"2016-11-18",symbol:"XLY",position:320,price:81.2,cash:3719.985,value:100507.385},
            {date:"2016-11-18",symbol:"XLE",position:240,price:71.13,cash:3719.985,value:100576.985},
            {date:"2016-11-21",symbol:"XLF",position:1233,price:22.26,cash:-4607.125,value:100661.015},
            {date:"2016-11-21",symbol:"XLI",position:0,price:61.61,cash:3154.735,value:100699.075},
            {date:"2016-11-21",symbol:"XLK",position:571,price:47.84,cash:3154.735,value:100973.155},
            {date:"2016-11-21",symbol:"XLY",position:320,price:81.73,cash:3154.735,value:101142.755},
            {date:"2016-11-21",symbol:"XLE",position:240,price:72.82,cash:3154.735,value:101548.355},
            {date:"2016-11-22",symbol:"XLF",position:1233,price:22.25,cash:3154.735,value:101536.025},
            {date:"2016-11-22",symbol:"XLK",position:571,price:47.99,cash:3154.735,value:101621.675},
            {date:"2016-11-22",symbol:"XLY",position:320,price:82.7,cash:3154.735,value:101932.075},
            {date:"2016-11-22",symbol:"XLE",position:240,price:72.78,cash:3154.735,value:101922.475},
            {date:"2016-11-23",symbol:"XLF",position:1233,price:22.38,cash:3154.735,value:102082.765},
            {date:"2016-11-23",symbol:"XLK",position:571,price:47.8,cash:3154.735,value:101974.275},
            {date:"2016-11-23",symbol:"XLY",position:320,price:82.78,cash:3154.735,value:101999.875},
            {date:"2016-11-23",symbol:"XLE",position:240,price:73.08,cash:3154.735,value:102071.875}
        ]);
    });
    it("max correl", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLU.ARCA,XLV.ARCA,XLY.ARCA',
          begin: "2016-11-14",
          end: "2016-12-01",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              Price: 'day.close',
              Weight: 'ROUND(MIN(0.5/CVAR(5, 60, day.adj_close), 100),2)'
          },
          retain: [
            'MAXCORREL(60,day.adj_close)<0.75',
            'SUMPREC(0, "Weight")+Weight<=100'
          ].join(' AND '),
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-11-14",Price:22.20,Weight:28.59},
            {symbol:"XLI",date:"2016-11-14",Price:61.31,Weight:23.29},
            {symbol:"XLE",date:"2016-11-14",Price:69.85,Weight:17.14},
            {symbol:"XLK",date:"2016-11-14",Price:46.02,Weight:26.90},
            {symbol:"XLF",date:"2016-11-15",Price:22.18,Weight:28.59},
            {symbol:"XLE",date:"2016-11-15",Price:71.82,Weight:17.14},
            {symbol:"XLK",date:"2016-11-15",Price:46.67,Weight:26.90},
            {symbol:"XLY",date:"2016-11-15",Price:80.04,Weight:26.08},
            {symbol:"XLI",date:"2016-11-16",Price:61.19,Weight:23.29},
            {symbol:"XLK",date:"2016-11-16",Price:47.10,Weight:26.90},
            {symbol:"XLE",date:"2016-11-16",Price:71.32,Weight:17.14},
            {symbol:"XLY",date:"2016-11-16",Price:80.48,Weight:26.08},
            {symbol:"XLF",date:"2016-11-17",Price:22.16,Weight:27.42},
            {symbol:"XLK",date:"2016-11-17",Price:47.40,Weight:26.90},
            {symbol:"XLE",date:"2016-11-17",Price:70.84,Weight:17.14},
            {symbol:"XLY",date:"2016-11-17",Price:81.45,Weight:26.08},
            {symbol:"XLF",date:"2016-11-18",Price:22.16,Weight:27.42},
            {symbol:"XLK",date:"2016-11-18",Price:47.36,Weight:26.90},
            {symbol:"XLY",date:"2016-11-18",Price:81.20,Weight:26.08},
            {symbol:"XLE",date:"2016-11-18",Price:71.13,Weight:17.14},
            {symbol:"XLF",date:"2016-11-21",Price:22.24,Weight:27.42},
            {symbol:"XLK",date:"2016-11-21",Price:47.84,Weight:26.90},
            {symbol:"XLY",date:"2016-11-21",Price:81.73,Weight:29.71},
            {symbol:"XLF",date:"2016-11-22",Price:22.25,Weight:27.42},
            {symbol:"XLK",date:"2016-11-22",Price:47.99,Weight:26.90},
            {symbol:"XLY",date:"2016-11-22",Price:82.70,Weight:26.08},
            {symbol:"XLE",date:"2016-11-22",Price:72.78,Weight:17.14},
            {symbol:"XLF",date:"2016-11-23",Price:22.38,Weight:27.42},
            {symbol:"XLK",date:"2016-11-23",Price:47.80,Weight:26.90},
            {symbol:"XLY",date:"2016-11-23",Price:82.78,Weight:29.71},
            {symbol:"XLF",date:"2016-11-25",Price:22.41,Weight:27.42},
            {symbol:"XLK",date:"2016-11-25",Price:48.00,Weight:26.90},
            {symbol:"XLY",date:"2016-11-25",Price:82.98,Weight:29.71},
            {symbol:"XLF",date:"2016-11-28",Price:22.15,Weight:27.42},
            {symbol:"XLK",date:"2016-11-28",Price:48.04,Weight:26.90},
            {symbol:"XLY",date:"2016-11-28",Price:82.32,Weight:26.08},
            {symbol:"XLE",date:"2016-11-28",Price:71.71,Weight:17.14},
            {symbol:"XLF",date:"2016-11-29",Price:22.21,Weight:27.42},
            {symbol:"XLK",date:"2016-11-29",Price:48.07,Weight:26.90},
            {symbol:"XLY",date:"2016-11-29",Price:82.54,Weight:26.08},
            {symbol:"XLE",date:"2016-11-29",Price:70.83,Weight:17.14},
            {symbol:"XLF",date:"2016-11-30",Price:22.51,Weight:27.42},
            {symbol:"XLK",date:"2016-11-30",Price:47.50,Weight:26.90},
            {symbol:"XLE",date:"2016-11-30",Price:74.43,Weight:17.14},
            {symbol:"XLV",date:"2016-11-30",Price:68.75,Weight:22.48}
        ]);
    });
    it("max correl average", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLY.ARCA',
          begin: "2016-11-14",
          end: "2016-11-22",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              price: 'day.close',
              cor: 'ROUND(MAXCORREL(60,day.adj_close),2)',
              risk: 'ROUND(CVAR(5, 60, day.adj_close),3)',
              target: 'IF(cor<0.75 AND SUMPREC(0,"target")<=95, MIN(ROUND(0.5/risk,2),100-SUMPREC(0,"target")), 0)',
              weight: 'ROUND((target + SUMPREV(2,"target"))/3,2)'
          },
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          retain: 'weight OR PREV("weight")'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-11-14",price:22.2,cor:0,risk:0.017,target:29.41,weight:9.8},
            {symbol:"XLI",date:"2016-11-14",price:61.31,cor:0.74,risk:0.021,target:23.81,weight:7.94},
            {symbol:"XLE",date:"2016-11-14",price:69.85,cor:0.31,risk:0.029,target:17.24,weight:5.75},
            {symbol:"XLK",date:"2016-11-14",price:46.02,cor:0.35,risk:0.019,target:26.32,weight:8.77},
            {symbol:"XLF",date:"2016-11-15",price:22.18,cor:0,risk:0.017,target:29.41,weight:19.61},
            {symbol:"XLI",date:"2016-11-15",price:61.54,cor:0.8,risk:0.021,target:0,weight:7.94},
            {symbol:"XLE",date:"2016-11-15",price:71.82,cor:0.39,risk:0.029,target:17.24,weight:11.49},
            {symbol:"XLK",date:"2016-11-15",price:46.67,cor:0.29,risk:0.019,target:26.32,weight:17.55},
            {symbol:"XLY",date:"2016-11-15",price:80.04,cor:0.58,risk:0.019,target:26.32,weight:8.77},
            {symbol:"XLI",date:"2016-11-16",price:61.19,cor:0,risk:0.021,target:23.81,weight:15.87},
            {symbol:"XLF",date:"2016-11-16",price:21.86,cor:0.84,risk:0.018,target:0,weight:19.61},
            {symbol:"XLK",date:"2016-11-16",price:47.1,cor:-0.18,risk:0.019,target:26.32,weight:26.32},
            {symbol:"XLE",date:"2016-11-16",price:71.32,cor:0.42,risk:0.029,target:17.24,weight:17.24},
            {symbol:"XLY",date:"2016-11-16",price:80.48,cor:0.59,risk:0.019,target:26.32,weight:17.55},
            {symbol:"XLF",date:"2016-11-17",price:22.16,cor:0,risk:0.018,target:27.78,weight:19.06},
            {symbol:"XLI",date:"2016-11-17",price:61.32,cor:0.86,risk:0.021,target:0,weight:7.94},
            {symbol:"XLK",date:"2016-11-17",price:47.4,cor:-0.15,risk:0.019,target:26.32,weight:26.32},
            {symbol:"XLE",date:"2016-11-17",price:70.84,cor:0.45,risk:0.029,target:17.24,weight:17.24},
            {symbol:"XLY",date:"2016-11-17",price:81.45,cor:0.63,risk:0.019,target:26.32,weight:26.32},
            {symbol:"XLF",date:"2016-11-18",price:22.16,cor:0,risk:0.018,target:27.78,weight:18.52},
            {symbol:"XLI",date:"2016-11-18",price:61.3,cor:0.88,risk:0.021,target:0,weight:7.94},
            {symbol:"XLK",date:"2016-11-18",price:47.36,cor:-0.12,risk:0.019,target:26.32,weight:26.32},
            {symbol:"XLY",date:"2016-11-18",price:81.2,cor:0.66,risk:0.019,target:26.32,weight:26.32},
            {symbol:"XLE",date:"2016-11-18",price:71.13,cor:0.47,risk:0.029,target:17.24,weight:17.24},
            {symbol:"XLF",date:"2016-11-21",price:22.24,cor:0,risk:0.018,target:27.78,weight:27.78},
            {symbol:"XLI",date:"2016-11-21",price:61.63,cor:0.9,risk:0.021,target:0,weight:0},
            {symbol:"XLK",date:"2016-11-21",price:47.84,cor:-0.06,risk:0.019,target:26.32,weight:26.32},
            {symbol:"XLY",date:"2016-11-21",price:81.73,cor:0.69,risk:0.017,target:29.41,weight:27.35},
            {symbol:"XLE",date:"2016-11-21",price:72.82,cor:0.53,risk:0.029,target:16.49,weight:16.99}
        ]);
    });
    it("max correl trades", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLY.ARCA',
          pad_leading: 11,
          begin: "2016-11-30",
          end: "2016-12-01",
          variables: {
              cor: 'MAXCORREL(60,day.adj_close)',
              risk: 'CVAR(5, 60, day.adj_close)',
              weight: 'IF(cor<0.75 AND SUMPREC(0,"weight")<=95, MIN(0.5/risk,100-SUMPREC(0,"weight")), 0)',
              target: 'FLOOR(100000*(weight + SUMPREV(2,"weight"))/300/day.close)',
              proceeds: '-shares * price',
              commission: 'IF(shares=0,0, MAX(shares * 0.005, 1.00))'
          },
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              shares: 'IF(ABS(target-PREV("position",0))<50,0,target-PREV("position",0))',
              position: 'PREV("position",0) + shares',
              price: 'day.close + 0.02 * IF(shares>0,1,-1)', // includes slippage
              basis: 'ROUND(IF(position=0,PREV("basis"),(PREV("basis")*PREV("position")+price*shares)/position),2)',
              profit: 'PREV("profit",0) + (price - PREV("price",0)) * PREV("position",0) - commission'
          },
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          retain: 'position OR shares'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-11-30",shares:0,position:1233,price:22.49,basis:22.23,profit:320.385},
            {symbol:"XLK",date:"2016-11-30",shares:0,position:571,price:47.48,basis:46.61,profit:493.78},
            {symbol:"XLE",date:"2016-11-30",shares:0,position:240,price:74.41,basis:71.01,profit:813.87},
            {symbol:"XLY",date:"2016-11-30",shares:-108,position:212,price:81.83,basis:80.08,profit:368.24}
        ]);
    });
    it("external instrument", function() {
        return collect({
          portfolio: 'SPY.ARCA,XIC.TSX',
          begin: "2016-01-01",
          end: "2016-02-01",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              Price: 'day.close'
          },
          // USD.CAD day.ending is an hour after SPY.ARCA day.ending, so
          // the previous USD.CAD day.close is used
          retain: 'exchange=IF(USD.CAD(CVAR(5,60,day.close))<0.01,"ARCA","TSX")'
        }).should.eventually.be.like([
            {symbol:"SPY",date:"2016-01-04",Price:201.02},
            {symbol:"SPY",date:"2016-01-05",Price:201.36},
            {symbol:"SPY",date:"2016-01-06",Price:198.82},
            {symbol:"SPY",date:"2016-01-07",Price:194.05},
            {symbol:"SPY",date:"2016-01-08",Price:191.92},
            {symbol:"SPY",date:"2016-01-11",Price:192.11},
            {symbol:"SPY",date:"2016-01-12",Price:193.66},
            {symbol:"SPY",date:"2016-01-13",Price:188.83},
            {symbol:"SPY",date:"2016-01-14",Price:191.93},
            {symbol:"SPY",date:"2016-01-15",Price:187.81},
            {symbol:"SPY",date:"2016-01-19",Price:188.06},
            {symbol:"SPY",date:"2016-01-20",Price:185.65},
            {symbol:"SPY",date:"2016-01-21",Price:186.69},
            {symbol:"XIC",date:"2016-01-22",Price:19.65},
            {symbol:"XIC",date:"2016-01-25",Price:19.27},
            {symbol:"XIC",date:"2016-01-26",Price:19.56},
            {symbol:"XIC",date:"2016-01-27",Price:19.64},
            {symbol:"XIC",date:"2016-01-28",Price:19.98},
            {symbol:"XIC",date:"2016-01-29",Price:20.26}
        ]);
    });
    it("external instrument using same time of day", function() {
        return collect({
          portfolio: 'SPY.ARCA,XIC.TSX',
          begin: "2016-01-01",
          end: "2016-02-01",
          columns: {
              symbol: 'symbol',
              date: 'DATE(ending)',
              Price: 'day.close'
          },
          retain: 'exchange=IF(USD.CAD(TOD(CVAR(5,60,m60.close)))<0.01,"ARCA","TSX")'
        }).should.eventually.be.like([
            {symbol:"SPY",date:"2016-01-04",Price:201.02},
            {symbol:"SPY",date:"2016-01-05",Price:201.36},
            {symbol:"SPY",date:"2016-01-06",Price:198.82},
            {symbol:"SPY",date:"2016-01-07",Price:194.05},
            {symbol:"SPY",date:"2016-01-08",Price:191.92},
            {symbol:"SPY",date:"2016-01-11",Price:192.11},
            {symbol:"SPY",date:"2016-01-12",Price:193.66},
            {symbol:"SPY",date:"2016-01-13",Price:188.83},
            {symbol:"SPY",date:"2016-01-14",Price:191.93},
            {symbol:"SPY",date:"2016-01-15",Price:187.81},
            {symbol:"SPY",date:"2016-01-19",Price:188.06},
            {symbol:"SPY",date:"2016-01-20",Price:185.65},
            {symbol:"XIC",date:"2016-01-21",Price:19.08},
            {symbol:"XIC",date:"2016-01-22",Price:19.65},
            {symbol:"XIC",date:"2016-01-25",Price:19.27},
            {symbol:"XIC",date:"2016-01-26",Price:19.56},
            {symbol:"XIC",date:"2016-01-27",Price:19.64},
            {symbol:"XIC",date:"2016-01-28",Price:19.98},
            {symbol:"XIC",date:"2016-01-29",Price:20.26}
        ]);
    });
    it("should inline criteria variables", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: 'povo<50 AND (povo<18 OR PREV("open"))',
                entry: 'open AND PREV("open") AND PREV("entry") OR close'
            },
            columns: {
                date: "DATE(ending)",
                close: "day.close",
                change: "CHANGE(close,OFFSET(1,close))",
                povo: "ROUND(day.POVO(20))",
                position: "IF(open,100000,0)",
                profit: "ROUND((close-entry)/entry*position,2)"
            },
            begin: '2014-02-10',
            end: '2014-02-22'
        }).should.eventually.be.like([
            {date:"2014-02-10",close:1.10574,change:0.23,povo:37,position:0,profit:0},
            {date:"2014-02-11",close:1.10067,change:-0.46,povo:22,position:0,profit:0},
            {date:"2014-02-12",close:1.10008,change:-0.05,povo:17,position:100000,profit:0},
            {date:"2014-02-13",close:1.09751,change:-0.23,povo:11,position:100000,profit:-233.62},
            {date:"2014-02-14",close:1.09849,change:0.09,povo:12,position:100000,profit:-144.53},
            {date:"2014-02-17",close:1.09609,change:-0.22,povo:4,position:100000,profit:-362.70},
            {date:"2014-02-18",close:1.09454,change:-0.14,povo:1,position:100000,profit:-503.60},
            {date:"2014-02-19",close:1.10772,change:1.2,povo:42,position:100000,profit:694.49},
            {date:"2014-02-20",close:1.10969,change:0.18,povo:65,position:0,profit:0},
            {date:"2014-02-21",close:1.1112,change:0.14,povo:70,position:0,profit:0}
        ]);
    });
    it("should allow columns to have same name as variable", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: 'povo<50 AND (povo<18 OR PREV("open"))',
                entry: 'open AND PREV("open") AND PREV("entry") OR close',
                notUsed: 'm30.close'
            },
            columns: {
                date: "DATE(day.ending)",
                open: "day.open",
                close: "day.close",
                change: "CHANGE(close,OFFSET(1,close))",
                povo: "ROUND(day.POVO(20))",
                entry: 'entry',
                profit: "ROUND((close-entry)/entry*IF(open,100000,0),2)"
            },
            begin: '2014-02-10',
            end: '2014-02-22'
        }).should.eventually.be.like([
            {date:"2014-02-10",open:1.10336,close:1.10574,change:0.23,povo:37,entry:1.10574,profit:0},
            {date:"2014-02-11",open:1.10574,close:1.10067,change:-0.46,povo:22,entry:1.10067,profit:0},
            {date:"2014-02-12",open:1.10068,close:1.10008,change:-0.05,povo:17,entry:1.10008,profit:0},
            {date:"2014-02-13",open:1.10008,close:1.09751,change:-0.23,povo:11,entry:1.10008,profit:-233.62},
            {date:"2014-02-14",open:1.09751,close:1.09849,change:0.09,povo:12,entry:1.10008,profit:-144.53},
            {date:"2014-02-17",open:1.0984,close:1.09609,change:-0.22,povo:4,entry:1.10008,profit:-362.7},
            {date:"2014-02-18",open:1.09625,close:1.09454,change:-0.14,povo:1,entry:1.10008,profit:-503.6},
            {date:"2014-02-19",open:1.09448,close:1.10772,change:1.2,povo:42,entry:1.10008,profit:694.49},
            {date:"2014-02-20",open:1.10786,close:1.10969,change:0.18,povo:65,entry:1.10969,profit:0},
            {date:"2014-02-21",open:1.10969,close:1.1112,change:0.14,povo:70,entry:1.1112,profit:0}
        ]);
    });
    it("should filter out most results using leading retain", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: 'IF ((HOUR(m60.ending)=12 OR PREV("open")=OFFSET(1,m30.ending)) AND m30.close>=OFFSET(1,m30.close),m30.ending)'
            },
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close'
            },
            retain: [
                'DATE(month.ending) = DATE(day.ending)',
                'HOUR(m60.ending) >= 12',
                'open'
            ].join(' and '),
            begin: '2014-01-01T08:30:00-0500',
            end: '2014-12-31T17:00:00-0500'
        }).should.eventually.be.like([
            {Date:"2014-01-02",Time:"12:30:00",Price:1.06356},
            {Date:"2014-01-02",Time:"13:00:00",Price:1.06393},
            {Date:"2014-01-02",Time:"13:30:00",Price:1.06394},
            {Date:"2014-01-02",Time:"14:00:00",Price:1.06515},
            {Date:"2014-01-02",Time:"14:30:00",Price:1.06544},
            {Date:"2014-01-02",Time:"15:00:00",Price:1.0661},
            {Date:"2014-01-02",Time:"15:30:00",Price:1.0662},
            {Date:"2014-01-02",Time:"16:00:00",Price:1.06721},
            {Date:"2014-02-03",Time:"12:00:00",Price:1.10735},
            {Date:"2014-02-03",Time:"12:30:00",Price:1.10895},
            {Date:"2014-02-03",Time:"13:00:00",Price:1.10933},
            {Date:"2014-02-03",Time:"13:30:00",Price:1.10964},
            {Date:"2014-02-03",Time:"14:00:00",Price:1.11},
            {Date:"2014-03-03",Time:"12:00:00",Price:1.109},
            {Date:"2014-04-01",Time:"12:00:00",Price:1.1025},
            {Date:"2014-06-02",Time:"12:30:00",Price:1.09025},
            {Date:"2014-07-01",Time:"12:00:00",Price:1.06521},
            {Date:"2014-08-01",Time:"12:00:00",Price:1.09177},
            {Date:"2014-09-01",Time:"12:30:00",Price:1.08626},
            {Date:"2014-11-03",Time:"12:00:00",Price:1.13188},
            {Date:"2014-11-03",Time:"12:30:00",Price:1.13363},
            {Date:"2014-11-03",Time:"13:00:00",Price:1.13378},
            {Date:"2014-11-03",Time:"13:30:00",Price:1.13521}
        ]);
    });
    it("should filter out most results using filter", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: '(HOUR(m60.ending)=12 OR PREV("open")) AND m30.close>=OFFSET(1,m30.close)'
            },
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close'
            },
            retain: [
                'DATE(month.ending) = DATE(day.ending)',
                'HOUR(m60.ending) >= 12'
            ],
            filter: [
                'open'
            ],
            begin: '2014-01-01T08:30:00-0500',
            end: '2014-12-31T17:00:00-0500'
        }).should.eventually.be.like([
            {Date:"2014-01-02",Time:"12:30:00",Price:1.06356},
            {Date:"2014-01-02",Time:"13:00:00",Price:1.06393},
            {Date:"2014-01-02",Time:"13:30:00",Price:1.06394},
            {Date:"2014-01-02",Time:"14:00:00",Price:1.06515},
            {Date:"2014-01-02",Time:"14:30:00",Price:1.06544},
            {Date:"2014-01-02",Time:"15:00:00",Price:1.0661},
            {Date:"2014-01-02",Time:"15:30:00",Price:1.0662},
            {Date:"2014-01-02",Time:"16:00:00",Price:1.06721},
            {Date:"2014-02-03",Time:"12:00:00",Price:1.10735},
            {Date:"2014-02-03",Time:"12:30:00",Price:1.10895},
            {Date:"2014-02-03",Time:"13:00:00",Price:1.10933},
            {Date:"2014-02-03",Time:"13:30:00",Price:1.10964},
            {Date:"2014-02-03",Time:"14:00:00",Price:1.11},
            {Date:"2014-03-03",Time:"12:00:00",Price:1.109},
            {Date:"2014-04-01",Time:"12:00:00",Price:1.1025},
            {Date:"2014-06-02",Time:"12:30:00",Price:1.09025},
            {Date:"2014-07-01",Time:"12:00:00",Price:1.06521},
            {Date:"2014-08-01",Time:"12:00:00",Price:1.09177},
            {Date:"2014-09-01",Time:"12:30:00",Price:1.08626},
            {Date:"2014-11-03",Time:"12:00:00",Price:1.13188},
            {Date:"2014-11-03",Time:"12:30:00",Price:1.13363},
            {Date:"2014-11-03",Time:"13:00:00",Price:1.13378},
            {Date:"2014-11-03",Time:"13:30:00",Price:1.13521}
        ]);
    });
    it("should order results", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: '(HOUR(m60.ending)=12 OR PREV("open")) AND m30.close>=OFFSET(1,m30.close)'
            },
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close'
            },
            retain: [
                'DATE(month.ending) = DATE(day.ending)',
                'HOUR(m60.ending) >= 12'
            ],
            filter: [
                'open'
            ],
            order: 'DESC(Date),DESC(Time)',
            begin: '2014-01-01T08:30:00-0500',
            end: '2014-12-31T17:00:00-0500'
        }).should.eventually.be.like([
            {Date:"2014-11-03",Time:"13:30:00",Price:1.13521},
            {Date:"2014-11-03",Time:"13:00:00",Price:1.13378},
            {Date:"2014-11-03",Time:"12:30:00",Price:1.13363},
            {Date:"2014-11-03",Time:"12:00:00",Price:1.13188},
            {Date:"2014-09-01",Time:"12:30:00",Price:1.08626},
            {Date:"2014-08-01",Time:"12:00:00",Price:1.09177},
            {Date:"2014-07-01",Time:"12:00:00",Price:1.06521},
            {Date:"2014-06-02",Time:"12:30:00",Price:1.09025},
            {Date:"2014-04-01",Time:"12:00:00",Price:1.1025},
            {Date:"2014-03-03",Time:"12:00:00",Price:1.109},
            {Date:"2014-02-03",Time:"14:00:00",Price:1.11},
            {Date:"2014-02-03",Time:"13:30:00",Price:1.10964},
            {Date:"2014-02-03",Time:"13:00:00",Price:1.10933},
            {Date:"2014-02-03",Time:"12:30:00",Price:1.10895},
            {Date:"2014-02-03",Time:"12:00:00",Price:1.10735},
            {Date:"2014-01-02",Time:"16:00:00",Price:1.06721},
            {Date:"2014-01-02",Time:"15:30:00",Price:1.0662},
            {Date:"2014-01-02",Time:"15:00:00",Price:1.0661},
            {Date:"2014-01-02",Time:"14:30:00",Price:1.06544},
            {Date:"2014-01-02",Time:"14:00:00",Price:1.06515},
            {Date:"2014-01-02",Time:"13:30:00",Price:1.06394},
            {Date:"2014-01-02",Time:"13:00:00",Price:1.06393},
            {Date:"2014-01-02",Time:"12:30:00",Price:1.06356}
        ]);
    });
    it("should identify results using leading criteria", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                entryAt: 'IF(Price>=OFFSET(1,Price),IF(PREV("entryAt"),PREV("entryAt"), IF(HOUR(m60.ending)=12, m30.ending)))'
            },
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                position: 'IF(entryAt<m30.ending, 100, 0)'
           },
            retain: [
                'DATE(month.ending) = DATE(day.ending)'
            ].join(' and '),
            begin: '2014-01-02T11:30:00-0500',
            end: '2014-01-02T17:00:00-0500'
        }).should.eventually.be.like([
            {Date:"2014-01-02",Time:"11:30:00",Price:1.06343,position:0},
            {Date:"2014-01-02",Time:"12:00:00",Price:1.06335,position:0},
            {Date:"2014-01-02",Time:"12:30:00",Price:1.06356,position:0},
            {Date:"2014-01-02",Time:"13:00:00",Price:1.06393,position:100},
            {Date:"2014-01-02",Time:"13:30:00",Price:1.06394,position:100},
            {Date:"2014-01-02",Time:"14:00:00",Price:1.06515,position:100},
            {Date:"2014-01-02",Time:"14:30:00",Price:1.06544,position:100},
            {Date:"2014-01-02",Time:"15:00:00",Price:1.0661,position:100},
            {Date:"2014-01-02",Time:"15:30:00",Price:1.0662,position:100},
            {Date:"2014-01-02",Time:"16:00:00",Price:1.06721,position:100},
            {Date:"2014-01-02",Time:"16:30:00",Price:1.06671,position:0}
        ]);
    });
    it("should use LEADING to meansure change", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: 'povo<50 AND (povo<15 OR PREV("open"))',
                entry: 'open AND PREV("open") AND PREV("entry") OR close'
            },
            columns: {
                date: "DATE(ending)",
                close: "day.close",
                change: "CHANGE(close,OFFSET(1,close))",
                povo: "ROUND(day.POVO(20))",
                position: "IF(open,100000,0)",
                profit: "ROUND((close-entry)/entry*position,2)"
            },
            begin: '2014-02-10',
            end: '2014-02-22'
        }).should.eventually.be.like([
            {date:"2014-02-10",close:1.10574,change:0.23,povo:37,position:0,profit:0},
            {date:"2014-02-11",close:1.10067,change:-0.46,povo:22,position:0,profit:0},
            {date:"2014-02-12",close:1.10008,change:-0.05,povo:17,position:0,profit:0},
            {date:"2014-02-13",close:1.09751,change:-0.23,povo:11,position:100000,profit:0},
            {date:"2014-02-14",close:1.09849,change:0.09,povo:12,position:100000,profit:89.29},
            {date:"2014-02-17",close:1.09609,change:-0.22,povo:4,position:100000,profit:-129.38},
            {date:"2014-02-18",close:1.09454,change:-0.14,povo:1,position:100000,profit:-270.61},
            {date:"2014-02-19",close:1.10772,change:1.2,povo:42,position:100000,profit:930.29},
            {date:"2014-02-20",close:1.10969,change:0.18,povo:65,position:0,profit:0},
            {date:"2014-02-21",close:1.1112,change:0.14,povo:70,position:0,profit:0}
        ]);
    });
    it("should use LEADING to meansure change", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                open: 'povo<50 AND (povo<15 OR PREV("open"))',
                entry: 'open AND PREV("open") AND PREV("entry") OR close'
            },
            columns: {
                date: "DATE(ending)",
                hour: "HOUR(ending)",
                close: "m240.close",
                change: "CHANGE(close,OFFSET(1,close))",
                povo: "ROUND(day.POVO(20))",
                position: "IF(open,100000,0)",
                profit: "ROUND((close-entry)/entry*100000,2)"
            },
            begin: '2014-02-12',
            end: '2014-02-21'
        }).should.eventually.be.like([
            {date:"2014-02-12",hour:0,close:1.09959,change:-0.23,povo:22,position:0,profit:0},
            {date:"2014-02-12",hour:4,close:1.09941,change:-0.02,povo:22,position:0,profit:0},
            {date:"2014-02-12",hour:8,close:1.10071,change:0.12,povo:22,position:0,profit:0},
            {date:"2014-02-12",hour:12,close:1.0992,change:-0.14,povo:22,position:0,profit:0},
            {date:"2014-02-12",hour:16,close:1.09963,change:0.04,povo:22,position:0,profit:0},
            {date:"2014-02-12",hour:20,close:1.10079,change:0.11,povo:17,position:0,profit:0},
            {date:"2014-02-13",hour:0,close:1.10068,change:-0.01,povo:17,position:0,profit:0},
            {date:"2014-02-13",hour:4,close:1.09839,change:-0.21,povo:17,position:0,profit:0},
            {date:"2014-02-13",hour:8,close:1.09909,change:0.06,povo:17,position:0,profit:0},
            {date:"2014-02-13",hour:12,close:1.09786,change:-0.11,povo:17,position:0,profit:0},
            {date:"2014-02-13",hour:16,close:1.09759,change:-0.02,povo:17,position:0,profit:0},
            {date:"2014-02-13",hour:20,close:1.09746,change:-0.01,povo:11,position:100000,profit:0},
            {date:"2014-02-14",hour:0,close:1.09504,change:-0.22,povo:11,position:100000,profit:-220.51},
            {date:"2014-02-14",hour:4,close:1.09598,change:0.09,povo:11,position:100000,profit:-134.86},
            {date:"2014-02-14",hour:8,close:1.09475,change:-0.11,povo:11,position:100000,profit:-246.93},
            {date:"2014-02-14",hour:12,close:1.09804,change:0.3,povo:11,position:100000,profit:52.85},
            {date:"2014-02-14",hour:16,close:1.09816,change:0.01,povo:11,position:100000,profit:63.78},
            {date:"2014-02-14",hour:20,close:1.09849,change:0.03,povo:12,position:100000,profit:93.85},
            {date:"2014-02-16",hour:20,close:1.09789,change:-0.05,povo:12,position:100000,profit:39.18},
            {date:"2014-02-17",hour:0,close:1.09723,change:-0.06,povo:12,position:100000,profit:-20.96},
            {date:"2014-02-17",hour:4,close:1.09747,change:0.02,povo:12,position:100000,profit:0.91},
            {date:"2014-02-17",hour:8,close:1.09659,change:-0.08,povo:12,position:100000,profit:-79.27},
            {date:"2014-02-17",hour:12,close:1.09605,change:-0.05,povo:12,position:100000,profit:-128.48},
            {date:"2014-02-17",hour:16,close:1.09613,change:0.01,povo:12,position:100000,profit:-121.19},
            {date:"2014-02-17",hour:20,close:1.0952,change:-0.08,povo:4,position:100000,profit:-205.93},
            {date:"2014-02-18",hour:0,close:1.0956,change:0.04,povo:4,position:100000,profit:-169.48},
            {date:"2014-02-18",hour:4,close:1.09669,change:0.1,povo:4,position:100000,profit:-70.16},
            {date:"2014-02-18",hour:8,close:1.09654,change:-0.01,povo:4,position:100000,profit:-83.83},
            {date:"2014-02-18",hour:12,close:1.09511,change:-0.13,povo:4,position:100000,profit:-214.13},
            {date:"2014-02-18",hour:16,close:1.095,change:-0.01,povo:4,position:100000,profit:-224.15},
            {date:"2014-02-18",hour:20,close:1.09546,change:0.04,povo:1,position:100000,profit:-182.24},
            {date:"2014-02-19",hour:0,close:1.09339,change:-0.19,povo:1,position:100000,profit:-370.86},
            {date:"2014-02-19",hour:4,close:1.09293,change:-0.04,povo:1,position:100000,profit:-412.77},
            {date:"2014-02-19",hour:8,close:1.09434,change:0.13,povo:1,position:100000,profit:-284.29},
            {date:"2014-02-19",hour:12,close:1.10446,change:0.92,povo:1,position:100000,profit:637.84},
            {date:"2014-02-19",hour:16,close:1.10808,change:0.33,povo:1,position:100000,profit:967.69},
            {date:"2014-02-19",hour:20,close:1.1073,change:-0.07,povo:42,position:100000,profit:896.62},
            {date:"2014-02-20",hour:0,close:1.10766,change:0.03,povo:42,position:100000,profit:929.42},
            {date:"2014-02-20",hour:4,close:1.10663,change:-0.09,povo:42,position:100000,profit:835.57},
            {date:"2014-02-20",hour:8,close:1.10784,change:0.11,povo:42,position:100000,profit:945.82},
            {date:"2014-02-20",hour:12,close:1.11039,change:0.23,povo:42,position:100000,profit:1178.18},
            {date:"2014-02-20",hour:16,close:1.10976,change:-0.06,povo:42,position:100000,profit:1120.77},
            {date:"2014-02-20",hour:20,close:1.11183,change:0.19,povo:65,position:0,profit:0},
            {date:"2014-02-21",hour:0,close:1.11255,change:0.06,povo:65,position:0,profit:0}
        ]);;
    });
    it("should reset LEADING at the same point", function() {
        return collect({
            portfolio: "USD.CAD",
            variables: {
                uptrend: 'povo<85 AND (povo<15 OR PREV("uptrend"))',
                downtrend: 'povo>15 AND (povo>85 OR PREV("downtrend"))',
                entry: '(uptrend AND PREV("uptrend") OR downtrend AND PREV("downtrend")) AND PREV("entry") OR close'
            },
            columns: {
                date: "DATE(ending)",
                close: "day.close",
                change: "CHANGE(close,OFFSET(1,close))",
                povo: "ROUND(day.POVO(20))",
                position: "IF(uptrend,100000,downtrend,-100000,0)",
                profit: "ROUND((close-entry)/entry*position,2)",
            },
            begin: '2014-01-30',
            end: '2014-03-07'
        }).should.eventually.be.like([
            {date:"2014-01-30",close:1.11578,change:-0.08,povo:90,position:-100000,profit:0},
            {date:"2014-01-31",close:1.11251,change:-0.29,povo:81,position:-100000,profit:293.07},
            {date:"2014-02-03",close:1.11162,change:-0.08,povo:77,position:-100000,profit:372.83},
            {date:"2014-02-04",close:1.108,change:-0.33,povo:54,position:-100000,profit:697.27},
            {date:"2014-02-05",close:1.1081,change:0.01,povo:51,position:-100000,profit:688.31},
            {date:"2014-02-06",close:1.10684,change:-0.11,povo:43,position:-100000,profit:801.23},
            {date:"2014-02-07",close:1.10319,change:-0.33,povo:33,position:-100000,profit:1128.36},
            {date:"2014-02-10",close:1.10574,change:0.23,povo:37,position:-100000,profit:899.82},
            {date:"2014-02-11",close:1.10067,change:-0.46,povo:22,position:-100000,profit:1354.21},
            {date:"2014-02-12",close:1.10008,change:-0.05,povo:17,position:-100000,profit:1407.09},
            {date:"2014-02-13",close:1.09751,change:-0.23,povo:11,position:100000,profit:0},
            {date:"2014-02-14",close:1.09849,change:0.09,povo:12,position:100000,profit:89.29},
            {date:"2014-02-17",close:1.09609,change:-0.22,povo:4,position:100000,profit:-129.38},
            {date:"2014-02-18",close:1.09454,change:-0.14,povo:1,position:100000,profit:-270.61},
            {date:"2014-02-19",close:1.10772,change:1.2,povo:42,position:100000,profit:930.29},
            {date:"2014-02-20",close:1.10969,change:0.18,povo:65,position:100000,profit:1109.78},
            {date:"2014-02-21",close:1.1112,change:0.14,povo:70,position:100000,profit:1247.37},
            {date:"2014-02-24",close:1.10549,change:-0.51,povo:35,position:100000,profit:727.1},
            {date:"2014-02-25",close:1.10829,change:0.25,povo:56,position:100000,profit:982.22},
            {date:"2014-02-26",close:1.11262,change:0.39,povo:88,position:-100000,profit:0},
            {date:"2014-02-27",close:1.11188,change:-0.07,povo:83,position:-100000,profit:66.51},
            {date:"2014-02-28",close:1.1064,change:-0.49,povo:45,position:-100000,profit:559.04},
            {date:"2014-03-03",close:1.10749,change:0.1,povo:53,position:-100000,profit:461.07},
            {date:"2014-03-04",close:1.10899,change:0.14,povo:71,position:-100000,profit:326.26},
            {date:"2014-03-05",close:1.10276,change:-0.56,povo:29,position:-100000,profit:886.2},
            {date:"2014-03-06",close:1.09829,change:-0.41,povo:16,position:-100000,profit:1287.95}
        ]);
    });
    it("should call nested collect", function() {
        config.save('CADUSD', {
            portfolio: 'USD.CAD',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            }
        });
        return collect({
            portfolio: 'CADUSD',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).should.eventually.be.like([
            {date:"2017-01-02",close:0.74421},
            {date:"2017-01-03",close:0.74481},
            {date:"2017-01-04",close:0.75185},
            {date:"2017-01-05",close:0.7561},
            {date:"2017-01-06",close:0.75549},
            {date:"2017-01-09",close:0.75662},
            {date:"2017-01-10",close:0.75574},
            {date:"2017-01-11",close:0.75882},
            {date:"2017-01-12",close:0.76076},
            {date:"2017-01-13",close:0.7629},
            {date:"2017-01-16",close:0.75911},
            {date:"2017-01-17",close:0.76678},
            {date:"2017-01-18",close:0.75364},
            {date:"2017-01-19",close:0.75087},
            {date:"2017-01-20",close:0.7514},
            {date:"2017-01-23",close:0.75548},
            {date:"2017-01-24",close:0.76014},
            {date:"2017-01-25",close:0.76518},
            {date:"2017-01-26",close:0.76397},
            {date:"2017-01-27",close:0.76054},
            {date:"2017-01-30",close:0.76238}
        ]);
    });
    it("should detect nested collect cycle", function() {
        config.save('USDCAD', {
            portfolio: 'CADUSD',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            }
        });
        config.save('CADUSD', {
            portfolio: 'USDCAD',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            }
        });
        return Promise.resolve().then(() => collect({
            portfolio: 'CADUSD',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        })).should.be.rejected;
    });
    it("should ignore unused columns in nested collect", function() {
        config.save('CADUSD', {
            portfolio: 'USD.CAD',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)',
                'm240.ending': 'm240.ending',
                'm240.close': 'ROUND(1/m240.close,5)'
            }
        });
        return collect({
            portfolio: 'CADUSD',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).should.eventually.be.like([
            {date:"2017-01-02",close:0.74421},
            {date:"2017-01-03",close:0.74481},
            {date:"2017-01-04",close:0.75185},
            {date:"2017-01-05",close:0.7561},
            {date:"2017-01-06",close:0.75549},
            {date:"2017-01-09",close:0.75662},
            {date:"2017-01-10",close:0.75574},
            {date:"2017-01-11",close:0.75882},
            {date:"2017-01-12",close:0.76076},
            {date:"2017-01-13",close:0.7629},
            {date:"2017-01-16",close:0.75911},
            {date:"2017-01-17",close:0.76678},
            {date:"2017-01-18",close:0.75364},
            {date:"2017-01-19",close:0.75087},
            {date:"2017-01-20",close:0.7514},
            {date:"2017-01-23",close:0.75548},
            {date:"2017-01-24",close:0.76014},
            {date:"2017-01-25",close:0.76518},
            {date:"2017-01-26",close:0.76397},
            {date:"2017-01-27",close:0.76054},
            {date:"2017-01-30",close:0.76238}
        ]);
    });
    it("should override order in nested collect", function() {
        config.save('CADUSD', {
            portfolio: 'USD.CAD',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)'
            },
            order: 'DESC(day.ending)'
        });
        return collect({
            portfolio: 'CADUSD',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).should.eventually.be.like([
            {date:"2017-01-02",close:0.74421},
            {date:"2017-01-03",close:0.74481},
            {date:"2017-01-04",close:0.75185},
            {date:"2017-01-05",close:0.7561},
            {date:"2017-01-06",close:0.75549},
            {date:"2017-01-09",close:0.75662},
            {date:"2017-01-10",close:0.75574},
            {date:"2017-01-11",close:0.75882},
            {date:"2017-01-12",close:0.76076},
            {date:"2017-01-13",close:0.7629},
            {date:"2017-01-16",close:0.75911},
            {date:"2017-01-17",close:0.76678},
            {date:"2017-01-18",close:0.75364},
            {date:"2017-01-19",close:0.75087},
            {date:"2017-01-20",close:0.7514},
            {date:"2017-01-23",close:0.75548},
            {date:"2017-01-24",close:0.76014},
            {date:"2017-01-25",close:0.76518},
            {date:"2017-01-26",close:0.76397},
            {date:"2017-01-27",close:0.76054},
            {date:"2017-01-30",close:0.76238}
        ]);
    });
    it("should not hide used columns", function() {
        config.save('CADUSD', {
            portfolio: 'USD.CAD',
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)',
                cad_close: '1/day.close'
            },
            order: 'cad_close'
        });
        return collect({
            portfolio: 'CADUSD',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).should.eventually.be.like([
            {date:"2017-01-02",close:0.74421},
            {date:"2017-01-03",close:0.74481},
            {date:"2017-01-04",close:0.75185},
            {date:"2017-01-05",close:0.7561},
            {date:"2017-01-06",close:0.75549},
            {date:"2017-01-09",close:0.75662},
            {date:"2017-01-10",close:0.75574},
            {date:"2017-01-11",close:0.75882},
            {date:"2017-01-12",close:0.76076},
            {date:"2017-01-13",close:0.7629},
            {date:"2017-01-16",close:0.75911},
            {date:"2017-01-17",close:0.76678},
            {date:"2017-01-18",close:0.75364},
            {date:"2017-01-19",close:0.75087},
            {date:"2017-01-20",close:0.7514},
            {date:"2017-01-23",close:0.75548},
            {date:"2017-01-24",close:0.76014},
            {date:"2017-01-25",close:0.76518},
            {date:"2017-01-26",close:0.76397},
            {date:"2017-01-27",close:0.76054},
            {date:"2017-01-30",close:0.76238}
        ]);
    });
    it("should not hide columns used by variables", function() {
        config.save('CADUSD', {
            portfolio: 'USD.CAD',
            variables: {
                cad_change: '(cad_close-PREV("cad_close"))/PREV("cad_close")'
            },
            columns: {
                'day.ending': 'day.ending',
                'day.close': 'ROUND(1/day.close,5)',
                cad_close: '1/day.close',
                change: 'ROUND(cad_change*100, 2)'
            }
        });
        return collect({
            portfolio: 'CADUSD',
            columns: {
                date: 'DATE(day.ending)',
                close: 'day.close',
                change: 'change'
            },
            begin: '2017-01-01',
            end: '2017-01-31'
        }).should.eventually.be.like([
            {date:"2017-01-02",close:0.74421},
            {date:"2017-01-03",close:0.74481,change:0.08},
            {date:"2017-01-04",close:0.75185,change:0.95},
            {date:"2017-01-05",close:0.7561,change:0.57},
            {date:"2017-01-06",close:0.75549,change:-0.08},
            {date:"2017-01-09",close:0.75662,change:0.15},
            {date:"2017-01-10",close:0.75574,change:-0.12},
            {date:"2017-01-11",close:0.75882,change:0.41},
            {date:"2017-01-12",close:0.76076,change:0.26},
            {date:"2017-01-13",close:0.7629,change:0.28},
            {date:"2017-01-16",close:0.75911,change:-0.5},
            {date:"2017-01-17",close:0.76678,change:1.01},
            {date:"2017-01-18",close:0.75364,change:-1.71},
            {date:"2017-01-19",close:0.75087,change:-0.37},
            {date:"2017-01-20",close:0.7514,change:0.07},
            {date:"2017-01-23",close:0.75548,change:0.54},
            {date:"2017-01-24",close:0.76014,change:0.62},
            {date:"2017-01-25",close:0.76518,change:0.66},
            {date:"2017-01-26",close:0.76397,change:-0.16},
            {date:"2017-01-27",close:0.76054,change:-0.45},
            {date:"2017-01-30",close:0.76238,change:0.24}
        ]);
    });
    it("nested", function() {
        config.save('SPDR', {
          portfolio: 'XLB.ARCA,XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLP.ARCA,XLU.ARCA,XLV.ARCA,XLY.ARCA',
          variables: {
              max: 'MIN(0.5/CVAR(5, 60, day.close), 100)'
          },
          columns: {
              date: 'DATE(ending)',
              symbol: 'symbol',
              price: 'day.close',
              target: 'IF(SUMPREC(0, "max")<100, max)'
          },
          precedence: 'DESC(MAX(PF(120,day.adj_close),PF(200,day.adj_close)))'
        });
        return collect({
          portfolio: 'SPDR',
          begin: "2016-12-01",
          end: "2016-12-03",
          columns: {
              date: 'date',
              symbol: 'symbol',
              price: 'price',
              weight: 'ROUND(MIN(target,IF(SUMPREC(0,"target")<100,100-SUMPREC(0,"target"),0)),2)'
          },
          precedence: 'DESC(target),symbol'
        }).should.eventually.be.like([
            {date:"2016-12-01",symbol:"XLI",price:62.82,weight:26.46},
            {date:"2016-12-01",symbol:"XLK",price:46.52,weight:26.18},
            {date:"2016-12-01",symbol:"XLY",price:81.89,weight:26.08},
            {date:"2016-12-01",symbol:"XLB",price:49.96,weight:21.28},
            {date:"2016-12-01",symbol:"XLE",price:74.61,weight:0},
            {date:"2016-12-01",symbol:"XLF",price:22.9,weight:0},
            {date:"2016-12-01",symbol:"XLP",price:50.25,weight:0},
            {date:"2016-12-01",symbol:"XLU",price:46.38,weight:0},
            {date:"2016-12-01",symbol:"XLV",price:68.25,weight:0},
            {date:"2016-12-02",symbol:"XLI",price:62.81,weight:26.46},
            {date:"2016-12-02",symbol:"XLK",price:46.69,weight:26.18},
            {date:"2016-12-02",symbol:"XLY",price:81.44,weight:26.08},
            {date:"2016-12-02",symbol:"XLB",price:49.98,weight:21.28},
            {date:"2016-12-02",symbol:"XLE",price:74.83,weight:0},
            {date:"2016-12-02",symbol:"XLF",price:22.65,weight:0},
            {date:"2016-12-02",symbol:"XLP",price:50.57,weight:0},
            {date:"2016-12-02",symbol:"XLU",price:46.8,weight:0},
            {date:"2016-12-02",symbol:"XLV",price:68.41,weight:0}
        ]);
    });
});

