// quote.spec.js
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');

var about = expected => actual => actual.should.be.closeTo(expected,0.000000001);

describe("quote", function() {
    this.timeout(30000);
    var tz = 'America/New_York';
    var fetch, quote;
    before(function() {
        config('config', path.resolve(__dirname, 'etc/ptrading.json'));
        config('prefix', createTempDir('quotes'));
        config(['iqfeed','enabled'], false);
        config(['yahoo','enabled'], false);
        config(['files','enabled'], true);
        config(['files','dirname'], path.resolve(__dirname, 'var'));
        fetch = Fetch();
        quote = Quote(fetch);
    });
    after(function() {
        config.unset('prefix');
        return Promise.all([
            quote.close(),
            fetch.close()
        ]);
    });
    it("should return daily", function() {
        return quote({
            columns: 'day.ending',
            symbol: 'YHOO',
            exchange: 'NASDAQ',
            begin: moment.tz('2014-01-01', tz),
            end: moment.tz('2014-02-01', tz)
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
    it("should return weekly", function() {
        return quote({
            columns: 'week.ending',
            symbol: 'YHOO',
            exchange: 'NASDAQ',
            begin: moment.tz('2014-01-06', tz),
            end: moment.tz('2014-02-01', tz)
        }).should.eventually.be.like(results => results.should.be.like([
            {ending:'2014-01-10T16:00:00-05:00'},
            {ending:'2014-01-17T16:00:00-05:00'},
            {ending:'2014-01-24T16:00:00-05:00'},
            {ending:'2014-01-31T16:00:00-05:00'}
        ]));
    });
    it("should return monthly", function() {
        return quote({
            columns: 'month.ending',
            symbol: 'YHOO',
            exchange: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz),
            end: moment.tz('2014-02-01', tz)
        }).should.eventually.be.like(results => results.slice(-4).should.be.like([
            {ending:'2013-10-31T16:00:00-04:00'},
            {ending:'2013-11-29T16:00:00-05:00'},
            {ending:'2013-12-31T16:00:00-05:00'},
            {ending:'2014-01-31T16:00:00-05:00'}
        ]));
    });
    it("should return 30 minute intervals", function() {
        return quote({
            columns: 'ending,m30.open,m30.high,m30.low,m30.close',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
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
        return quote({
            interval: 'm10',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T10:10:00-0500'),
            end: moment('2014-03-03T11:00:00-0500')
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
        return quote({
            interval: 'm1',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T10:01:00-0500'),
            end: moment('2014-03-03T10:30:00-0500')
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
    it("should update partial blocks", function() {
        config('files.dirname', path.resolve(__dirname, 'partial'));
        return quote({
            columns: [
                'DATE(day.ending) AS "Date"',
                'day.close AS "Close"',
                '(day.close - OFFSET(1, day.close)) *100 / day.close AS "Change"'
            ].join(','),
            symbol: 'IBM',
            exchange: 'NYSE',
            begin: moment.tz('2009-12-01', tz),
            end: moment.tz('2010-02-01', tz)
        }).then(() => {
            config('files.dirname', path.resolve(__dirname, 'var'));
            return quote({
                columns: [
                    'DATE(day.ending) AS "Date"',
                    'day.close AS "Close"',
                    '(day.close - OFFSET(1, day.close)) *100 / OFFSET(1, day.close) AS "Change"'
                ].join(','),
                symbol: 'IBM',
                exchange: 'NYSE',
                begin: moment.tz('2009-12-01', tz),
                end: moment.tz('2010-03-01', tz),
            });
        }).should.eventually.be.like([
            {Date:'2009-12-01',Close:127.94,Change:about(1.2584091808)},
            {Date:'2009-12-02',Close:127.21,Change:about(-0.5705799594)},
            {Date:'2009-12-03',Close:127.55,Change:about(0.2672745853)},
            {Date:'2009-12-04',Close:127.25,Change:about(-0.2352018816)},
            {Date:'2009-12-07',Close:127.04,Change:about(-0.1650294695)},
            {Date:'2009-12-08',Close:126.80,Change:about(-0.1889168766)},
            {Date:'2009-12-09',Close:128.39,Change:about(1.2539432177)},
            {Date:'2009-12-10',Close:129.34,Change:about(0.7399330166)},
            {Date:'2009-12-11',Close:129.68,Change:about(0.2628730478)},
            {Date:'2009-12-14',Close:129.93,Change:about(0.1927822332)},
            {Date:'2009-12-15',Close:128.49,Change:about(-1.1082890787)},
            {Date:'2009-12-16',Close:128.71,Change:about(0.1712195502)},
            {Date:'2009-12-17',Close:127.40,Change:about(-1.0177919354)},
            {Date:'2009-12-18',Close:127.91,Change:about(0.4003139717)},
            {Date:'2009-12-21',Close:128.65,Change:about(0.5785317802)},
            {Date:'2009-12-22',Close:129.93,Change:about(0.9949475321)},
            {Date:'2009-12-23',Close:130.00,Change:about(0.0538751635)},
            {Date:'2009-12-24',Close:130.57,Change:about(0.4384615385)},
            {Date:'2009-12-28',Close:132.31,Change:about(1.3326185188)},
            {Date:'2009-12-29',Close:131.85,Change:about(-0.3476683546)},
            {Date:'2009-12-30',Close:132.57,Change:about(0.5460750853)},
            {Date:'2009-12-31',Close:130.90,Change:about(-1.2597118503)},
            {Date:'2010-01-04',Close:132.45,Change:about(1.1841100076)},
            {Date:'2010-01-05',Close:130.85,Change:about(-1.20800302)},
            {Date:'2010-01-06',Close:130.00,Change:about(-0.6495987772)},
            {Date:'2010-01-07',Close:129.55,Change:about(-0.3461538462)},
            {Date:'2010-01-08',Close:130.85,Change:about(1.0034735623)},
            {Date:'2010-01-11',Close:129.48,Change:about(-1.0470003821)},
            {Date:'2010-01-12',Close:130.51,Change:about(0.7954896509)},
            {Date:'2010-01-13',Close:130.23,Change:about(-0.2145429469)},
            {Date:'2010-01-14',Close:132.31,Change:about(1.5971742302)},
            {Date:'2010-01-15',Close:131.78,Change:about(-0.4005744086)},
            {Date:'2010-01-19',Close:134.14,Change:about(1.7908635605)},
            {Date:'2010-01-20',Close:130.25,Change:about(-2.8999552706)},
            {Date:'2010-01-21',Close:129.00,Change:about(-0.9596928983)},
            {Date:'2010-01-22',Close:125.50,Change:about(-2.7131782946)},
            {Date:'2010-01-25',Close:126.12,Change:about(0.4940239044)},
            {Date:'2010-01-26',Close:125.75,Change:about(-0.2933713923)},
            {Date:'2010-01-27',Close:126.33,Change:about(0.4612326044)},
            {Date:'2010-01-28',Close:123.75,Change:about(-2.0422702446)},
            {Date:'2010-01-29',Close:122.39,Change:about(-1.098989899)},
            {Date:'2010-02-01',Close:124.67,Change:about(1.8628972955)},
            {Date:'2010-02-02',Close:125.53,Change:about(0.6898211278)},
            {Date:'2010-02-03',Close:125.66,Change:about(0.1035609018)},
            {Date:'2010-02-04',Close:123.00,Change:about(-2.1168231736)},
            {Date:'2010-02-05',Close:123.52,Change:about(0.4227642276)},
            {Date:'2010-02-08',Close:121.88,Change:about(-1.3277202073)},
            {Date:'2010-02-09',Close:123.21,Change:about(1.0912372826)},
            {Date:'2010-02-10',Close:122.81,Change:about(-0.3246489733)},
            {Date:'2010-02-11',Close:123.73,Change:about(0.7491246641)},
            {Date:'2010-02-12',Close:124.00,Change:about(0.2182170856)},
            {Date:'2010-02-16',Close:125.23,Change:about(0.9919354839)},
            {Date:'2010-02-17',Close:126.33,Change:about(0.8783837739)},
            {Date:'2010-02-18',Close:127.81,Change:about(1.171534869)},
            {Date:'2010-02-19',Close:127.19,Change:about(-0.485095063)},
            {Date:'2010-02-22',Close:126.85,Change:about(-0.2673166129)},
            {Date:'2010-02-23',Close:126.46,Change:about(-0.3074497438)},
            {Date:'2010-02-24',Close:127.59,Change:about(0.893563182)},
            {Date:'2010-02-25',Close:127.07,Change:about(-0.4075554511)},
            {Date:'2010-02-26',Close:127.16,Change:about(0.0708271032)}

        ]);
    });
    it("should fix incompatible partial blocks", function() {
        config('files.dirname', path.resolve(__dirname, 'partial'));
        return quote({
            columns: [
                'DATE(day.ending) AS "Date"',
                'day.close AS "Close"',
                '(day.close - OFFSET(1, day.close)) *100 / day.close AS "Change"'
            ].join(','),
            symbol: 'DIS',
            exchange: 'NYSE',
            begin: moment.tz('2016-11-01', tz),
            end: moment.tz('2016-12-01', tz)
        }).then(wrong => {
            _.first(wrong).should.be.like(
                {Date:"2016-11-01",Close:57.19,Change:-2.3955236929533217}
            );
        }).then(() => {
            config('files.dirname', path.resolve(__dirname, 'var'));
            return quote({
                columns: [
                    'DATE(day.ending) AS "Date"',
                    'day.close AS "Close"',
                    '(day.close - OFFSET(1, day.close)) *100 / OFFSET(1, day.close) AS "Change"'
                ].join(','),
                symbol: 'DIS',
                exchange: 'NYSE',
                begin: moment.tz('2016-11-01', tz),
                end: moment.tz('2016-12-31', tz),
            });
        }).should.eventually.be.like([
            {Date:"2016-11-01",Close:92.39,Change:-0.3236595101952715},
            {Date:"2016-11-02",Close:91.91,Change:-0.51953674640113},
            {Date:"2016-11-03",Close:93.37,Change:1.5885104994015973},
            {Date:"2016-11-04",Close:92.45,Change:-0.9853271928885099},
            {Date:"2016-11-07",Close:94.43,Change:2.1416982152514916},
            {Date:"2016-11-08",Close:94.38,Change:-0.05294927459495009},
            {Date:"2016-11-09",Close:94.64,Change:0.2754820936639173},
            {Date:"2016-11-10",Close:94.96,Change:0.33812341504648474},
            {Date:"2016-11-11",Close:97.68,Change:2.864363942712735},
            {Date:"2016-11-14",Close:97.92,Change:0.24570024570024043},
            {Date:"2016-11-15",Close:97.7,Change:-0.22467320261437793},
            {Date:"2016-11-16",Close:99.12,Change:1.4534288638689885},
            {Date:"2016-11-17",Close:99.37,Change:0.2522195318805488},
            {Date:"2016-11-18",Close:98.24,Change:-1.1371641340444898},
            {Date:"2016-11-21",Close:97.63,Change:-0.6209283387622144},
            {Date:"2016-11-22",Close:97.71,Change:0.08194202601659152},
            {Date:"2016-11-23",Close:98.26,Change:0.5628901852420545},
            {Date:"2016-11-25",Close:98.82,Change:0.5699165479340403},
            {Date:"2016-11-28",Close:98.97,Change:0.15179113539769853},
            {Date:"2016-11-29",Close:99.67,Change:0.7072850358694582},
            {Date:"2016-11-30",Close:99.12,Change:-0.5518210093307887},
            {Date:"2016-12-01",Close:98.94,Change:-0.18159806295400202},
            {Date:"2016-12-02",Close:98.5,Change:-0.4447139680614491},
            {Date:"2016-12-05",Close:99.96,Change:1.4822335025380646},
            {Date:"2016-12-06",Close:100.66,Change:0.7002801120448208},
            {Date:"2016-12-07",Close:101.99,Change:1.3212795549374114},
            {Date:"2016-12-08",Close:103.38,Change:1.3628787135993732},
            {Date:"2016-12-09",Close:104.86,Change:1.4316115302766532},
            {Date:"2016-12-12",Close:104.06,Change:-0.7629219912263944},
            {Date:"2016-12-13",Close:103.85,Change:-0.20180665000961748},
            {Date:"2016-12-14",Close:104.05,Change:0.19258545979778802},
            {Date:"2016-12-15",Close:104.39,Change:0.326765977895246},
            {Date:"2016-12-16",Close:103.91,Change:-0.45981415844429924},
            {Date:"2016-12-19",Close:105.3,Change:1.3376960831488793},
            {Date:"2016-12-20",Close:105.46,Change:0.15194681861348205},
            {Date:"2016-12-21",Close:105.56,Change:0.09482268158544332},
            {Date:"2016-12-22",Close:105.42,Change:-0.13262599469496075},
            {Date:"2016-12-23",Close:105.15,Change:-0.25611838360841965},
            {Date:"2016-12-27",Close:105.17,Change:0.019020446980500257},
            {Date:"2016-12-28",Close:104.3,Change:-0.8272321004088662},
            {Date:"2016-12-29",Close:104.56,Change:0.24928092042186492},
            {Date:"2016-12-30",Close:104.22,Change:-0.3251721499617477}
        ]);
    });
    it("should load the last 100 days", function() {
        return quote({
            symbol: 'IBM',
            exchange: 'NYSE'
        }).should.eventually.be.an('array').and.lengthOf(100);
    });
    it("should pad end", function() {
        return quote({
            interval: 'day',
            symbol: 'YHOO',
            exchange: 'NASDAQ',
            begin: moment.tz('2014-01-01', tz),
            end: moment.tz('2014-01-01', tz),
            pad_end: 21,
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
    it("should eval change", function() {
        return quote({
            symbol: 'IBM',
            exchange: 'NYSE',
            begin: moment.tz('2010-01-04', tz),
            end: moment.tz('2010-01-30', tz),
            columns: 'symbol, exchange, DATE(ending) AS "Date",day.close AS "Close",(day.close - OFFSET(1, day.close))*100/OFFSET(1,day.close) AS "Change"'
        }).should.eventually.be.like([
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-04',Close:132.45,Change:about(1.184110008)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-05',Close:130.85,Change:about(-1.20800302)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-06',Close:130,Change:about(-0.6495987772)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-07',Close:129.55,Change:about(-0.3461538462)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-08',Close:130.85,Change:about(1.0034735623)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-11',Close:129.48,Change:about(-1.0470003821)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-12',Close:130.51,Change:about(0.7954896509)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-13',Close:130.23,Change:about(-0.2145429469)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-14',Close:132.31,Change:about(1.5971742302)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-15',Close:131.78,Change:about(-0.4005744086)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-19',Close:134.14,Change:about(1.7908635605)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-20',Close:130.25,Change:about(-2.8999552706)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-21',Close:129,Change:about(-0.9596928983)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-22',Close:125.5,Change:about(-2.7131782946)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-25',Close:126.12,Change:about(0.4940239044)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-26',Close:125.75,Change:about(-0.2933713923)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-27',Close:126.33,Change:about(0.4612326044)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-28',Close:123.75,Change:about(-2.0422702446)},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-29',Close:122.39,Change:about(-1.098989899)}
        ]);
    });
    it("should combine intervals", function() {
        return quote({
            columns: [
                'DATE(m30.ending) AS "Date"',
                'TIME(m30.ending) AS "Time"',
                'm30.close AS "Price"',
                '(m30.close - day.close)*100/day.close AS "Change"'
            ].join(','),
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:30:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:about(0.3289949385)},
            {Date:'2014-03-03',Time:'09:00:00',Price:1.10879,Change:about(0.2160159074)},
            {Date:'2014-03-03',Time:'09:30:00',Price:1.10824,Change:about(0.1663051338)},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:about(0.2575921909)},
            {Date:'2014-03-03',Time:'10:30:00',Price:1.10819,Change:about(0.1617859725)},
            {Date:'2014-03-03',Time:'11:00:00',Price:1.10789,Change:about(0.1346710051)},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:about(0.1916124367)},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:about(0.2349963847)},
            {Date:'2014-03-03',Time:'12:30:00',Price:1.10841,Change:about(0.181670282)},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:about(0.3172451193)},
            {Date:'2014-03-03',Time:'13:30:00',Price:1.10966,Change:about(0.2946493131)},
            {Date:'2014-03-03',Time:'14:00:00',Price:1.10949,Change:about(0.2792841649)},
            {Date:'2014-03-03',Time:'14:30:00',Price:1.10846,Change:about(0.1861894432)},
            {Date:'2014-03-03',Time:'15:00:00',Price:1.10833,Change:about(0.174439624)},
            {Date:'2014-03-03',Time:'15:30:00',Price:1.10793,Change:about(0.1382863341)},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:about(0.1726319595)},
            {Date:'2014-03-03',Time:'16:30:00',Price:1.10761,Change:about(0.1093637021)},
            {Date:'2014-03-03',Time:'17:00:00',Price:1.10749,Change:0},
            {Date:'2014-03-03',Time:'17:30:00',Price:1.10758,Change:about((1.10758-1.10749)*100/1.10749)}
        ]);
    });
    it("should combine intervals conditionally", function() {
        return quote({
            columns: [
                'DATE(m30.ending) AS "Date"',
                'TIME(m30.ending) AS "Time"',
                'm30.close AS "Price"',
                'CHANGE(m30.close, IF(TIME(day.ending)=TIME(m30.ending),OFFSET(1,day.close),day.close)) AS "Change"'
            ].join(','),
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:30:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:about(0.3289949385)},
            {Date:'2014-03-03',Time:'09:00:00',Price:1.10879,Change:about(0.2160159074)},
            {Date:'2014-03-03',Time:'09:30:00',Price:1.10824,Change:about(0.1663051338)},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:about(0.2575921909)},
            {Date:'2014-03-03',Time:'10:30:00',Price:1.10819,Change:about(0.1617859725)},
            {Date:'2014-03-03',Time:'11:00:00',Price:1.10789,Change:about(0.1346710051)},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:about(0.1916124367)},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:about(0.2349963847)},
            {Date:'2014-03-03',Time:'12:30:00',Price:1.10841,Change:about(0.181670282)},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:about(0.3172451193)},
            {Date:'2014-03-03',Time:'13:30:00',Price:1.10966,Change:about(0.2946493131)},
            {Date:'2014-03-03',Time:'14:00:00',Price:1.10949,Change:about(0.2792841649)},
            {Date:'2014-03-03',Time:'14:30:00',Price:1.10846,Change:about(0.1861894432)},
            {Date:'2014-03-03',Time:'15:00:00',Price:1.10833,Change:about(0.174439624)},
            {Date:'2014-03-03',Time:'15:30:00',Price:1.10793,Change:about(0.1382863341)},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:about(0.1726319595)},
            {Date:'2014-03-03',Time:'16:30:00',Price:1.10761,Change:about(0.1093637021)},
            {Date:'2014-03-03',Time:'17:00:00',Price:1.10749,Change:about((1.10749-1.1064)*100/1.1064)},
            {Date:'2014-03-03',Time:'17:30:00',Price:1.10758,Change:about((1.10758-1.10749)*100/1.10749)}
        ]);
    });
    it("should compute YTD", function() {
        return quote({
            columns: [
                'DATE(m30.ending) AS "Date"',
                'TIME(m30.ending) AS "Time"',
                'm30.close AS "Price"',
                '(m30.close - year.close)*100/year.close AS "YTD"'
            ].join(','),
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,YTD:about(4.3820055668)},
            {Date:'2014-03-03',Time:'09:00:00',Price:1.10879,YTD:about(4.2644624991)},
            {Date:'2014-03-03',Time:'09:30:00',Price:1.10824,YTD:about(4.2127435492)},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,YTD:about(4.3077183480)},
            {Date:'2014-03-03',Time:'10:30:00',Price:1.10819,YTD:about(4.2080418265)},
            {Date:'2014-03-03',Time:'11:00:00',Price:1.10789,YTD:about(4.1798314903)},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,YTD:about(4.2390731964)},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,YTD:about(4.2842097344)},
            {Date:'2014-03-03',Time:'12:30:00',Price:1.10841,YTD:about(4.2287294065)},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,YTD:about(4.3697810878)},
            {Date:'2014-03-03',Time:'13:30:00',Price:1.10966,YTD:about(4.3462724742)},
            {Date:'2014-03-03',Time:'14:00:00',Price:1.10949,YTD:about(4.3302866170)},
            {Date:'2014-03-03',Time:'14:30:00',Price:1.10846,YTD:about(4.2334311292)},
            {Date:'2014-03-03',Time:'15:00:00',Price:1.10833,YTD:about(4.2212066501)},
            {Date:'2014-03-03',Time:'15:30:00',Price:1.10793,YTD:about(4.1835928684)},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,YTD:about(4.2193259610)},
            {Date:'2014-03-03',Time:'16:30:00',Price:1.10761,YTD:about(4.1535018431)},
            {Date:'2014-03-03',Time:'17:00:00',Price:1.10749,YTD:about(4.1422177086)}

        ]);
    });
    it("should filter out results", function() {
        return quote({
            columns: [
                'DATE(m30.ending) AS "Date"',
                'TIME(m30.ending) AS "Time"',
                'm30.close AS "Price"',
                '(m30.close - day.close)*100/day.close AS "Change"'
            ].join(','),
            criteria: 'm30.close > OFFSET(1, m30.close)',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:about(0.3289949385)},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:about(0.2575921909)},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:about(0.1916124367)},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:about(0.2349963847)},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:about(0.3172451193)},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:about(0.1726319595)}
        ]);
    });
    it("should filter out most results", function() {
        return quote({
            columns: [
                'DATE(m30.ending) AS "Date"',
                'TIME(m30.ending) AS "Time"',
                'm30.close AS "Price"'
            ].join(','),
            criteria: 'WORKDAY(month.ending) = WORKDAY(day.ending) and HOUR(m30.ending) = 12',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-01-01T08:30:00-0500'),
            end: moment('2014-12-31T17:00:00-0500')
        }).should.eventually.be.like([
            {Date: "2014-01-02", Time: "12:00:00", Price: 1.06335},
            {Date: "2014-02-03", Time: "12:00:00", Price: 1.10735},
            {Date: "2014-03-03", Time: "12:00:00", Price: 1.10900},
            {Date: "2014-04-01", Time: "12:00:00", Price: 1.10250},
            {Date: "2014-05-01", Time: "12:00:00", Price: 1.09639},
            {Date: "2014-06-02", Time: "12:00:00", Price: 1.08934},
            {Date: "2014-07-01", Time: "12:00:00", Price: 1.06521},
            {Date: "2014-08-01", Time: "12:00:00", Price: 1.09177},
            {Date: "2014-09-01", Time: "12:00:00", Price: 1.08609},
            {Date: "2014-10-01", Time: "12:00:00", Price: 1.11706},
            {Date: "2014-11-03", Time: "12:00:00", Price: 1.13188},
            {Date: "2014-12-01", Time: "12:00:00", Price: 1.13436}
        ]);
    });
    it("should filter out most results using opening criteria", function() {
        return quote({
            columns: [
                'DATE(m30.ending) AS "Date"',
                'TIME(m30.ending) AS "Time"',
                'm30.close AS "Price"'
            ].join(','),
            criteria: [
                'WORKDAY(month.ending) = WORKDAY(day.ending)',
                'OPENING(HOUR(m60.ending)) = 12',
                'm30.close >= OFFSET(1,m30.close)'
            ].join(' and '),
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-01-01T08:30:00-0500'),
            end: moment('2014-12-31T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:"2014-01-02",Time:"12:30:00",Price:1.06356},
            {Date:"2014-01-02",Time:"13:00:00",Price:1.06393},
            {Date:"2014-01-02",Time:"13:30:00",Price:1.06394},
            {Date:"2014-01-02",Time:"14:00:00",Price:1.06515},
            {Date:"2014-01-02",Time:"14:30:00",Price:1.06544},
            {Date:"2014-01-02",Time:"15:00:00",Price:1.0661},
            {Date:"2014-01-02",Time:"15:30:00",Price:1.0662},
            {Date:"2014-01-02",Time:"16:00:00",Price:1.06721},
            {Date:"2014-02-03",Time:"12:00:00",Price:1.10735},
            {Date:"2014-02-03",Time:"12:30:00",Price:1.10895},
            {Date:"2014-02-03",Time:"13:00:00",Price:1.10933},
            {Date:"2014-02-03",Time:"13:30:00",Price:1.10964},
            {Date:"2014-02-03",Time:"14:00:00",Price:1.11},
            {Date:"2014-03-03",Time:"12:00:00",Price:1.109},
            {Date:"2014-04-01",Time:"12:00:00",Price:1.1025},
            {Date:"2014-06-02",Time:"12:30:00",Price:1.09025},
            {Date:"2014-07-01",Time:"12:00:00",Price:1.06521},
            {Date:"2014-08-01",Time:"12:00:00",Price:1.09177},
            {Date:"2014-09-01",Time:"12:30:00",Price:1.08626},
            {Date:"2014-11-03",Time:"12:00:00",Price:1.13188},
            {Date:"2014-11-03",Time:"12:30:00",Price:1.13363},
            {Date:"2014-11-03",Time:"13:00:00",Price:1.13378},
            {Date:"2014-11-03",Time:"13:30:00",Price:1.13521}
        ]);
    });
});
