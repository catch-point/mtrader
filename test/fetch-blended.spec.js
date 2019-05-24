// fetch-blended.spec.js
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
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');

describe("fetch-blended", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var fetch, quote;
    before(function() {
        config('prefix', __dirname);
        config('fetch.files.dirname', path.resolve(__dirname, 'data'));
        config.load(path.resolve(__dirname, 'testdata.json'));
        config('fetch.iqfeed.enabled', false);
        config('fetch.yahoo.enabled', false);
        config('fetch.files.enabled', false);
        config('fetch.blended', {enabled: true, delegate: 'files', assets:[{
            symbol: 'YHOO', market: 'NASDAQ',
            underlying: {symbol: 'AABA', market: 'NASDAQ'}
        }, {
            symbol: 'XLC', market: 'ARCA',
            underlying: {symbol: 'XLC', market: 'ARCA'},
            blend: [{
                data: [
                    {ending:'2018-06-18T16:00:00-04:00', open:49.72, high:50.52, low:49.31, close:50.18, volume:131094, adj_close:50.09},
                    {ending:'2018-06-19T16:00:00-04:00', open:49.65, high:50.39, low:49.27, close:50.11, volume: 152086, adj_close:50.02}
                ]
            }]
        }, {
            symbol: 'XLC', market: 'ARCA2018',
            afterHoursClosesAt: "20:00:00",
            marketClosesAt: "16:00:00",
            marketOpensAt: "09:30:00",
            premarketOpensAt: "04:00:00",
            currency: "USD",
            tz,
            underlying: {symbol: 'XLC', market: 'ARCA'},
            blend: [{
                data: [
                    {ending:'2018-06-18T16:00:00-04:00', open:49.72, high:50.52, low:49.31, close:50.18, volume:131094, adj_close:50.09},
                    {ending:'2018-06-19T16:00:00-04:00', open:49.65, high:50.39, low:49.27, close:50.11, volume: 152086, adj_close:50.02}
                ]
            }]
        }]});
        fetch = Fetch();
        quote = Quote(fetch);
    });
    after(function() {
        config.unset('fetch.files.dirname');
        config.unset('fetch.iqfeed.enabled');
        config.unset('fetch.yahoo.enabled');
        config.unset('fetch.files.enabled');
        config.unset('fetch.blended');
        return Promise.all([
            quote.close(),
            fetch.close()
        ]);
    });
    it("should find YHOO", function() {
        return fetch({
            interval: 'lookup',
            symbol:'YHOO', market: 'NASDAQ'
        }).then(_.first).should.eventually.be.like({
            symbol: 'YHOO', market: 'NASDAQ',
            name: /Altaba/i
        });
    });
    it("should blend XLC on June 18 (before inception)", function() {
        return fetch({
            interval: 'day',
            symbol: 'XLC', market: 'ARCA',
            begin: '2018-06-18', end: '2018-06-23', tz
        }).should.eventually.be.like([
            {ending:'2018-06-18T16:00:00-04:00',adj_close:50.03},
            {ending:'2018-06-19T16:00:00-04:00',adj_close:49.96},
            {ending:'2018-06-20T16:00:00-04:00',adj_close:50.58},
            {ending:'2018-06-21T16:00:00-04:00',adj_close:50.27},
            {ending:'2018-06-22T16:00:00-04:00',adj_close:50.49}
        ]);
    });
    it("should blend XLC using a different market name", function() {
        return fetch({
            interval: 'day',
            symbol: 'XLC', market: 'ARCA2018',
            begin: '2018-06-18', end: '2018-06-23', tz
        }).should.eventually.be.like([
            {ending:'2018-06-18T16:00:00-04:00',adj_close:50.03},
            {ending:'2018-06-19T16:00:00-04:00',adj_close:49.96},
            {ending:'2018-06-20T16:00:00-04:00',adj_close:50.58},
            {ending:'2018-06-21T16:00:00-04:00',adj_close:50.27},
            {ending:'2018-06-22T16:00:00-04:00',adj_close:50.49}
        ]);
    });
    it("should blend XLC using a different market name from quote", function() {
        return quote({
            symbol: 'XLC', market: 'ARCA2018',
            columns: {ending:'ending', adj_close:'day.adj_close'},
            begin: '2018-06-18', end: '2018-06-23', tz
        }).should.eventually.be.like([
            {ending:'2018-06-18T16:00:00-04:00',adj_close:50.03},
            {ending:'2018-06-19T16:00:00-04:00',adj_close:49.96},
            {ending:'2018-06-20T16:00:00-04:00',adj_close:50.58},
            {ending:'2018-06-21T16:00:00-04:00',adj_close:50.27},
            {ending:'2018-06-22T16:00:00-04:00',adj_close:50.49}
        ]);
    });
    it("should return daily", function() {
        return fetch({
            interval: 'day',
            symbol: 'YHOO', market: 'NASDAQ',
            begin: '2014-01-01', end: '2014-02-01', tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T16:00:00-05:00'},
            {ending:'2014-01-03T16:00:00-05:00'},
            {ending:'2014-01-06T16:00:00-05:00'},
            {ending:'2014-01-07T16:00:00-05:00'},
            {ending:'2014-01-08T16:00:00-05:00'},
            {ending:'2014-01-09T16:00:00-05:00'},
            {ending:'2014-01-10T16:00:00-05:00'},
            {ending:'2014-01-13T16:00:00-05:00'},
            {ending:'2014-01-14T16:00:00-05:00'},
            {ending:'2014-01-15T16:00:00-05:00'},
            {ending:'2014-01-16T16:00:00-05:00'},
            {ending:'2014-01-17T16:00:00-05:00'},
            {ending:'2014-01-21T16:00:00-05:00'},
            {ending:'2014-01-22T16:00:00-05:00'},
            {ending:'2014-01-23T16:00:00-05:00'},
            {ending:'2014-01-24T16:00:00-05:00'},
            {ending:'2014-01-27T16:00:00-05:00'},
            {ending:'2014-01-28T16:00:00-05:00'},
            {ending:'2014-01-29T16:00:00-05:00'},
            {ending:'2014-01-30T16:00:00-05:00'},
            {ending:'2014-01-31T16:00:00-05:00'}
        ]);
    });
});
