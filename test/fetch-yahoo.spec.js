// fetch-yahoo.spec.js
/*
 *  Copyright (c) 2016-2019 James Leigh, Some Rights Reserved
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
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const yahoo = require('../src/fetch-yahoo.js');

describe("fetch-yahoo", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = yahoo();
    after(function() {
        return client.close();
    });
    it("should find AABA", function() {
        return client({interval:'lookup', symbol:'AABA'})
          .should.eventually.be.like(results => _.some(results, like({
            symbol: 'AABA',
            market: 'NASDAQ',
            yahoo_symbol: 'AABA',
            name: "Altaba Inc."
        })));
    });
    it("should find IBM", function() {
        return client({
            interval:'lookup',
            symbol:'IBM',
            marketLang:'en-US',
            exch:'NYQ'
        }).then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            name: "International Business Machines Corporation"
        });
    });
    it("should return daily", function() {
        return client({
            interval: 'day',
            symbol: 'AABA',
            yahoo_symbol: 'AABA',
            begin: moment.tz('2014-01-01', tz),
            end: moment.tz('2014-02-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T16:00:00-05:00',open:40.37,high:40.49,low:39.31,close:39.59},
            {ending:'2014-01-03T16:00:00-05:00',open:40.16,high:40.44,low:39.82,close:40.12},
            {ending:'2014-01-06T16:00:00-05:00',open:40.05,high:40.32,low:39.75,close:39.93},
            {ending:'2014-01-07T16:00:00-05:00',open:40.08,high:41.20,low:40.08,close:40.92},
            {ending:'2014-01-08T16:00:00-05:00',open:41.29,high:41.72,low:41.02,close:41.02},
            {ending:'2014-01-09T16:00:00-05:00',open:41.33,high:41.35,low:40.61,close:40.92},
            {ending:'2014-01-10T16:00:00-05:00',open:40.95,high:41.35,low:40.82,close:41.23},
            {ending:'2014-01-13T16:00:00-05:00',open:41.16,high:41.22,low:39.80,close:39.99},
            {ending:'2014-01-14T16:00:00-05:00',open:40.21,high:41.14,low:40.04,close:41.14},
            {ending:'2014-01-15T16:00:00-05:00',open:41.06,high:41.31,low:40.76,close:41.07},
            {ending:'2014-01-16T16:00:00-05:00',open:40.43,high:40.75,low:40.11,close:40.34},
            {ending:'2014-01-17T16:00:00-05:00',open:40.12,high:40.44,low:39.47,close:40.01},
            {ending:'2014-01-21T16:00:00-05:00',open:39.98,high:40.05,low:38.86,close:39.52},
            {ending:'2014-01-22T16:00:00-05:00',open:39.66,high:40.40,low:39.32,close:40.18},
            {ending:'2014-01-23T16:00:00-05:00',open:39.31,high:39.77,low:39.14,close:39.39},
            {ending:'2014-01-24T16:00:00-05:00',open:38.67,high:38.98,low:37.62,close:37.91},
            {ending:'2014-01-27T16:00:00-05:00',open:37.60,high:37.94,low:36.62,close:36.65},
            {ending:'2014-01-28T16:00:00-05:00',open:36.83,high:38.32,low:36.52,close:38.22},
            {ending:'2014-01-29T16:00:00-05:00',open:35.77,high:36.31,low:34.82,close:34.89},
            {ending:'2014-01-30T16:00:00-05:00',open:34.89,high:35.81,low:34.45,close:35.31},
            {ending:'2014-01-31T16:00:00-05:00',open:34.69,high:36.33,low:34.55,close:36.01}
        ]);
    });
    it("should find BRK.A symbol", function() {
        return client({
            interval:'lookup',
            symbol: 'BRK.A',
            marketLang: 'en-US'
        }).should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should adjust first dividend", function() {
        return client({
            interval: 'day',
            symbol: 'SPY',
            yahoo_symbol: 'SPY',
            begin: moment.tz('2017-03-15', tz),
            end: moment.tz('2017-03-21', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.defaults({adj_close: datum.adj_close * scale}, datum));
        }).should.eventually.be.like([
            {ending:'2017-03-15T16:00:00-04:00',open:237.56,close:238.95,adj_close:237.91},
            {ending:'2017-03-16T16:00:00-04:00',open:239.11,close:238.48,adj_close:237.45},
            {ending:'2017-03-17T16:00:00-04:00',open:237.75,close:237.03,adj_close:237.03},
            {ending:'2017-03-20T16:00:00-04:00',open:237.03,close:236.77,adj_close:236.77},
            {ending:'2017-03-21T16:00:00-04:00',open:237.47,close:233.73,adj_close:233.73}
        ]);
    });
    it("should adjust second dividend", function() {
        return client({
            interval: 'day',
            symbol: 'SPY',
            yahoo_symbol: 'SPY',
            begin: moment.tz('2016-12-01', tz),
            end: moment.tz('2016-12-31', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.defaults({adj_close: datum.adj_close * scale}, datum));
        }).should.eventually.be.like([
            {ending:'2016-12-01T16:00:00-05:00',open:220.73,close:219.57,adj_close:218.29},
            {ending:'2016-12-02T16:00:00-05:00',open:219.67,close:219.68,adj_close:218.40},
            {ending:'2016-12-05T16:00:00-05:00',open:220.65,close:221.00,adj_close:219.70},
            {ending:'2016-12-06T16:00:00-05:00',open:221.22,close:221.70,adj_close:220.41},
            {ending:'2016-12-07T16:00:00-05:00',open:221.52,close:224.60,adj_close:223.29},
            {ending:'2016-12-08T16:00:00-05:00',open:224.57,close:225.15,adj_close:223.83},
            {ending:'2016-12-09T16:00:00-05:00',open:225.41,close:226.51,adj_close:225.19},
            {ending:'2016-12-12T16:00:00-05:00',open:226.40,close:226.25,adj_close:224.93},
            {ending:'2016-12-13T16:00:00-05:00',open:227.02,close:227.76,adj_close:226.42},
            {ending:'2016-12-14T16:00:00-05:00',open:227.41,close:225.88,adj_close:224.55},
            {ending:'2016-12-15T16:00:00-05:00',open:226.16,close:226.81,adj_close:225.48},
            {ending:'2016-12-16T16:00:00-05:00',open:226.01,close:225.04,adj_close:225.04},
            {ending:'2016-12-19T16:00:00-05:00',open:225.25,close:225.53,adj_close:225.53},
            {ending:'2016-12-20T16:00:00-05:00',open:226.15,close:226.40,adj_close:226.40},
            {ending:'2016-12-21T16:00:00-05:00',open:226.25,close:225.77,adj_close:225.77},
            {ending:'2016-12-22T16:00:00-05:00',open:225.60,close:225.38,adj_close:225.38},
            {ending:'2016-12-23T16:00:00-05:00',open:225.43,close:225.71,adj_close:225.71},
            {ending:'2016-12-27T16:00:00-05:00',open:226.02,close:226.27,adj_close:226.27},
            {ending:'2016-12-28T16:00:00-05:00',open:226.57,close:224.40,adj_close:224.40},
            {ending:'2016-12-29T16:00:00-05:00',open:224.48,close:224.35,adj_close:224.35},
            {ending:'2016-12-30T16:00:00-05:00',open:224.73,close:223.53,adj_close:223.53}
        ]);
    });
    it("should handle ignore peudo split entry", function() {
        return client({
            interval: 'day',
            symbol: 'XLF',
            yahoo_symbol: 'XLF',
            begin: moment.tz('2016-09-14', tz),
            end: moment.tz('2016-09-21', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-09-14T16:00:00-04:00',open:23.88,close:23.82,adj_close:19.2},
            {ending:'2016-09-15T16:00:00-04:00',open:23.77,close:23.96,adj_close:19.3},
            {ending:'2016-09-16T16:00:00-04:00',open:23.75,close:23.62,adj_close:19.18},
            {ending:'2016-09-19T16:00:00-04:00',open:19.18,close:19.31,adj_close:19.31},
            {ending:'2016-09-20T16:00:00-04:00',open:19.45,close:19.32,adj_close:19.32},
            {ending:'2016-09-21T16:00:00-04:00',open:19.41,close:19.44,adj_close:19.44}
        ]);
    });
    it("should adjust for REM splits", function() {
        return client({
            interval: 'day',
            symbol: 'REM',
            market: 'BATS',
            begin: '2016-11-01',
            end: '2016-11-30',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-11-01T16:00:00-04:00',close:10.32,adj_close:41.28},
            {ending:'2016-11-02T16:00:00-04:00',close:10.30,adj_close:41.20},
            {ending:'2016-11-03T16:00:00-04:00',close:10.35,adj_close:41.40},
            {ending:'2016-11-04T16:00:00-04:00',close:10.43,adj_close:41.72},
            {ending:'2016-11-07T16:00:00-05:00',close:42.02,adj_close:42.02},
            {ending:'2016-11-08T16:00:00-05:00',close:42.22,adj_close:42.22},
            {ending:'2016-11-09T16:00:00-05:00',close:41.95,adj_close:41.95},
            {ending:'2016-11-10T16:00:00-05:00',close:41.39,adj_close:41.39},
            {ending:'2016-11-11T16:00:00-05:00',close:41.71,adj_close:41.71},
            {ending:'2016-11-14T16:00:00-05:00',close:41.43,adj_close:41.43},
            {ending:'2016-11-15T16:00:00-05:00',close:41.74,adj_close:41.74},
            {ending:'2016-11-16T16:00:00-05:00',close:41.75,adj_close:41.75},
            {ending:'2016-11-17T16:00:00-05:00',close:41.85,adj_close:41.85},
            {ending:'2016-11-18T16:00:00-05:00',close:42.02,adj_close:42.02},
            {ending:'2016-11-21T16:00:00-05:00',close:42.42,adj_close:42.42},
            {ending:'2016-11-22T16:00:00-05:00',close:42.79,adj_close:42.79},
            {ending:'2016-11-23T16:00:00-05:00',close:42.3,adj_close:42.30},
            {ending:'2016-11-25T16:00:00-05:00',close:42.6,adj_close:42.60},
            {ending:'2016-11-28T16:00:00-05:00',close:42.82,adj_close:42.82},
            {ending:'2016-11-29T16:00:00-05:00',close:43.22,adj_close:43.22},
            {ending:'2016-11-30T16:00:00-05:00',close:42.63,adj_close:42.63}
        ]);
    });
});
