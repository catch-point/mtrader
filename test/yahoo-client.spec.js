// yahoo-client.spec.js
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
const yahooClient = require('../src/yahoo-client.js');

describe("yahoo-client", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = yahooClient();
    after(function() {
        return client.close();
    });
    it("should find IBM", function() {
        return client.lookup('IBM', 'en-US').then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            name: "International Business Machines Corporation"
        });
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
    it("should find dividend for SPY", function() {
        return client.dividend('SPY', '2019-01-01', 'America/New_York')
          .then(data => data.filter(d => d.Date < '2020'))
          .then(data => _.sortBy(data, 'Date'))
          .then(data => data.slice(data.length-4,data.length))
          .should.eventually.be.like([
            { Date: '2019-03-15', Dividends: '1.233' },
            { Date: '2019-06-21', Dividends: '1.432' },
            { Date: '2019-09-20', Dividends: '1.384' },
            { Date: '2019-12-20', Dividends: '1.57' }
        ]);
    });
    it("should find dividends for XLK", function() {
        return client.dividend('XLK', '2010-01-01', 'America/New_York')
          .then(data => data.filter(d => d.Date < '2015'))
          .then(data => _.sortBy(data, 'Date'))
          .should.eventually.be.like([
            { Date: '2010-03-19', Dividends: '0.073' },
            { Date: '2010-06-18', Dividends: '0.079' },
            { Date: '2010-09-17', Dividends: '0.081' },
            { Date: '2010-12-17', Dividends: '0.09' },
            { Date: '2011-03-18', Dividends: '0.084' },
            { Date: '2011-06-17', Dividends: '0.098' },
            { Date: '2011-09-16', Dividends: '0.094' },
            { Date: '2011-12-16', Dividends: '0.109' },
            { Date: '2012-03-16', Dividends: '0.096' },
            { Date: '2012-06-15', Dividends: '0.109' },
            { Date: '2012-09-21', Dividends: '0.13' },
            { Date: '2012-12-21', Dividends: '0.168' },
            { Date: '2013-03-15', Dividends: '0.124' },
            { Date: '2013-06-21', Dividends: '0.155' },
            { Date: '2013-09-20', Dividends: '0.158' },
            { Date: '2013-12-20', Dividends: '0.171' },
            { Date: '2014-03-21', Dividends: '0.157' },
            { Date: '2014-06-20', Dividends: '0.176' },
            { Date: '2014-09-19', Dividends: '0.174' },
            { Date: '2014-12-19', Dividends: '0.216' }

        ]);
    });
});
