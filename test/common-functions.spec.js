// common-functions.spec.js
/*
 *  Copyright (c) 2014-2019 James Leigh, Some Rights Reserved
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
const common = require('../src/common-functions.js');
const Parser = require('../src/parser.js');
const expect = require('chai').expect;

describe("common-functions", function(){
    describe("WORKDATE", function(){
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var DAY = parser.parse('DAY(day.ending)');
        var MONTH = parser.parse('MONTH(day.ending)');
        var YEAR = parser.parse('YEAR(day.ending)');
        var WORKDAY0 = parser.parse('WORKDAY(day.ending,0)');
        var WORKDAY1 = parser.parse('WORKDAY(day.ending,1)');
        var WORKDAY2 = parser.parse('WORKDAY(day.ending,2)');
        var WORKDAY4 = parser.parse('WORKDAY(day.ending,4)');
        var WORKDAY5 = parser.parse('WORKDAY(day.ending,5)');
        var WORKDAY_1 = parser.parse('WORKDAY(day.ending,-1)');
        var WORKDAY_2 = parser.parse('WORKDAY(day.ending,-2)');
        var WORKDAY_4 = parser.parse('WORKDAY(day.ending,-4)');
        var WORKDAY_5 = parser.parse('WORKDAY(day.ending,-5)');
        var WORKDAY_6 = parser.parse('WORKDAY(day.ending,-6)');
        it("DAY0", function(){
            expect(
                DAY({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(18);
        });
        it("MONTH0", function(){
            expect(
                MONTH({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(7);
        });
        it("YEAR", function(){
            expect(
                YEAR({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(2015);
        });
        it("WORKDAY0", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-19T00:00:00-04:00"})
            );
            expect(
                WORKDAY0({"day.ending":"2015-07-19T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-17T00:00:00-04:00"})
            );
            expect(
                WORKDAY0({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-17T00:00:00-04:00"})
            );
        });
        it("WORKDAY1", function(){
            expect(
                WORKDAY1({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-17T00:00:00-04:00"})
            );
        });
        it("WORKDAY-1", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY1({"day.ending":"2015-07-15T00:00:00-04:00"})
            );
        });
        it("WORKDAY_1", function(){
            expect(
                WORKDAY_1({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-15T00:00:00-04:00"})
            );
        });
        it("WORKDAY2", function(){
            expect(
                WORKDAY2({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-20T00:00:00-04:00"})
            );
        });
        it("WORKDAY-2", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY2({"day.ending":"2015-07-14T00:00:00-04:00"})
            );
        });
        it("WORKDAY_2", function(){
            expect(
                WORKDAY_2({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-14T00:00:00-04:00"})
            );
        });
        it("WORKDAY4", function(){
            expect(
                WORKDAY4({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-22T00:00:00-04:00"})
            );
        });
        it("WORKDAY-4", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY4({"day.ending":"2015-07-10T00:00:00-04:00"})
            );
        });
        it("WORKDAY_4", function(){
            expect(
                WORKDAY_4({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-10T00:00:00-04:00"})
            );
        });
        it("WORKDAY5", function(){
            expect(
                WORKDAY5({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-23T00:00:00-04:00"})
            );
        });
        it("WORKDAY-5", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY5({"day.ending":"2015-07-09T00:00:00-04:00"})
            );
        });
        it("WORKDAY_5", function(){
            expect(
                WORKDAY_5({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-09T00:00:00-04:00"})
            );
        });
        it("WORKDAY_6", function(){
            expect(
                WORKDAY_6({"day.ending":"2015-07-17T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-09T00:00:00-04:00"})
            );
        });
    });
    describe("NETWORKDAYS", function(){
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var NETWORKDAYS = parser.parse('NETWORKDAYS(from, to)');
        it("NETWORKDAYS", function() {
            expect(NETWORKDAYS({
                from: "2012-10-01",
                to: "2013-03-01"
            })).to.equal(110);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-01"
            })).to.equal(1);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-02"
            })).to.equal(1);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-03"
            })).to.equal(1);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-04"
            })).to.equal(2);
        });
        it("NETWORKDAYS0", function() {
            expect(NETWORKDAYS({
                from: "2015-07-18T00:00:00-04:00",
                to: "2015-07-19T00:00:00-04:00"
            })).to.equal(0);
        });
        it("NETWORKDAYS2", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-17T00:00:00-04:00"
            })).to.equal(2);
        });
        it("NETWORKDAYS3", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-20T00:00:00-04:00"
            })).to.equal(3);
        });
        it("NETWORKDAYS5", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-22T00:00:00-04:00"
            })).to.equal(5);
        });
        it("NETWORKDAYS6", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-23T00:00:00-04:00"
            })).to.equal(6);
        });
        it("NETWORKDAYS-1", function() {
            expect(NETWORKDAYS({
                from: "2015-07-19T00:00:00-04:00",
                to: "2015-07-17T00:00:00-04:00"
            })).to.equal(-1);
            expect(NETWORKDAYS({
                from: "2015-07-18T00:00:00-04:00",
                to: "2015-07-17T00:00:00-04:00"
            })).to.equal(-1);
        });
        it("NETWORKDAYS-2", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-15T00:00:00-04:00"
            })).to.equal(-2);
        });
        it("NETWORKDAYS-3", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-14T00:00:00-04:00"
            })).to.equal(-3);
        });
        it("NETWORKDAYS-5", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-10T00:00:00-04:00"
            })).to.equal(-5);
        });
        it("NETWORKDAYS-6", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-09T00:00:00-04:00"
            })).to.equal(-6);
        });
    });
    describe("EDATE", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var EDATE = parser.parse('EDATE(date, duration)');
        it("1", function() {
            expect(EDATE({date: "2015-01-11", duration: 1})).to.have.string("2015-02-11");
        });
        it("-1", function() {
            expect(EDATE({date: "2015-01-11", duration: -1})).to.have.string("2014-12-11");
        });
        it("2", function() {
            expect(EDATE({date: "2015-01-11", duration: 2})).to.have.string("2015-03-11");
        });
        it("-P15D", function() {
            expect(EDATE({date: "2010-02-08", duration: "-P15D"})).to.have.string("2010-01-24");
        });
        it("P30D", function() {
            expect(EDATE({date: "2010-02-08", duration: "P30D"})).to.have.string("2010-03-10");
        });
        it("-P15D", function() {
            expect(EDATE({date: "2010-03-10", duration: "-P15D"})).to.have.string("2010-02-23");
        });
        it("P3Y", function() {
            expect(EDATE({date: "2009-06-09", duration: "P3Y"})).to.have.string("2012-06-09");
        });
        it("-P5Y", function() {
            expect(EDATE({date: "2009-09-02", duration: "-P5Y"})).to.have.string("2004-09-02");
        });
        it("P25Y", function() {
            expect(EDATE({date: "2010-12-10", duration: "P25Y"})).to.have.string("2035-12-10");
        });
        it("P3Y1M5D", function() {
            expect(EDATE({date: "2009-06-09", duration: "P3Y1M5D"})).to.have.string("2012-07-14");
        });
        it("P1Y7M5D", function() {
            expect(EDATE({date: "2009-06-09", duration: "P1Y7M5D"})).to.have.string("2011-01-14");
        });
    });
    describe("TEXT", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        it("$,.2f", function() {
            expect(parser.parse('TEXT(val, "$,.2f")')({val: 1234.56})).to.equal("$1,234.56");
        });
        it(".1%", function() {
            expect(parser.parse('TEXT(val, ".1%")')({val: 0.285})).to.equal("28.5%");
        });
        it.skip(".2E", function() {
            expect(parser.parse('TEXT(val, ".2E")')({val: 12200000})).to.equal("1.22E+07");
        });
        it("07", function() {
            expect(parser.parse('TEXT(val, "07")')({val: 1234})).to.equal("0001234");
        });
        it("MM/DD/YY", function() {
            expect(parser.parse('TEXT(val, "MM/DD/YY")')({val: "2012-03-14T13:29:00-04:00"})).to.equal("03/14/12");
        });
        it("dddd", function() {
            expect(parser.parse('TEXT(val, "dddd")')({val: "2012-03-14T13:29:00-04:00"})).to.equal("Wednesday");
        });
        it("h:mm A", function() {
            expect(parser.parse('TEXT(val, "h:mm A")')({val: "2012-03-14T13:29:00-04:00"})).to.equal("1:29 PM");
        });
    });
    describe("LEFT/RIGHT", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var LEFT = parser.parse('LEFT(t, n)');
        var RIGHT = parser.parse('RIGHT(t, n)');
        it("a1", function() {
            expect(LEFT({t:"a",n:1})).to.equal("a");
            expect(RIGHT({t:"a",n:1})).to.equal("a");
        });
        it("ab1", function() {
            expect(LEFT({t:"ab",n:1})).to.equal("a");
            expect(RIGHT({t:"ab",n:1})).to.equal("b");
        });
        it("abc2", function() {
            expect(LEFT({t:"abc",n:2})).to.equal("ab");
            expect(RIGHT({t:"abc",n:2})).to.equal("bc");
        });
        it("abc4", function() {
            expect(LEFT({t:"abc",n:4})).to.equal("abc");
            expect(RIGHT({t:"abc",n:4})).to.equal("abc");
        });
        it("1", function() {
            expect(LEFT({t:"",n:1})).to.equal("");
            expect(RIGHT({t:"",n:1})).to.equal("");
        });
        it("abc0", function() {
            expect(LEFT({t:"abc",n:0})).to.equal("");
            expect(RIGHT({t:"abc",n:0})).to.equal("");
        });
        it("abc-1", function() {
            expect(LEFT({t:"abc",n:-1})).to.equal("");
            expect(RIGHT({t:"abc",n:-1})).to.equal("");
        });
        it("null1", function() {
            expect(LEFT({n:1})).to.equal(null);
            expect(RIGHT({n:1})).to.equal(null);
        });
    });
    describe("SEARCH/REPLACE", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var LEN = parser.parse('LEN(t)');
        var REPLACE = parser.parse('REPLACE(t, p, l, n)');
        var SEARCH = parser.parse('SEARCH(f, t, p)');
        it("abc", function() {
            expect(REPLACE({t:"abc"})).to.equal("abc");
            expect(REPLACE({t:"abc",p:2})).to.equal("abc");
            expect(LEN({t:"abc"})).to.equal(3);
            expect(SEARCH({f:"a",t:"abcabc",p:1})).to.equal(1);
            expect(SEARCH({f:"a",t:"abcabc",p:2})).to.equal(4);
        });
        it("bc", function() {
            expect(REPLACE({t:"abc",p:1,l:1})).to.equal("bc");
            expect(LEN({t:"bc"})).to.equal(2);
            expect(SEARCH({f:"bc",t:"abc"})).to.equal(2);
        });
        it("ab1", function() {
            expect(REPLACE({t:"abc",p:3,l:1,n:'1'})).to.equal("ab1");
            expect(LEN({t:"ab1"})).to.equal(3);
            expect(SEARCH({f:"1",t:"ab1"})).to.equal(3);
        });
        it("1", function() {
            expect(REPLACE({t:"abc",p:1,l:3,n:'1'})).to.equal("1");
            expect(LEN({t:"1"})).to.equal(1);
            expect(SEARCH({f:"bc",t:"abc"})).to.equal(2);
        });
        it("ab-c", function() {
            expect(REPLACE({t:"abc",p:3,l:0,n:'-'})).to.equal("ab-c");
            expect(LEN({t:"ab-c"})).to.equal(4);
            expect(SEARCH({f:"B",t:"ab-c"})).to.equal(2);
        });
    });
    describe("Arthimatic", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        it("MIN", function() {
            expect(+parser.parse('MIN(50/1,100-0)')()).to.equal(50);
        });
    });
    describe("Options", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        // note that these options assume no dividend yeild
        var BS = parser.parse('BS(s, k, t, v, r, cp)');
        var BSIV = parser.parse('BSIV(c, s, k, t, r, cp)');
        var ln = parser.parse('LN(s/k)');
        var power = parser.parse('POWER(BSIV(c, s, k, t, r, cp)/100,2)');
        var dn = parser.parse('(r/100+POWER(BSIV(c, s, k, t, r, cp)/100,2)/2)*t/365');
        var xert = parser.parse('k*EXP(-r/100*t/365)');
        var v1 = 'BSIV(c, s, k, t, r, cp)/100*SQRT(t/365)';
        var d1 = `(LN(s/k)+(r/100+POWER(BSIV(c, s, k, t, r, cp)/100,2)/2)*t/365)/(${v1})`;
        var g1 = `EXP(-POWER(${d1},2)/2)/SQRT(2*PI())`;
        var t1 = `-s*${g1}*BSIV(c, s, k, t, r, cp)/100/(2*SQRT(t/365))`;
        var r1 = `k*EXP(-r/100*t/365)*NORMSDIST(${d1}-${v1})`;
        var delta = parser.parse(`NORMSDIST(${d1})`);
        var gamma = parser.parse(`${g1}/(s*${v1})`);
        var ctheta = parser.parse(`(${t1}-(r/100*${r1}))/365`);
        var ptheta = parser.parse(`(${t1}+(r/100*${r1}))/365`);
        var vega = parser.parse(`${g1}*s*SQRT(t/365)/100`);
        var rho = parser.parse(`t/365*${r1}/100`);
        var nd2 = parser.parse(`NORMSDIST(${d1}-${v1})`);
        var pd1 = parser.parse(d1);
        var dd = parser.parse(v1);
        it("35 call option", function() {
            expect(BS    ({c:2.42,s:36.07,k:35,t:26,v:48,r:1,cp:'C'})).to.closeTo(2.42, 1);
            expect(BSIV  ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(48, 1);
            expect(ln    ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.0301, 0.0005);
            expect(power ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.23, 0.005);
            expect(dn    ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.0090, 0.0005);
            expect(dd    ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.12, 0.05);
            expect(pd1   ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.303, 0.001);
            expect(xert  ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(34.98, 0.01);
            expect(nd2   ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.5695, 0.001);
            expect(delta ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.6194, 0.0005);
            expect(gamma ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.0820, 0.0005);
            expect(ctheta({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(-0.0346, 0.0005);
            expect(vega  ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.0367, 0.0005);
            expect(rho   ({c:2.42,s:36.07,k:35,t:26,r:1,cp:'C'})).to.closeTo(0.0142, 0.005);
        });
        it("35 put option", function() {
            expect(BS    ({s:36.07,k:35,t:26,v:48,r:1,cp:'P'})).to.closeTo(1.33, 1);
            expect(BSIV  ({c:1.33,s:36.07,k:35,t:26,r:1,cp:'P'})).to.closeTo(48, 1);
            expect(delta ({c:1.33,s:36.07,k:35,t:26,r:1,cp:'P'})).to.closeTo(1-0.3806, 0.0005);
            expect(gamma ({c:1.33,s:36.07,k:35,t:26,r:1,cp:'P'})).to.closeTo(0.0820, 0.0005);
            expect(ptheta({c:1.33,s:36.07,k:35,t:26,r:1,cp:'P'})).to.closeTo(-0.0336, 0.0005);
            expect(vega  ({c:1.33,s:36.07,k:35,t:26,r:1,cp:'P'})).to.closeTo(0.0367, 0.0005);
            expect(rho   ({c:1.33,s:36.07,k:35,t:26,r:1,cp:'P'})).to.closeTo(0.0107, 0.005);
        });
        it("call delta", function() {
            expect(delta({c:0.80,s:1516.12,k:1680,t:67,r:0.5,cp:'C'})).to.closeTo(0.0268, 0.0005);
        });
        it("put delta", function() {
            expect(delta({c:19.15,s:1516.12,k:1470,t:67,r:0.5,cp:'P'})).to.closeTo(1-0.30, 0.001);
        });
    });
});
