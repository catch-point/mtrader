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
});
