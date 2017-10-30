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
        ptrading.config('config', path.resolve(__dirname, 'etc/ptrading.json'));
        ptrading.config('prefix', createTempDir('ptrading'));
        ptrading.config(['iqfeed','enabled'], false);
        ptrading.config(['google','enabled'], true);
        ptrading.config(['yahoo','enabled'], false);
        ptrading.config(['files','enabled'], true);
        ptrading.config(['files','dirname'], path.resolve(__dirname, 'var'));
    });
    after(function() {
        ptrading.config.unset('prefix');
        ptrading.config.unset(['iqfeed','enabled']);
        ptrading.config.unset(['google','enabled']);
        ptrading.config.unset(['yahoo','enabled']);
        ptrading.config.unset(['files','enabled']);
        ptrading.config.unset(['files','dirname']);
    });
    it("lookup", function() {
        return ptrading.lookup({symbol: 'AABA'}).then(suggestions => {
          suggestions.forEach(suggestion => {
            suggestion.symbol.should.eql('AABA');
            suggestion.exchange.should.eql('NASDAQ');
          });
        });
    });
    it("fundamental", function() {
        return ptrading.fundamental({
          symbol: 'AABA',
          exchange: 'NASDAQ'
        }).should.eventually.be.like({
            name: 'Altaba Inc.',
            EarningsShare: _.isFinite
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
});




