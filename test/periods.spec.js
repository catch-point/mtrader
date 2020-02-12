// intervals.spec.js
/*
 *  Copyright (c) 2014-2018 James Leigh, Some Rights Reserved
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
    describe("stocks", function() {
        testMarket({
            tz: "America/New_York",
            security_tz: "America/New_York",
            trading_hours: "04:00:00 - 20:00:00",
            liquid_hours: "09:30:00 - 16:00:00",
            open_time: "09:30:00"
        });
    });
    describe("fx", function() {
        testMarket({
            tz: "America/New_York",
            security_tz: "America/New_York",
            trading_hours: "17:00:00 - 17:00:00",
            liquid_hours: "17:00:00 - 17:00:00",
            open_time: "17:00:00"
        });
    });
    describe("futures", function() {
        testMarket({
            tz: "America/New_York",
            trading_hours: "17:00:00 - 16:00:00",
            liquid_hours: "08:30:00 - 16:00:00",
            open_time: "17:00:00",
            security_tz: "America/Chicago",
        });
    });
    describe("mercantile", function() {
        testMarket({
            tz: "America/New_York",
            trading_hours: "17:00:00 - 17:00:00",
            liquid_hours: "18:00:00 - 17:00:00",
            open_time: "18:00:00",
            security_tz: "America/New_York",
        });
    });
    describe("options", function() {
        testMarket({
            tz: "America/New_York",
            trading_hours: "02:00:00 - 15:15:00",
            liquid_hours: "08:30:00 - 15:15:00",
            open_time: "08:30:00",
            security_tz: "America/Chicago"
        });
    });
});

function testMarket(ex) {
    var intervals = _.object(periods.values, periods.values.map(value => periods(_.extend({
        interval: value
    }, ex))));
    describe('spot check', function() {
        shouldBeConsistent(it, ex, intervals['m30'], moment('2014-03-09T20:31:00-04:00'), 144);
        shouldBeConsistent(it, ex, intervals['m120'], moment('2010-01-01T00:02:00-05:00'), 1);
    });
    describe('interday', function() {
        describe('day', function(){
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                shouldBeConsistent(it, ex,intervals.day, date, numbers[i]);
            });
        });
        describe('week', function(){
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 5 *60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                shouldBeConsistent(it, ex,intervals.week, date, numbers[i]);
            });
        });
        describe('month', function(){
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 30 *60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                shouldBeConsistent(it, ex,intervals.month, date, numbers[i]);
            });
        });
        describe('quarter', function(){
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 90 *60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                shouldBeConsistent(it, ex,intervals.quarter, date, numbers[i]);
            });
        });
        describe('year', function(){
            var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), 250 *60 *60 *1000);
            var numbers = numbersBetween(0, 500, dates.length);
            dates.forEach(function(date,i,dates){
                shouldBeConsistent(it, ex,intervals.year, date, numbers[i]);
            });
        });
    });
    describe('intraday', function() {
        describe('m1', testMinuteInterval(ex, 1));
        describe('m2', testMinuteInterval(ex, 2));
        describe('m5', testMinuteInterval(ex, 5));
        describe('m10', testMinuteInterval(ex, 10));
        describe('m15', testMinuteInterval(ex, 15));
        describe('m20', testMinuteInterval(ex, 20));
        describe('m30', testMinuteInterval(ex, 30));
        describe('m60', testMinuteInterval(ex, 60));
        describe('m120', testMinuteInterval(ex, 120));
        describe('m240', testMinuteInterval(ex, 240));
    });
}

function testMinuteInterval(ex, size) {
    var intervals = _.object(periods.values, periods.values.map(value => periods(_.extend({
        interval: value
    }, ex))));
    return function(){
        var interval = intervals['m' + size];
        var dates = datesBetween(new Date(2010,0,1), new Date(2015,0,1), size * 1000);
        var numbers = numbersBetween(0, 500, dates.length);
        dates.forEach(function(date,i,dates){
            shouldBeConsistent(it, ex,interval, date, numbers[i]);
        });
    };
}

function shouldBeConsistent(it, ex, interval, date, amount) {
    it(`shouldBeConsistent(it.o${'nly'}, ex, intervals['${interval.value}'], moment('${date.format()}'), ${amount})`, () => {
        const dec = interval.dec(date, amount);
        const inc = interval.inc(date, amount);
        expectCloseOrNotOpen(ex, interval, dec);
        expectCloseOrNotOpen(ex, interval, inc);
        expect(dec.format()).to.eql(interval.inc(date, -amount).format());
        expect(inc.format()).to.eql(interval.dec(date, -amount).format());
        expectPeriodDiffConsistency(ex, interval, date, dec, amount);
        expectPeriodDiffConsistency(ex, interval, inc, date, amount);
        expect(interval.dec(interval.inc(date, amount *2), amount).format()).to.eql(inc.format());
        expect(interval.inc(interval.dec(date, amount *2), amount).format()).to.eql(dec.format());
    });
}

function expectOpenOrNotClose(ex, interval, date) {
    const rth = interval.value.charAt(0) != 'm' || interval.value == 'month';
    const open_time = rth ? ex.open_time || ex.liquid_hours.substring(0, 8) : ex.trading_hours.substring(0, 8);
    const end_time = rth ? ex.liquid_hours.substring(11) : ex.trading_hours.substring(11);
    const time = moment(date).tz(ex.security_tz).format('HH:mm:ss');
    if (open_time < end_time && open_time <= time) {
        expect(time <= end_time).to.be.true;
    }
    if (open_time < end_time && time <= end_time) {
        expect(open_time <= time).to.be.true;
    }
    if (end_time < open_time && time < open_time) {
        expect(time <= end_time).to.be.true;
    }
    if (end_time < open_time && end_time < time) {
        expect(open_time <= time).to.be.true;
    }
    if (time != open_time && time != '16:00:00' && time != '18:00:00') { // unless 24hr market
        expect(time).not.to.equal(end_time);
    }
}

function expectCloseOrNotOpen(ex, interval, date) {
    const rth = interval.value.charAt(0) != 'm' || interval.value == 'month';
    const open_time = rth ? ex.open_time || ex.liquid_hours.substring(0, 8) : ex.trading_hours.substring(0, 8);
    const end_time = rth ? ex.liquid_hours.substring(11) : ex.trading_hours.substring(11);
    const time = moment(date).tz(ex.security_tz).format('HH:mm:ss');
    if (open_time < end_time && open_time <= time) {
        expect(time <= end_time).to.be.true;
    }
    if (open_time < end_time && time <= end_time) {
        expect(open_time <= time).to.be.true;
    }
    if (end_time < open_time && time < open_time) {
        expect(time <= end_time).to.be.true;
    }
    if (end_time < open_time && end_time < time) {
        expect(open_time <= time).to.be.true;
    }
    if (time != end_time && time != '16:00:00' && time != '18:00:00') { // unless 24hr market
        expect(time).not.to.equal(open_time);
    }
}

function expectPeriodDiffConsistency(ex, interval, to, from, amount) {
    expectPeriodDiffSelfConsistency(ex, interval, to);
    expectPeriodDiffSelfConsistency(ex, interval, from);
    expectPeriodDiffAmountConsistency(interval, to, from, amount);
}

function expectPeriodDiffSelfConsistency(ex, interval, date) {
    expect(interval.diff(date, date)).to.equal(0);
    expectOpenOrNotClose(ex, interval, interval.floor(date));
    expectCloseOrNotOpen(ex, interval, interval.ceil(date));
    expect(interval.floor(interval.floor(date)).format()).to.eql(interval.floor(date).format());
    expect(interval.floor(interval.ceil(interval.floor(date))).format()).to.eql(interval.floor(date).format());
    expect(interval.ceil(interval.ceil(date)).format()).to.eql(interval.ceil(date).format());
    expect(interval.ceil(interval.floor(interval.ceil(date))).format()).to.eql(interval.ceil(date).format());
    if (interval.floor(date).isBefore(date)) {
        expect(interval.diff(date, interval.floor(date))).to.equal(1);
        expect(interval.diff(interval.floor(date), date)).to.equal(-1);
        expect(interval.dec(date, 1).format()).to.eql(interval.ceil(interval.floor(date)).format());
        expect(interval.inc(date, -1).format()).to.eql(interval.ceil(interval.floor(date)).format());
    } else {
        expect(interval.diff(date, interval.floor(date))).to.equal(0);
        expect(interval.diff(interval.floor(date), date)).to.equal(0);
        expect(interval.inc(date, 1).format()).to.eql(interval.inc(interval.floor(date),1).format());
        expect(interval.dec(date, -1).format()).to.eql(interval.inc(interval.floor(date),1).format());
    }
    if (interval.ceil(date).isAfter(date)) {
        expect(interval.diff(date, interval.ceil(date))).to.equal(-1);
        expect(interval.diff(interval.ceil(date), date)).to.equal(1);
        expect(interval.inc(date, 1).format()).to.eql(interval.ceil(date).format());
        expect(interval.dec(date, -1).format()).to.eql(interval.ceil(date).format());
        expect(interval.inc(date, 0).format()).to.eql(date.format());
        expect(interval.dec(date, 0).format()).to.eql(date.format());
    } else {
        expect(interval.diff(date, interval.ceil(date))).to.equal(0);
        expect(interval.diff(interval.ceil(date), date)).to.equal(0);
        expect(interval.dec(date, 1).format()).to.eql(interval.dec(interval.ceil(date),1).format());
        expect(interval.inc(date, -1).format()).to.eql(interval.dec(interval.ceil(date),1).format());
        expect(interval.inc(date, 0).format()).to.eql(interval.ceil(date).format());
        expect(interval.dec(date, 0).format()).to.eql(interval.ceil(date).format());
    }
    if (interval.floor(date).isBefore(date) || interval.ceil(date).isAfter(date)) {
        expect(interval.diff(interval.floor(date), interval.ceil(date))).to.equal(-1);
        expect(interval.diff(interval.ceil(date), interval.floor(date))).to.equal(1);
    } else {
        expect(interval.diff(interval.floor(date), interval.ceil(date))).to.equal(0);
        expect(interval.diff(interval.ceil(date), interval.floor(date))).to.equal(0);
    }
}

function expectPeriodDiffAmountConsistency(interval, to, from, amount) {
    expect(amount).to.be.at.least(0);
    expect(interval.diff(to, from)).to.equal(amount);
    expect(interval.diff(from, to)).to.equal(-amount);
    expect(interval.diff(to, interval.floor(from))).to.equal(amount);
    expect(interval.diff(interval.ceil(to), from)).to.equal(amount);
    expect(interval.diff(interval.ceil(to), interval.floor(from))).to.equal(amount);
    if (interval.floor(to).isBefore(to) && moment(from).isBetween(interval.floor(to),to)) {
        expect(interval.diff(interval.floor(to), from)).to.equal(amount-2);
    } else if (interval.floor(to).isBefore(to)) {
        expect(interval.diff(interval.floor(to), from)).to.equal(amount-1);
    } else {
        expect(interval.diff(interval.floor(to), from)).to.equal(amount);
    }
    if (interval.ceil(from).isAfter(from) && moment(to).isBetween(from,interval.ceil(from))) {
        expect(interval.diff(to, interval.ceil(from))).to.equal(amount-2);
    } else if (interval.ceil(from).isAfter(from)) {
        expect(interval.diff(to, interval.ceil(from))).to.equal(amount-1);
    } else {
        expect(interval.diff(to, interval.ceil(from))).to.equal(amount);
    }
    if (interval.floor(to).isBefore(to) && interval.ceil(from).isAfter(from)) {
        expect(interval.diff(interval.floor(to), interval.ceil(from))).to.equal(amount-2);
    } else if (interval.floor(to).isBefore(to) || interval.ceil(from).isAfter(from)) {
        expect(interval.diff(interval.floor(to), interval.ceil(from))).to.equal(amount-1);
    } else if (!interval.floor(to).isSame(interval.ceil(from))) {
        expect(interval.diff(interval.floor(to), interval.ceil(from))).to.equal(amount);
    }
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
