// rolling-functions.spec.js
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

const path = require('path');
const _ = require('underscore');
const merge = require('../src/merge.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');
const Collect = require('../src/collect.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("rolling functions", function() {
    this.timeout(60000);
    var fetch, quote, collect;
    before(function() {
        config('prefix', createTempDir('collect'));
        fetch = Fetch(merge(config('fetch'), {
            files: {
                enabled: true,
                dirname: path.resolve(__dirname, 'data')
            }
        }));
        quote = new Quote(fetch);
        collect = new Collect(fetch, quote);
    });
    after(function() {
        config.unset('prefix');
        return Promise.all([
            collect.close(),
            quote.close(),
            fetch.close()
        ]);
    });
    it("criteria static expression", function() {
        return collect({
          portfolio: 'SPY.ARCA',
          begin: "2016-01-01",
          end: "2016-02-01",
          columns: {
              date: 'DATE(ending)',
              Price: 'day.close',
              Vol: 'day.volume',
              Max: 'MAXPREV("Price",5,"Vol>200000000")'
          }
        }).should.eventually.be.like([
            { date: '2016-01-04', Price: 201.02, Vol: 222353500, Max: null },
            { date: '2016-01-05', Price: 201.36, Vol: 110845800, Max: 201.02 },
            { date: '2016-01-06', Price: 198.82, Vol: 152112600, Max: 201.02 },
            { date: '2016-01-07', Price: 194.05, Vol: 213436100, Max: 201.02 },
            { date: '2016-01-08', Price: 191.92, Vol: 209817200, Max: 201.02 },
            { date: '2016-01-11', Price: 192.11, Vol: 187941300, Max: 201.02 },
            { date: '2016-01-12', Price: 193.66, Vol: 172330500, Max: 194.05 },
            { date: '2016-01-13', Price: 188.83, Vol: 221168900, Max: 194.05 },
            { date: '2016-01-14', Price: 191.93, Vol: 240795600, Max: 194.05 },
            { date: '2016-01-15', Price: 187.81, Vol: 314240200, Max: 191.93 },
            { date: '2016-01-19', Price: 188.06, Vol: 195244400, Max: 191.93 },
            { date: '2016-01-20', Price: 185.65, Vol: 286547800, Max: 191.93 },
            { date: '2016-01-21', Price: 186.69, Vol: 195772900, Max: 191.93 },
            { date: '2016-01-22', Price: 190.52, Vol: 168319600, Max: 191.93 },
            { date: '2016-01-25', Price: 187.64, Vol: 130371700, Max: 187.81 },
            { date: '2016-01-26', Price: 190.20, Vol: 141036800, Max: 185.65 },
            { date: '2016-01-27', Price: 188.13, Vol: 185681700, Max: 185.65 },
            { date: '2016-01-28', Price: 189.11, Vol: 143798800, Max: null },
            { date: '2016-01-29', Price: 193.72, Vol: 210529300, Max: null }
        ]);
    });
    it("criteria dynamic expression", function() {
        return collect({
          portfolio: 'SPY.ARCA',
          begin: "2016-01-01",
          end: "2016-02-01",
          columns: {
              date: 'DATE(ending)',
              Price: 'day.close',
              Vol: 'day.volume',
              Max: 'MAXPREC("Price",5,`Vol>{Vol}`)'
          }
        }).should.eventually.be.like([
            { date: '2016-01-04', Price: 201.02, Vol: 222353500, Max: null },
            { date: '2016-01-05', Price: 201.36, Vol: 110845800, Max: 201.02 },
            { date: '2016-01-06', Price: 198.82, Vol: 152112600, Max: 201.02 },
            { date: '2016-01-07', Price: 194.05, Vol: 213436100, Max: 201.02 },
            { date: '2016-01-08', Price: 191.92, Vol: 209817200, Max: 201.02 },
            { date: '2016-01-11', Price: 192.11, Vol: 187941300, Max: 201.02 },
            { date: '2016-01-12', Price: 193.66, Vol: 172330500, Max: 194.05 },
            { date: '2016-01-13', Price: 188.83, Vol: 221168900, Max: null },
            { date: '2016-01-14', Price: 191.93, Vol: 240795600, Max: null },
            { date: '2016-01-15', Price: 187.81, Vol: 314240200, Max: null },
            { date: '2016-01-19', Price: 188.06, Vol: 195244400, Max: 191.93 },
            { date: '2016-01-20', Price: 185.65, Vol: 286547800, Max: 187.81 },
            { date: '2016-01-21', Price: 186.69, Vol: 195772900, Max: 191.93 },
            { date: '2016-01-22', Price: 190.52, Vol: 168319600, Max: 191.93 },
            { date: '2016-01-25', Price: 187.64, Vol: 130371700, Max: 190.52 },
            { date: '2016-01-26', Price: 190.20, Vol: 141036800, Max: 190.52 },
            { date: '2016-01-27', Price: 188.13, Vol: 185681700, Max: 186.69 },
            { date: '2016-01-28', Price: 189.11, Vol: 143798800, Max: 190.52 },
            { date: '2016-01-29', Price: 193.72, Vol: 210529300, Max: null }
        ]);
    });
    it("criteria relative expression", function() {
        return collect({
          portfolio: 'SPY.ARCA',
          begin: "2016-01-01",
          end: "2016-02-01",
          columns: {
              date: 'DATE(ending)',
              Price: 'day.close',
              Vol: 'ROUND(day.volume/100000000)',
              Count: 'COUNTPREV("Vol",10,`>={Vol}`)'
          }
        }).should.eventually.be.like([
            { date: '2016-01-04', Price: 201.02, Vol: 2, Count: 0 },
            { date: '2016-01-05', Price: 201.36, Vol: 1, Count: 1 },
            { date: '2016-01-06', Price: 198.82, Vol: 2, Count: 1 },
            { date: '2016-01-07', Price: 194.05, Vol: 2, Count: 2 },
            { date: '2016-01-08', Price: 191.92, Vol: 2, Count: 3 },
            { date: '2016-01-11', Price: 192.11, Vol: 2, Count: 4 },
            { date: '2016-01-12', Price: 193.66, Vol: 2, Count: 5 },
            { date: '2016-01-13', Price: 188.83, Vol: 2, Count: 6 },
            { date: '2016-01-14', Price: 191.93, Vol: 2, Count: 7 },
            { date: '2016-01-15', Price: 187.81, Vol: 3, Count: 0 },
            { date: '2016-01-19', Price: 188.06, Vol: 2, Count: 9 },
            { date: '2016-01-20', Price: 185.65, Vol: 3, Count: 1 },
            { date: '2016-01-21', Price: 186.69, Vol: 2, Count: 10 },
            { date: '2016-01-22', Price: 190.52, Vol: 2, Count: 10 },
            { date: '2016-01-25', Price: 187.64, Vol: 1, Count: 10 },
            { date: '2016-01-26', Price: 190.20, Vol: 1, Count: 10 },
            { date: '2016-01-27', Price: 188.13, Vol: 2, Count: 8 },
            { date: '2016-01-28', Price: 189.11, Vol: 1, Count: 10 },
            { date: '2016-01-29', Price: 193.72, Vol: 2, Count: 7 }
        ]);
    });
    it("criteria value", function() {
        return collect({
          portfolio: 'SPY.ARCA',
          begin: "2016-01-01",
          end: "2016-02-01",
          columns: {
              date: 'DATE(ending)',
              Price: 'day.close',
              Vol: 'ROUND(day.volume/100000000)',
              Count: 'COUNTPREC("Vol",10,Vol)'
          }
        }).should.eventually.be.like([
            { date: '2016-01-04', Price: 201.02, Vol: 2, Count: 0 },
            { date: '2016-01-05', Price: 201.36, Vol: 1, Count: 0 },
            { date: '2016-01-06', Price: 198.82, Vol: 2, Count: 1 },
            { date: '2016-01-07', Price: 194.05, Vol: 2, Count: 2 },
            { date: '2016-01-08', Price: 191.92, Vol: 2, Count: 3 },
            { date: '2016-01-11', Price: 192.11, Vol: 2, Count: 4 },
            { date: '2016-01-12', Price: 193.66, Vol: 2, Count: 5 },
            { date: '2016-01-13', Price: 188.83, Vol: 2, Count: 6 },
            { date: '2016-01-14', Price: 191.93, Vol: 2, Count: 7 },
            { date: '2016-01-15', Price: 187.81, Vol: 3, Count: 0 },
            { date: '2016-01-19', Price: 188.06, Vol: 2, Count: 8 },
            { date: '2016-01-20', Price: 185.65, Vol: 3, Count: 1 },
            { date: '2016-01-21', Price: 186.69, Vol: 2, Count: 8 },
            { date: '2016-01-22', Price: 190.52, Vol: 2, Count: 8 },
            { date: '2016-01-25', Price: 187.64, Vol: 1, Count: 0 },
            { date: '2016-01-26', Price: 190.20, Vol: 1, Count: 1 },
            { date: '2016-01-27', Price: 188.13, Vol: 2, Count: 6 },
            { date: '2016-01-28', Price: 189.11, Vol: 1, Count: 2 },
            { date: '2016-01-29', Price: 193.72, Vol: 2, Count: 5 }
        ]);
    });
});

