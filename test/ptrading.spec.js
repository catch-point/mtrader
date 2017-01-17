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

const ptrading = require('../src/ptrading.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("ptrading", function() {
    ptrading.config('prefix', createTempDir('ptrading'));
    var about = expected => actual => actual.should.be.closeTo(expected,0.0001);
    it("lookup", function() {
        return ptrading.lookup({symbol: 'YHOO'}).then(suggestions => {
          suggestions.forEach(suggestion => {
            suggestion.symbol.should.eql('YHOO');
            suggestion.exchange.should.eql('NASDAQ');
          });
        });
    });
    it("quote", function() {
        return ptrading.quote({
          symbol: 'YHOO',
          exchange: 'NASDAQ',
          begin: "2017-01-13",
          pad_begin: 9,
          end: "2017-01-14",
          columns: [
              'DATE(ending) AS "Date"',
              'day.close AS "Close"',
              '(day.adj_close - OFFSET(1, day.adj_close))*100/OFFSET(1,day.adj_close) AS "Change"'
          ].join(','),
          criteria: 'day.adj_close > OFFSET(1, day.adj_close)'
        }).should.eventually.be.like([
            {Date:"2016-12-30",Close:38.67,Change:about(0.0776)},
            {Date:"2017-01-03",Close:38.90,Change:about(0.5947)},
            {Date:"2017-01-04",Close:40.06,Change:about(2.9820)},
            {Date:"2017-01-05",Close:41.34,Change:about(3.1952)},
            {Date:"2017-01-09",Close:41.34,Change:about(0.2667)},
            {Date:"2017-01-10",Close:42.30,Change:about(2.3222)},
            {Date:"2017-01-11",Close:42.59,Change:about(0.6855)},
            {Date:"2017-01-13",Close:42.27,Change:about(0.3799)}
        ]);
    });
});




