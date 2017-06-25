// yahoo-client.spec.js
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
const yahooClient = require('../src/yahoo-client.js');

describe("yahoo-client", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = yahooClient();
    after(function() {
        return client.close();
    });
    it("should find AABA", function() {
        return client.lookup('AABA', 'en-US').should.eventually.be.like(results => _.some(results, like({
            symbol: 'AABA',
            exch: Boolean,
            name: "Altaba Inc."
        })));
    });
    it("should find AABA details", function() {
        return client.fundamental('AABA').should.eventually.be.like({
            symbol: 'AABA',
            name: "Altaba Inc."
        });
    });
    it("should find IBM", function() {
        return client.lookup('IBM', 'en-US').then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            name: "International Business Machines Corporation"
        });
    });
    it("should find IBM details", function() {
        return client.fundamental('IBM').should.eventually.be.like({
            symbol: 'IBM',
            name: "International Business Machines"
        });
    });
    it("should return daily", function() {
        return client.day('AABA', moment.tz('2014-01-01', tz), tz)
          .then(result => result.slice(0, 21))
          .should.eventually.be.like([
            {Date:'2014-01-02',Open:40.37,High:40.49,Low:39.31,Close:39.59},
            {Date:'2014-01-03',Open:40.16,High:40.44,Low:39.82,Close:40.12},
            {Date:'2014-01-06',Open:40.05,High:40.32,Low:39.75,Close:39.93},
            {Date:'2014-01-07',Open:40.08,High:41.20,Low:40.08,Close:40.92},
            {Date:'2014-01-08',Open:41.29,High:41.72,Low:41.02,Close:41.02},
            {Date:'2014-01-09',Open:41.33,High:41.35,Low:40.61,Close:40.92},
            {Date:'2014-01-10',Open:40.95,High:41.35,Low:40.82,Close:41.23},
            {Date:'2014-01-13',Open:41.16,High:41.22,Low:39.80,Close:39.99},
            {Date:'2014-01-14',Open:40.21,High:41.14,Low:40.04,Close:41.14},
            {Date:'2014-01-15',Open:41.06,High:41.31,Low:40.76,Close:41.07},
            {Date:'2014-01-16',Open:40.43,High:40.75,Low:40.11,Close:40.34},
            {Date:'2014-01-17',Open:40.12,High:40.44,Low:39.47,Close:40.01},
            {Date:'2014-01-21',Open:39.98,High:40.05,Low:38.86,Close:39.52},
            {Date:'2014-01-22',Open:39.66,High:40.40,Low:39.32,Close:40.18},
            {Date:'2014-01-23',Open:39.31,High:39.77,Low:39.14,Close:39.39},
            {Date:'2014-01-24',Open:38.67,High:38.98,Low:37.62,Close:37.91},
            {Date:'2014-01-27',Open:37.60,High:37.94,Low:36.62,Close:36.65},
            {Date:'2014-01-28',Open:36.83,High:38.32,Low:36.52,Close:38.22},
            {Date:'2014-01-29',Open:35.77,High:36.31,Low:34.82,Close:34.89},
            {Date:'2014-01-30',Open:34.89,High:35.81,Low:34.45,Close:35.31},
            {Date:'2014-01-31',Open:34.69,High:36.33,Low:34.55,Close:36.01}
        ]);
    });
    it("should return monthly", function() {
        return client.month('AABA',moment.tz('2013-10-01', tz), tz)
          .then(result => result.slice(0, 4))
          .should.eventually.be.like([
            {Date:'2013-10-01',Open:33.36,High:35.06,Low:31.70,Close:32.94},
            {Date:'2013-11-01',Open:33.15,High:37.35,Low:32.06,Close:36.98},
            {Date:'2013-12-01',Open:37.04,High:41.05,Low:36.25,Close:40.44},
            {Date:'2014-01-01',Open:40.37,High:41.72,Low:34.45,Close:36.01}
        ]);
    });
    it("should load intraday quote", function() {
        return client.intraday('AABA').should.eventually.have.property('symbol', 'AABA');
    });
    it("should find BRK/A symbol", function() {
        return client.lookup('BRK/A', 'en-US').should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should find C^K symbol", function() {
        return client.lookup('C^K', 'en-US').should.eventually.be.like(results => _.some(results, like(
            {symbol: 'C', name: name => name.toLowerCase().indexOf("citigroup") === 0}
        )));
    });
});
