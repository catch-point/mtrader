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
    var about = expected => actual => (+actual).should.be.closeTo(expected,0.01);
    it("should find YHOO", function() {
        return client.lookup('YHOO', 'en-US').should.eventually.be.like(results => _.some(results, like({
            symbol: 'YHOO',
            exch: Boolean,
            name: "Yahoo! Inc."
        })));
    });
    it("should find YHOO details", function() {
        return client.fundamental('YHOO').should.eventually.be.like({
            symbol: 'YHOO',
            name: "Yahoo! Inc."
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
        return client.day(
            'YHOO',
            moment.tz('2014-01-01', tz), moment.tz('2014-02-01', tz),
            '16:00:00', tz
        ).should.eventually.be.like([
            {Date:'2014-01-31',Open:about(34.69),High:about(36.33),Low:about(34.55),Close:about(36.01)},
            {Date:'2014-01-30',Open:about(34.89),High:about(35.81),Low:about(34.45),Close:about(35.31)},
            {Date:'2014-01-29',Open:about(35.77),High:about(36.31),Low:about(34.82),Close:about(34.89)},
            {Date:'2014-01-28',Open:about(36.83),High:about(38.32),Low:about(36.52),Close:about(38.22)},
            {Date:'2014-01-27',Open:about(37.60),High:about(37.94),Low:about(36.62),Close:about(36.65)},
            {Date:'2014-01-24',Open:about(38.67),High:about(38.98),Low:about(37.62),Close:about(37.91)},
            {Date:'2014-01-23',Open:about(39.31),High:about(39.77),Low:about(39.14),Close:about(39.39)},
            {Date:'2014-01-22',Open:about(39.66),High:about(40.40),Low:about(39.32),Close:about(40.18)},
            {Date:'2014-01-21',Open:about(39.98),High:about(40.05),Low:about(38.86),Close:about(39.52)},
            {Date:'2014-01-17',Open:about(40.12),High:about(40.44),Low:about(39.47),Close:about(40.01)},
            {Date:'2014-01-16',Open:about(40.43),High:about(40.75),Low:about(40.11),Close:about(40.34)},
            {Date:'2014-01-15',Open:about(41.06),High:about(41.31),Low:about(40.76),Close:about(41.07)},
            {Date:'2014-01-14',Open:about(40.21),High:about(41.14),Low:about(40.04),Close:about(41.14)},
            {Date:'2014-01-13',Open:about(41.16),High:about(41.22),Low:about(39.80),Close:about(39.99)},
            {Date:'2014-01-10',Open:about(40.95),High:about(41.35),Low:about(40.82),Close:about(41.23)},
            {Date:'2014-01-09',Open:about(41.33),High:about(41.35),Low:about(40.61),Close:about(40.92)},
            {Date:'2014-01-08',Open:about(41.29),High:about(41.72),Low:about(41.02),Close:about(41.02)},
            {Date:'2014-01-07',Open:about(40.08),High:about(41.20),Low:about(40.08),Close:about(40.92)},
            {Date:'2014-01-06',Open:about(40.05),High:about(40.32),Low:about(39.75),Close:about(39.93)},
            {Date:'2014-01-03',Open:about(40.16),High:about(40.44),Low:about(39.82),Close:about(40.12)},
            {Date:'2014-01-02',Open:about(40.37),High:about(40.49),Low:about(39.31),Close:about(39.59)}
        ]);
    });
    it("should return weekly", function() {
        return client.week(
            'YHOO',
            moment.tz('2014-01-06', tz), moment.tz('2014-02-01', tz),
            '16:00:00', tz
        ).should.eventually.be.like([
            {Date:'2014-01-27',Open:about(37.60),High:about(38.32),Low:about(34.45),Close:about(36.01)},
            {Date:'2014-01-21',Open:about(39.98),High:about(40.40),Low:about(37.62),Close:about(37.91)},
            {Date:'2014-01-13',Open:about(41.16),High:about(41.31),Low:about(39.47),Close:about(40.01)},
            {Date:'2014-01-06',Open:about(40.05),High:about(41.72),Low:about(39.75),Close:about(41.23)}
        ]);
    });
    it("should return monthly", function() {
        return client.month(
            'YHOO',
            moment.tz('2013-10-01', tz), moment.tz('2014-02-01', tz),
            '16:00:00', tz
        ).should.eventually.be.like([
            {Date:'2014-01-02',Open:about(40.37),High:about(41.72),Low:about(34.45),Close:about(36.01)},
            {Date:'2013-12-02',Open:about(37.04),High:about(41.05),Low:about(36.25),Close:about(40.44)},
            {Date:'2013-11-01',Open:about(33.15),High:about(37.35),Low:about(32.06),Close:about(36.98)},
            {Date:'2013-10-01',Open:about(33.36),High:about(35.06),Low:about(31.70),Close:about(32.94)}
        ]);
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
