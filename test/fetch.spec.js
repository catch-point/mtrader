// fetch.spec.js
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
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');

describe("fetch", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var fetch;
    before(function() {
        config('prefix', __dirname);
        config('files.dirname', path.resolve(__dirname, 'var'));
        config.load(path.resolve(__dirname, 'etc/ptrading.json'));
        fetch = Fetch();
    });
    after(function() {
        config.unset('files.dirname');
        return fetch.close();
    });
    it("should find AABA", function() {
        return fetch({interval: 'lookup', symbol:'AABA'}).then(_.first).should.eventually.be.like({
            symbol: 'AABA',
            exchange: 'NASDAQ',
            yahoo_symbol: 'AABA',
            name: "Altaba Inc"
        });
    });
    it("should find IBM", function() {
        return fetch({
            interval: 'lookup',
            symbol: 'IBM',
            exchange: 'NYSE'
        }).then(_.first).should.eventually.be.like({
            symbol: 'IBM',
            yahoo_symbol: 'IBM',
            name: "International Business Machines Corporation"
        });
    });
    it("should find USD/CAD details", function() {
        return fetch({
            interval: 'fundamental',
            symbol: 'USD',
            exchange: 'CAD'
        }).should.eventually.be.like([{
            symbol: 'USD',
            yahoo_symbol: 'USDCAD=X'
        }]);
    });
    it("should return daily", function() {
        return fetch({
            interval: 'day',
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
        return fetch({
            interval: 'week',
            symbol: 'AABA',
            exchange: 'NASDAQ',
            begin: moment.tz('2014-01-06', tz)
        }).should.eventually.be.like(results => results.slice(0,4).should.be.like([
            {ending:'2014-01-10T16:00:00-05:00'},
            {ending:'2014-01-17T16:00:00-05:00'},
            {ending:'2014-01-24T16:00:00-05:00'},
            {ending:'2014-01-31T16:00:00-05:00'}
        ]));
    });
    it("should return monthly", function() {
        return fetch({
            interval: 'month',
            symbol: 'AABA',
            exchange: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz)
        }).should.eventually.be.like(results => results.slice(0,4).should.be.like([
            {ending:'2013-10-31T16:00:00-04:00'},
            {ending:'2013-11-29T16:00:00-05:00'},
            {ending:'2013-12-31T16:00:00-05:00'},
            {ending:'2014-01-31T16:00:00-05:00'}
        ]));
    });
    it("should return quarter", function() {
        return fetch({
            interval: 'quarter',
            symbol: 'AABA',
            exchange: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz),
            end: moment.tz('2013-12-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2013-12-31T16:00:00-05:00',open:33.36,high:41.05,low:31.7,close:40.44}
        ]);
    });
    it("should return year", function() {
        return fetch({
            interval: 'year',
            symbol: 'AABA',
            exchange: 'NASDAQ',
            begin: moment.tz('2013-10-01', tz),
            end: moment.tz('2013-12-01', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).should.eventually.be.like([
            {ending:'2013-12-31T16:00:00-05:00',open:20.2,high:41.05,low:18.89,close:40.44}
        ]);
    });
    it("should find BRK.A symbol", function() {
        return fetch({
            interval: 'lookup',
            symbol: 'BRK.A',
            exchange: 'NYSE'
        }).should.eventually.be.like(results => _.some(results, like({
            symbol: /^BRK.A/,
            yahoo_symbol: /^BRK.A/,
            name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0
        })));
    });
    it("should return 30 minute intervals", function() {
        return fetch({
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
        return fetch({
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
        return fetch({
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
});
