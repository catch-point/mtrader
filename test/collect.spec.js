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
        config(['google','enabled'], false);
        config(['yahoo','enabled'], false);
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
          portfolio: 'YHOO.NASDAQ,IBM.NYSE',
          pad_begin: 10,
          begin: "2017-01-13",
          end: "2017-01-14",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "close"',
              'CHANGE(day.adj_close, OFFSET(1, day.adj_close)) AS "change"'
          ],
          retain: 'day.adj_close > OFFSET(1, day.adj_close) AND COUNTPREC(0, "symbol")<1',
          precedence: 'DESC(PF(120,day.adj_close))'
        }).should.eventually.be.like([
            {symbol:'IBM',date:"2016-12-29",close:166.6,change:0.25},
            {symbol:'YHOO',date:"2016-12-30",close:38.67,change:0.08},
            {symbol:'IBM',date:"2017-01-03",close:167.19,change:0.72},
            {symbol:'IBM',date:"2017-01-04",close:169.26,change:1.24},
            {symbol:'YHOO',date:"2017-01-05",close:41.34,change:3.20},
            {symbol:'IBM',date:"2017-01-06",close:169.53,change:0.49},
            {symbol:'YHOO',date:"2017-01-09",close:41.34,change:0.27},
            {symbol:'YHOO',date:"2017-01-10",close:42.3,change:2.32},
            {symbol:'IBM',date:"2017-01-11",close:167.75,change:1.35},
            {symbol:'IBM',date:"2017-01-12",close:167.95,change:0.12},
            {symbol:'YHOO',date:"2017-01-13",close:42.27,change:0.38}
        ]);
    });
    it("sum", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLK.ARCA,XLV.ARCA,XLY.ARCA',
          begin: "2016-12-01",
          end: "2016-12-02",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"',
              'MIN(0.5/CVAR(5, 60, day.close), 100) AS "Weight"'
          ],
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
          columns: [
              'DATE(ending) AS date',
              'symbol',
              'MAXCORREL(60,day.adj_close) AS cor',
              'CVAR(5, 60, day.adj_close) AS risk',
              'IF(cor<0.75 AND SUMPREC(0,"weight")<=95, MIN(0.5/risk,100-SUMPREC(0,"weight")), 0) AS weight',
              'FLOOR(100000*(weight + SUMPREV(2,"weight"))/300/day.close) AS target',
              'IF(ABS(target-PREV("position",0))<50,0,target-PREV("position",0)) AS shares',
              'PREV("position",0) + shares AS position',
              'day.close + 0.02 * IF(shares>0,1,-1) AS price', // includes slippage
              '-shares * price AS proceeds',
              'IF(shares=0,0, MAX(shares * 0.005, 1.00)) AS commission',
              'IF(position=0,PREV("basis"),(PREV("basis")*PREV("position")+price*shares)/position) AS basis',
              '(price - PREV("price",0)) * PREV("position",0) AS mtm',
              'PREC("cash",100000)+proceeds-commission AS cash',
              'PREC("value",100000)+mtm-commission AS value'
          ],
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          retain: 'position OR shares'
        }).then(data=>data.map(o=>_.pick(o,'date', 'symbol', 'position', 'price', 'cash', 'value')))
          .should.eventually.be.like([
            {date:"2016-11-14",symbol:"XLF",position:429,price:22.22,cash:90465.475,value:99997.855},
            {date:"2016-11-14",symbol:"XLI",position:126,price:61.33,cash:82736.895,value:99996.855},
            {date:"2016-11-14",symbol:"XLE",position:81,price:69.87,cash:77076.425,value:99995.855},
            {date:"2016-11-14",symbol:"XLK",position:194,price:46.04,cash:68143.665,value:99994.855},
            {date:"2016-11-15",symbol:"XLF",position:859,price:22.2,cash:58595.515,value:99984.125},
            {date:"2016-11-15",symbol:"XLI",position:126,price:61.52,cash:58595.515,value:100008.065},
            {date:"2016-11-15",symbol:"XLE",position:159,price:71.84,cash:52990.995,value:100166.635},
            {date:"2016-11-15",symbol:"XLK",position:384,price:46.69,cash:44118.895,value:100291.735},
            {date:"2016-11-15",symbol:"XLY",position:108,price:80.06,cash:35471.415,value:100290.735},
            {date:"2016-11-16",symbol:"XLI",position:253,price:61.21,cash:27696.745,value:100250.675},
            {date:"2016-11-16",symbol:"XLF",position:859,price:21.84,cash:27696.745,value:99941.435},
            {date:"2016-11-16",symbol:"XLK",position:571,price:47.12,cash:18884.305,value:100105.555},
            {date:"2016-11-16",symbol:"XLE",position:240,price:71.34,cash:13104.765,value:100025.055},
            {date:"2016-11-16",symbol:"XLY",position:216,price:80.5,cash:4409.765,value:100071.575},
            {date:"2016-11-17",symbol:"XLF",position:859,price:22.14,cash:4409.765,value:100329.275},
            {date:"2016-11-17",symbol:"XLI",position:126,price:61.3,cash:12193.865,value:100351.045},
            {date:"2016-11-17",symbol:"XLK",position:571,price:47.38,cash:12193.865,value:100499.505},
            {date:"2016-11-17",symbol:"XLE",position:240,price:70.82,cash:12193.865,value:100374.705},
            {date:"2016-11-17",symbol:"XLY",position:320,price:81.47,cash:3719.985,value:100583.225},
            {date:"2016-11-18",symbol:"XLF",position:859,price:22.14,cash:3719.985,value:100583.225},
            {date:"2016-11-18",symbol:"XLI",position:126,price:61.28,cash:3719.985,value:100580.705},
            {date:"2016-11-18",symbol:"XLK",position:571,price:47.34,cash:3719.985,value:100557.865},
            {date:"2016-11-18",symbol:"XLY",position:320,price:81.18,cash:3719.985,value:100465.065},
            {date:"2016-11-18",symbol:"XLE",position:240,price:71.11,cash:3719.985,value:100534.665},
            {date:"2016-11-21",symbol:"XLF",position:1233,price:22.26,cash:-4607.125,value:100635.875},
            {date:"2016-11-21",symbol:"XLI",position:0,price:61.61,cash:3154.735,value:100676.455},
            {date:"2016-11-21",symbol:"XLK",position:571,price:47.82,cash:3154.735,value:100950.535},
            {date:"2016-11-21",symbol:"XLY",position:320,price:81.71,cash:3154.735,value:101120.135},
            {date:"2016-11-21",symbol:"XLE",position:240,price:72.8,cash:3154.735,value:101525.735},
            {date:"2016-11-22",symbol:"XLF",position:1233,price:22.23,cash:3154.735,value:101488.745},
            {date:"2016-11-22",symbol:"XLK",position:571,price:47.97,cash:3154.735,value:101574.395},
            {date:"2016-11-22",symbol:"XLY",position:320,price:82.68,cash:3154.735,value:101884.795},
            {date:"2016-11-22",symbol:"XLE",position:240,price:72.76,cash:3154.735,value:101875.195},
            {date:"2016-11-23",symbol:"XLF",position:1233,price:22.36,cash:3154.735,value:102035.485},
            {date:"2016-11-23",symbol:"XLK",position:571,price:47.78,cash:3154.735,value:101926.995},
            {date:"2016-11-23",symbol:"XLY",position:320,price:82.76,cash:3154.735,value:101952.595},
            {date:"2016-11-23",symbol:"XLE",position:240,price:73.06,cash:3154.735,value:102024.595}
        ]);
    });
    it("max correl", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLU.ARCA,XLV.ARCA,XLY.ARCA',
          begin: "2016-11-14",
          end: "2016-12-01",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"',
              'ROUND(MIN(0.5/CVAR(5, 60, day.adj_close), 100),2) AS "Weight"'
          ],
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
          columns: [
              'symbol',
              'DATE(ending) AS date',
              'day.close AS price',
              'ROUND(MAXCORREL(60,day.adj_close),2) AS cor',
              'ROUND(CVAR(5, 60, day.adj_close),3) AS risk',
              'IF(cor<0.75 AND SUMPREC(0,"target")<=95, MIN(ROUND(0.5/risk,2),100-SUMPREC(0,"target")), 0) AS target',
              'ROUND((target + SUMPREV(2,"target"))/3,2) AS weight'
          ],
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
          columns: [
              'symbol',
              'DATE(ending) AS date',
              'MAXCORREL(60,day.adj_close) AS cor',
              'CVAR(5, 60, day.adj_close) AS risk',
              'IF(cor<0.75 AND SUMPREC(0,"weight")<=95, MIN(0.5/risk,100-SUMPREC(0,"weight")), 0) AS weight',
              'FLOOR(100000*(weight + SUMPREV(2,"weight"))/300/day.close) AS target',
              'IF(ABS(target-PREV("position",0))<50,0,target-PREV("position",0)) AS shares',
              'PREV("position",0) + shares AS position',
              'day.close + 0.02 * IF(shares>0,1,-1) AS price', // includes slippage
              '-shares * price AS proceeds',
              'IF(shares=0,0, MAX(shares * 0.005, 1.00)) AS commission',
              'ROUND(IF(position=0,PREV("basis"),(PREV("basis")*PREV("position")+price*shares)/position),2) AS basis',
              'PREV("profit",0) + (price - PREV("price",0)) * PREV("position",0) - commission AS profit'
          ],
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))',
          retain: 'position OR shares'
        }).then(data=>data.map(o=>_.omit(o,'cor','risk','weight','target','proceeds','commission')))
          .should.eventually.be.like([
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
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"'
          ],
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
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"'
          ],
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
            columns: [
                "DATE(ending) AS date",
                "day.close AS close",
                "CHANGE(close,OFFSET(1,close)) AS change",
                "ROUND(day.POVO(20)) AS povo",
                "IF(LEADING(povo)<18 AND povo<50,100000,0) AS position",
                "ROUND((close-LEADING(close))/LEADING(close)*100000,2) AS profit",
            ],
            criteria: "LEADING(povo)<18 AND povo<50",
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
});

