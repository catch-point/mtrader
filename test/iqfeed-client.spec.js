// iqfeed-client.spec.js
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
const iqfeedClient = require('../src/iqfeed-client.js');

describe("iqfeed-client", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = iqfeedClient();
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
        return client.lookup('IBM', 7).should.eventually.be.like(results => _.some(results, like({
            symbol: 'IBM',
            listed_market: 7,
            name: "INTERNATIONAL BUSINESS MACHINE"
        })));
    });
    it("should find USD/CAD details", function() {
        return client.fundamental('USDCAD.FXCM', 74).should.eventually.be.like({
            symbol: 'USDCAD.FXCM',
            listed_market: "74",
            company_name: /FXCM USD CAD/
        });
    });
    it("should return daily", function() {
        return client.day(
            'USDCAD.FXCM',
            moment.tz('2014-01-01', tz), moment.tz('2014-02-01', tz),
            '17:00:00', tz
        ).should.eventually.be.like([
            {Date_Stamp:'2014-01-31',High:'1.12234',Low:'1.10867',Open:'1.11578',Close:'1.11251'},
            {Date_Stamp:'2014-01-30',High:'1.11994',Low:'1.11498',Open:'1.11666',Close:'1.11578'},
            {Date_Stamp:'2014-01-29',High:'1.11860',Low:'1.11014',Open:'1.11507',Close:'1.11668'},
            {Date_Stamp:'2014-01-28',High:'1.11761',Low:'1.10773',Open:'1.11140',Close:'1.11507'},
            {Date_Stamp:'2014-01-27',High:'1.11165',Low:'1.10308',Open:'1.10600',Close:'1.11136'},
            {Date_Stamp:'2014-01-24',High:'1.11364',Low:'1.10498',Open:'1.10999',Close:'1.10788'},
            {Date_Stamp:'2014-01-23',High:'1.11729',Low:'1.10811',Open:'1.10866',Close:'1.10996'},
            {Date_Stamp:'2014-01-22',High:'1.10909',Low:'1.09525',Open:'1.09651',Close:'1.10866'},
            {Date_Stamp:'2014-01-21',High:'1.10179',Low:'1.09382',Open:'1.09436',Close:'1.09651'},
            {Date_Stamp:'2014-01-20',High:'1.09712',Low:'1.09285',Open:'1.09597',Close:'1.09434'},
            {Date_Stamp:'2014-01-17',High:'1.09829',Low:'1.09251',Open:'1.09301',Close:'1.09617'},
            {Date_Stamp:'2014-01-16',High:'1.09618',Low:'1.09041',Open:'1.09351',Close:'1.09301'},
            {Date_Stamp:'2014-01-15',High:'1.09904',Low:'1.09193',Open:'1.09466',Close:'1.09351'},
            {Date_Stamp:'2014-01-14',High:'1.09578',Low:'1.08577',Open:'1.08615',Close:'1.09466'},
            {Date_Stamp:'2014-01-13',High:'1.09283',Low:'1.08416',Open:'1.08996',Close:'1.08611'},
            {Date_Stamp:'2014-01-10',High:'1.09451',Low:'1.08361',Open:'1.08429',Close:'1.08947'},
            {Date_Stamp:'2014-01-09',High:'1.08736',Low:'1.08159',Open:'1.08169',Close:'1.08429'},
            {Date_Stamp:'2014-01-08',High:'1.08292',Low:'1.07600',Open:'1.07658',Close:'1.08169'},
            {Date_Stamp:'2014-01-07',High:'1.07805',Low:'1.06467',Open:'1.06541',Close:'1.07658'},
            {Date_Stamp:'2014-01-06',High:'1.06798',Low:'1.06076',Open:'1.06313',Close:'1.06543'},
            {Date_Stamp:'2014-01-03',High:'1.06709',Low:'1.06013',Open:'1.06676',Close:'1.06312'},
            {Date_Stamp:'2014-01-02',High:'1.06770',Low:'1.05874',Open:'1.06321',Close:'1.06680'}
        ]);
    });
    it("should return weekly", function() {
        return client.week(
            'USDCAD.FXCM',
            moment.tz('2014-01-06', tz), null,
            '17:00:00', tz
        ).should.eventually.be.like(results => results.slice(-4).should.be.like([
            {Date_Stamp:'2014-01-31',High:'1.12234',Low:'1.10308',Open:'1.10600',Close:'1.11251'},
            {Date_Stamp:'2014-01-24',High:'1.11729',Low:'1.09285',Open:'1.09597',Close:'1.10788'},
            {Date_Stamp:'2014-01-17',High:'1.09904',Low:'1.08416',Open:'1.08996',Close:'1.09617'},
            {Date_Stamp:'2014-01-10',High:'1.09451',Low:'1.06076',Open:'1.06313',Close:'1.08947'}
        ]));
    });
    it("should return monthly", function() {
        return client.month(
            'USDCAD.FXCM',
            moment.tz('2014-01-01', tz), null,
            '17:00:00', tz
        ).should.eventually.be.like(results => results.slice(-12).should.be.like([
            {Date_Stamp:'2014-12-31',High:'1.16724',Low:'1.13120',Open:'1.14272',Close:'1.16123'},
            {Date_Stamp:'2014-11-28',High:'1.14655',Low:'1.11896',Open:'1.12827',Close:'1.14119'},
            {Date_Stamp:'2014-10-31',High:'1.13843',Low:'1.10704',Open:'1.11943',Close:'1.12661'},
            {Date_Stamp:'2014-09-30',High:'1.12185',Low:'1.08197',Open:'1.08710',Close:'1.11942'},
            {Date_Stamp:'2014-08-29',High:'1.09967',Low:'1.08097',Open:'1.09039',Close:'1.08731'},
            {Date_Stamp:'2014-07-31',High:'1.09286',Low:'1.06195',Open:'1.06679',Close:'1.09039'},
            {Date_Stamp:'2014-06-30',High:'1.09595',Low:'1.06455',Open:'1.08358',Close:'1.06679'},
            {Date_Stamp:'2014-05-30',High:'1.10055',Low:'1.08133',Open:'1.09597',Close:'1.08397'},
            {Date_Stamp:'2014-04-30',High:'1.10693',Low:'1.08570',Open:'1.10480',Close:'1.09598'},
            {Date_Stamp:'2014-03-31',High:'1.12775',Low:'1.09543',Open:'1.10708',Close:'1.10482'},
            {Date_Stamp:'2014-02-28',High:'1.11935',Low:'1.09092',Open:'1.11070',Close:'1.10640'},
            {Date_Stamp:'2014-01-31',High:'1.12234',Low:'1.05874',Open:'1.06321',Close:'1.11251'}
        ]));
    });
    it("should find BRK.A symbol", function() {
        return client.lookup('BRK.A', 7).should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should return 30 minute intervals", function() {
        return client.minute(30, 'USDCAD.FXCM',
            moment('2014-03-03T08:30:00-0500'), moment('2014-03-03T17:00:00-0500'), tz
        ).should.eventually.be.like([
            {Time_Stamp:'2014-03-03 17:00:00',Open:'1.10761',High:'1.10792',Low:'1.10729',Close:'1.10749'},
            {Time_Stamp:'2014-03-03 16:30:00',Open:'1.10830',High:'1.10842',Low:'1.10747',Close:'1.10761'},
            {Time_Stamp:'2014-03-03 16:00:00',Open:'1.10793',High:'1.10835',Low:'1.10736',Close:'1.10831'},
            {Time_Stamp:'2014-03-03 15:30:00',Open:'1.10834',High:'1.10834',Low:'1.10771',Close:'1.10793'},
            {Time_Stamp:'2014-03-03 15:00:00',Open:'1.10845',High:'1.10846',Low:'1.10745',Close:'1.10833'},
            {Time_Stamp:'2014-03-03 14:30:00',Open:'1.10944',High:'1.10944',Low:'1.10806',Close:'1.10846'},
            {Time_Stamp:'2014-03-03 14:00:00',Open:'1.10966',High:'1.10970',Low:'1.10865',Close:'1.10949'},
            {Time_Stamp:'2014-03-03 13:30:00',Open:'1.10991',High:'1.11000',Low:'1.10951',Close:'1.10966'},
            {Time_Stamp:'2014-03-03 13:00:00',Open:'1.10840',High:'1.10995',Low:'1.10782',Close:'1.10991'},
            {Time_Stamp:'2014-03-03 12:30:00',Open:'1.10900',High:'1.10930',Low:'1.10794',Close:'1.10841'},
            {Time_Stamp:'2014-03-03 12:00:00',Open:'1.10854',High:'1.10929',Low:'1.10827',Close:'1.10900'},
            {Time_Stamp:'2014-03-03 11:30:00',Open:'1.10789',High:'1.10961',Low:'1.10779',Close:'1.10852'},
            {Time_Stamp:'2014-03-03 11:00:00',Open:'1.10819',High:'1.10824',Low:'1.10694',Close:'1.10789'},
            {Time_Stamp:'2014-03-03 10:30:00',Open:'1.10923',High:'1.10993',Low:'1.10799',Close:'1.10819'},
            {Time_Stamp:'2014-03-03 10:00:00',Open:'1.10824',High:'1.10951',Low:'1.10824',Close:'1.10925'},
            {Time_Stamp:'2014-03-03 09:30:00',Open:'1.10880',High:'1.10914',Low:'1.10811',Close:'1.10824'},
            {Time_Stamp:'2014-03-03 09:00:00',Open:'1.11006',High:'1.11009',Low:'1.10869',Close:'1.10879'},
            {Time_Stamp:'2014-03-03 08:30:00',Open:'1.10966',High:'1.11014',Low:'1.10926',Close:'1.11004'}
        ]);
    });
    it("should return 10 minute intervals", function() {
        return client.minute(10, 'USDCAD.FXCM',
            moment('2014-03-03T10:10:00-0500'), moment('2014-03-03T11:00:00-0500'), tz
        ).should.eventually.be.like([
            {Time_Stamp:'2014-03-03 11:00:00',High:'1.10798',Low:'1.10694',Open:'1.10793',Close:'1.10789'},
            {Time_Stamp:'2014-03-03 10:50:00',High:'1.10814',Low:'1.10755',Open:'1.10755',Close:'1.10794'},
            {Time_Stamp:'2014-03-03 10:40:00',High:'1.10824',Low:'1.10718',Open:'1.10819',Close:'1.10755'},
            {Time_Stamp:'2014-03-03 10:30:00',High:'1.10905',Low:'1.10799',Open:'1.10880',Close:'1.10819'},
            {Time_Stamp:'2014-03-03 10:20:00',High:'1.10944',Low:'1.10879',Open:'1.10905',Close:'1.10880'},
            {Time_Stamp:'2014-03-03 10:10:00',High:'1.10993',Low:'1.10876',Open:'1.10923',Close:'1.10905'}
        ]);
    });
    it("should return minutes", function() {
        return client.minute(1, 'USDCAD.FXCM',
            moment('2014-03-03T10:01:00-0500'), moment('2014-03-03T10:30:00-0500'), tz
        ).should.eventually.be.like([
            {Time_Stamp:'2014-03-03 10:30:00',High:'1.10825',Low:'1.10805',Open:'1.10819',Close:'1.10819'},
            {Time_Stamp:'2014-03-03 10:29:00',High:'1.10860',Low:'1.10815',Open:'1.10859',Close:'1.10815'},
            {Time_Stamp:'2014-03-03 10:28:00',High:'1.10859',Low:'1.10843',Open:'1.10843',Close:'1.10857'},
            {Time_Stamp:'2014-03-03 10:27:00',High:'1.10847',Low:'1.10800',Open:'1.10809',Close:'1.10843'},
            {Time_Stamp:'2014-03-03 10:26:00',High:'1.10844',Low:'1.10808',Open:'1.10826',Close:'1.10808'},
            {Time_Stamp:'2014-03-03 10:25:00',High:'1.10855',Low:'1.10799',Open:'1.10848',Close:'1.10826'},
            {Time_Stamp:'2014-03-03 10:24:00',High:'1.10865',Low:'1.10837',Open:'1.10848',Close:'1.10844'},
            {Time_Stamp:'2014-03-03 10:23:00',High:'1.10905',Low:'1.10845',Open:'1.10902',Close:'1.10847'},
            {Time_Stamp:'2014-03-03 10:22:00',High:'1.10903',Low:'1.10889',Open:'1.10889',Close:'1.10901'},
            {Time_Stamp:'2014-03-03 10:21:00',High:'1.10889',Low:'1.10875',Open:'1.10880',Close:'1.10889'},
            {Time_Stamp:'2014-03-03 10:20:00',High:'1.10905',Low:'1.10879',Open:'1.10905',Close:'1.10880'},
            {Time_Stamp:'2014-03-03 10:19:00',High:'1.10939',Low:'1.10903',Open:'1.10939',Close:'1.10905'},
            {Time_Stamp:'2014-03-03 10:18:00',High:'1.10944',Low:'1.10909',Open:'1.10910',Close:'1.10939'},
            {Time_Stamp:'2014-03-03 10:17:00',High:'1.10915',Low:'1.10899',Open:'1.10904',Close:'1.10909'},
            {Time_Stamp:'2014-03-03 10:16:00',High:'1.10909',Low:'1.10891',Open:'1.10891',Close:'1.10901'},
            {Time_Stamp:'2014-03-03 10:15:00',High:'1.10907',Low:'1.10879',Open:'1.10879',Close:'1.10890'},
            {Time_Stamp:'2014-03-03 10:14:00',High:'1.10905',Low:'1.10879',Open:'1.10897',Close:'1.10879'},
            {Time_Stamp:'2014-03-03 10:13:00',High:'1.10925',Low:'1.10894',Open:'1.10905',Close:'1.10894'},
            {Time_Stamp:'2014-03-03 10:12:00',High:'1.10905',Low:'1.10881',Open:'1.10883',Close:'1.10902'},
            {Time_Stamp:'2014-03-03 10:11:00',High:'1.10905',Low:'1.10883',Open:'1.10905',Close:'1.10883'},
            {Time_Stamp:'2014-03-03 10:10:00',High:'1.10905',Low:'1.10877',Open:'1.10878',Close:'1.10905'},
            {Time_Stamp:'2014-03-03 10:09:00',High:'1.10933',Low:'1.10876',Open:'1.10932',Close:'1.10877'},
            {Time_Stamp:'2014-03-03 10:08:00',High:'1.10944',Low:'1.10932',Open:'1.10944',Close:'1.10932'},
            {Time_Stamp:'2014-03-03 10:07:00',High:'1.10951',Low:'1.10943',Open:'1.10951',Close:'1.10943'},
            {Time_Stamp:'2014-03-03 10:06:00',High:'1.10956',Low:'1.10951',Open:'1.10956',Close:'1.10952'},
            {Time_Stamp:'2014-03-03 10:05:00',High:'1.10957',Low:'1.10945',Open:'1.10952',Close:'1.10957'},
            {Time_Stamp:'2014-03-03 10:04:00',High:'1.10956',Low:'1.10950',Open:'1.10956',Close:'1.10953'},
            {Time_Stamp:'2014-03-03 10:03:00',High:'1.10967',Low:'1.10950',Open:'1.10955',Close:'1.10956'},
            {Time_Stamp:'2014-03-03 10:02:00',High:'1.10993',Low:'1.10941',Open:'1.10981',Close:'1.10955'},
            {Time_Stamp:'2014-03-03 10:01:00',High:'1.10981',Low:'1.10923',Open:'1.10923',Close:'1.10981'}
        ]);
    });
});
