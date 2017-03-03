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

const _ = require('underscore');
const ptrading = require('../src/ptrading.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("ptrading", function() {
    this.timeout(60000);
    ptrading.config('prefix', createTempDir('ptrading'));
    it("lookup", function() {
        return ptrading.lookup({symbol: 'YHOO'}).then(suggestions => {
          suggestions.forEach(suggestion => {
            suggestion.symbol.should.eql('YHOO');
            suggestion.exchange.should.eql('NASDAQ');
          });
        });
    });
    it("fundamental", function() {
        return ptrading.fundamental({
          symbol: 'YHOO',
          exchange: 'NASDAQ'
        }).should.eventually.be.like({
            name: 'Yahoo! Inc.',
            EarningsShare: _.isFinite
        });
    });
    it("fetch", function() {
        return ptrading.fetch({
          interval: 'day',
          symbol: 'YHOO',
          exchange: 'NASDAQ'
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
          symbol: 'YHOO',
          exchange: 'NASDAQ',
          begin: "2017-01-13",
          pad_begin: 9,
          end: "2017-01-14",
          columns: [
              'DATE(ending) AS "Date"',
              'day.close AS "Close"',
              '(day.adj_close - OFFSET(1, day.adj_close))*100/OFFSET(1,day.adj_close) AS "Change"'
          ].join(','),
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
    it("collect profit", function() {
        return ptrading.collect({
          portfolio: 'YHOO.NASDAQ,IBM.NYSE',
          begin: "2017-01-09",
          end: "2017-01-14",
          precedence: 'PF(120,day.adj_close)',
          columns: [
              'symbol',
              'DATE(ending) AS date',
              'IF(COUNT(symbol)<=1,FLOOR(10000/(day.close)),0) AS target',
              'IF(ABS(target-PREV("position",0))<10,0,target-PREV("position",0)) AS shares',
              'PREV("position",0) + shares AS position',
              'day.close + 0.02 * IF(shares>0,1,-1) AS price', // includes slippage
              '-shares * price AS proceeds',
              'IF(shares=0,0, MAX(shares * 0.005, 1.00)) AS commission',
              'IF(position=0,PREV("basis",price),(PREV("basis")*PREV("position")+price*shares)/position) AS basis',
              'PREV("profit",0) + (price - PREV("price",0)) * PREV("position",0) - commission AS profit'
          ].join(','),
          retain: 'position OR shares'
        }).should.eventually.be.like([
            {symbol:"YHOO",date:"2017-01-09",target:241,shares:241,position:241,price:41.36,
                proceeds:-9967.76,commission:1.20,basis:41.36,profit:-1.20},
            {symbol:"IBM",date:"2017-01-10",target:60,shares:60,position:60,price:165.54,
                proceeds:-9932.40,commission:1,basis:165.54,profit:-1},
            {symbol:"YHOO",date:"2017-01-10",target:0,shares:-241,position:0,price:42.27,
                proceeds:10189.47,commission:1,basis:41.36,profit:219.51},
            {symbol:"YHOO",date:"2017-01-11",target:234,shares:234,position:234,price:42.61,
                proceeds:-9970.74,commission:1.17,basis:42.61,profit:218.34},
            {symbol:"IBM",date:"2017-01-11",target:0,shares:-60,position:0,price:167.73,
                proceeds:10063.8,commission:1,basis:165.54,profit:129.39},
            {symbol:"YHOO",date:"2017-01-12",target:237,shares:0,position:234,price:42.08,
                proceeds:0,commission:0,basis:42.61,profit:96.66},
            {symbol:"IBM",date:"2017-01-13",target:59,shares:59,position:59,price:167.36,
                proceeds:-9874.24,commission:1,basis:167.36,profit:-1},
            {symbol:"YHOO",date:"2017-01-13",target:0,shares:-234,position:0,price:42.25,
                proceeds:9886.5,commission:1,basis:42.61,profit:133.10}
        ]);
    });
});




