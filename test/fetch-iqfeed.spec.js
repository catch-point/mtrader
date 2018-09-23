// fetch-iqfeed.spec.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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
const iqfeed = require('../src/fetch-iqfeed.js');

describe("fetch-iqfeed", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = iqfeed();
    before(function() {
        return client.open().catch(err => {
            client = null;
            this.skip();
        });
    });
    after(function() {
        if (client) return client.close();
    });
    it("should find AABA", function() {
        return client.lookup({symbol:'AABA'}).should.eventually.be.like(results => _.some(results, like({
            symbol: 'AABA',
            market: 'NASDAQ',
            iqfeed_symbol: 'AABA',
            name: "ALTABA INC"
        })));
    });
    it("should find AABA details", function() {
        return client.fundamental({
            symbol:'AABA',
            market: 'NASDAQ',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([{
            symbol: 'AABA',
            company_name: "ALTABA INC"
        }]);
    });
    it("should find IBM", function() {
        return client.lookup({symbol:'IBM', listed_market:7}).should.eventually.be.like(results => _.some(results, like({
            symbol: 'IBM',
            name: "INTERNATIONAL BUSINESS MACHINE"
        })));
    });
    it("should return daily", function() {
        return client.interday({
            interval: 'day',
            symbol: 'AABA',
            market: 'NASDAQ',
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
    it("should return weekly", function() {
        return client.interday({
            interval: 'week',
            symbol: 'AABA',
            market: 'NASDAQ',
            begin: moment.tz('2014-01-06', tz),
            end: moment.tz('2014-02-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-10T16:00:00-05:00',open:40.05,high:41.72,low:39.75,close:41.23},
            {ending:'2014-01-17T16:00:00-05:00',open:41.16,high:41.31,low:39.47,close:40.01},
            {ending:'2014-01-24T16:00:00-05:00',open:39.98,high:40.40,low:37.62,close:37.91},
            {ending:'2014-01-31T16:00:00-05:00',open:37.60,high:38.32,low:34.45,close:36.01}
        ]);
    });
    it("should return monthly", function() {
        return client.interday({
            interval: 'month',
            symbol: 'AABA',
            market: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz),
            end: moment.tz('2014-02-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2013-10-31T16:00:00-04:00',open:33.36,high:35.06,low:31.70,close:32.94},
            {ending:'2013-11-29T16:00:00-05:00',open:33.15,high:37.35,low:32.06,close:36.98},
            {ending:'2013-12-31T16:00:00-05:00',open:37.04,high:41.05,low:36.25,close:40.44},
            {ending:'2014-01-31T16:00:00-05:00',open:40.37,high:41.72,low:34.45,close:36.01}
        ]);
    });
    it("should return quarter", function() {
        return client.interday({
            interval: 'quarter',
            symbol: 'AABA',
            market: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz),
            end: moment.tz('2013-12-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2013-12-31T16:00:00-05:00',open:33.36,high:41.05,low:31.7,close:40.44}
        ]);
    });
    it("should return year", function() {
        return client.interday({
            interval: 'year',
            symbol: 'AABA',
            market: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz),
            end: moment.tz('2013-12-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2013-12-31T16:00:00-05:00',open:20.2,high:41.05,low:18.89,close:40.44}
        ]);
    });
    it("should find BRK.A symbol", function() {
        return client.lookup({
            symbol: 'BRK.A',
            marketLang: 'en-US'
        }).should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should adjust first dividend", function() {
        return client.interday({
            interval: 'day',
            symbol: 'SPY',
            market: 'ARCA',
            begin: moment.tz('2017-03-15', tz),
            end: moment.tz('2017-03-22', tz),
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
        return client.interday({
            interval: 'day',
            symbol: 'SPY',
            market: 'ARCA',
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
        return client.interday({
            interval: 'day',
            symbol: 'XLF',
            market: 'ARCA',
            begin: moment.tz('2016-09-14', tz),
            end: moment.tz('2016-09-22', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-09-14T16:00:00-04:00',open:23.88,close:23.82,adj_close:19.2},
            {ending:'2016-09-15T16:00:00-04:00',open:23.77,close:23.96,adj_close:19.3},
            {ending:'2016-09-16T16:00:00-04:00',open:23.75,close:23.62,adj_close:19.18},
            {ending:'2016-09-19T16:00:00-04:00',open:19.35,close:19.31,adj_close:19.31},
            {ending:'2016-09-20T16:00:00-04:00',open:19.45,close:19.32,adj_close:19.32},
            {ending:'2016-09-21T16:00:00-04:00',open:19.41,close:19.44,adj_close:19.44}
        ]);
    });
    it("should adjust monthly dividend", function() {
        return client.interday({
            interval: 'month',
            symbol: 'SPY',
            market: 'ARCA',
            begin: moment.tz('2016-01-01', tz),
            end: moment.tz('2016-12-31', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-01-29T16:00:00-05:00',open:200.49,close:193.72,adj_close:189.65},
            {ending:'2016-02-29T16:00:00-05:00',open:192.53,close:193.56,adj_close:189.49},
            {ending:'2016-03-31T16:00:00-04:00',open:195.01-1.00,close:205.52,adj_close:202.23},
            {ending:'2016-04-29T16:00:00-04:00',open:204.35,close:206.33,adj_close:203.03},
            {ending:'2016-05-31T16:00:00-04:00',open:206.92,close:209.84,adj_close:206.49},
            {ending:'2016-06-30T16:00:00-04:00',open:209.12-1.08,close:209.47,adj_close:207.2},
            {ending:'2016-07-29T16:00:00-04:00',open:209.36,close:217.12,adj_close:214.76},
            {ending:'2016-08-31T16:00:00-04:00',open:217.19,close:217.38,adj_close:215.02},
            {ending:'2016-09-30T16:00:00-04:00',open:217.37-1.10,close:216.30,adj_close:215.03},
            {ending:'2016-10-31T16:00:00-04:00',open:215.82,close:212.55,adj_close:211.31},
            {ending:'2016-11-30T16:00:00-05:00',open:212.93,close:220.38,adj_close:219.09},
            {ending:'2016-12-30T16:00:00-05:00',open:220.73-1.29,close:223.53,adj_close:223.53}
        ]);
    });
    it("should adjust splits and dividends", function() {
        return client.interday({
            interval: 'month',
            symbol: 'AAPL',
            market: 'NASDAQ',
            begin: moment.tz('2014-01-01', tz),
            end: moment.tz('2014-09-30', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2014-01-31T16:00:00-05:00',open:555.7,close:500.60,adj_close:70.34},
            {ending:'2014-02-28T16:00:00-05:00',open:502.61-3,close:526.2,adj_close:74.39},
            {ending:'2014-03-31T16:00:00-04:00',open:523.4,close:536.74,adj_close:75.87},
            {ending:'2014-04-30T16:00:00-04:00',open:537.76,close:590.09,adj_close:83.41},
            {ending:'2014-05-30T16:00:00-04:00',open:592.00-3.29,close:633.00,adj_close:89.98},
            {ending:'2014-06-30T16:00:00-04:00',open:Math.round(633.96/7*100)/100,close:92.93,adj_close:92.47},
            {ending:'2014-07-31T16:00:00-04:00',open:93.52,close:95.60,adj_close:95.13},
            {ending:'2014-08-29T16:00:00-04:00',open:94.90-0.47,close:102.50,adj_close:102.5},
            {ending:'2014-09-30T16:00:00-04:00',open:103.06,close:100.75,adj_close:100.75}
        ]);
    });
    it("should adjust splits and dividends on intraday", function() {
        return client.intraday({
            minutes: 30,
            symbol: 'AAPL',
            market: 'NASDAQ',
            begin: '2014-06-06T09:30:00-04:00',
            end: '2014-06-09T16:00:00-04:00',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            { ending: '2014-06-06T09:30:00-04:00', close: 650.21, adj_close: 92.89 },
            { ending: '2014-06-06T10:00:00-04:00', close: 647.86, adj_close: 92.55 },
            { ending: '2014-06-06T10:30:00-04:00', close: 647.9, adj_close: 92.56 },
            { ending: '2014-06-06T11:00:00-04:00', close: 647.43, adj_close: 92.49 },
            { ending: '2014-06-06T11:30:00-04:00', close: 648.12, adj_close: 92.59 },
            { ending: '2014-06-06T12:00:00-04:00', close: 649.69, adj_close: 92.81 },
            { ending: '2014-06-06T12:30:00-04:00', close: 650.491, adj_close: 92.93 },
            { ending: '2014-06-06T13:00:00-04:00', close: 649.73, adj_close: 92.82 },
            { ending: '2014-06-06T13:30:00-04:00', close: 646.46, adj_close: 92.35 },
            { ending: '2014-06-06T14:00:00-04:00', close: 645.7, adj_close: 92.24 },
            { ending: '2014-06-06T14:30:00-04:00', close: 647.98, adj_close: 92.57 },
            { ending: '2014-06-06T15:00:00-04:00', close: 648.41, adj_close: 92.63 },
            { ending: '2014-06-06T15:30:00-04:00', close: 647.8, adj_close: 92.54 },
            { ending: '2014-06-06T16:00:00-04:00', close: 645.57, adj_close: 92.22 },
            { ending: '2014-06-06T16:30:00-04:00', close: 645.21, adj_close: 92.17 },
            { ending: '2014-06-06T17:00:00-04:00', close: 645.79, adj_close: 92.26 },
            { ending: '2014-06-06T17:30:00-04:00', close: 645.84, adj_close: 92.26 },
            { ending: '2014-06-06T18:00:00-04:00', close: 645.86, adj_close: 92.27 },
            { ending: '2014-06-06T18:30:00-04:00', close: 646, adj_close: 92.29 },
            { ending: '2014-06-06T19:00:00-04:00', close: 645.8, adj_close: 92.26 },
            { ending: '2014-06-06T19:30:00-04:00', close: 645.7, adj_close: 92.24 },
            { ending: '2014-06-06T20:00:00-04:00', close: 645.65, adj_close: 92.24 },
            { ending: '2014-06-09T04:30:00-04:00', close: 92.4, adj_close: 92.40 },
            { ending: '2014-06-09T05:00:00-04:00', close: 92.64, adj_close: 92.64 },
            { ending: '2014-06-09T05:30:00-04:00', close: 92.56, adj_close: 92.56 },
            { ending: '2014-06-09T06:00:00-04:00', close: 92.4, adj_close: 92.4 },
            { ending: '2014-06-09T06:30:00-04:00', close: 92.4, adj_close: 92.4 },
            { ending: '2014-06-09T07:00:00-04:00', close: 92.2, adj_close: 92.2 },
            { ending: '2014-06-09T07:30:00-04:00', close: 92.08, adj_close: 92.08 },
            { ending: '2014-06-09T08:00:00-04:00', close: 92.05, adj_close: 92.05 },
            { ending: '2014-06-09T08:30:00-04:00', close: 92.1, adj_close: 92.1 },
            { ending: '2014-06-09T09:00:00-04:00', close: 92.05, adj_close: 92.05 },
            { ending: '2014-06-09T09:30:00-04:00', close: 92.66, adj_close: 92.66 },
            { ending: '2014-06-09T10:00:00-04:00', close: 92.3101, adj_close: 92.3101 },
            { ending: '2014-06-09T10:30:00-04:00', close: 92.34, adj_close: 92.34 },
            { ending: '2014-06-09T11:00:00-04:00', close: 92.62, adj_close: 92.62 },
            { ending: '2014-06-09T11:30:00-04:00', close: 92.85, adj_close: 92.85 },
            { ending: '2014-06-09T12:00:00-04:00', close: 93.01, adj_close: 93.01 },
            { ending: '2014-06-09T12:30:00-04:00', close: 93.32, adj_close: 93.32 },
            { ending: '2014-06-09T13:00:00-04:00', close: 93.695, adj_close: 93.695 },
            { ending: '2014-06-09T13:30:00-04:00', close: 93.4495, adj_close: 93.4495 },
            { ending: '2014-06-09T14:00:00-04:00', close: 93.76, adj_close: 93.76 },
            { ending: '2014-06-09T14:30:00-04:00', close: 93.35, adj_close: 93.35 },
            { ending: '2014-06-09T15:00:00-04:00', close: 93.69, adj_close: 93.69 },
            { ending: '2014-06-09T15:30:00-04:00', close: 93.84, adj_close: 93.84 },
            { ending: '2014-06-09T16:00:00-04:00', close: 93.7, adj_close: 93.7 }
        ]);
    });
    it("should adjust yearly dividends", function() {
        return client.interday({
            interval: 'year',
            symbol: 'SPY',
            market: 'ARCA',
            begin: moment.tz('2010-01-01', tz),
            end: moment.tz('2016-12-31', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2010-12-31T16:00:00-05:00',open:112.37-2.17,close:125.75,adj_close:111.12},
            {ending:'2011-12-30T16:00:00-05:00',open:126.71-2.60,close:125.5,adj_close:113.23},
            {ending:'2012-12-31T16:00:00-05:00',open:127.76-2.78,close:142.41,adj_close:131.32},
            {ending:'2013-12-31T16:00:00-05:00',open:145.11-2.87,close:184.69,adj_close:173.75},
            {ending:'2014-12-31T16:00:00-05:00',open:183.98-3.53,close:205.54,adj_close:197.15},
            {ending:'2015-12-31T16:00:00-05:00',open:206.38-4.18,close:203.87,adj_close:199.58},
            {ending:'2016-12-30T16:00:00-05:00',open:200.49-4.22,close:223.53,adj_close:223.53}
        ]);
    });
    it("should adjust for REM splits", function() {
        return client.interday({
            interval: 'day',
            symbol: 'REM',
            market: 'ARCA',
            begin: '2016-11-01',
            end: '2016-12-01',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-11-01T16:00:00-04:00',close:10.32,adj_close:41.28,split:1,dividend:0},
            {ending:'2016-11-02T16:00:00-04:00',close:10.3,adj_close:41.20,split:1,dividend:0},
            {ending:'2016-11-03T16:00:00-04:00',close:10.35,adj_close:41.40,split:1,dividend:0},
            {ending:'2016-11-04T16:00:00-04:00',close:10.43,adj_close:41.72,split:1,dividend:0},
            {ending:'2016-11-07T16:00:00-05:00',close:42.02,adj_close:42.02,split:0.25,dividend:0},
            {ending:'2016-11-08T16:00:00-05:00',close:42.22,adj_close:42.21,split:1,dividend:0},
            {ending:'2016-11-09T16:00:00-05:00',close:41.95,adj_close:41.95,split:1,dividend:0},
            {ending:'2016-11-10T16:00:00-05:00',close:41.39,adj_close:41.39,split:1,dividend:0},
            {ending:'2016-11-11T16:00:00-05:00',close:41.71,adj_close:41.71,split:1,dividend:0},
            {ending:'2016-11-14T16:00:00-05:00',close:41.43,adj_close:41.43,split:1,dividend:0},
            {ending:'2016-11-15T16:00:00-05:00',close:41.74,adj_close:41.74,split:1,dividend:0},
            {ending:'2016-11-16T16:00:00-05:00',close:41.75,adj_close:41.75,split:1,dividend:0},
            {ending:'2016-11-17T16:00:00-05:00',close:41.85,adj_close:41.85,split:1,dividend:0},
            {ending:'2016-11-18T16:00:00-05:00',close:42.02,adj_close:42.02,split:1,dividend:0},
            {ending:'2016-11-21T16:00:00-05:00',close:42.42,adj_close:42.42,split:1,dividend:0},
            {ending:'2016-11-22T16:00:00-05:00',close:42.79,adj_close:42.79,split:1,dividend:0},
            {ending:'2016-11-23T16:00:00-05:00',close:42.3,adj_close:42.30,split:1,dividend:0},
            {ending:'2016-11-25T16:00:00-05:00',close:42.6,adj_close:42.60,split:1,dividend:0},
            {ending:'2016-11-28T16:00:00-05:00',close:42.82,adj_close:42.82,split:1,dividend:0},
            {ending:'2016-11-29T16:00:00-05:00',close:43.22,adj_close:43.22,split:1,dividend:0},
            {ending:'2016-11-30T16:00:00-05:00',close:42.63,adj_close:42.63,split:1,dividend:0}
        ]);
    });
    it("should find USD/CAD details", function() {
        return client.fundamental({
            symbol:'USDCAD.FXCM', 
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like([{
            symbol: 'USDCAD.FXCM',
            listed_market: "74",
            company_name: /FXCM USD CAD/
        }]);
    });
    it("should return daily FX", function() {
        return client.interday({
            interval: 'day',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2014-02-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680},
            {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312},
            {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543},
            {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658},
            {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169},
            {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429},
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947},
            {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611},
            {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466},
            {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351},
            {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617},
            {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434},
            {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651},
            {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866},
            {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788},
            {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136},
            {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507},
            {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668},
            {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251}
        ]);
    });
    it("should return weekly FX", function() {
        return client.interday({
            interval: 'week',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-05', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.06076,open:1.06313,close:1.08947},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09904,low:1.08416,open:1.08996,close:1.09617},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11729,low:1.09285,open:1.09597,close:1.10788},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10308,open:1.10600,close:1.11251}
        ]));
    });
    it("should return monthly FX", function() {
        return client.interday({
            interval: 'month',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 12).should.be.like([
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.05874,open:1.06321,close:1.11251},
            {ending:'2014-02-28T17:00:00-05:00',high:1.11935,low:1.09092,open:1.11070,close:1.10640},
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.09543,open:1.10708,close:1.10482},
            {ending:'2014-04-30T17:00:00-04:00',high:1.10693,low:1.08570,open:1.10480,close:1.09598},
            {ending:'2014-05-30T17:00:00-04:00',high:1.10055,low:1.08133,open:1.09597,close:1.08397},
            {ending:'2014-06-30T17:00:00-04:00',high:1.09595,low:1.06455,open:1.08358,close:1.06679},
            {ending:'2014-07-31T17:00:00-04:00',high:1.09286,low:1.06195,open:1.06679,close:1.09039},
            {ending:'2014-08-29T17:00:00-04:00',high:1.09967,low:1.08097,open:1.09039,close:1.08731},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.08197,open:1.08710,close:1.11942},
            {ending:'2014-10-31T17:00:00-04:00',high:1.13843,low:1.10704,open:1.11943,close:1.12661},
            {ending:'2014-11-28T17:00:00-05:00',high:1.14655,low:1.11896,open:1.12827,close:1.14119},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.13120,open:1.14272,close:1.16123}
        ]));
    });
    it("should return quarter FX", function() {
        return client.interday({
            interval: 'quarter',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.05874,open:1.06321,close:1.10482},
            {ending:'2014-06-30T17:00:00-04:00',high:1.10693,low:1.06455,open:1.10480,close:1.06679},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.06195,open:1.06679,close:1.11942},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.10704,open:1.11943,close:1.16123}
        ]));
    });
    it("should return year FX", function() {
        return client.interday({
            interval: 'year',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 1).should.be.like([
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.05874,open:1.06321,close:1.16123}
        ]));
    });
    it("should find BRK.A symbol", function() {
        return client.lookup({symbol:'BRK.A', listed_market:7}).should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should return minutes", function() {
        return client.intraday({
            minutes: 1,
            symbol: 'USDCAD.FXCM',
            begin: moment('2014-03-03T10:01:00-0500'),
            end: moment('2014-03-03T10:30:00-0500'),
            tz: tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T10:01:00-05:00',high:1.10981,low:1.10923,open:1.10923,close:1.10981},
            {ending:'2014-03-03T10:02:00-05:00',high:1.10993,low:1.10941,open:1.10981,close:1.10955},
            {ending:'2014-03-03T10:03:00-05:00',high:1.10967,low:1.10950,open:1.10955,close:1.10956},
            {ending:'2014-03-03T10:04:00-05:00',high:1.10956,low:1.10950,open:1.10956,close:1.10953},
            {ending:'2014-03-03T10:05:00-05:00',high:1.10957,low:1.10945,open:1.10952,close:1.10957},
            {ending:'2014-03-03T10:06:00-05:00',high:1.10956,low:1.10951,open:1.10956,close:1.10952},
            {ending:'2014-03-03T10:07:00-05:00',high:1.10951,low:1.10943,open:1.10951,close:1.10943},
            {ending:'2014-03-03T10:08:00-05:00',high:1.10944,low:1.10932,open:1.10944,close:1.10932},
            {ending:'2014-03-03T10:09:00-05:00',high:1.10933,low:1.10876,open:1.10932,close:1.10877},
            {ending:'2014-03-03T10:10:00-05:00',high:1.10905,low:1.10877,open:1.10878,close:1.10905},
            {ending:'2014-03-03T10:11:00-05:00',high:1.10905,low:1.10883,open:1.10905,close:1.10883},
            {ending:'2014-03-03T10:12:00-05:00',high:1.10905,low:1.10881,open:1.10883,close:1.10902},
            {ending:'2014-03-03T10:13:00-05:00',high:1.10925,low:1.10894,open:1.10905,close:1.10894},
            {ending:'2014-03-03T10:14:00-05:00',high:1.10905,low:1.10879,open:1.10897,close:1.10879},
            {ending:'2014-03-03T10:15:00-05:00',high:1.10907,low:1.10879,open:1.10879,close:1.10890},
            {ending:'2014-03-03T10:16:00-05:00',high:1.10909,low:1.10891,open:1.10891,close:1.10901},
            {ending:'2014-03-03T10:17:00-05:00',high:1.10915,low:1.10899,open:1.10904,close:1.10909},
            {ending:'2014-03-03T10:18:00-05:00',high:1.10944,low:1.10909,open:1.10910,close:1.10939},
            {ending:'2014-03-03T10:19:00-05:00',high:1.10939,low:1.10903,open:1.10939,close:1.10905},
            {ending:'2014-03-03T10:20:00-05:00',high:1.10905,low:1.10879,open:1.10905,close:1.10880},
            {ending:'2014-03-03T10:21:00-05:00',high:1.10889,low:1.10875,open:1.10880,close:1.10889},
            {ending:'2014-03-03T10:22:00-05:00',high:1.10903,low:1.10889,open:1.10889,close:1.10901},
            {ending:'2014-03-03T10:23:00-05:00',high:1.10905,low:1.10845,open:1.10902,close:1.10847},
            {ending:'2014-03-03T10:24:00-05:00',high:1.10865,low:1.10837,open:1.10848,close:1.10844},
            {ending:'2014-03-03T10:25:00-05:00',high:1.10855,low:1.10799,open:1.10848,close:1.10826},
            {ending:'2014-03-03T10:26:00-05:00',high:1.10844,low:1.10808,open:1.10826,close:1.10808},
            {ending:'2014-03-03T10:27:00-05:00',high:1.10847,low:1.10800,open:1.10809,close:1.10843},
            {ending:'2014-03-03T10:28:00-05:00',high:1.10859,low:1.10843,open:1.10843,close:1.10857},
            {ending:'2014-03-03T10:29:00-05:00',high:1.10860,low:1.10815,open:1.10859,close:1.10815},
            {ending:'2014-03-03T10:30:00-05:00',high:1.10825,low:1.10805,open:1.10819,close:1.10819}
        ]);
    });
    it("should return 10 minute intervals", function() {
        return client.intraday({
            minutes: 10,
            symbol: 'USDCAD.FXCM',
            begin: moment('2014-03-03T10:10:00-0500'),
            end: moment('2014-03-03T11:00:00-0500'),
            tz: tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T10:10:00-05:00',high:1.10993,low:1.10876,open:1.10923,close:1.10905},
            {ending:'2014-03-03T10:20:00-05:00',high:1.10944,low:1.10879,open:1.10905,close:1.10880},
            {ending:'2014-03-03T10:30:00-05:00',high:1.10905,low:1.10799,open:1.10880,close:1.10819},
            {ending:'2014-03-03T10:40:00-05:00',high:1.10824,low:1.10718,open:1.10819,close:1.10755},
            {ending:'2014-03-03T10:50:00-05:00',high:1.10814,low:1.10755,open:1.10755,close:1.10794},
            {ending:'2014-03-03T11:00:00-05:00',high:1.10798,low:1.10694,open:1.10793,close:1.10789}
        ]);
    });
    it("should estimate daily", function() {
        return client.rollday({
            minutes: 30,
            interval: 'day',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz), end: moment.tz('2014-02-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680},
            {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312},
            {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543},
            {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658},
            {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169},
            {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429},
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947},
            {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611},
            {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466},
            {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351},
            {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617},
            {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434},
            {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651},
            {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866},
            {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788},
            {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136},
            {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507},
            {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668},
            {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251}
        ]);
    });
    it("should estimate weekly", function() {
        return client.rollday({
            minutes: 30,
            interval: 'week',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-05', end: '2014-02-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.06076,open:1.06313,close:1.08947},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09904,low:1.08416,open:1.08996,close:1.09617},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11729,low:1.09285,open:1.09597,close:1.10788},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10308,open:1.10600,close:1.11251}
        ]));
    });
    it("should estimate monthly", function() {
        return client.rollday({
            minutes: 30,
            interval: 'month',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2015-01-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 12).should.be.like([
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.05874,open:1.06321,close:1.11251},
            {ending:'2014-02-28T17:00:00-05:00',high:1.11935,low:1.09092,open:1.11070,close:1.10640},
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.09543,open:1.10708,close:1.10482},
            {ending:'2014-04-30T17:00:00-04:00',high:1.10693,low:1.08570,open:1.10480,close:1.09598},
            {ending:'2014-05-30T17:00:00-04:00',high:1.10055,low:1.08133,open:1.09597,close:1.08397},
            {ending:'2014-06-30T17:00:00-04:00',high:1.09595,low:1.06455,open:1.08358,close:1.06679},
            {ending:'2014-07-31T17:00:00-04:00',high:1.09286,low:1.06195,open:1.06679,close:1.09039},
            {ending:'2014-08-29T17:00:00-04:00',high:1.09967,low:1.08097,open:1.09039,close:1.08731},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.08197,open:1.08710,close:1.11942},
            {ending:'2014-10-31T17:00:00-04:00',high:1.13843,low:1.10704,open:1.11943,close:1.12661},
            {ending:'2014-11-28T17:00:00-05:00',high:1.14655,low:1.11896,open:1.12827,close:1.14119},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.13120,open:1.14272,close:1.16123}
        ]));
    });
    it("should estimate quarter", function() {
        return client.rollday({
            minutes: 30,
            interval: 'quarter',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2015-01-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.05874,open:1.06321,close:1.10482},
            {ending:'2014-06-30T17:00:00-04:00',high:1.10693,low:1.06455,open:1.10480,close:1.06679},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.06195,open:1.06679,close:1.11942},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.10704,open:1.11943,close:1.16123}
        ]));
    });
    it("should estimate year", function() {
        return client.rollday({
            minutes: 30,
            interval: 'year',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2015-01-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 1).should.be.like([
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.05874,open:1.06321,close:1.16123}
        ]));
    });
});
