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

describe("quote", function() {
    this.timeout(30000);
    var tz = 'America/New_York';
    var fetch, quote;
    before(function() {
        config.load(path.resolve(__dirname, 'etc/ptrading.json'));
        config('prefix', createTempDir('quotes'));
        config('iqfeed.enabled', false);
        config('google.enabled', false);
        config('yahoo.enabled', false);
        config('files.enabled', true);
    });
    beforeEach(function() {
        config('files.dirname', path.resolve(__dirname, 'var'));
        fetch = Fetch();
        quote = Quote(fetch);
    });
    afterEach(function() {
        return Promise.all([
            quote.close(),
            fetch.close()
        ]);
    });
    after(function() {
        config.unset('prefix');
        config.unset('iqfeed.enabled');
        config.unset('google.enabled');
        config.unset('yahoo.enabled');
        config.unset('files.enabled');
        config.unset('files.dirname');
    });
    it("should return daily", function() {
        return quote({
            columns: {ending: 'day.ending'},
            symbol: 'AABA',
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
            columns: {ending: 'week.ending'},
            symbol: 'AABA',
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
            columns: {ending:'month.ending'},
            symbol: 'AABA',
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
    it("should return weekly and monthly", function() {
        return quote({
            symbol: 'AABA',
            exchange: 'NASDAQ',
            columns: {
                day: 'DATE(day.ending)',
                close: 'day.close',
                last_week: 'DATE(week.ending)',
                last_month: 'DATE(month.ending)',
                last2_month: 'OFFSET(1,month.close)'
            },
            begin: '2013-10-30',
            end: '2013-12-10'
        }).should.eventually.be.like(results => results.should.be.like([
            {day:"2013-10-30",close:32.57,last_week:"2013-10-25",last_month:"2013-09-30",last2_month:27.12},
            {day:"2013-10-31",close:32.94,last_week:"2013-10-25",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-01",close:33.18,last_week:"2013-11-01",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-04",close:33.19,last_week:"2013-11-01",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-05",close:32.97,last_week:"2013-11-01",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-06",close:32.88,last_week:"2013-11-01",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-07",close:32.11,last_week:"2013-11-01",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-08",close:33.12,last_week:"2013-11-08",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-11",close:33.82,last_week:"2013-11-08",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-12",close:34.07,last_week:"2013-11-08",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-13",close:35.1,last_week:"2013-11-08",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-14",close:35.69,last_week:"2013-11-08",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-15",close:35.47,last_week:"2013-11-15",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-18",close:34.98,last_week:"2013-11-15",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-19",close:34.63,last_week:"2013-11-15",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-20",close:35.62,last_week:"2013-11-15",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-21",close:36.3,last_week:"2013-11-15",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-22",close:36.49,last_week:"2013-11-22",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-25",close:36.29,last_week:"2013-11-22",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-26",close:36.64,last_week:"2013-11-22",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-27",close:36.96,last_week:"2013-11-22",last_month:"2013-10-31",last2_month:33.17},
            {day:"2013-11-29",close:36.98,last_week:"2013-11-29",last_month:"2013-11-29",last2_month:32.94},
            {day:"2013-12-02",close:37.01,last_week:"2013-11-29",last_month:"2013-11-29",last2_month:32.94},
            {day:"2013-12-03",close:36.56,last_week:"2013-11-29",last_month:"2013-11-29",last2_month:32.94},
            {day:"2013-12-04",close:38.13,last_week:"2013-11-29",last_month:"2013-11-29",last2_month:32.94},
            {day:"2013-12-05",close:38.87,last_week:"2013-11-29",last_month:"2013-11-29",last2_month:32.94},
            {day:"2013-12-06",close:38.86,last_week:"2013-12-06",last_month:"2013-11-29",last2_month:32.94},
            {day:"2013-12-09",close:38.87,last_week:"2013-12-06",last_month:"2013-11-29",last2_month:32.94}
        ]));
    });
    it("should return 30 minute intervals", function() {
        return quote({
            interval: 'm30',
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
        fetch.close();
        quote.close();
        fetch = Fetch();
        quote = Quote(fetch);
        return quote({
            columns: {
                Date: 'DATE(day.ending)',
                Close: 'day.close',
                Change: '(day.close - OFFSET(1, day.close)) *100 / day.close',
                incomplete: 'day.incomplete'
            },
            symbol: 'IBM',
            exchange: 'NYSE',
            begin: moment.tz('2009-12-01', tz),
            end: moment.tz('2010-02-01', tz)
        }).then(partial => {
            _.first(partial).should.have.property('incomplete').that.is.not.ok;
            _.last(partial).should.have.property('incomplete').that.is.ok;
        }).then(() => {
            config('files.dirname', path.resolve(__dirname, 'var'));
            fetch.close();
            quote.close();
            fetch = Fetch();
            quote = Quote(fetch);
            return quote({
                columns: {
                    Date: 'DATE(day.ending)',
                    Close: 'day.close',
                    Change: '(day.close - OFFSET(1, day.close)) *100 / OFFSET(1, day.close)'
                },
                symbol: 'IBM',
                exchange: 'NYSE',
                begin: moment.tz('2009-12-01', tz),
                end: moment.tz('2010-03-01', tz),
            });
        }).should.eventually.be.like([
            {Date:'2009-12-01',Close:127.94,Change:1.2584},
            {Date:'2009-12-02',Close:127.21,Change:-0.5705},
            {Date:'2009-12-03',Close:127.55,Change:0.2672},
            {Date:'2009-12-04',Close:127.25,Change:-0.2352},
            {Date:'2009-12-07',Close:127.04,Change:-0.1650},
            {Date:'2009-12-08',Close:126.80,Change:-0.1889},
            {Date:'2009-12-09',Close:128.39,Change:1.2539},
            {Date:'2009-12-10',Close:129.34,Change:0.7399},
            {Date:'2009-12-11',Close:129.68,Change:0.2628},
            {Date:'2009-12-14',Close:129.93,Change:0.1927},
            {Date:'2009-12-15',Close:128.49,Change:-1.1082},
            {Date:'2009-12-16',Close:128.71,Change:0.1712},
            {Date:'2009-12-17',Close:127.40,Change:-1.0177},
            {Date:'2009-12-18',Close:127.91,Change:0.4003},
            {Date:'2009-12-21',Close:128.65,Change:0.5785},
            {Date:'2009-12-22',Close:129.93,Change:0.9949},
            {Date:'2009-12-23',Close:130.00,Change:0.0538},
            {Date:'2009-12-24',Close:130.57,Change:0.4384},
            {Date:'2009-12-28',Close:132.31,Change:1.3326},
            {Date:'2009-12-29',Close:131.85,Change:-0.3476},
            {Date:'2009-12-30',Close:132.57,Change:0.5460},
            {Date:'2009-12-31',Close:130.90,Change:-1.2597},
            {Date:'2010-01-04',Close:132.45,Change:1.1841},
            {Date:'2010-01-05',Close:130.85,Change:-1.2080},
            {Date:'2010-01-06',Close:130.00,Change:-0.6495},
            {Date:'2010-01-07',Close:129.55,Change:-0.3461},
            {Date:'2010-01-08',Close:130.85,Change:1.0034},
            {Date:'2010-01-11',Close:129.48,Change:-1.0470},
            {Date:'2010-01-12',Close:130.51,Change:0.7954},
            {Date:'2010-01-13',Close:130.23,Change:-0.2145},
            {Date:'2010-01-14',Close:132.31,Change:1.5971},
            {Date:'2010-01-15',Close:131.78,Change:-0.4005},
            {Date:'2010-01-19',Close:134.14,Change:1.7908},
            {Date:'2010-01-20',Close:130.25,Change:-2.8999},
            {Date:'2010-01-21',Close:129.00,Change:-0.9596},
            {Date:'2010-01-22',Close:125.50,Change:-2.7131},
            {Date:'2010-01-25',Close:126.12,Change:0.4940},
            {Date:'2010-01-26',Close:125.75,Change:-0.2933},
            {Date:'2010-01-27',Close:126.33,Change:0.4612},
            {Date:'2010-01-28',Close:123.75,Change:-2.0422},
            {Date:'2010-01-29',Close:122.39,Change:-1.0989},
            {Date:'2010-02-01',Close:124.67,Change:1.8628},
            {Date:'2010-02-02',Close:125.53,Change:0.6898},
            {Date:'2010-02-03',Close:125.66,Change:0.1035},
            {Date:'2010-02-04',Close:123.00,Change:-2.1168},
            {Date:'2010-02-05',Close:123.52,Change:0.4227},
            {Date:'2010-02-08',Close:121.88,Change:-1.3277},
            {Date:'2010-02-09',Close:123.21,Change:1.0912},
            {Date:'2010-02-10',Close:122.81,Change:-0.3246},
            {Date:'2010-02-11',Close:123.73,Change:0.7491},
            {Date:'2010-02-12',Close:124.00,Change:0.2182},
            {Date:'2010-02-16',Close:125.23,Change:0.9919},
            {Date:'2010-02-17',Close:126.33,Change:0.8783},
            {Date:'2010-02-18',Close:127.81,Change:1.1715},
            {Date:'2010-02-19',Close:127.19,Change:-0.4850},
            {Date:'2010-02-22',Close:126.85,Change:-0.2673},
            {Date:'2010-02-23',Close:126.46,Change:-0.3074},
            {Date:'2010-02-24',Close:127.59,Change:0.8935},
            {Date:'2010-02-25',Close:127.07,Change:-0.4075},
            {Date:'2010-02-26',Close:127.16,Change:0.0708}

        ]);
    });
    it("should fix incompatible partial blocks", function() {
        config('files.dirname', path.resolve(__dirname, 'partial'));
        fetch.close();
        quote.close();
        fetch = Fetch();
        quote = Quote(fetch);
        return quote({
            columns: {
                Date: 'DATE(day.ending)',
                Close: 'day.close',
                Change: 'CHANGE(day.adj_close, OFFSET(1, day.adj_close))'
            },
            symbol: 'DIS',
            exchange: 'NYSE',
            begin: moment.tz('2016-12-01', tz),
            end: moment.tz('2016-12-08', tz).endOf('day')
        }).then(wrong => {
            _.last(wrong).should.be.like(
                {Date:"2016-12-08",Close:103.38,Change:1.36}
            );
        }).then(() => {
            config('files.dirname', path.resolve(__dirname, 'var'));
            fetch.close();
            quote.close();
            fetch = Fetch();
            quote = Quote(fetch);
            return quote({
                columns: {
                    Date: 'DATE(day.ending)',
                    Close: 'day.close',
                    Change: 'CHANGE(day.adj_close, OFFSET(1, day.adj_close))'
                },
                symbol: 'DIS',
                exchange: 'NYSE',
                begin: moment.tz('2016-12-01', tz),
                end: moment.tz('2016-12-31', tz),
            });
        }).should.eventually.be.like([
            {Date:"2016-12-01",Close:98.94,Change:-0.18},
            {Date:"2016-12-02",Close:98.5,Change:-0.44},
            {Date:"2016-12-05",Close:99.96,Change:1.48},
            {Date:"2016-12-06",Close:100.66,Change:0.70},
            {Date:"2016-12-07",Close:101.99,Change:1.32},
            {Date:"2016-12-08",Close:103.38,Change:2.14},
            {Date:"2016-12-09",Close:104.86,Change:1.43},
            {Date:"2016-12-12",Close:104.06,Change:-0.76},
            {Date:"2016-12-13",Close:103.85,Change:-0.20},
            {Date:"2016-12-14",Close:104.05,Change:0.19},
            {Date:"2016-12-15",Close:104.39,Change:0.33},
            {Date:"2016-12-16",Close:103.91,Change:-0.46},
            {Date:"2016-12-19",Close:105.3,Change:1.34},
            {Date:"2016-12-20",Close:105.46,Change:0.15},
            {Date:"2016-12-21",Close:105.56,Change:0.09},
            {Date:"2016-12-22",Close:105.42,Change:-0.13},
            {Date:"2016-12-23",Close:105.15,Change:-0.26},
            {Date:"2016-12-27",Close:105.17,Change:0.02},
            {Date:"2016-12-28",Close:104.3,Change:-0.83},
            {Date:"2016-12-29",Close:104.56,Change:0.25},
            {Date:"2016-12-30",Close:104.22,Change:-0.33}
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
            symbol: 'AABA',
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
            columns: {
                symbol: 'symbol',
                exchange: 'exchange',
                Date: 'DATE(ending)',
                Close: 'day.close',
                Change: '(day.close - OFFSET(1, day.close))*100/OFFSET(1,day.close)'
            }
        }).should.eventually.be.like([
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-04',Close:132.45,Change:1.1841},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-05',Close:130.85,Change:-1.2080},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-06',Close:130,Change:-0.6495},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-07',Close:129.55,Change:-0.3461},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-08',Close:130.85,Change:1.0034},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-11',Close:129.48,Change:-1.0470},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-12',Close:130.51,Change:0.7954},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-13',Close:130.23,Change:-0.2145},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-14',Close:132.31,Change:1.5971},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-15',Close:131.78,Change:-0.4005},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-19',Close:134.14,Change:1.7908},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-20',Close:130.25,Change:-2.8999},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-21',Close:129,Change:-0.9596},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-22',Close:125.5,Change:-2.7131},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-25',Close:126.12,Change:0.4940},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-26',Close:125.75,Change:-0.2933},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-27',Close:126.33,Change:0.4612},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-28',Close:123.75,Change:-2.0422},
            {symbol:'IBM',exchange:'NYSE',Date:'2010-01-29',Close:122.39,Change:-1.0989}
        ]);
    });
    it("should combine intervals", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: '(m30.close - day.close)*100/day.close'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:30:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:0.3289},
            {Date:'2014-03-03',Time:'09:00:00',Price:1.10879,Change:0.2160},
            {Date:'2014-03-03',Time:'09:30:00',Price:1.10824,Change:0.1663},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:0.2575},
            {Date:'2014-03-03',Time:'10:30:00',Price:1.10819,Change:0.1617},
            {Date:'2014-03-03',Time:'11:00:00',Price:1.10789,Change:0.1346},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:0.1916},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:0.2349},
            {Date:'2014-03-03',Time:'12:30:00',Price:1.10841,Change:0.1816},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:0.3172},
            {Date:'2014-03-03',Time:'13:30:00',Price:1.10966,Change:0.2946},
            {Date:'2014-03-03',Time:'14:00:00',Price:1.10949,Change:0.2792},
            {Date:'2014-03-03',Time:'14:30:00',Price:1.10846,Change:0.1861},
            {Date:'2014-03-03',Time:'15:00:00',Price:1.10833,Change:0.1744},
            {Date:'2014-03-03',Time:'15:30:00',Price:1.10793,Change:0.1382},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:0.1726},
            {Date:'2014-03-03',Time:'16:30:00',Price:1.10761,Change:0.1093},
            {Date:'2014-03-03',Time:'17:00:00',Price:1.10749,Change:0},
            {Date:'2014-03-03',Time:'17:30:00',Price:1.10758,Change:0.0081}
        ]);
    });
    it("should combine intervals conditionally", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: 'CHANGE(m30.close, IF(TIME(day.ending)=TIME(m30.ending),OFFSET(1,day.close),day.close))'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:30:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:0.33},
            {Date:'2014-03-03',Time:'09:00:00',Price:1.10879,Change:0.22},
            {Date:'2014-03-03',Time:'09:30:00',Price:1.10824,Change:0.17},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:0.26},
            {Date:'2014-03-03',Time:'10:30:00',Price:1.10819,Change:0.16},
            {Date:'2014-03-03',Time:'11:00:00',Price:1.10789,Change:0.13},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:0.19},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:0.23},
            {Date:'2014-03-03',Time:'12:30:00',Price:1.10841,Change:0.18},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:0.32},
            {Date:'2014-03-03',Time:'13:30:00',Price:1.10966,Change:0.29},
            {Date:'2014-03-03',Time:'14:00:00',Price:1.10949,Change:0.28},
            {Date:'2014-03-03',Time:'14:30:00',Price:1.10846,Change:0.19},
            {Date:'2014-03-03',Time:'15:00:00',Price:1.10833,Change:0.17},
            {Date:'2014-03-03',Time:'15:30:00',Price:1.10793,Change:0.14},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:0.17},
            {Date:'2014-03-03',Time:'16:30:00',Price:1.10761,Change:0.11},
            {Date:'2014-03-03',Time:'17:00:00',Price:1.10749,Change:0.10},
            {Date:'2014-03-03',Time:'17:30:00',Price:1.10758,Change:0.01}
        ]);
    });
    it("should compute YTD", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                YTD: '(m30.close - year.close)*100/year.close'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:"2014-03-03",Time:"08:30:00",Price:1.11004,YTD:4.38},
            {Date:"2014-03-03",Time:"09:00:00",Price:1.10879,YTD:4.26},
            {Date:"2014-03-03",Time:"09:30:00",Price:1.10824,YTD:4.21},
            {Date:"2014-03-03",Time:"10:00:00",Price:1.10925,YTD:4.31},
            {Date:"2014-03-03",Time:"10:30:00",Price:1.10819,YTD:4.21},
            {Date:"2014-03-03",Time:"11:00:00",Price:1.10789,YTD:4.18},
            {Date:"2014-03-03",Time:"11:30:00",Price:1.10852,YTD:4.24},
            {Date:"2014-03-03",Time:"12:00:00",Price:1.10900,YTD:4.28},
            {Date:"2014-03-03",Time:"12:30:00",Price:1.10841,YTD:4.23},
            {Date:"2014-03-03",Time:"13:00:00",Price:1.10991,YTD:4.37},
            {Date:"2014-03-03",Time:"13:30:00",Price:1.10966,YTD:4.34},
            {Date:"2014-03-03",Time:"14:00:00",Price:1.10949,YTD:4.33},
            {Date:"2014-03-03",Time:"14:30:00",Price:1.10846,YTD:4.23},
            {Date:"2014-03-03",Time:"15:00:00",Price:1.10833,YTD:4.22},
            {Date:"2014-03-03",Time:"15:30:00",Price:1.10793,YTD:4.18},
            {Date:"2014-03-03",Time:"16:00:00",Price:1.10831,YTD:4.22},
            {Date:"2014-03-03",Time:"16:30:00",Price:1.10761,YTD:4.15},
            {Date:"2014-03-03",Time:"17:00:00",Price:1.10749,YTD:4.14}

        ]);
    });
    it("should not allow NOW() in lookback functions", function() {
        return quote({
            columns: {
                previously: "OFFSET(1, DAYS(NOW(), day.ending))"
            },
            symbol: 'IBM',
            exchange: 'NYSE',
            begin: "2010-01-05",
            end: "2010-01-06",
            now: "2010-01-08T16:00:00"
        }).should.be.rejected;
    });
    it("should not cache NOW() result", function() {
        return quote({
            columns: {
                previously: "DAYS(NOW(), day.ending)"
            },
            symbol: 'IBM',
            exchange: 'NYSE',
            begin: "2010-01-05",
            end: "2010-01-06",
            now: "2010-01-08T16:00:00"
        }).then(result=>result[0].previously).then(previously => quote({
            columns: {
                currently: "DAYS(NOW(), day.ending)",
                previously: "previously"
            },
            parameters: {
                previously: previously
            },
            symbol: 'IBM',
            exchange: 'NYSE',
            begin: "2010-01-05",
            end: "2010-01-06",
            now: "2010-01-15T16:00:00"
        })).should.eventually.be.like([
            {currently: 10, previously: 3}
        ]);
    });
    it("should detect circular reference", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: 'CHANGE(Price, Another)',
                Another: 'day.close * (1 + Change)'
            },
            criteria: 'Price > OFFSET(1, Price)',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.be.rejected;
    });
    it("should filter out results", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: '(m30.close - day.close)*100/day.close'
            },
            criteria: 'm30.close > OFFSET(1, m30.close)',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:0.3289},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:0.2575},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:0.1916},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:0.2349},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:0.3172},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:0.1726}
        ]);
    });
    it("should filter out results using columns", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: 'CHANGE(Price, day.close)'
            },
            criteria: 'Price > OFFSET(1, Price)',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:0.33},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:0.26},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:0.19},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:0.23},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:0.32},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:0.17}
        ]);
    });
    it("should filter out results using variables", function() {
        return quote({
            variables: {
                pcls: 'OFFSET(1, m30.close)'
            },
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: 'CHANGE(Price, day.close)'
            },
            criteria: 'Price > pcls',
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:0.33},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:0.26},
            {Date:'2014-03-03',Time:'11:30:00',Price:1.10852,Change:0.19},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:0.23},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:0.32},
            {Date:'2014-03-03',Time:'16:00:00',Price:1.10831,Change:0.17}
        ]);
    });
    it("should read parameters", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close',
                Change: 'CHANGE(Price, day.close)'
            },
            criteria: 'Change >= minimum',
            parameters: {
                minimum: 0.2
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-03-03T08:30:00-0500'),
            end: moment('2014-03-03T17:00:00-0500')
        }).should.eventually.be.like([
            {Date:'2014-03-03',Time:'08:30:00',Price:1.11004,Change:0.33},
            {Date:'2014-03-03',Time:'09:00:00',Price:1.10879,Change:0.22},
            {Date:'2014-03-03',Time:'10:00:00',Price:1.10925,Change:0.26},
            {Date:'2014-03-03',Time:'12:00:00',Price:1.10900,Change:0.23},
            {Date:'2014-03-03',Time:'13:00:00',Price:1.10991,Change:0.32},
            {Date:'2014-03-03',Time:'13:30:00',Price:1.10966,Change:0.29},
            {Date:'2014-03-03',Time:'14:00:00',Price:1.10949,Change:0.28}
        ]);
    });
    it("should support include currency and tz for instrument", function() {
        return quote({
            symbol: "USD",
            exchange: "CAD",
            columns: {
                date: "DATE(day.ending)",
                hour: "HOUR(ending, tz)",
                timezone: "tz",
                curr: "currency"
            },
            begin: '2014-02-10',
            end: '2014-02-11'
        }).should.eventually.be.like([
            {date:"2014-02-10",hour:17,timezone:"America/New_York",curr:"CAD"}
        ]);
    });
    it("should filter out most results", function() {
        return quote({
            columns: {
                Date: 'DATE(m30.ending)',
                Time: 'TIME(m30.ending)',
                Price: 'm30.close'
            },
            criteria: 'DATE(month.ending) = DATE(day.ending) and HOUR(m30.ending) = 12',
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
    it("should lookback to multiple blocks", function() {
        return quote({
            columns: {
                Date: 'DATE(m240.ending)',
                Time: 'TIME(m240.ending)',
                Price: 'm240.close',
                M1: 'OFFSET(120, m240.close)',
                M2: 'OFFSET(240, m240.close)'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: '2016-01-15',
            end: '2016-01-16'
        }).should.eventually.be.like([
            {Date:"2016-01-15",Time:"00:00:00",Price:1.4389,M1:1.3769,M2:1.3248},
            {Date:"2016-01-15",Time:"04:00:00",Price:1.4508,M1:1.3805,M2:1.3282},
            {Date:"2016-01-15",Time:"08:00:00",Price:1.4497,M1:1.3783,M2:1.3266},
            {Date:"2016-01-15",Time:"12:00:00",Price:1.4529,M1:1.3791,M2:1.3297},
            {Date:"2016-01-15",Time:"16:00:00",Price:1.4528,M1:1.3793,M2:1.3304},
            {Date:"2016-01-15",Time:"20:00:00",Price:1.4534,M1:1.3813,M2:1.3293}
        ]);
    });
    it("should lookback to multiple partial blocks", function() {
        config('files.dirname', path.resolve(__dirname, 'partial'));
        fetch.close();
        quote.close();
        fetch = Fetch();
        quote = Quote(fetch);
        return quote({ // loads partial month and evals
            columns: {
                Date: 'DATE(m240.ending)',
                Time: 'TIME(m240.ending)',
                Price: 'm240.close',
                M1: 'OFFSET(120, m240.close)',
                M2: 'OFFSET(240, m240.close)',
                incomplete: 'm240.incomplete'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: '2016-02-15',
            end: '2016-02-16'
        }).then(partial => {
            _.first(partial).should.have.property('incomplete').that.is.not.ok;
            _.last(partial).should.have.property('incomplete').that.is.ok;
        }).then(partial => {
            config('files.dirname', path.resolve(__dirname, 'var'));
            fetch.close();
            quote.close();
            fetch = Fetch();
            quote = Quote(fetch);
            return quote({ // loads rest of the month and computes prior expressions
                columns: {
                    Date: 'DATE(m240.ending)',
                    Time: 'TIME(m240.ending)',
                    Price: 'm240.close'
                },
                symbol: 'USD',
                exchange: 'CAD',
                begin: '2016-02-16',
                end: '2016-02-17'
            });
        }).then(complete => {
            return quote({ // should already have computed prior expressions in month
                columns: {
                    Date: 'DATE(m240.ending)',
                    Time: 'TIME(m240.ending)',
                    Price: 'm240.close',
                    M1: 'OFFSET(120, m240.close)',
                    M2: 'OFFSET(240, m240.close)'
                },
                symbol: 'USD',
                exchange: 'CAD',
                begin: '2016-02-16',
                end: '2016-02-17'
            });
        }).should.eventually.be.like([
            {Date:"2016-02-16",Time:"00:00:00",Price:1.3755,M1:1.4577,M2:1.3925},
            {Date:"2016-02-16",Time:"04:00:00",Price:1.3723,M1:1.4624,M2:1.3964},
            {Date:"2016-02-16",Time:"08:00:00",Price:1.378,M1:1.4684,M2:1.3989},
            {Date:"2016-02-16",Time:"12:00:00",Price:1.3859,M1:1.4641,M2:1.3964},
            {Date:"2016-02-16",Time:"16:00:00",Price:1.3882,M1:1.4592,M2:1.3958},
            {Date:"2016-02-16",Time:"20:00:00",Price:1.3871,M1:1.4489,M2:1.3934},
            {Date:"2016-02-17",Time:"00:00:00",Price:1.3872,M1:1.4459,M2:1.3937}
        ]);
    });
});
