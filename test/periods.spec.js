// intervals.spec.js
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
const _ = require('underscore');
const moment = require('moment-timezone');
const expect = require('chai').expect;
const periods = require('../src/periods.js');

describe("periods", function(){
    var stocks = {
        tz: "America/New_York",
        marketOpensAt: "09:30:00",
        marketClosesAt: "16:00:00",
        premarketOpensAt: "04:00:00",
        afterHoursClosesAt: "20:00:00"
    };
    describe("stocks", function() {
        testMarket(stocks);
        testMinuteIntervals(stocks);
    });
    describe("fx", function() {
        testMarket({
            tz: "America/New_York",
            marketOpensAt: "17:00:00",
            marketClosesAt: "17:00:00",
            premarketOpensAt: "17:00:00",
            afterHoursClosesAt: "17:00:00"
        });
    });
    describe("index", function() {
        testMarket({
            tz: "America/New_York",
            marketOpensAt: "18:00:00",
            marketClosesAt: "18:00:00",
            premarketOpensAt: "17:00:00",
            afterHoursClosesAt: "17:00:00"
        });
    });
    describe("24hours", function() {
        testMinuteIntervals({
            tz: "America/New_York",
            marketOpensAt: "16:00:00",
            marketClosesAt: "16:00:00",
            premarketOpensAt: "16:00:00",
            afterHoursClosesAt: "16:00:00"
        });
    });
});

function testMarket(ex) {
    var intervals = _.object(periods.values, periods.values.map(value => periods(_.extend({
        interval: value
    }, ex))));
    describe("spot check", function(){
        describe('year', function(){
            describe('inc', function(){
                it("Fri Jan 31 2014 00:00:00 GMT-0500 (EST) by 1", function() {
                    var amount = 1;
                    var date = new Date("Fri Jan 31 2014 00:00:00 GMT-0500 (EST)");
                    var inc = intervals.year.inc(date, amount);
                    expect(moment(inc).year()).to.eql(2015);
                    expect(intervals.year.diff(inc, date)).to.eql(amount);
                    expect(intervals.year.diff(date, inc)).to.eql(-amount);
                });
            });
        });
        describe("m1", function() {
            var size = 1;
            var amount = 420;
            var date = moment("2012-01-13T09:30:00.000-05:00");
            it(date.toString() + ' by ' + amount, function(){
                var dec = intervals['m' + size].dec(date, amount);
                expect(date.valueOf()).to.be.a('number');
                expect(dec.valueOf()).to.be.a('number');
                expect(dec.valueOf() % size *60 *1000).to.eql(0);
                expect(date.valueOf() - dec.valueOf() > 0).to.be.true;
                if (size < 60) expect((date.valueOf() - dec.valueOf()) /1000 /60).not.to.be.below(size * amount);
                expect((date.valueOf() - dec.valueOf()) /1000 /60).to.be.below(Math.ceil(size * amount /60 /6.5 /5) *7 * 24 *60 +2 *24 *60);
                if (ex.premarketOpensAt != ex.afterHoursClosesAt) {
                    var opens = moment.tz(dec.format('YYYY-MM-DD') + 'T' + ex.premarketOpensAt, ex.tz);
                    var closes = moment.tz(dec.format('YYYY-MM-DD') + 'T' + ex.afterHoursClosesAt, ex.tz);
                    expect(dec.format(), "dec " + amount + " of " + moment.tz(date, ex.tz).format()).not.to.be.below(opens.format());
                    expect(dec.valueOf() >= opens.valueOf()).to.be.true;
                    expect(dec.format(), "dec " + amount + " of " + moment.tz(date, ex.tz).format()).not.to.be.above(closes.format());
                    expect(dec.valueOf() <= closes.valueOf()).to.be.true;
                }
            });
        });
        describe("m2", function() {
            var interval = intervals['m2'];
            var date = moment("2013-02-04T07:41:58-05:00");
            var amount = 233;
            it(date.toString() + ' by ' + amount, function(){
                var dec = interval.dec(date, amount);
                expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                expect(interval.diff(date, dec)).to.eql(amount);
            });
            var date = moment(new Date("Fri Sep 02 2011 16:10:46 GMT-0400"));
            var amount = 34;
            it(date.toString() + ' by ' + amount, function(){
                var inc = interval.inc(date, amount);
                var dec = interval.dec(date, amount);
                expect(interval.diff(inc, date)).to.eql(amount);
                expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                expect(interval.diff(date, inc)).to.eql(-amount);
                expect(interval.diff(date, dec)).to.eql(amount);
            });
            var date = moment("2012-02-12T19:22:38-05:00");
            var amount = 144;
            it(date.toString() + ' by ' + amount, function(){
                var inc = interval.inc(date, amount);
                var dec = interval.dec(date, amount);
                expect(interval.diff(inc, date)).to.eql(amount);
                expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                expect(interval.diff(date, inc)).to.eql(-amount);
                expect(interval.diff(date, dec)).to.eql(amount);
            });
        });
        describe('m60', function(){
            describe('inc', function(){
                it("Fri Jan 31 2014 16:00:00 GMT-0500 (EST) by 1", function(){
                    var amount = 1;
                    var date = new Date("Fri Jan 31 2014 16:00:00 GMT-0500 (EST)");
                    var inc = intervals.m60.inc(date, amount);
                    expect(moment(inc).minute()).to.eql(0);
                    expect(intervals.m60.diff(inc, date)).to.eql(amount);
                    expect(intervals.m60.diff(date, inc)).to.eql(-amount);
                });
            });
            var interval = intervals['m60'];
            var date = moment("2010-01-01T01:27:00-05:00");
            var amount = 34;
            it(date.toString() + ' by ' + amount, function(){
                var dec = interval.dec(date, amount);
                expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                expect(interval.diff(date, dec)).to.eql(amount);
            });
            var date = moment(new Date("Fri Jan 01 2010 10:08:00 GMT-0500"));
            var amount = 233;
            it(date.toString() + ' by ' + amount, function(){
                var inc = interval.inc(date, amount);
                var dec = interval.dec(date, amount);
                expect(interval.diff(inc, date)).to.eql(amount);
                expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                expect(interval.diff(date, inc)).to.eql(-amount);
                expect(interval.diff(date, dec)).to.eql(amount);
            });
        });
        describe('m120', function(){
            describe('inc', function(){
                it("Fri Jan 31 2014 16:00:00 GMT-0500 (EST) by 1", function(){
                    var amount = 1;
                    var date = new Date("Fri Jan 31 2014 16:00:00 GMT-0500 (EST)");
                    var inc = intervals.m120.inc(date, amount);
                    expect(moment(inc).minute()).to.eql(0);
                    expect(intervals.m120.diff(inc, date)).to.eql(amount);
                    expect(intervals.m120.diff(date, inc)).to.eql(-amount);
                });
            });
            var interval = intervals['m120'];
            var date = moment(new Date("Thu Mar 29 2012 10:42:00 GMT-0400"));
            var amount = 21;
            it(date.toString() + ' by ' + amount, function(){
                var inc = interval.inc(date, amount);
                var dec = interval.dec(date, amount);
                expect(interval.diff(inc, date)).to.eql(amount);
                expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                expect(interval.diff(date, inc)).to.eql(-amount);
                expect(interval.diff(date, dec)).to.eql(amount);
            });
        });
        describe('day', function(){
            describe("inc", function() {
                it("Mon Oct 13 2014 16:00:00 GMT-0400 (EDT) by 1", function(){
                    var amount = 1;
                    var date = new Date("Mon Oct 13 2014 16:00:00 GMT-0400 (EDT)");
                    var inc = intervals.day.inc(date, amount);
                    expect(moment(inc).subtract(1,'minute').format('dddd')).to.eql(moment(date).add(1,'day').format('dddd'));
                    expect(intervals.day.diff(inc, date)).to.eql(amount);
                    expect(intervals.day.diff(date, inc)).to.eql(-amount);
                });
                it("Wed Oct 15 2014 16:00:00 GMT-0400 (EDT) by 1", function(){
                    var amount = 1;
                    var date = new Date("Wed Oct 15 2014 16:00:00 GMT-0400 (EDT)");
                    var inc = intervals.day.inc(date, amount);
                    expect(moment(inc).subtract(1,'minute').format('dddd')).to.eql(moment(date).add(1,'day').format('dddd'));
                    expect(intervals.day.diff(inc, date)).to.eql(amount);
                    expect(intervals.day.diff(date, inc)).to.eql(-amount);
                });
            });
            describe("dec", function() {
                it("Wed Oct 15 2014 16:00:00 GMT-0400 (EDT) by 1", function(){
                    var amount = 1;
                    var date = new Date("Wed Oct 15 2014 16:00:00 GMT-0400 (EDT)");
                    var dec = intervals.day.dec(date, amount);
                    expect(moment(dec).format('dddd')).to.eql(moment(date).subtract(1,'day').format('dddd'));
                    expect(intervals.day.diff(dec, date)).to.eql(-amount);
                    expect(intervals.day.diff(date, dec)).to.eql(amount);
                });
                it("Fri Oct 17 2014 16:00:00 GMT-0400 (EDT) by 1", function(){
                    var amount = 1;
                    var date = new Date("Fri Oct 17 2014 16:00:00 GMT-0400 (EDT)");
                    var dec = intervals.day.dec(date, amount);
                    expect(moment(dec).format('dddd')).to.eql(moment(date).subtract(1,'day').format('dddd'));
                    expect(intervals.day.diff(dec, date)).to.eql(-amount);
                    expect(intervals.day.diff(date, dec)).to.eql(amount);
                });
            });
            describe("diff", function() {
                it("Wed Oct 15 2014 16:00:00 GMT-0400 (EDT)", function(){
                    var date = new Date("Wed Oct 15 2014 16:00:00 GMT-0400 (EDT)");
                    expect(intervals.day.diff(date, date)).to.eql(0);
                    expect(intervals.day.diff(date, moment(date).subtract(1,'days'))).to.eql(1);
                });
                it("Fri Oct 17 2014 16:00:00 GMT-0400 (EDT) by 1", function(){
                    var date = new Date("Fri Oct 17 2014 16:00:00 GMT-0400 (EDT)");
                    expect(intervals.day.diff(moment(date).add(1,'days'), date)).to.eql(1);
                });
            });
        });
    });
    describe('day', function(){
        describe("ceil", function() {
            datesBetween(new Date(2010,0,1), new Date(2015,0,1), 60 *60 *1000).forEach(function(date){
                it(date.toString(), function(){
                    var ceil = intervals.day.ceil(date);
                    expect(date.valueOf()).to.be.a('number');
                    expect(ceil.valueOf()).to.be.a('number');
                    expect(ceil.valueOf() - date.valueOf() >= 0).to.be.true;
                    expect(ceil.valueOf() - date.valueOf() < 3 *24 *60 *60 *1000).to.be.true;
                });
            });
        });
        describe("floor", function() {
            datesBetween(new Date(2010,0,1), new Date(2015,0,1), 60 *60 *1000).forEach(function(date){
                it(date.toString(), function(){
                    var floor = intervals.day.floor(date);
                    expect(date.valueOf()).to.be.a('number');
                    expect(floor.valueOf()).to.be.a('number');
                    expect(date.valueOf() - floor.valueOf() >= 0).to.be.true;
                    expect(date.valueOf() - floor.valueOf() < 3 *24 *60 *60 *1000).to.be.true;
                });
            });
        });
        describe("inc", function() {
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var inc = intervals.day.inc(date, amount);
                    expect(date.valueOf()).to.be.a('number');
                    expect(inc.valueOf()).to.be.a('number');
                    expect(inc.valueOf() - date.valueOf() > 0).to.be.true;
                    expect((inc.valueOf() - date.valueOf()) /1000 /60 /60 /24).not.to.be.below(amount);
                    expect((inc.valueOf() - date.valueOf()) /1000 /60 /60 /24).to.be.below(Math.ceil(amount /5) *7 +3);
                    expect(intervals.day.diff(inc, date)).to.eql(amount);
                    expect(intervals.day.diff(date, inc)).to.eql(-amount);
                });
            });
        });
        describe("dec", function() {
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var dec = intervals.day.dec(date, amount);
                    expect(date.valueOf()).to.be.a('number');
                    expect(dec.valueOf()).to.be.a('number');
                    expect(dec.valueOf() % 60 *1000).to.eql(0);
                    expect(date.valueOf() - dec.valueOf() > 0).to.be.true;
                    expect((date.valueOf() - dec.valueOf()) /1000 /60 /60 /24).not.to.be.below(amount);
                    expect((date.valueOf() - dec.valueOf()) /1000 /60 /60 /24).to.be.below(Math.ceil(amount /5) *7 +3);
                    expect(intervals.day.diff(dec, date)).to.eql(-amount);
                    expect(intervals.day.diff(date, dec)).to.eql(amount);
                });
            });
        });
    });
    describe('week', function(){
        describe("ceil", function() {
            datesBetween(new Date(2010,0,1), new Date(2015,0,1), 5 *60 *60 *1000).forEach(function(date){
                it(date.toString(), function(){
                    var ceil = intervals.week.ceil(date);
                    expect(date.valueOf()).to.be.a('number');
                    expect(ceil.valueOf()).to.be.a('number');
                    expect(ceil.valueOf() - date.valueOf() >= 0).to.be.true;
                    expect(ceil.valueOf() - date.valueOf() < 7 *24 *60 *60 *1000).to.be.true;
                });
            });
        });
        describe("floor", function() {
            datesBetween(new Date(2010,0,1), new Date(2015,0,1), 5 *60 *60 *1000).forEach(function(date){
                it(date.toString(), function(){
                    var floor = intervals.week.floor(date);
                    expect(date.valueOf()).to.be.a('number');
                    expect(floor.valueOf()).to.be.a('number');
                    expect(date.valueOf() - floor.valueOf() >= 0).to.be.true;
                    expect(date.valueOf() - floor.valueOf() < 7 *24 *60 *60 *1000).to.be.true;
                });
            });
        });
        describe("inc", function() {
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 5 *60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var inc = intervals.week.inc(date, amount);
                    expect(date.valueOf()).to.be.a('number');
                    expect(inc.valueOf()).to.be.a('number');
                    expect(inc.valueOf() - date.valueOf() > 0).to.be.true;
                    expect((inc.valueOf() - date.valueOf()) /1000 /60 /60 /24).not.to.be.below(5 * amount);
                    expect((inc.valueOf() - date.valueOf()) /1000 /60 /60 /24).to.be.below(amount *7 +7);
                    expect(intervals.week.diff(inc, date)).to.eql(amount);
                    expect(intervals.week.diff(date, inc)).to.eql(-amount);
                });
            });
        });
        describe("dec", function() {
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 5 *60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var dec = intervals.week.dec(date, amount);
                    expect(date.valueOf()).to.be.a('number');
                    expect(dec.valueOf()).to.be.a('number');
                    expect(dec.valueOf() % 5 *60 *1000).to.eql(0);
                    expect(date.valueOf() - dec.valueOf() > 0).to.be.true;
                    expect((date.valueOf() - dec.valueOf()) /1000 /60 /60 /24).not.to.be.below(5 * amount);
                    expect((date.valueOf() - dec.valueOf()) /1000 /60 /60 /24).to.be.below(amount *7 +7);
                    expect(intervals.week.diff(dec, date)).to.eql(-amount);
                    expect(intervals.week.diff(date, dec)).to.eql(amount);
                });
            });
        });
    });
}

function testMinuteIntervals(ex) {
    testMinuteInterval(ex, 1);
    testMinuteInterval(ex, 2);
    testMinuteInterval(ex, 5);
    testMinuteInterval(ex, 10);
    testMinuteInterval(ex, 15);
    testMinuteInterval(ex, 20);
    testMinuteInterval(ex, 30);
    testMinuteInterval(ex, 60);
    testMinuteInterval(ex, 120);
    testMinuteInterval(ex, 240);
}

function testMinuteInterval(ex, size) {
    var intervals = _.object(periods.values, periods.values.map(value => periods(_.extend({
        interval: value
    }, ex))));
    describe('m' + size, function(){
        describe("ceil", function() {
            datesBetween(new Date(2010,0,1), new Date(2015,0,1), size * 1000).forEach(function(date){
                it(date.toString(), function(){
                    var ceil = intervals['m' + size].ceil(date);
                    expect(date.valueOf()).to.be.a('number');
                    expect(ceil.valueOf()).to.be.a('number');
                    expect(ceil.valueOf() % size *60 *1000).to.eql(0);
                    expect(ceil.valueOf() - date.valueOf() >= 0).to.be.true;
                    expect(ceil.valueOf() - date.valueOf() < size * 60000).to.be.true;
                    if (size < 60) expect(ceil.valueOf() == date.valueOf()).to.equal(date.valueOf() % (size * 60*1000) === 0);
                });
            });
        });
        describe("floor", function() {
            datesBetween(new Date(2010,0,1), new Date(2015,0,1), size * 1000).forEach(function(date){
                it(date.toString(), function(){
                    var floor = intervals['m' + size].floor(date);
                    expect(date.valueOf()).to.be.a('number');
                    expect(floor.valueOf()).to.be.a('number');
                    expect(floor.valueOf() % size *60 *1000).to.eql(0);
                    expect(date.valueOf() - floor.valueOf() >= 0).to.be.true;
                    expect(date.valueOf() - floor.valueOf() < size * 60000).to.be.true;
                    if (size < 60) expect(date.valueOf() == floor.valueOf()).to.equal(date.valueOf() % (size * 60*1000) === 0);
                });
            });
        });
        describe("inc", function() {
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), size * 1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var inc = intervals['m' + size].inc(date, amount);
                    expect(date.valueOf()).to.be.a('number');
                    expect(inc.valueOf()).to.be.a('number');
                    expect(inc.valueOf() % size *60 *1000).to.eql(0);
                    expect(inc.valueOf() - date.valueOf() > 0).to.be.true;
                    expect((inc.valueOf() - date.valueOf()) /1000 /60).not.to.be.below(size * amount);
                    expect((inc.valueOf() - date.valueOf()) /1000 /60).to.be.below(Math.ceil(size * amount /60 /6.5 /5) *7 *24 *60 +2 *24 *60);
                    if (ex.premarketOpensAt != ex.afterHoursClosesAt) {
                        var opens = moment.tz(inc.format('YYYY-MM-DD') + 'T' + ex.premarketOpensAt, ex.tz);
                        var closes = moment.tz(inc.format('YYYY-MM-DD') + 'T' + ex.afterHoursClosesAt, ex.tz);
                        expect(inc.valueOf() >= opens.valueOf()).to.be.true;
                        expect(inc.valueOf() <= closes.valueOf()).to.be.true;
                    }
                });
            });
        });
        describe("dec", function() {
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), size * 1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var dec = intervals['m' + size].dec(date, amount);
                    expect(date.valueOf()).to.be.a('number');
                    expect(dec.valueOf()).to.be.a('number');
                    expect(dec.valueOf() % size *60 *1000).to.eql(0);
                    expect(date.valueOf() - dec.valueOf() > 0).to.be.true;
                    if (size < 60) expect((date.valueOf() - dec.valueOf()) /1000 /60).not.to.be.below(size * amount);
                    expect((date.valueOf() - dec.valueOf()) /1000 /60).to.be.below(Math.ceil(size * amount /60 /6.5 /5) *7 * 24 *60 +2 *24 *60);
                    if (ex.premarketOpensAt != ex.afterHoursClosesAt) {
                        var opens = moment.tz(dec.format('YYYY-MM-DD') + 'T' + ex.premarketOpensAt, ex.tz);
                        var closes = moment.tz(dec.format('YYYY-MM-DD') + 'T' + ex.afterHoursClosesAt, ex.tz);
                        expect(dec.format(), "dec " + amount + " of " + moment.tz(date, ex.tz).format()).not.to.be.below(opens.format());
                        expect(dec.valueOf() >= opens.valueOf()).to.be.true;
                        expect(dec.format(), "dec " + amount + " of " + moment.tz(date, ex.tz).format()).not.to.be.above(closes.format());
                        expect(dec.valueOf() <= closes.valueOf()).to.be.true;
                    }
                });
            });
        });
        describe("diff", function() {
            var interval = intervals['m' + size];
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), size * 1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                var amount = numbers[i];
                it(date.toString() + ' by ' + amount, function(){
                    var inc = interval.inc(date, amount);
                    var dec = interval.dec(date, amount);
                    expect(interval.diff(inc, date)).to.eql(amount);
                    expect(interval.diff(dec, date), "Between " + dec.format() + " and " + date.format()).to.eql(-amount);
                    expect(interval.diff(date, inc)).to.eql(-amount);
                    expect(interval.diff(date, dec)).to.eql(amount);
                });
            });
        });
    });
}

function datesBetween(start, stop, step) {
    var result = [];
    var f0 = 0, f1 = 1;
    var reset = (stop.valueOf() - start.valueOf())/step/10;
    var time = start.valueOf();
    while (time < stop.valueOf()) {
        if (f1 > reset) {
            f0 = 0;
            f1 = 1;
        } else {
            f1 = f0 + f1;
            f0 = f1 - f0;
        }
        time = time + f1 * step;
        result.push(moment(time));
    }
    return result;
}

function numbersBetween(min, max, length) {
    var result = new Array(length);
    var f0 = 0, f1 = 1;
    for (var i=0;i<length;i++) {
        if (min + f0 + f1 > max) {
            f0 = 0;
            f1 = 1;
        } else {
            f1 = f0 + f1;
            f0 = f1 - f0;
        }
        result[i] = min + f1;
    }
    return result;
    
}
