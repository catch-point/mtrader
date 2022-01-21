// fetch.spec.js
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const merge = require('../src/merge.js');
const like = require('./should-be-like.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const createTempDir = require('./create-temp-dir.js');

describe("fetch", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var fetch;
    before(function() {
        config('prefix', createTempDir('fetch'));
        fetch = Fetch(merge(config('fetch'), {
            files: {
                enabled: true,
                dirname: path.resolve(__dirname, 'data')
            },
            yahoo: {
                enabled: true
            },
            iqfeed: {
                enabled: false
            }
        }));
    });
    after(function() {
        return fetch.close();
    });
    it("should find IBM", function() {
        return fetch({
            interval: 'lookup',
            symbol: 'IBM', market: 'NYSE', tz
        }).then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            name: /International Business Machine/i
        });
    });
    it("should find USD/CAD details", function() {
        return fetch({
            interval: 'fundamental',
            symbol: 'USD', market: 'CAD', tz
        }).should.eventually.be.like([{
            symbol: 'USD'
        }]);
    });
    it("should find BRK.A symbol", function() {
        return fetch({
            interval: 'lookup',
            symbol: 'BRK.A', market: 'NYSE'
        }).should.eventually.be.like(results => _.some(results, like({
            symbol: /^BRK.A/,
            name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0
        })));
    });
    it("should return 30 minute intervals", function() {
        return fetch({
            interval: 'm30',
            symbol: 'USD', market: 'CAD',
            begin: '2014-03-03T08:30:00-0500', end: '2014-03-03T17:00:00-0500', tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T08:30:00-05:00',open:1.10966,high:1.11014,low:1.10926,close:1.11004},
            {ending:'2014-03-03T09:00:00-05:00',open:1.11006,high:1.11009,low:1.10869,close:1.10879},
            {ending:'2014-03-03T09:30:00-05:00',open:1.1088,high:1.10914,low:1.10811,close:1.10824},
            {ending:'2014-03-03T10:00:00-05:00',open:1.10824,high:1.10951,low:1.10824,close:1.10925},
            {ending:'2014-03-03T10:30:00-05:00',open:1.10923,high:1.10993,low:1.10799,close:1.10819},
            {ending:'2014-03-03T11:00:00-05:00',open:1.10819,high:1.10824,low:1.10694,close:1.10789},
            {ending:'2014-03-03T11:30:00-05:00',open:1.10789,high:1.10961,low:1.10779,close:1.10852},
            {ending:'2014-03-03T12:00:00-05:00',open:1.10854,high:1.10929,low:1.10827,close:1.109},
            {ending:'2014-03-03T12:30:00-05:00',open:1.109,high:1.1093,low:1.10794,close:1.10841},
            {ending:'2014-03-03T13:00:00-05:00',open:1.1084,high:1.10995,low:1.10782,close:1.10991},
            {ending:'2014-03-03T13:30:00-05:00',open:1.10991,high:1.11,low:1.10951,close:1.10966},
            {ending:'2014-03-03T14:00:00-05:00',open:1.10966,high:1.1097,low:1.10865,close:1.10949},
            {ending:'2014-03-03T14:30:00-05:00',open:1.10944,high:1.10944,low:1.10806,close:1.10846},
            {ending:'2014-03-03T15:00:00-05:00',open:1.10845,high:1.10846,low:1.10745,close:1.10833},
            {ending:'2014-03-03T15:30:00-05:00',open:1.10834,high:1.10834,low:1.10771,close:1.10793},
            {ending:'2014-03-03T16:00:00-05:00',open:1.10793,high:1.10835,low:1.10736,close:1.10831},
            {ending:'2014-03-03T16:30:00-05:00',open:1.1083,high:1.10842,low:1.10747,close:1.10761},
            {ending:'2014-03-03T17:00:00-05:00',open:1.10761,high:1.10792,low:1.10729,close:1.10749}
        ]);
    });
    it("should return 10 minute intervals", function() {
        return fetch({
            interval: 'm10',
            symbol: 'USD', market: 'CAD',
            begin: '2014-03-03T10:10:00-0500', end: '2014-03-03T11:00:00-0500', tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T10:10:00-05:00',high:1.10993,low:1.10876,open:1.10923,close:1.10905},
            {ending:'2014-03-03T10:20:00-05:00',high:1.10944,low:1.10879,open:1.10905,close:1.10880},
            {ending:'2014-03-03T10:30:00-05:00',high:1.10905,low:1.10799,open:1.10880,close:1.10819},
            {ending:'2014-03-03T10:40:00-05:00',high:1.10824,low:1.10718,open:1.10819,close:1.10755},
            {ending:'2014-03-03T10:50:00-05:00',high:1.10814,low:1.10755,open:1.10755,close:1.10794},
            {ending:'2014-03-03T11:00:00-05:00',high:1.10798,low:1.10694,open:1.10793,close:1.10789}
        ]);
    });
    it("should return minutes", function() {
        return fetch({
            interval: 'm1',
            symbol: 'USD', market: 'CAD',
            begin: '2014-03-03T10:01:00-0500', end: '2014-03-03T10:30:00-0500', tz
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
    it("should adjust monthly dividend", function() {
        return fetch({
            interval: 'month',
            symbol: 'SPY', market: 'NYSE',
            begin: '2016-01-01', end: '2016-12-31', tz
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
            {ending:'2016-07-29T16:00:00-04:00',open:209.48,close:217.12,adj_close:214.76},
            {ending:'2016-08-31T16:00:00-04:00',open:217.19,close:217.38,adj_close:215.02},
            {ending:'2016-09-30T16:00:00-04:00',open:217.37-1.10,close:216.30,adj_close:215.03},
            {ending:'2016-10-31T16:00:00-04:00',open:215.82,close:212.55,adj_close:211.31},
            {ending:'2016-11-30T16:00:00-05:00',open:212.93,close:220.38,adj_close:219.09},
            {ending:'2016-12-30T16:00:00-05:00',open:220.73-1.29,close:223.53,adj_close:223.53}
        ]);
    });
    it("should adjust splits and dividends", function() {
        return fetch({
            interval: 'month',
            symbol: 'AAPL', market: 'NASDAQ',
            begin: '2014-01-01', end: '2014-09-30', tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2014-01-31T16:00:00-05:00',open:555.7,close:500.60,adj_close:70.34},
            {ending:'2014-02-28T16:00:00-05:00',open:502.61-3,close:526.2,adj_close:74.39},
            {ending:'2014-03-31T16:00:00-04:00',open:523.4,close:536.7,adj_close:75.87},
            {ending:'2014-04-30T16:00:00-04:00',open:537.8,close:590.09,adj_close:83.41},
            {ending:'2014-05-30T16:00:00-04:00',open:592.00-3.29,close:633.00,adj_close:89.98},
            {ending:'2014-06-30T16:00:00-04:00',open:Math.round(633.96/7*100)/100,close:92.93,adj_close:92.47},
            {ending:'2014-07-31T16:00:00-04:00',open:93.52,close:95.60,adj_close:95.13},
            {ending:'2014-08-29T16:00:00-04:00',open:94.90-0.47,close:102.50,adj_close:102.5},
            {ending:'2014-09-30T16:00:00-04:00',open:103.06,close:100.75,adj_close:100.75}
        ]);
    });
    it("should adjust yearly dividends", function() {
        return fetch({
            interval: 'year',
            symbol: 'SPY', market: 'NYSE',
            begin: '2010-01-01', end: '2016-12-31', tz
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
    it("should return daily FX", function() {
        return fetch({
            interval: 'day',
            symbol: 'USD', market: 'CAD',
            begin: '2014-01-01', end: '2014-02-01', tz
        }).should.eventually.be.like([
        {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680,adj_close:1.06680},
        {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312,adj_close:1.06312},
        {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543,adj_close:1.06543},
        {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658,adj_close:1.07658},
        {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169,adj_close:1.08169},
        {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429,adj_close:1.08429},
        {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947,adj_close:1.08947},
        {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611,adj_close:1.08611},
        {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466,adj_close:1.09466},
        {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351,adj_close:1.09351},
        {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301,adj_close:1.09301},
        {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617,adj_close:1.09617},
        {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434,adj_close:1.09434},
        {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651,adj_close:1.09651},
        {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866,adj_close:1.10866},
        {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996,adj_close:1.10996},
        {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788,adj_close:1.10788},
        {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136,adj_close:1.11136},
        {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507,adj_close:1.11507},
        {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668,adj_close:1.11668},
        {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578,adj_close:1.11578},
        {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251,adj_close:1.11251}
        ]);
    });
    it("should return weekly FX", function() {
        return fetch({
            interval: 'week',
            symbol: 'USD', market: 'CAD',
            begin: '2014-01-05', tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
        {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.06076,open:1.06313,close:1.08947,adj_close:1.08947},
        {ending:'2014-01-17T17:00:00-05:00',high:1.09904,low:1.08416,open:1.08996,close:1.09617,adj_close:1.09617},
        {ending:'2014-01-24T17:00:00-05:00',high:1.11729,low:1.09285,open:1.09597,close:1.10788,adj_close:1.10788},
        {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10308,open:1.10600,close:1.11251,adj_close:1.11251}
        ]));
    });
    it("should return monthly FX", function() {
        return fetch({
            interval: 'month',
            symbol: 'USD', market: 'CAD',
            begin: '2014-01-01', tz
        }).should.eventually.be.like(results => results.slice(0, 12).should.be.like([
        {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.05874,open:1.06321,close:1.11251,adj_close:1.11251},
        {ending:'2014-02-28T17:00:00-05:00',high:1.11935,low:1.09092,open:1.11070,close:1.10640,adj_close:1.10640},
        {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.09543,open:1.10708,close:1.10482,adj_close:1.10482},
        {ending:'2014-04-30T17:00:00-04:00',high:1.10693,low:1.08570,open:1.10480,close:1.09598,adj_close:1.09598},
        {ending:'2014-05-30T17:00:00-04:00',high:1.10055,low:1.08133,open:1.09597,close:1.08397,adj_close:1.08397},
        {ending:'2014-06-30T17:00:00-04:00',high:1.09595,low:1.06455,open:1.08358,close:1.06679,adj_close:1.06679},
        {ending:'2014-07-31T17:00:00-04:00',high:1.09286,low:1.06195,open:1.06679,close:1.09039,adj_close:1.09039},
        {ending:'2014-08-29T17:00:00-04:00',high:1.09967,low:1.08097,open:1.09039,close:1.08731,adj_close:1.08731},
        {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.08197,open:1.08710,close:1.11942,adj_close:1.11942},
        {ending:'2014-10-31T17:00:00-04:00',high:1.13843,low:1.10704,open:1.11943,close:1.12661,adj_close:1.12661},
        {ending:'2014-11-28T17:00:00-05:00',high:1.14655,low:1.11896,open:1.12827,close:1.14119,adj_close:1.14119},
        {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.13120,open:1.14272,close:1.16123,adj_close:1.16123}
        ]));
    });
    it("should return quarter FX", function() {
        return fetch({
            interval: 'quarter',
            symbol: 'USD', market: 'CAD',
            begin: '2014-01-01', tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
        {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.05874,open:1.06321,close:1.10482,adj_close:1.10482},
        {ending:'2014-06-30T17:00:00-04:00',high:1.10693,low:1.06455,open:1.10480,close:1.06679,adj_close:1.06679},
        {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.06195,open:1.06679,close:1.11942,adj_close:1.11942},
        {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.10704,open:1.11943,close:1.16123,adj_close:1.16123}
        ]));
    });
    it("should return year FX", function() {
        return fetch({
            interval: 'year',
            symbol: 'USD', market: 'CAD',
            begin: '2014-01-01', tz
        }).should.eventually.be.like(results => results.slice(0, 1).should.be.like([
        {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.05874,open:1.06321,close:1.16123,adj_close:1.16123}
        ]));
    });
});
