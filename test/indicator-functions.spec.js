// indicator-functions.spec.js
/*
 *  Copyright (c) 2014-2017 James Leigh, Some Rights Reserved
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
const indicator = require('../src/indicator-functions.js');
const Parser = require('../src/parser.js');
const expect = require('chai').expect;
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');

describe("indicator-functions", function(){
    this.timeout(10000);
    var about = 0.01;
    var fetch, quote;
    before(function() {
        config('config', path.resolve(__dirname, 'etc/ptrading.json'));
        config('prefix', createTempDir('quotes'));
        config(['iqfeed','enabled'], false);
        config(['google','enabled'], false);
        config(['yahoo','enabled'], false);
        config(['files','enabled'], true);
        config(['files','dirname'], path.resolve(__dirname, 'var'));
        fetch = Fetch();
        quote = Quote(fetch);
    });
    after(function() {
        config.unset('prefix');
        config.unset(['files','dirname']);
        return Promise.all([
            quote.close(),
            fetch.close()
        ]);
    });
    after(function() {
        config.unset('prefix');
    });
    it("OBV", function() {
        return quote({
            columns: {
                Date: 'DATE(day.ending)',
                Close: 'day.close',
                UpDown: 'SIGN(day.close - OFFSET(1, day.close))',
                Volume: 'day.volume',
                OBV: 'day.OBV(28)'
            },
            symbol: 'WMT',
            exchange: 'NYSE',
            begin: moment('2010-10-27'),
            end: moment('2010-12-09')
        }).should.eventually.be.like([
            {Date:"2010-10-27",Close:53.87,UpDown:-1,Volume:13020300,OBV:850243.2638535842},
            {Date:"2010-10-28",Close:54.08,UpDown:1,Volume:8183600,OBV:902359.6339603458},
            {Date:"2010-10-29",Close:54.17,UpDown:1,Volume:8032900,OBV:954503.4011184545},
            {Date:"2010-11-01",Close:54.31,UpDown:1,Volume:8207500,OBV:1008097.4580579563},
            {Date:"2010-11-02",Close:54.79,UpDown:1,Volume:8849200,OBV:1067162.028469751},
            {Date:"2010-11-03",Close:54.91,UpDown:1,Volume:9189200,OBV:1127414.0467717336},
            {Date:"2010-11-04",Close:55.36,UpDown:1,Volume:13246800,OBV:1217692.1072699542},
            {Date:"2010-11-05",Close:55.2,UpDown:-1,Volume:10261400,OBV:1138002.5241484493},
            {Date:"2010-11-08",Close:54.91,UpDown:-1,Volume:9941100,OBV:1062048.3223182512},
            {Date:"2010-11-09",Close:55.05,UpDown:1,Volume:10047100,OBV:1128811.858159634},
            {Date:"2010-11-10",Close:54.51,UpDown:-1,Volume:11236900,OBV:1042739.4356888663},
            {Date:"2010-11-11",Close:54.34,UpDown:-1,Volume:12566100,OBV:945932.4860193188},
            {Date:"2010-11-12",Close:54.13,UpDown:-1,Volume:10677800,OBV:864061.568378241},
            {Date:"2010-11-15",Close:53.95,UpDown:-1,Volume:11459500,OBV:775708.7569903407},
            {Date:"2010-11-16",Close:54.26,UpDown:1,Volume:23555200,OBV:938350.7498729029},
            {Date:"2010-11-17",Close:53.77,UpDown:-1,Volume:14504700,OBV:828747.9918657854},
            {Date:"2010-11-18",Close:53.98,UpDown:1,Volume:11587300,OBV:906229.5627859685},
            {Date:"2010-11-19",Close:54.39,UpDown:1,Volume:10307500,OBV:975523.8459583122},
            {Date:"2010-11-22",Close:54.38,UpDown:-1,Volume:9501800,OBV:901699.422979156},
            {Date:"2010-11-23",Close:53.67,UpDown:-1,Volume:13851400,OBV:798516.6929334011},
            {Date:"2010-11-24",Close:54.01,UpDown:1,Volume:10312400,OBV:866916.3192679207},
            {Date:"2010-11-26",Close:53.74,UpDown:-1,Volume:4155000,OBV:832397.1530249111},
            {Date:"2010-11-29",Close:53.85,UpDown:1,Volume:10787600,OBV:905165.754956787},
            {Date:"2010-11-30",Close:54.09,UpDown:1,Volume:17556900,OBV:1027132.3716319267},
            {Date:"2010-12-01",Close:54.7,UpDown:1,Volume:17882900,OBV:1150864.877986782},
            {Date:"2010-12-02",Close:54.75,UpDown:1,Volume:15774900,OBV:1258597.5292323334},
            {Date:"2010-12-03",Close:54.62,UpDown:-1,Volume:10096900,OBV:1180263.9450940518},
            {Date:"2010-12-06",Close:54.49,UpDown:-1,Volume:8632900,OBV:1112264.062023386},
            {Date:"2010-12-07",Close:55.09,UpDown:1,Volume:15893300,OBV:1218497.961362481},
            {Date:"2010-12-08",Close:54.49,UpDown:-1,Volume:12479700,OBV:1122023.6248093543}
        ]);
    });
    describe("ATR", function() {
        it("stockcharts.com", function() {
            var data = [
                [48.7,47.79,48.16],
                [48.72,48.14,48.61],
                [48.9,48.39,48.75],
                [48.87,48.37,48.63],
                [48.82,48.24,48.74],
                [49.05,48.635,49.03],
                [49.2,48.94,49.07],
                [49.35,48.86,49.32],
                [49.92,49.5,49.91],
                [50.19,49.87,50.13],
                [50.12,49.2,49.53],
                [49.66,48.9,49.5],
                [49.88,49.43,49.75],
                [50.19,49.725,50.03,0.555],
                [50.36,49.26,50.31,0.5939285714],
                [50.57,50.09,50.52,0.5857908163],
                [50.65,50.3,50.41,0.5689486152],
                [50.43,49.21,49.34,0.6154522855],
                [49.63,48.98,49.37,0.6179199794],
                [50.33,49.61,50.23,0.6423542666],
                [50.29,49.2,49.2375,0.6743289618],
                [50.17,49.43,49.93,0.6927697503],
                [49.32,48.08,48.43,0.7754290538],
                [48.5,47.64,48.18,0.7814698357],
                [48.3201,41.55,46.57,1.2092291331],
                [46.8,44.2833,45.41,1.3026199093],
                [47.8,47.31,47.77,1.3802899158],
                [48.39,47.2,47.72,1.366697779],
                [48.66,47.9,48.62,1.3362193662],
                [48.79,47.7301,47.85,1.3164822686]
            ];
            var parser = Parser({
                constant(value) {
                    return () => value;
                },
                variable(name) {
                    return _.compose(_.property(name), _.last);
                },
                expression(expr, name, args) {
                    return indicator(name, args);
                }
            });
            var ATR = parser.parse('day.ATR(14)');
            data.forEach((datum,i,data) => {
                var atr = datum[3];
                var points = data.slice(0, i+1).map(datum => {
                    return {day: {
                        high: datum[0],
                        low: datum[1],
                        close: datum[2]
                    }};
                });
                if (atr) {
                    expect(ATR(points)).to.be.closeTo(atr, about);
                }
            });
        });
    });
    describe("SAR", function() {
        it("PSAR", function() {
            return quote({
                columns: {
                    Date: 'DATE(day.ending)',
                    High: 'day.high',
                    Low: 'day.low',
                    PSAR: 'day.PSAR(0.02, 0.2, 15)'
                },
                symbol: 'QQQ',
                exchange: 'NASDAQ',
                begin: moment('2010-01-10'),
                end: moment('2010-02-13')
            }).should.eventually.be.like([
                {Date:"2010-01-11",High:46.64,Low:46.12,PSAR:45.9442},
                {Date:"2010-01-12",High:46.14,Low:45.53,PSAR:46.6178},
                {Date:"2010-01-13",High:46.49,Low:45.61,PSAR:46.5960},
                {Date:"2010-01-14",High:46.52,Low:46.22,PSAR:46.5747},
                {Date:"2010-01-15",High:46.55,Low:45.65,PSAR:46.5538},
                {Date:"2010-01-19",High:46.64,Low:45.95,PSAR:45.5522},
                {Date:"2010-01-20",High:46.60,Low:45.43,PSAR:46.6158},
                {Date:"2010-01-21",High:46.35,Low:45.30,PSAR:46.5632},
                {Date:"2010-01-22",High:45.48,Low:44.04,PSAR:46.4118},
                {Date:"2010-01-25",High:44.60,Low:44.12,PSAR:46.2695},
                {Date:"2010-01-26",High:44.89,Low:44.05,PSAR:46.1357},
                {Date:"2010-01-27",High:44.85,Low:44.01,PSAR:45.9657},
                {Date:"2010-01-28",High:44.43,Low:43.32,PSAR:45.7011},
                {Date:"2010-01-29",High:44.02,Low:42.63,PSAR:45.3326},
                {Date:"2010-02-01",High:43.28,Low:42.88,PSAR:45.0083},
                {Date:"2010-02-02",High:43.78,Low:43.03,PSAR:44.7229},
                {Date:"2010-02-03",High:43.97,Low:43.42,PSAR:44.4717},
                {Date:"2010-02-04",High:43.66,Low:42.62,PSAR:44.2125},
                {Date:"2010-02-05",High:43.02,Low:42.12,PSAR:43.8777},
                {Date:"2010-02-08",High:43.18,Low:42.64,PSAR:43.5965},
                {Date:"2010-02-09",High:43.51,Low:42.76,PSAR:43.6517},
                {Date:"2010-02-10",High:43.31,Low:42.75,PSAR:43.7119},
                {Date:"2010-02-11",High:43.79,Low:42.76,PSAR:42.1534},
                {Date:"2010-02-12",High:43.88,Low:43.16,PSAR:42.2225}
            ]);
        });
        it("SAB", function() {
            return quote({
                columns: {
                    Date: 'DATE(day.ending)',
                    High: 'day.high',
                    Low: 'day.low',
                    SAB: 'day.SAB(0.02, 0.2, 15)'
                },
                symbol: 'QQQ',
                exchange: 'NASDAQ',
                begin: moment('2010-01-10'),
                end: moment('2010-02-13')
            }).should.eventually.be.like([
                {Date:"2010-01-11",High:46.64,Low:46.12,SAB:46.6296},
                {Date:"2010-01-12",High:46.14,Low:45.53,SAB:46.58562},
                {Date:"2010-01-13",High:46.49,Low:45.61,SAB:46.54339},
                {Date:"2010-01-14",High:46.52,Low:46.22,SAB:46.514},
                {Date:"2010-01-15",High:46.55,Low:45.65,SAB:46.532},
                {Date:"2010-01-19",High:46.64,Low:45.95,SAB:46.6262},
                {Date:"2010-01-20",High:46.60,Low:45.43,SAB:46.5766},
                {Date:"2010-01-21",High:46.35,Low:45.30,SAB:46.52554},
                {Date:"2010-01-22",High:45.48,Low:44.04,SAB:46.37640},
                {Date:"2010-01-25",High:44.60,Low:44.12,SAB:46.23622},
                {Date:"2010-01-26",High:44.89,Low:44.05,SAB:46.10445},
                {Date:"2010-01-27",High:44.85,Low:44.01,SAB:45.93689},
                {Date:"2010-01-28",High:44.43,Low:43.32,SAB:45.67520},
                {Date:"2010-01-29",High:44.02,Low:42.63,SAB:45.30978},
                {Date:"2010-02-01",High:43.28,Low:42.88,SAB:44.98820},
                {Date:"2010-02-02",High:43.78,Low:43.03,SAB:44.70522},
                {Date:"2010-02-03",High:43.97,Low:43.42,SAB:44.45619},
                {Date:"2010-02-04",High:43.66,Low:42.62,SAB:44.19913},
                {Date:"2010-02-05",High:43.02,Low:42.12,SAB:43.86647},
                {Date:"2010-02-08",High:43.18,Low:42.64,SAB:43.58703},
                {Date:"2010-02-09",High:43.51,Low:42.76,SAB:43.495},
                {Date:"2010-02-10",High:43.31,Low:42.75,SAB:43.37804},
                {Date:"2010-02-11",High:43.79,Low:42.76,SAB:43.7694},
                {Date:"2010-02-12",High:43.88,Low:43.16,SAB:43.8656}
            ]);
        });
        it("SAS", function() {
            return quote({
                columns: {
                    Date: 'DATE(day.ending)',
                    High: 'day.high',
                    Low: 'day.low',
                    SAS: 'day.SAS(0.02, 0.2, 15)'
                },
                symbol: 'QQQ',
                exchange: 'NASDAQ',
                begin: moment('2010-01-10'),
                end: moment('2010-02-13')
            }).should.eventually.be.like([
                {Date:"2010-01-11",High:46.64,Low:46.12,SAS:45.9703},
                {Date:"2010-01-12",High:46.14,Low:45.53,SAS:45.5422},
                {Date:"2010-01-13",High:46.49,Low:45.61,SAS:45.5801},
                {Date:"2010-01-14",High:46.52,Low:46.22,SAS:45.6365},
                {Date:"2010-01-15",High:46.55,Low:45.65,SAS:45.668},
                {Date:"2010-01-19",High:46.64,Low:45.95,SAS:45.7069},
                {Date:"2010-01-20",High:46.6,Low:45.43,SAS:45.4534},
                {Date:"2010-01-21",High:46.35,Low:45.3,SAS:45.321},
                {Date:"2010-01-22",High:45.48,Low:44.04,SAS:44.0688},
                {Date:"2010-01-25",High:44.6,Low:44.12,SAS:44.09702},
                {Date:"2010-01-26",High:44.89,Low:44.05,SAS:44.067},
                {Date:"2010-01-27",High:44.85,Low:44.01,SAS:44.027},
                {Date:"2010-01-28",High:44.43,Low:43.32,SAS:43.342},
                {Date:"2010-01-29",High:44.02,Low:42.63,SAS:42.658},
                {Date:"2010-02-01",High:43.28,Low:42.88,SAS:42.6850},
                {Date:"2010-02-02",High:43.78,Low:43.03,SAS:42.7117},
                {Date:"2010-02-03",High:43.97,Low:43.42,SAS:42.7379},
                {Date:"2010-02-04",High:43.66,Low:42.62,SAS:42.6408},
                {Date:"2010-02-05",High:43.02,Low:42.12,SAS:42.138},
                {Date:"2010-02-08",High:43.18,Low:42.64,SAS:42.1797},
                {Date:"2010-02-09",High:43.51,Low:42.76,SAS:42.2595},
                {Date:"2010-02-10",High:43.31,Low:42.75,SAS:42.3345},
                {Date:"2010-02-11",High:43.79,Low:42.76,SAS:42.4510},
                {Date:"2010-02-12",High:43.88,Low:43.16,SAS:42.5939}
            ]);
        });
    });
    it("POPV", function() {
        return quote({
            columns: {
                Date: 'DATE(day.ending)',
                High: 'day.high',
                Low: 'day.low',
                Close: 'day.close',
                POPV: 'day.POPV(20,50)'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-01-01'),
            end: moment('2014-02-01')
        }).should.eventually.be.like([
            {Date:"2014-01-02",High:1.06770,Low:1.05874,Close:1.06680,POPV:1.06372},
            {Date:"2014-01-03",High:1.06709,Low:1.06013,Close:1.06312,POPV:1.06354},
            {Date:"2014-01-06",High:1.06798,Low:1.06076,Close:1.06543,POPV:1.06340},
            {Date:"2014-01-07",High:1.07805,Low:1.06467,Close:1.07658,POPV:1.06354},
            {Date:"2014-01-08",High:1.08292,Low:1.07600,Close:1.08169,POPV:1.06361},
            {Date:"2014-01-09",High:1.08736,Low:1.08159,Close:1.08429,POPV:1.06454},
            {Date:"2014-01-10",High:1.09451,Low:1.08361,Close:1.08947,POPV:1.06519},
            {Date:"2014-01-13",High:1.09283,Low:1.08416,Close:1.08611,POPV:1.06555},
            {Date:"2014-01-14",High:1.09578,Low:1.08577,Close:1.09466,POPV:1.06676},
            {Date:"2014-01-15",High:1.09904,Low:1.09193,Close:1.09351,POPV:1.06770},
            {Date:"2014-01-16",High:1.09618,Low:1.09041,Close:1.09301,POPV:1.06993},
            {Date:"2014-01-17",High:1.09829,Low:1.09251,Close:1.09617,POPV:1.07600},
            {Date:"2014-01-20",High:1.09712,Low:1.09285,Close:1.09434,POPV:1.08159},
            {Date:"2014-01-21",High:1.10179,Low:1.09382,Close:1.09651,POPV:1.08361},
            {Date:"2014-01-22",High:1.10909,Low:1.09525,Close:1.10866,POPV:1.08611},
            {Date:"2014-01-23",High:1.11729,Low:1.10811,Close:1.10996,POPV:1.08947},
            {Date:"2014-01-24",High:1.11364,Low:1.10498,Close:1.10788,POPV:1.09193},
            {Date:"2014-01-27",High:1.11165,Low:1.10308,Close:1.11136,POPV:1.09301},
            {Date:"2014-01-28",High:1.11761,Low:1.10773,Close:1.11507,POPV:1.09382},
            {Date:"2014-01-29",High:1.11860,Low:1.11014,Close:1.11668,POPV:1.09436},
            {Date:"2014-01-30",High:1.11994,Low:1.11498,Close:1.11578,POPV:1.09466},
            {Date:"2014-01-31",High:1.12234,Low:1.10867,Close:1.11251,POPV:1.09617}
        ]);
    });
    it("ROF", function() {
        return quote({
            columns: {
                Date: 'DATE(day.ending)',
                High: 'day.high',
                Low: 'day.low',
                Close: 'day.close',
                ROF: 'day.ROF(20)'
            },
            symbol: 'USD',
            exchange: 'CAD',
            begin: moment('2014-01-01'),
            end: moment('2014-02-01')
        }).should.eventually.be.like([
            {Date:"2014-01-02",High:1.06770,Low:1.05874,Close:1.06680,ROF:2},
            {Date:"2014-01-03",High:1.06709,Low:1.06013,Close:1.06312,ROF:4},
            {Date:"2014-01-06",High:1.06798,Low:1.06076,Close:1.06543,ROF:6},
            {Date:"2014-01-07",High:1.07805,Low:1.06467,Close:1.07658,ROF:8},
            {Date:"2014-01-08",High:1.08292,Low:1.07600,Close:1.08169,ROF:12},
            {Date:"2014-01-09",High:1.08736,Low:1.08159,Close:1.08429,ROF:16},
            {Date:"2014-01-10",High:1.09451,Low:1.08361,Close:1.08947,ROF:18},
            {Date:"2014-01-13",High:1.09283,Low:1.08416,Close:1.08611,ROF:16},
            {Date:"2014-01-14",High:1.09578,Low:1.08577,Close:1.09466,ROF:20},
            {Date:"2014-01-15",High:1.09904,Low:1.09193,Close:1.09351,ROF:20},
            {Date:"2014-01-16",High:1.09618,Low:1.09041,Close:1.09301,ROF:16},
            {Date:"2014-01-17",High:1.09829,Low:1.09251,Close:1.09617,ROF:16},
            {Date:"2014-01-20",High:1.09712,Low:1.09285,Close:1.09434,ROF:16},
            {Date:"2014-01-21",High:1.10179,Low:1.09382,Close:1.09651,ROF:20},
            {Date:"2014-01-22",High:1.10909,Low:1.09525,Close:1.10866,ROF:22},
            {Date:"2014-01-23",High:1.11729,Low:1.10811,Close:1.10996,ROF:22},
            {Date:"2014-01-24",High:1.11364,Low:1.10498,Close:1.10788,ROF:18},
            {Date:"2014-01-27",High:1.11165,Low:1.10308,Close:1.11136,ROF:14},
            {Date:"2014-01-28",High:1.11761,Low:1.10773,Close:1.11507,ROF:18},
            {Date:"2014-01-29",High:1.11860,Low:1.11014,Close:1.11668,ROF:20},
            {Date:"2014-01-30",High:1.11994,Low:1.11498,Close:1.11578,ROF:22},
            {Date:"2014-01-31",High:1.12234,Low:1.10867,Close:1.11251,ROF:20}
        ]);
    });
});
