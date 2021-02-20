// adjustments.spec.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
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
const Big = require('big.js');
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const Adjustments = require('../src/adjustments-yahoo.js');
const createTempDir = require('./create-temp-dir.js');

describe("adjustments", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var adjustments = new Adjustments({cache_dir: createTempDir('adjustments.spec')});
    after(function() {
        return adjustments.close();
    });
    it("list dividends and adjustments", function() {
        return adjustments({
            symbol: 'SPY',
            market: 'NYSE',
            begin: '2017-01-01',
            tz: tz
        }).then(adjustments => {
            var end = '2018-01-01';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:'2017-03-17',dividend:1.03,adj:0.9809},
            {exdate:'2017-06-16',dividend:1.18,adj:0.9852},
            {exdate:'2017-09-15',dividend:1.23,adj:0.9900},
            {exdate:'2017-12-15',dividend:1.35,adj:0.9949}
        ]);
    });
    it.skip("should handle ignore peudo split entry", function() {
        return adjustments({
            symbol: 'XLF',
            market: 'NYSE',
            begin: '2016-01-01',
            tz: tz
        }).then(adjustments => {
            var end = '2016-12-31';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:'2016-03-18',adj:0.79},
            {exdate:'2016-06-17',adj:0.80},
            {exdate:'2016-09-16',dividend:0.11,adj:0.8},
            {exdate:'2016-09-19',dividend:4.4,adj:0.8090},
            {exdate:'2016-12-16',dividend:0.11,adj:0.995}
        ]);
    });
    it("should adjust splits and dividends for AAPL", function() {
        return adjustments({
            symbol: 'AAPL',
            market: 'NASDAQ',
            begin: '2014-01-01',
            tz: tz
        }).then(adjustments => {
            var end = '2014-12-31';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: +Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:'2014-02-06',dividend:3.05,cum_close:512.59,adj:0.1399},
            {exdate:'2014-05-08',dividend:3.29,cum_close:592.33,adj:0.1408},
            {exdate:'2014-06-09',split:7/1,    cum_close:645.57,adj:0.1415},
            {exdate:'2014-08-07',dividend:0.47,cum_close: 94.96,adj:0.9908},
            {exdate:'2014-11-06',dividend:0.47,cum_close:108.86,adj:0.9957}
        ]);
    });
    it("should adjust splits and dividends for BERK", function() {
        return adjustments({
            symbol: 'BERK',
            market: 'NASDAQ',
            begin: '2004-01-01',
            tz: tz
        }).then(adjustments => {
            var end = '2004-12-31';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:'2004-04-15',dividend:0.15,cum_close:55.00,adj:0.3313},
            {exdate:'2004-05-19',split:3/1,    cum_close:54.99,adj:0.3323},
            {exdate:'2004-10-20',dividend:0.06,cum_close:18.49,adj:0.9968}
        ]);
    });
    it("should adjust for REM reverse split", function() {
        return adjustments({
            symbol: 'REM',
            market: 'NYSE',
            begin: '2016-01-01',
            tz: tz
        }).then(adjustments => {
            var end = '2016-12-31';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:'2016-03-23',dividend:0.27,cum_close:9.84,adj:3.61},
            {exdate:'2016-06-21',dividend:0.27,cum_close:10.34,adj:3.71},
            {exdate:'2016-09-26',dividend:0.29,cum_close:10.83,adj:3.81},
            {exdate:'2016-11-07',split:1/4,    cum_close:10.43,adj:3.9204},
            {exdate:'2016-12-21',dividend:0.85,cum_close:42.94,adj:0.9800}
        ]);
    });
    it("should ignore NOV 2-to-1 split (it was actually 9079/10000)", function() {
        return adjustments({
            symbol: 'NOV',
            market: 'NYSE',
            begin: '2007-09-01',
            tz: tz
        }).then(adjustments => {
            var end = '2008-01-01';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx] && adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([{
            exdate: '2007-10-01',
            adj: 1/2,
            adj_dividend_only: 1,
            adj_split_only: 1/2,
            cum_close: Math.round(65.15*2*1109/1000 *100)/100,
            split: 2,
            dividend: 0
        }]);
    });
    it("should adjust for Citigroup reverse split", function() {
        return adjustments({
            symbol: 'C',
            market: 'NASDAQ',
            begin: '2011-01-01',
            tz: tz
        }).then(adjustments => {
            var end = '2011-12-31';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:'2011-05-09',split:1/10,   cum_close:4.52,adj:9.99},
            {exdate:'2011-05-25',dividend:0.01,cum_close:40.51,adj:0.9992},
            {exdate:'2011-07-28',dividend:0.01,cum_close:38.27,adj:0.9995},
            {exdate:'2011-11-03',dividend:0.01,cum_close:29.83,adj:0.999}
        ]);
    });
    it("should be empty for unsupported markets", function() {
        return adjustments({
            symbol: 'ABC',
            market: 'DNE',
            begin: '2011-01-01',
            end: '2011-12-31',
            tz: tz
        }).should.eventually.be.like([]);
    });
    it("should adjust first dividend", function() {
        return adjustments({
            symbol: 'SPY',
            market: 'NYSE',
            begin: '2017-03-15',
            tz: tz
        }).then(adjustments => {
            var end = '2017-03-21';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([{
            exdate: '2017-03-17',
            adj: 0.995668,
            adj_dividend_only: 0.995668,
            adj_split_only: 1,
            cum_close: 238.479996,
            split: 1,
            dividend: 1.033
        }]);
    });
    it("should ignore TRI 1/0 split (it was actually 9079/10000)", function() {
        return adjustments({
            symbol: 'TRI',
            market: 'TSE',
            begin: '2018-11-01',
            tz: tz
        }).then(adjustments => {
            var end = '2018-12-31';
            var idx = _.sortedIndex(adjustments, {exdate: end}, 'exdate');
            var after = adjustments[idx] && adjustments[idx].exdate == end ? adjustments[idx+1] : adjustments[idx];
            return adjustments
              .filter(datum => datum.exdate <= end)
              .map(datum => _.mapObject({...datum,
                adj: Big(datum.adj).div(after.adj),
                adj_dividend_only: Big(datum.adj_dividend_only).div(after.adj_dividend_only),
                adj_split_only: Big(datum.adj_split_only).div(after.adj_split_only)
              }, num => _.isFinite(num) ? +num : num));
        }).should.eventually.be.like([
            {exdate:"2018-11-14",split:1},
            {exdate:"2018-11-27",split:1}
        ]);
    });
});
