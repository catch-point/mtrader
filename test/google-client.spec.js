// google-client.spec.js
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
const googleClient = require('../src/google-client.js');

describe("google-client", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = googleClient();
    after(function() {
        return client.close();
    });
    it("should find AABA", function() {
        return client.lookup('AABA').should.eventually.be.like(results => _.some(results, like({
            symbol: 'AABA',
            e: Boolean,
            name: "Altaba Inc"
        })));
    });
    it("should find AABA details", function() {
        return client.fundamental('NASDAQ:AABA').should.eventually.be.like({
            t: 'AABA',
            name: "Altaba Inc"
        });
    });
    it("should find IBM", function() {
        return client.lookup('IBM').then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            name: "International Business Machines Corp."
        });
    });
    it("should find IBM details", function() {
        return client.fundamental('NYSE:IBM').should.eventually.be.like({
            t: 'IBM',
            name: "International Business Machines Corp."
        });
    });
    it("should return daily", function() {
        return client.day('NASDAQ:AABA', moment.tz('2014-01-01', tz), moment().tz(tz), tz)
          .then(result => result.slice(-21))
          .should.eventually.be.like([
            {Date:"31-Jan-14",Open:34.7,High:36.3,Low:34.6,Close:36.01},
            {Date:"30-Jan-14",Open:34.9,High:35.8,Low:34.5,Close:35.31},
            {Date:"29-Jan-14",Open:35.8,High:36.3,Low:34.8,Close:34.89},
            {Date:"28-Jan-14",Open:36.8,High:38.3,Low:36.5,Close:38.22},
            {Date:"27-Jan-14",Open:37.6,High:37.9,Low:36.6,Close:36.65},
            {Date:"24-Jan-14",Open:38.7,High:39,Low:37.6,Close:37.91},
            {Date:"23-Jan-14",Open:39.3,High:39.8,Low:39.1,Close:39.39},
            {Date:"22-Jan-14",Open:39.7,High:40.4,Low:39.3,Close:40.18},
            {Date:"21-Jan-14",Open:40,High:40.1,Low:38.9,Close:39.52},
            {Date:"17-Jan-14",Open:40.1,High:40.4,Low:39.5,Close:40.01},
            {Date:"16-Jan-14",Open:40.4,High:40.8,Low:40.1,Close:40.34},
            {Date:"15-Jan-14",Open:41.1,High:41.3,Low:40.8,Close:41.07},
            {Date:"14-Jan-14",Open:40.2,High:41.1,Low:40,Close:41.14},
            {Date:"13-Jan-14",Open:41.2,High:41.2,Low:39.8,Close:39.99},
            {Date:"10-Jan-14",Open:41,High:41.4,Low:40.8,Close:41.23},
            {Date:"9-Jan-14",Open:41.3,High:41.4,Low:40.6,Close:40.92},
            {Date:"8-Jan-14",Open:41.3,High:41.7,Low:41,Close:41.02},
            {Date:"7-Jan-14",Open:40.1,High:41.2,Low:40.1,Close:40.92},
            {Date:"6-Jan-14",Open:40.1,High:40.3,Low:39.8,Close:39.93},
            {Date:"3-Jan-14",Open:40.2,High:40.4,Low:39.8,Close:40.12},
            {Date:"2-Jan-14",Open:40.4,High:40.5,Low:39.3,Close:39.59}
        ]);
    });
    it("should load intraday quote", function() {
        return client.quote('NASDAQ:AABA').should.eventually.have.property('t', 'AABA');
    });
    it("should find BRK/A symbol", function() {
        return client.lookup('BRK/A').should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should find C symbol", function() {
        return client.lookup('C').should.eventually.be.like(results => _.some(results, like(
            {symbol: 'C', name: name => name.toLowerCase().indexOf("citigroup") === 0}
        )));
    });
});
