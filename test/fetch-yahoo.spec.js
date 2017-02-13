// fetch-yahoo.spec.js
/*
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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
    it("should find YHOO", function() {
        return client.lookup({symbol:'YHOO'}).should.eventually.be.like(results => _.some(results, like({
            symbol: 'YHOO',
            exchange: 'NASDAQ',
            yahoo_symbol: 'YHOO',
            exch: Boolean,
            name: "Yahoo! Inc."
        })));
    });
    it("should find YHOO details", function() {
        return client.fundamental({
            symbol:'YHOO',
            yahoo_symbol:'YHOO',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([{
            symbol: 'YHOO',
            name: "Yahoo! Inc."
        }]);
    });
    it("should find IBM", function() {
        return client.lookup({
            symbol:'IBM',
            marketLang:'en-US',
            exch:'NYQ'
        }).then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            name: "International Business Machines Corporation"
        });
    });
    it("should find IBM details", function() {
        return client.fundamental({
            symbol:'IBM',
            yahoo_symbol:'IBM',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([{
            symbol: 'IBM',
            name: "International Business Machines"
        }]);
    });
    it("should return daily", function() {
        return client.interday({
            interval: 'day',
            symbol: 'YHOO',
            yahoo_symbol: 'YHOO',
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
            symbol: 'YHOO',
            yahoo_symbol: 'YHOO',
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
            symbol: 'YHOO',
            yahoo_symbol: 'YHOO',
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
            symbol: 'YHOO',
            yahoo_symbol: 'YHOO',
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
            symbol: 'YHOO',
            yahoo_symbol: 'YHOO',
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
});
