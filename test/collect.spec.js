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
    var closeTo = expected => actual => actual.should.be.closeTo(expected,0.0001);
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
            {symbol:'IBM',date:"2016-12-29",close:166.6,change:closeTo(0.2467)},
            {symbol:'YHOO',date:"2016-12-30",close:38.67,change:closeTo(0.0776)},
            {symbol:'IBM',date:"2017-01-03",close:167.19,change:closeTo(0.7229)},
            {symbol:'IBM',date:"2017-01-04",close:169.26,change:closeTo(1.2381)},
            {symbol:'YHOO',date:"2017-01-05",close:41.34,change:closeTo(3.1952)},
            {symbol:'IBM',date:"2017-01-06",close:169.53,change:closeTo(0.4919)},
            {symbol:'YHOO',date:"2017-01-09",close:41.34,change:closeTo(0.2667)},
            {symbol:'YHOO',date:"2017-01-10",close:42.3,change:closeTo(2.3222)},
            {symbol:'IBM',date:"2017-01-11",close:167.75,change:closeTo(1.3472)},
            {symbol:'IBM',date:"2017-01-12",close:167.95,change:closeTo(0.1192)},
            {symbol:'YHOO',date:"2017-01-13",close:42.27,change:closeTo(0.3799)}
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
            {symbol:"XLF",date:"2016-12-01",Price:22.9,Weight:closeTo(9.9549)},
            {symbol:"XLE",date:"2016-12-01",Price:74.61,Weight:closeTo(12.7971)},
            {symbol:"XLK",date:"2016-12-01",Price:46.52,Weight:closeTo(27.8882)},
            {symbol:"XLY",date:"2016-12-01",Price:81.89,Weight:closeTo(27.4883)}
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
            {symbol:"XLF",date:"2016-11-14",Price:22.20,Weight:closeTo(10.0710)},
            {symbol:"XLI",date:"2016-11-14",Price:61.31,Weight:closeTo(21.6351)},
            {symbol:"XLE",date:"2016-11-14",Price:69.85,Weight:closeTo(17.6174)},
            {symbol:"XLK",date:"2016-11-14",Price:46.02,Weight:closeTo(27.8882)},
            {symbol:"XLF",date:"2016-11-15",Price:22.18,Weight:closeTo(10.0792)},
            {symbol:"XLE",date:"2016-11-15",Price:71.82,Weight:closeTo(16.3964)},
            {symbol:"XLK",date:"2016-11-15",Price:46.67,Weight:closeTo(29.5361)},
            {symbol:"XLY",date:"2016-11-15",Price:80.04,Weight:closeTo(27.4883)},
            {symbol:"XLI",date:"2016-11-16",Price:61.19,Weight:closeTo(21.6351)},
            {symbol:"XLK",date:"2016-11-16",Price:47.10,Weight:closeTo(29.5361)},
            {symbol:"XLE",date:"2016-11-16",Price:71.32,Weight:closeTo(16.3964)},
            {symbol:"XLY",date:"2016-11-16",Price:80.48,Weight:closeTo(27.4883)},
            {symbol:"XLF",date:"2016-11-17",Price:22.16,Weight:closeTo(10.0535)},
            {symbol:"XLK",date:"2016-11-17",Price:47.40,Weight:closeTo(29.5361)},
            {symbol:"XLE",date:"2016-11-17",Price:70.84,Weight:closeTo(16.3964)},
            {symbol:"XLY",date:"2016-11-17",Price:81.45,Weight:closeTo(27.4883)},
            {symbol:"XLF",date:"2016-11-18",Price:22.16,Weight:closeTo(10.0583)},
            {symbol:"XLK",date:"2016-11-18",Price:47.36,Weight:closeTo(29.5361)},
            {symbol:"XLY",date:"2016-11-18",Price:81.20,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-18",Price:71.13,Weight:closeTo(16.3964)},
            {symbol:"XLF",date:"2016-11-21",Price:22.24,Weight:closeTo(10.0831)},
            {symbol:"XLK",date:"2016-11-21",Price:47.84,Weight:closeTo(29.5361)},
            {symbol:"XLY",date:"2016-11-21",Price:81.73,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-21",Price:72.82,Weight:closeTo(17.4381)},
            {symbol:"XLF",date:"2016-11-22",Price:22.25,Weight:closeTo(10.1231)},
            {symbol:"XLK",date:"2016-11-22",Price:47.99,Weight:closeTo(27.8882)},
            {symbol:"XLY",date:"2016-11-22",Price:82.70,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-22",Price:72.78,Weight:closeTo(17.4381)},
            {symbol:"XLF",date:"2016-11-23",Price:22.38,Weight:closeTo(10.1009)},
            {symbol:"XLK",date:"2016-11-23",Price:47.80,Weight:closeTo(27.8882)},
            {symbol:"XLY",date:"2016-11-23",Price:82.78,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-23",Price:73.08,Weight:closeTo(17.4381)},
            {symbol:"XLF",date:"2016-11-25",Price:22.41,Weight:closeTo(10.0815)},
            {symbol:"XLK",date:"2016-11-25",Price:48.00,Weight:closeTo(27.8882)},
            {symbol:"XLY",date:"2016-11-25",Price:82.98,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-25",Price:72.72,Weight:closeTo(17.4381)},
            {symbol:"XLF",date:"2016-11-28",Price:22.15,Weight:closeTo(10.1329)},
            {symbol:"XLK",date:"2016-11-28",Price:48.04,Weight:closeTo(29.5361)},
            {symbol:"XLY",date:"2016-11-28",Price:82.32,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-28",Price:71.71,Weight:closeTo(17.4381)},
            {symbol:"XLF",date:"2016-11-29",Price:22.21,Weight:closeTo(10.1157)},
            {symbol:"XLK",date:"2016-11-29",Price:48.07,Weight:closeTo(29.5361)},
            {symbol:"XLY",date:"2016-11-29",Price:82.54,Weight:closeTo(27.4883)},
            {symbol:"XLE",date:"2016-11-29",Price:70.83,Weight:closeTo(17.4381)},
            {symbol:"XLF",date:"2016-11-30",Price:22.51,Weight:closeTo(10.0471)},
            {symbol:"XLK",date:"2016-11-30",Price:47.50,Weight:closeTo(29.5361)},
            {symbol:"XLE",date:"2016-11-30",Price:74.43,Weight:closeTo(12.7971)},
            {symbol:"XLV",date:"2016-11-30",Price:68.75,Weight:closeTo(16.9539)},
            {symbol:"XLU",date:"2016-11-30",Price:46.75,Weight:closeTo(24.7222)}
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

