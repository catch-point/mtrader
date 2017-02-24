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
        config.unset(['yahoo','enabled']);
        config.unset(['files','enabled']);
        return Promise.all([
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    it("count", function() {
        return collect({
          portfolio: 'YHOO.NASDAQ,IBM.NYSE',
          pad_begin: 9,
          begin: "2017-01-13",
          end: "2017-01-14",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "close"',
              'CHANGE(day.adj_close, OFFSET(1, day.adj_close)) AS "change"'
          ].join(','),
          criteria: 'day.adj_close > OFFSET(1, day.adj_close)',
          retain: 'COUNT(symbol)<=1',
          precedence: 'DESC(PF(120,day.adj_close))'
        }).should.eventually.be.like([
            {symbol:'IBM',date:"2016-12-29",close:166.6,change:0.2467},
            {symbol:'YHOO',date:"2016-12-30",close:38.67,change:0.0776},
            {symbol:'IBM',date:"2017-01-03",close:167.19,change:0.7229},
            {symbol:'IBM',date:"2017-01-04",close:169.26,change:1.2381},
            {symbol:'YHOO',date:"2017-01-05",close:41.34,change:3.1952},
            {symbol:'IBM',date:"2017-01-06",close:169.53,change:0.4919},
            {symbol:'YHOO',date:"2017-01-09",close:41.34,change:0.2667},
            {symbol:'YHOO',date:"2017-01-10",close:42.3,change:2.3222},
            {symbol:'IBM',date:"2017-01-11",close:167.75,change:1.3472},
            {symbol:'IBM',date:"2017-01-12",close:167.95,change:0.1192},
            {symbol:'YHOO',date:"2017-01-13",close:42.27,change:0.3799}
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
          ].join(','),
          retain: 'SUM(MIN(0.5/CVAR(5, 60, day.adj_close), 100)) <= 100',
          precedence: 'DESC(MAX(PF(120,day.adj_close),PF(200,day.adj_close)))'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-12-01",Price:22.9,Weight:9.9549},
            {symbol:"XLE",date:"2016-12-01",Price:74.61,Weight:12.7971},
            {symbol:"XLK",date:"2016-12-01",Price:46.52,Weight:27.8882},
            {symbol:"XLY",date:"2016-12-01",Price:81.89,Weight:27.4883}
        ]);
    });
    it("max correl", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLP.ARCA,XLU.ARCA,XLV.ARCA,XLY.ARCA',
          begin: "2016-11-14",
          end: "2016-12-01",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"',
              'MIN(0.5/CVAR(5, 60, day.close), 100) AS "Weight"'
          ].join(','),
          retain: [
            'MAXCORREL(60,day.adj_close)<0.75',
            'SUM(MIN(0.5/CVAR(5,60,day.adj_close), 100))<=100'
          ].join(' AND '),
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-11-14",Price:22.20,Weight:10.0710},
            {symbol:"XLI",date:"2016-11-14",Price:61.31,Weight:21.6351},
            {symbol:"XLE",date:"2016-11-14",Price:69.85,Weight:17.6174},
            {symbol:"XLK",date:"2016-11-14",Price:46.02,Weight:27.8882},
            {symbol:"XLF",date:"2016-11-15",Price:22.18,Weight:10.0792},
            {symbol:"XLE",date:"2016-11-15",Price:71.82,Weight:16.3964},
            {symbol:"XLK",date:"2016-11-15",Price:46.67,Weight:29.5361},
            {symbol:"XLY",date:"2016-11-15",Price:80.04,Weight:27.4883},
            {symbol:"XLI",date:"2016-11-16",Price:61.19,Weight:21.6351},
            {symbol:"XLK",date:"2016-11-16",Price:47.10,Weight:29.5361},
            {symbol:"XLE",date:"2016-11-16",Price:71.32,Weight:16.3964},
            {symbol:"XLY",date:"2016-11-16",Price:80.48,Weight:27.4883},
            {symbol:"XLF",date:"2016-11-17",Price:22.16,Weight:10.0535},
            {symbol:"XLK",date:"2016-11-17",Price:47.40,Weight:29.5361},
            {symbol:"XLE",date:"2016-11-17",Price:70.84,Weight:16.3964},
            {symbol:"XLY",date:"2016-11-17",Price:81.45,Weight:27.4883},
            {symbol:"XLF",date:"2016-11-18",Price:22.16,Weight:10.0583},
            {symbol:"XLK",date:"2016-11-18",Price:47.36,Weight:29.5361},
            {symbol:"XLY",date:"2016-11-18",Price:81.20,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-18",Price:71.13,Weight:16.3964},
            {symbol:"XLF",date:"2016-11-21",Price:22.24,Weight:10.0831},
            {symbol:"XLK",date:"2016-11-21",Price:47.84,Weight:29.5361},
            {symbol:"XLY",date:"2016-11-21",Price:81.73,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-21",Price:72.82,Weight:17.4381},
            {symbol:"XLF",date:"2016-11-22",Price:22.25,Weight:10.1231},
            {symbol:"XLK",date:"2016-11-22",Price:47.99,Weight:27.8882},
            {symbol:"XLY",date:"2016-11-22",Price:82.70,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-22",Price:72.78,Weight:17.4381},
            {symbol:"XLF",date:"2016-11-23",Price:22.38,Weight:10.1009},
            {symbol:"XLK",date:"2016-11-23",Price:47.80,Weight:27.8882},
            {symbol:"XLY",date:"2016-11-23",Price:82.78,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-23",Price:73.08,Weight:17.4381},
            {symbol:"XLF",date:"2016-11-25",Price:22.41,Weight:10.0815},
            {symbol:"XLK",date:"2016-11-25",Price:48.00,Weight:27.8882},
            {symbol:"XLY",date:"2016-11-25",Price:82.98,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-25",Price:72.72,Weight:17.4381},
            {symbol:"XLF",date:"2016-11-28",Price:22.15,Weight:10.1329},
            {symbol:"XLK",date:"2016-11-28",Price:48.04,Weight:29.5361},
            {symbol:"XLY",date:"2016-11-28",Price:82.32,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-28",Price:71.71,Weight:17.4381},
            {symbol:"XLF",date:"2016-11-29",Price:22.21,Weight:10.1157},
            {symbol:"XLK",date:"2016-11-29",Price:48.07,Weight:29.5361},
            {symbol:"XLY",date:"2016-11-29",Price:82.54,Weight:27.4883},
            {symbol:"XLE",date:"2016-11-29",Price:70.83,Weight:17.4381},
            {symbol:"XLF",date:"2016-11-30",Price:22.51,Weight:10.0471},
            {symbol:"XLK",date:"2016-11-30",Price:47.50,Weight:29.5361},
            {symbol:"XLE",date:"2016-11-30",Price:74.43,Weight:12.7971},
            {symbol:"XLV",date:"2016-11-30",Price:68.75,Weight:16.9539},
            {symbol:"XLU",date:"2016-11-30",Price:46.75,Weight:24.7222}
        ]);
    });
    it("max correl trades", function() {
        return collect({
          portfolio: 'XLE.ARCA,XLF.ARCA,XLI.ARCA,XLK.ARCA,XLP.ARCA,XLU.ARCA,XLV.ARCA,XLY.ARCA',
          begin: "2016-11-14",
          end: "2016-11-19",
          columns: [
              'symbol',
              'DATE(ending) AS date',
              'day.close AS price',
              'MAXCORREL(60,day.adj_close) AS correl',
              'CVAR(5, 60, day.adj_close) AS risk',
              'IF(correl<0.75 AND SUM(MIN(0.5/risk,100))<=100, MIN(0.5/risk,100), 0) AS weight'
          ].join(','),
          precedence: 'DESC(MAX(PF(120,day.adj_close), PF(200,day.adj_close)))'
        }).should.eventually.be.like([
            {symbol:"XLF",date:"2016-11-14",price:22.2,correl:0,risk:0.0312,weight:16.0234},
            {symbol:"XLI",date:"2016-11-14",price:61.31,correl:0.7395,risk:0.0231,weight:21.6351},
            {symbol:"XLE",date:"2016-11-14",price:69.85,correl:0.3137,risk:0.0283,weight:17.6174},
            {symbol:"XLK",date:"2016-11-14",price:46.02,correl:0.3469,risk:0.0179,weight:27.8882},
            {symbol:"XLY",date:"2016-11-14",price:79.73,correl:0.6013,risk:0.0181,weight:0},
            {symbol:"XLV",date:"2016-11-14",price:70.27,correl:0.7825,risk:0.0294,weight:0},
            {symbol:"XLU",date:"2016-11-14",price:46,correl:0.3992,risk:0.0197,weight:0},
            {symbol:"XLP",date:"2016-11-14",price:50.45,correl:0.7251,risk:0.0175,weight:0},
            {symbol:"XLF",date:"2016-11-15",price:22.18,correl:0,risk:0.0312,weight:16.0234},
            {symbol:"XLI",date:"2016-11-15",price:61.54,correl:0.7996,risk:0.0231,weight:0},
            {symbol:"XLE",date:"2016-11-15",price:71.82,correl:0.3873,risk:0.0304,weight:16.3964},
            {symbol:"XLK",date:"2016-11-15",price:46.67,correl:0.2927,risk:0.0169,weight:29.5361},
            {symbol:"XLY",date:"2016-11-15",price:80.04,correl:0.5781,risk:0.0181,weight:0},
            {symbol:"XLV",date:"2016-11-15",price:70.47,correl:0.7651,risk:0.0294,weight:0},
            {symbol:"XLU",date:"2016-11-15",price:46.74,correl:0.3784,risk:0.0197,weight:0},
            {symbol:"XLP",date:"2016-11-15",price:50.76,correl:0.7323,risk:0.0175,weight:0},
            {symbol:"XLI",date:"2016-11-16",price:61.19,correl:0,risk:0.0231,weight:21.6351},
            {symbol:"XLF",date:"2016-11-16",price:21.86,correl:0.8353,risk:0.0312,weight:0},
            {symbol:"XLK",date:"2016-11-16",price:47.1,correl:-0.1787,risk:0.0169,weight:29.5361},
            {symbol:"XLE",date:"2016-11-16",price:71.32,correl:0.4249,risk:0.0304,weight:16.3964},
            {symbol:"XLY",date:"2016-11-16",price:80.48,correl:0.5876,risk:0.0181,weight:0},
            {symbol:"XLV",date:"2016-11-16",price:70.17,correl:0.7328,risk:0.0294,weight:0},
            {symbol:"XLP",date:"2016-11-16",price:50.77,correl:0.4967,risk:0.0175,weight:0},
            {symbol:"XLU",date:"2016-11-16",price:46.42,correl:0.7445,risk:0.0197,weight:0},
            {symbol:"XLF",date:"2016-11-17",price:22.16,correl:0,risk:0.0312,weight:16.0234},
            {symbol:"XLI",date:"2016-11-17",price:61.32,correl:0.8624,risk:0.0231,weight:0},
            {symbol:"XLK",date:"2016-11-17",price:47.4,correl:-0.1452,risk:0.0169,weight:29.5361},
            {symbol:"XLE",date:"2016-11-17",price:70.84,correl:0.4462,risk:0.0304,weight:16.3964},
            {symbol:"XLY",date:"2016-11-17",price:81.45,correl:0.6268,risk:0.0181,weight:0},
            {symbol:"XLV",date:"2016-11-17",price:70.45,correl:0.6891,risk:0.0294,weight:0},
            {symbol:"XLP",date:"2016-11-17",price:50.68,correl:0.4694,risk:0.0175,weight:0},
            {symbol:"XLU",date:"2016-11-17",price:46.43,correl:0.7549,risk:0.0197,weight:0},
            {symbol:"XLF",date:"2016-11-18",price:22.16,correl:0,risk:0.0312,weight:16.0234},
            {symbol:"XLI",date:"2016-11-18",price:61.3,correl:0.8826,risk:0.0231,weight:0},
            {symbol:"XLK",date:"2016-11-18",price:47.36,correl:-0.1218,risk:0.0169,weight:29.5361},
            {symbol:"XLY",date:"2016-11-18",price:81.2,correl:0.6552,risk:0.0181,weight:27.4884},
            {symbol:"XLE",date:"2016-11-18",price:71.13,correl:0.4732,risk:0.0304,weight:0},
            {symbol:"XLV",date:"2016-11-18",price:69.7,correl:0.6431,risk:0.0294,weight:0},
            {symbol:"XLP",date:"2016-11-18",price:50.5,correl:0.4608,risk:0.0175,weight:0},
            {symbol:"XLU",date:"2016-11-18",price:46.29,correl:0.7643,risk:0.0197,weight:0}
        ]);
    });
    it("external instrument", function() {
        return collect({
          portfolio: 'SPY.ARCA,XIC.TSX',
          begin: "2015-10-01",
          end: "2015-11-01",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"'
          ].join(','),
          // USD.CAD day.ending is an hour after SPY.ARCA day.ending, so
          // the previous USD.CAD day.close is used
          retain: 'exchange=IF(USD.CAD(CVAR(5,60,day.close))<0.01,"ARCA","TSX")'
        }).should.eventually.be.like([
            {symbol:"XIC",date:"2015-10-01",Price:20.95},
            {symbol:"XIC",date:"2015-10-02",Price:21.13},
            {symbol:"XIC",date:"2015-10-05",Price:21.48},
            {symbol:"XIC",date:"2015-10-06",Price:21.63},
            {symbol:"SPY",date:"2015-10-07",Price:199.41},
            {symbol:"SPY",date:"2015-10-08",Price:201.21},
            {symbol:"SPY",date:"2015-10-09",Price:201.33},
            {symbol:"SPY",date:"2015-10-12",Price:201.52},
            {symbol:"SPY",date:"2015-10-13",Price:200.25},
            {symbol:"SPY",date:"2015-10-14",Price:199.29},
            {symbol:"SPY",date:"2015-10-15",Price:202.35},
            {symbol:"SPY",date:"2015-10-16",Price:203.27},
            {symbol:"SPY",date:"2015-10-19",Price:203.37},
            {symbol:"SPY",date:"2015-10-20",Price:203.11},
            {symbol:"SPY",date:"2015-10-21",Price:201.85},
            {symbol:"XIC",date:"2015-10-22",Price:22.01},
            {symbol:"XIC",date:"2015-10-23",Price:22.12},
            {symbol:"XIC",date:"2015-10-26",Price:21.87},
            {symbol:"XIC",date:"2015-10-27",Price:21.71},
            {symbol:"XIC",date:"2015-10-28",Price:21.98},
            {symbol:"XIC",date:"2015-10-29",Price:21.88},
            {symbol:"XIC",date:"2015-10-30",Price:21.46}
        ]);
    });
    it("external instrument using same time of day", function() {
        return collect({
          portfolio: 'SPY.ARCA,XIC.TSX',
          begin: "2015-10-01",
          end: "2015-11-01",
          columns: [
              'symbol',
              'DATE(ending) AS "date"',
              'day.close AS "Price"'
          ].join(','),
          retain: 'exchange=IF(USD.CAD(TOD(CVAR(5,60,m60.close)))<0.01,"ARCA","TSX")'
        }).should.eventually.be.like([
            {symbol:"XIC",date:"2015-10-01",Price:20.95},
            {symbol:"XIC",date:"2015-10-02",Price:21.13},
            {symbol:"XIC",date:"2015-10-05",Price:21.48},
            {symbol:"SPY",date:"2015-10-06",Price:197.79},
            {symbol:"SPY",date:"2015-10-07",Price:199.41},
            {symbol:"SPY",date:"2015-10-08",Price:201.21},
            {symbol:"SPY",date:"2015-10-09",Price:201.33},
            {symbol:"SPY",date:"2015-10-12",Price:201.52},
            {symbol:"SPY",date:"2015-10-13",Price:200.25},
            {symbol:"SPY",date:"2015-10-14",Price:199.29},
            {symbol:"SPY",date:"2015-10-15",Price:202.35},
            {symbol:"SPY",date:"2015-10-16",Price:203.27},
            {symbol:"SPY",date:"2015-10-19",Price:203.37},
            {symbol:"SPY",date:"2015-10-20",Price:203.11},
            {symbol:"XIC",date:"2015-10-21",Price:21.72},
            {symbol:"XIC",date:"2015-10-22",Price:22.01},
            {symbol:"XIC",date:"2015-10-23",Price:22.12},
            {symbol:"XIC",date:"2015-10-26",Price:21.87},
            {symbol:"XIC",date:"2015-10-27",Price:21.71},
            {symbol:"XIC",date:"2015-10-28",Price:21.98},
            {symbol:"XIC",date:"2015-10-29",Price:21.88},
            {symbol:"XIC",date:"2015-10-30",Price:21.46}
        ]);
    });
});

