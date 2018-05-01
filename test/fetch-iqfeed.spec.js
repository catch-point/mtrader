// fetch-iqfeed.spec.js
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
const iqfeed = require('../src/fetch-iqfeed.js');

describe("fetch-iqfeed", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = iqfeed();
    before(function() {
        return client.open().catch(err => {
            client = null;
            this.skip();
        });
    });
    after(function() {
        if (client) return client.close();
    });
    it("should find IBM", function() {
        return client.lookup({symbol:'IBM', listed_market:7}).should.eventually.be.like(results => _.some(results, like({
            symbol: 'IBM',
            name: "INTERNATIONAL BUSINESS MACHINE"
        })));
    });
    it("should find USD/CAD details", function() {
        return client.fundamental({
            symbol:'USDCAD.FXCM', 
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like([{
            symbol: 'USDCAD.FXCM',
            listed_market: "74",
            company_name: /FXCM USD CAD/
        }]);
    });
    it("should return daily", function() {
        return client.interday({
            interval: 'day',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2014-02-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680},
            {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312},
            {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543},
            {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658},
            {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169},
            {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429},
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947},
            {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611},
            {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466},
            {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351},
            {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617},
            {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434},
            {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651},
            {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866},
            {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788},
            {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136},
            {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507},
            {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668},
            {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251}
        ]);
    });
    it("should return weekly", function() {
        return client.interday({
            interval: 'week',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-05', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.06076,open:1.06313,close:1.08947},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09904,low:1.08416,open:1.08996,close:1.09617},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11729,low:1.09285,open:1.09597,close:1.10788},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10308,open:1.10600,close:1.11251}
        ]));
    });
    it("should return monthly", function() {
        return client.interday({
            interval: 'month',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 12).should.be.like([
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.05874,open:1.06321,close:1.11251},
            {ending:'2014-02-28T17:00:00-05:00',high:1.11935,low:1.09092,open:1.11070,close:1.10640},
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.09543,open:1.10708,close:1.10482},
            {ending:'2014-04-30T17:00:00-04:00',high:1.10693,low:1.08570,open:1.10480,close:1.09598},
            {ending:'2014-05-30T17:00:00-04:00',high:1.10055,low:1.08133,open:1.09597,close:1.08397},
            {ending:'2014-06-30T17:00:00-04:00',high:1.09595,low:1.06455,open:1.08358,close:1.06679},
            {ending:'2014-07-31T17:00:00-04:00',high:1.09286,low:1.06195,open:1.06679,close:1.09039},
            {ending:'2014-08-29T17:00:00-04:00',high:1.09967,low:1.08097,open:1.09039,close:1.08731},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.08197,open:1.08710,close:1.11942},
            {ending:'2014-10-31T17:00:00-04:00',high:1.13843,low:1.10704,open:1.11943,close:1.12661},
            {ending:'2014-11-28T17:00:00-05:00',high:1.14655,low:1.11896,open:1.12827,close:1.14119},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.13120,open:1.14272,close:1.16123}
        ]));
    });
    it("should return quarter", function() {
        return client.interday({
            interval: 'quarter',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.05874,open:1.06321,close:1.10482},
            {ending:'2014-06-30T17:00:00-04:00',high:1.10693,low:1.06455,open:1.10480,close:1.06679},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.06195,open:1.06679,close:1.11942},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.10704,open:1.11943,close:1.16123}
        ]));
    });
    it("should return year", function() {
        return client.interday({
            interval: 'year',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 1).should.be.like([
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.05874,open:1.06321,close:1.16123}
        ]));
    });
    it("should find BRK.A symbol", function() {
        return client.lookup({symbol:'BRK.A', listed_market:7}).should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should return minutes", function() {
        return client.intraday({
            minutes: 1,
            symbol: 'USDCAD.FXCM',
            begin: moment('2014-03-03T10:01:00-0500'),
            end: moment('2014-03-03T10:30:00-0500'),
            tz: tz
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
    it("should return 10 minute intervals", function() {
        return client.intraday({
            minutes: 10,
            symbol: 'USDCAD.FXCM',
            begin: moment('2014-03-03T10:10:00-0500'),
            end: moment('2014-03-03T11:00:00-0500'),
            tz: tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T10:10:00-05:00',high:1.10993,low:1.10876,open:1.10923,close:1.10905},
            {ending:'2014-03-03T10:20:00-05:00',high:1.10944,low:1.10879,open:1.10905,close:1.10880},
            {ending:'2014-03-03T10:30:00-05:00',high:1.10905,low:1.10799,open:1.10880,close:1.10819},
            {ending:'2014-03-03T10:40:00-05:00',high:1.10824,low:1.10718,open:1.10819,close:1.10755},
            {ending:'2014-03-03T10:50:00-05:00',high:1.10814,low:1.10755,open:1.10755,close:1.10794},
            {ending:'2014-03-03T11:00:00-05:00',high:1.10798,low:1.10694,open:1.10793,close:1.10789}
        ]);
    });
    it("should estimate daily", function() {
        return client.rollday({
            minutes: 30,
            interval: 'day',
            symbol: 'USDCAD.FXCM',
            begin: moment.tz('2014-01-01', tz), end: moment.tz('2014-02-01', tz),
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680},
            {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312},
            {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543},
            {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658},
            {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169},
            {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429},
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947},
            {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611},
            {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466},
            {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351},
            {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617},
            {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434},
            {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651},
            {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866},
            {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788},
            {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136},
            {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507},
            {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668},
            {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251}
        ]);
    });
    it("should estimate weekly", function() {
        return client.rollday({
            minutes: 30,
            interval: 'week',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-05', end: '2014-02-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.06076,open:1.06313,close:1.08947},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09904,low:1.08416,open:1.08996,close:1.09617},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11729,low:1.09285,open:1.09597,close:1.10788},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10308,open:1.10600,close:1.11251}
        ]));
    });
    it("should estimate monthly", function() {
        return client.rollday({
            minutes: 30,
            interval: 'month',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2015-01-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 12).should.be.like([
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.05874,open:1.06321,close:1.11251},
            {ending:'2014-02-28T17:00:00-05:00',high:1.11935,low:1.09092,open:1.11070,close:1.10640},
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.09543,open:1.10708,close:1.10482},
            {ending:'2014-04-30T17:00:00-04:00',high:1.10693,low:1.08570,open:1.10480,close:1.09598},
            {ending:'2014-05-30T17:00:00-04:00',high:1.10055,low:1.08133,open:1.09597,close:1.08397},
            {ending:'2014-06-30T17:00:00-04:00',high:1.09595,low:1.06455,open:1.08358,close:1.06679},
            {ending:'2014-07-31T17:00:00-04:00',high:1.09286,low:1.06195,open:1.06679,close:1.09039},
            {ending:'2014-08-29T17:00:00-04:00',high:1.09967,low:1.08097,open:1.09039,close:1.08731},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.08197,open:1.08710,close:1.11942},
            {ending:'2014-10-31T17:00:00-04:00',high:1.13843,low:1.10704,open:1.11943,close:1.12661},
            {ending:'2014-11-28T17:00:00-05:00',high:1.14655,low:1.11896,open:1.12827,close:1.14119},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.13120,open:1.14272,close:1.16123}
        ]));
    });
    it("should estimate quarter", function() {
        return client.rollday({
            minutes: 30,
            interval: 'quarter',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2015-01-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 4).should.be.like([
            {ending:'2014-03-31T17:00:00-04:00',high:1.12775,low:1.05874,open:1.06321,close:1.10482},
            {ending:'2014-06-30T17:00:00-04:00',high:1.10693,low:1.06455,open:1.10480,close:1.06679},
            {ending:'2014-09-30T17:00:00-04:00',high:1.12185,low:1.06195,open:1.06679,close:1.11942},
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.10704,open:1.11943,close:1.16123}
        ]));
    });
    it("should estimate year", function() {
        return client.rollday({
            minutes: 30,
            interval: 'year',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2015-01-01',
            marketOpensAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
        }).should.eventually.be.like(results => results.slice(0, 1).should.be.like([
            {ending:'2014-12-31T17:00:00-05:00',high:1.16724,low:1.05874,open:1.06321,close:1.16123}
        ]));
    });
});
