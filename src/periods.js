// periods.js
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
'use strict';

const _ = require('underscore');
const moment = require('moment-timezone');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(options) {
    expect(options).to.be.like({
        interval: int => expect(int).to.be.oneOf(_.keys(intervals)),
        marketOpensAt: /\d\d:\d\d(:00)?/,
        marketClosesAt: /\d\d:\d\d(:00)?/,
        tz: tz => moment.tz.zone(tz)
        
    });
    const period = intervals[options.interval];
    return {
        value: period.value,
        millis: period.millis,
        floor: period.floor.bind(period, options),
        ceil: period.ceil.bind(period, options),
        inc: period.inc.bind(period, options),
        dec: period.dec.bind(period, options),
        diff: period.diff.bind(period, options),
    };
};

module.exports.sort = periods => _.sortBy(periods, period => {
    if (_.isString(period) && !intervals[period])
        throw Error("Unknown interval: " + period + " must be one of " + _.keys(intervals).join(', '));
    return _.isString(period) ? intervals[period].millis : period.millis;
});

const m1 = {
    value: 'm1',
    millis: 60 * 1000,
    floor: function(ex, dateTime, amount) {
        return moment.tz(dateTime, ex.tz).startOf('minute');
    },
    ceil: function(ex, dateTime) {
        const start = m1.floor(ex, dateTime);
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.add(1, 'minutes');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const start = m1.ceil(ex, dateTime);
        const hours = marketHours(ex, start);
        if (start.isBefore(hours.opens))
            return m1.inc(ex, hours.opens, amount);
        if (start.isAfter(hours.closes))
            return m1.inc(ex, hours.opens.add(1, 'days'), amount);
        const weeks = Math.floor(amount /5 /hours.minInDay);
        if (weeks)
            return m1.inc(ex, start.add(weeks, 'weeks'), Math.round(amount - weeks *5 *hours.minInDay));
        const untilClose = hours.closes.diff(start, 'minutes');
        if (untilClose < amount)
            return m1.inc(ex, hours.opens.add(1, 'days'), amount - untilClose);
        return start.add(amount, 'minutes');
    },
    dec: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const start = m1.floor(ex, dateTime);
        const hours = marketHours(ex, start, true);
        if (start.isBefore(hours.opens))
            return m1.dec(ex, hours.closes.subtract(1, 'days'), amount);
        if (start.isAfter(hours.closes))
            return m1.dec(ex, hours.closes, amount);
        const weeks = Math.floor(amount /5 /hours.minInDay);
        if (weeks)
            return m1.dec(ex, start.subtract(weeks, 'weeks'), Math.round(amount - weeks *5 *hours.minInDay));
        const sinceOpen = start.diff(hours.opens, 'minutes');
        if (sinceOpen < amount)
            return m1.dec(ex, hours.closes.subtract(1, 'days'), amount - sinceOpen);
        return start.subtract(amount, 'minutes');
    },
    diff: function(ex, to, from) {
        const start = m1.inc(ex, from, 0);
        const end = m1.dec(ex, to, 0);
        if (end.isBefore(start) && moment(to).isBefore(from))
            return -1 * m1.diff(ex, from, to);
        else if (end.isBefore(start))
            return 0;
        const hours = marketHours(ex, start);
        const weeks = end.diff(start, 'weeks');
        if (weeks)
            return weeks * 5 * hours.minInDay + m1.diff(ex, end, start.add(weeks, 'weeks'));
        const days = end.diff(start, 'days');
        if (days && start.day() < end.day())
            return days * hours.minInDay + m1.diff(ex, end, start.add(days, 'days'));
        else if (end.isAfter(hours.closes))
            return hours.closes.diff(start, 'minutes') + m1.diff(ex, end, hours.opens.add(1, 'days'));
        else return end.diff(start, 'minutes');
    }
};
const m2 = {
    value: 'm2',
    millis: 2 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(Math.floor(moment(dateTime).valueOf() /2 /60 /1000) *2 *60 *1000, ex.tz);
    },
    ceil: function(ex, dateTime) {
        return moment.tz(Math.ceil(moment(dateTime).valueOf() /2 /60 /1000) *2 *60 *1000, ex.tz);
    },
    inc: function(ex, dateTime, amount) {
        return m1.inc(ex, m2.ceil(ex, dateTime), amount * 2);
    },
    dec: function(ex, dateTime, amount) {
        return m1.dec(ex, m2.floor(ex, dateTime), amount * 2);
    },
    diff: function(ex, to, from) {
        const minutes = m1.diff(ex, to, from);
        if (minutes < 0)
            return Math.ceil(minutes /2);
        return Math.floor(minutes /2);
    }
};
const m5 = {
    value: 'm5',
    millis: 5 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(Math.floor(moment(dateTime).valueOf() /5 /60 /1000) *5 *60 *1000, ex.tz);
    },
    ceil: function(ex, dateTime) {
        return moment.tz(Math.ceil(moment(dateTime).valueOf() /5 /60 /1000) *5 *60 *1000, ex.tz);
    },
    inc: function(ex, dateTime, amount) {
        return m1.inc(ex, m5.ceil(ex, dateTime), amount * 5);
    },
    dec: function(ex, dateTime, amount) {
        return m1.dec(ex, m5.floor(ex, dateTime), amount * 5);
    },
    diff: function(ex, to, from) {
        const minutes = m1.diff(ex, to, from);
        if (minutes < 0)
            return Math.ceil(minutes /5);
        return Math.floor(minutes /5);
    }
};
const m10 = {
    value: 'm10',
    millis: 10 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(Math.floor(moment(dateTime).valueOf() /10 /60 /1000) *10 *60 *1000, ex.tz);
    },
    ceil: function(ex, dateTime) {
        return moment.tz(Math.ceil(moment(dateTime).valueOf() /10 /60 /1000) *10 *60 *1000, ex.tz);
    },
    inc: function(ex, dateTime, amount) {
        return m1.inc(ex, m10.ceil(ex, dateTime), amount * 10);
    },
    dec: function(ex, dateTime, amount) {
        return m1.dec(ex, m10.floor(ex, dateTime), amount * 10);
    },
    diff: function(ex, to, from) {
        const minutes = m1.diff(ex, to, from);
        if (minutes < 0)
            return Math.ceil(minutes /10);
        return Math.floor(minutes /10);
    }
};
const m15 = {
    value: 'm15',
    millis: 15 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(Math.floor(moment(dateTime).valueOf() /15 /60 /1000) *15 *60 *1000, ex.tz);
    },
    ceil: function(ex, dateTime) {
        return moment.tz(Math.ceil(moment(dateTime).valueOf() /15 /60 /1000) *15 *60 *1000, ex.tz);
    },
    inc: function(ex, dateTime, amount) {
        return m1.inc(ex, m15.ceil(ex, dateTime), amount * 15);
    },
    dec: function(ex, dateTime, amount) {
        return m1.dec(ex, m15.floor(ex, dateTime), amount * 15);
    },
    diff: function(ex, to, from) {
        const minutes = m1.diff(ex, to, from);
        if (minutes < 0)
            return Math.ceil(minutes /15);
        return Math.floor(minutes /15);
    }
};
const m20 = {
    value: 'm20',
    millis: 20 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(Math.floor(moment(dateTime).valueOf() /20 /60 /1000) *20 *60 *1000, ex.tz);
    },
    ceil: function(ex, dateTime) {
        return moment.tz(Math.ceil(moment(dateTime).valueOf() /20 /60 /1000) *20 *60 *1000, ex.tz);
    },
    inc: function(ex, dateTime, amount) {
        return m1.inc(ex, m20.ceil(ex, dateTime), amount * 20);
    },
    dec: function(ex, dateTime, amount) {
        return m1.dec(ex, m20.floor(ex, dateTime), amount * 20);
    },
    diff: function(ex, to, from) {
        const minutes = m1.diff(ex, to, from);
        if (minutes < 0)
            return Math.ceil(minutes /20);
        return Math.floor(minutes /20);
    }
};
const m30 = {
    value: 'm30',
    millis: 30 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(Math.floor(moment(dateTime).valueOf() /30 /60 /1000) *30 *60 *1000, ex.tz);
    },
    ceil: function(ex, dateTime) {
        return moment.tz(Math.ceil(moment(dateTime).valueOf() /30 /60 /1000) *30 *60 *1000, ex.tz);
    },
    inc: function(ex, dateTime, amount) {
        return m1.inc(ex, m30.ceil(ex, dateTime), amount * 30);
    },
    dec: function(ex, dateTime, amount) {
        return m1.dec(ex, m30.floor(ex, dateTime), amount * 30);
    },
    diff: function(ex, to, from) {
        const minutes = m1.diff(ex, to, from);
        if (minutes < 0)
            return Math.ceil(minutes /30);
        return Math.floor(minutes /30);
    }
};
const m60 = {
    value: 'm60',
    millis: 60 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(dateTime, ex.tz).startOf('hour');
    },
    ceil: function(ex, dateTime) {
        const start = m60.floor(ex, dateTime);
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.add(1, 'hours');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const date = moment.tz(dateTime, ex.tz);
        const opens = moment.tz(date.format('YYYY-MM-DD') + 'T' + ex.marketOpensAt, ex.tz);
        const start = opens.valueOf() == date.valueOf() ? date.startOf('hour') : m60.ceil(ex, dateTime);
        const hours = marketHours(ex, start);
        if (hours.opens.diff(start, 'hours') > 0)
            return m60.inc(ex, hours.opens, amount);
        if (start.diff(hours.closes, 'hours') > 0)
            return m60.inc(ex, hours.opens.add(1, 'days'), amount);
        const weeks = Math.floor(amount /5 /hours.hoursInDay);
        if (weeks)
            return m60.inc(ex, start.add(weeks, 'weeks'), Math.round(amount - weeks *5 *hours.hoursInDay));
        const untilClose = Math.ceil(hours.closes.diff(start, 'hours', true));
        if (untilClose < amount)
            return m60.inc(ex, hours.opens.add(1, 'days'), amount - untilClose);
        if (amount === 0 && hours.opens.hour() == start.hour())
            return start.minute(hours.opens.minute());
        return start.add(amount, 'hours');
    },
    dec: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const start = m60.floor(ex, dateTime);
        const hours = marketHours(ex, start, true);
        if (hours.opens.diff(start, 'hours') > 0)
            return m60.dec(ex, hours.closes.subtract(1, 'days'), amount);
        if (start.diff(hours.closes, 'hours') > 0)
            return m60.dec(ex, hours.closes, amount);
        const weeks = Math.floor(amount /5 /hours.hoursInDay);
        if (weeks)
            return m60.dec(ex, start.subtract(weeks, 'weeks'), Math.round(amount - weeks *5 *hours.hoursInDay));
        const sinceOpen = Math.ceil(start.diff(hours.opens, 'hours', true));
        if (sinceOpen < amount)
            return m60.dec(ex, hours.closes.subtract(1, 'days'), amount - sinceOpen);
        const result = start.subtract(amount, 'hours');
        if (hours.opens.hour() == result.hour()) return result.minute(hours.opens.minute());
        else return result;
    },
    diff: function(ex, to, from) {
        const start = m60.inc(ex, from, 0);
        const end = m60.dec(ex, to, 0);
        if (end.isBefore(start) && moment(to).isBefore(from))
            return -1 * m60.diff(ex, from, to);
        else if (end.isBefore(start))
            return 0;
        const hours = marketHours(ex, start);
        const weeks = end.diff(start, 'weeks');
        if (weeks)
            return weeks * 5 * hours.hoursInDay + m60.diff(ex, end, start.add(weeks, 'weeks'));
        const days = end.diff(start, 'days');
        if (days && start.day() < end.day())
            return days * hours.hoursInDay + m60.diff(ex, end, start.add(days, 'days'));
        else if (end.isAfter(hours.closes))
            return Math.ceil(hours.closes.diff(start, 'hours', true))
                + m60.diff(ex, end, hours.opens.add(1, 'days'));
        else return Math.ceil(end.diff(start, 'hours', true));
    }
};
const m120 = {
    value: 'm120',
    millis: 120 * 60 * 1000,
    floor: function(ex, dateTime) {
        const start = m60.floor(ex, dateTime);
        if (start.hour() % 2) return start.subtract(1, 'hours');
        return start;
    },
    ceil: function(ex, dateTime) {
        const start = m60.ceil(ex, dateTime);
        if (start.hour() % 2) return start.add(1, 'hours');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const date = moment.tz(dateTime, ex.tz);
        const opens = moment.tz(date.format('YYYY-MM-DD') + 'T' + ex.marketOpensAt, ex.tz);
        const start = opens.valueOf() == date.valueOf() ? m120.floor(ex, opens) : m120.ceil(ex, dateTime);
        const hours = marketHours(ex, start);
        const floorOpens = m120.floor(ex, hours.opens);
        const ceilCloses = m120.ceil(ex, hours.closes);
        if (start.valueOf() < floorOpens.valueOf())
            return m120.inc(ex, hours.opens, amount);
        if (start.valueOf() > ceilCloses.valueOf())
            return m120.inc(ex, hours.opens.add(1, 'days'), amount);
        const hoursInDay = Math.ceil(hours.hoursInDay /2);
        const weeks = Math.floor(amount /5 /hoursInDay);
        if (weeks)
            return m120.inc(ex, start.add(weeks, 'weeks'), Math.round(amount - weeks *5 *hoursInDay));
        const untilClose = Math.ceil(ceilCloses.diff(start, 'hours', true) /2);
        if (untilClose < amount)
            return m120.inc(ex, ceilCloses, amount - untilClose);
        if (amount === 0 && floorOpens.valueOf() == start.valueOf())
            return hours.opens;
        return start.add(amount*2, 'hours');
    },
    dec: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const start = m120.floor(ex, dateTime);
        const hours = marketHours(ex, start, true);
        const floorOpens = m120.floor(ex, hours.opens);
        const ceilCloses = m120.ceil(ex, hours.closes);
        if (start.valueOf() < floorOpens.valueOf())
            return m120.dec(ex, hours.closes.subtract(1, 'days'), amount);
        if (start.valueOf() > ceilCloses.valueOf())
            return m120.dec(ex, hours.closes, amount);
        const hoursInDay = Math.ceil(hours.hoursInDay /2);
        const weeks = Math.floor(amount /5 /hoursInDay);
        if (weeks)
            return m120.dec(ex,start.subtract(weeks,'weeks'),Math.round(amount - weeks *5 *hoursInDay));
        const sinceOpen = Math.ceil(start.diff(floorOpens, 'hours', true) /2);
        if (sinceOpen < amount)
            return m120.dec(ex, floorOpens, amount - sinceOpen);
        const result = start.subtract(amount*2, 'hours');
        if (floorOpens.valueOf() == result.valueOf()) return hours.opens;
        else return result;
    },
    diff: function(ex, to, from) {
        const start = m120.inc(ex, from, 0);
        const end = m120.dec(ex, to, 0);
        if (end.isBefore(start) && moment(to).isBefore(from))
            return -1 * m120.diff(ex, from, to);
        else if (end.isBefore(start))
            return 0;
        const hours = marketHours(ex, start);
        const ceilCloses = m120.ceil(ex, hours.closes);
        const hoursInDay = Math.ceil(hours.hoursInDay /2);
        const weeks = end.diff(start, 'weeks');
        if (weeks)
            return weeks * 5 * hoursInDay + m120.diff(ex, end, start.add(weeks, 'weeks'));
        const days = end.diff(start, 'days');
        if (days && start.day() < end.day())
            return days * hoursInDay + m120.diff(ex, end, start.add(days, 'days'));
        else if (end.isAfter(ceilCloses))
            return Math.ceil(ceilCloses.diff(start, 'hours', true) /2) + m120.diff(ex, end, ceilCloses);
        else return Math.ceil(end.diff(start, 'hours', true) /2);
    }
};
const m240 = {
    value: 'm240',
    millis: 240 * 60 * 1000,
    floor: function(ex, dateTime) {
        const start = m120.floor(ex, dateTime);
        if (start.hour() % 4) return start.subtract(2, 'hours');
        return start;
    },
    ceil: function(ex, dateTime) {
        const start = m120.ceil(ex, dateTime);
        if (start.hour() % 4) return start.add(2, 'hours');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const date = moment.tz(dateTime, ex.tz);
        const opens = moment.tz(date.format('YYYY-MM-DD') + 'T' + ex.marketOpensAt, ex.tz);
        const start = opens.valueOf() == date.valueOf() ? m240.floor(ex, opens) : m240.ceil(ex, dateTime);
        const hours = marketHours(ex, start);
        const floorOpens = m120.floor(ex, hours.opens);
        const ceilCloses = m240.ceil(ex, hours.closes);
        if (date.valueOf() < floorOpens.valueOf() && dateTime.isSame(hours.opens))
            throw Error("cycle");
        if (date.valueOf() < floorOpens.valueOf())
            return m240.inc(ex, hours.opens, amount);
        if (start.valueOf() > ceilCloses.valueOf())
            return m240.inc(ex, hours.opens.add(1, 'days'), amount);
        const hoursInDay = Math.ceil(hours.hoursInDay /4);
        const weeks = Math.floor(amount /5 /hoursInDay);
        if (weeks)
            return m240.inc(ex, start.add(weeks, 'weeks'), Math.round(amount - weeks *5 *hoursInDay));
        const untilClose = Math.ceil(ceilCloses.diff(start, 'hours', true) /4);
        if (untilClose < amount)
            return m240.inc(ex, ceilCloses, amount - untilClose);
        if (amount === 0 && floorOpens.valueOf() == start.valueOf())
            return hours.opens;
        return start.add(amount*4, 'hours');
    },
    dec: function(ex, dateTime, amount) {
        if (amount < 0) throw Error("Amount must be >= 0");
        const start = m240.floor(ex, dateTime);
        const hours = marketHours(ex, start, true);
        const floorOpens = m240.floor(ex, hours.opens);
        const ceilCloses = m240.ceil(ex, hours.closes);
        if (start.valueOf() < floorOpens.valueOf())
            return m240.dec(ex, hours.closes.subtract(1, 'days'), amount);
        if (start.valueOf() > ceilCloses.valueOf())
            return m240.dec(ex, hours.closes, amount);
        const hoursInDay = Math.ceil(hours.hoursInDay /4);
        const weeks = Math.floor(amount /5 /hoursInDay);
        if (weeks)
            return m240.dec(ex,start.subtract(weeks,'weeks'),Math.round(amount - weeks *5 *hoursInDay));
        const sinceOpen = Math.ceil(start.diff(floorOpens, 'hours', true) /4);
        if (sinceOpen < amount)
            return m240.dec(ex, floorOpens, amount - sinceOpen);
        const result = start.subtract(amount*4, 'hours');
        if (floorOpens.valueOf() == result.valueOf()) return hours.opens;
        else return result;
    },
    diff: function(ex, to, from) {
        const start = m240.inc(ex, from, 0);
        const end = m240.dec(ex, to, 0);
        if (end.isBefore(start) && moment(to).isBefore(from))
            return -1 * m240.diff(ex, from, to);
        else if (end.isBefore(start))
            return 0;
        const hours = marketHours(ex, start);
        const ceilCloses = m240.ceil(ex, hours.closes);
        const hoursInDay = Math.ceil(hours.hoursInDay /4);
        const weeks = end.diff(start, 'weeks');
        if (weeks)
            return weeks * 5 * hoursInDay + m240.diff(ex, end, start.add(weeks, 'weeks'));
        const days = end.diff(start, 'days');
        if (days && start.day() < end.day())
            return days * hoursInDay + m240.diff(ex, end, start.add(days, 'days'));
        else if (end.isAfter(ceilCloses))
            return Math.ceil(ceilCloses.diff(start, 'hours', true) /4) + m240.diff(ex, end, ceilCloses);
        else return Math.ceil(end.diff(start, 'hours', true) /4);
    }
};
const day = {
    value: 'day',
    millis: 24 * 60 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(dateTime, ex.tz).startOf('day');
    },
    ceil: function(ex, dateTime) {
        const start = day.floor(ex, dateTime);
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.add(1, 'days');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        const start = day.ceil(ex, dateTime);
        const wd = start.isoWeekday();
        if (wd > 5)
            return day.inc(ex, start.add(8 - wd, 'days'), amount);
        const w = Math.floor((wd -1 + amount) / 5);
        const days = amount - w *5;
        if (wd + days < 6)
            return start.isoWeek(start.isoWeek() + w).isoWeekday(wd + days);
        else return start.isoWeek(start.isoWeek() + w).isoWeekday(wd +2 + days);
    },
    dec: function(ex, dateTime, amount) {
        const start = day.floor(ex, dateTime);
        const wd = start.isoWeekday();
        if (wd == 1)
            return day.dec(ex, start.subtract(2, 'days'), amount)
        else if (wd == 7)
            return day.dec(ex, start.subtract(1, 'days'), amount);
        const w = Math.floor(amount / 5);
        const days = amount - w*5;
        if (wd > days)
            return start.isoWeek(start.isoWeek() - w).isoWeekday(wd - days);
        else return start.isoWeek(start.isoWeek() - w).isoWeekday(wd -2 - days);
    },
    diff: function(ex, to, from) {
        const start = moment.tz(from, ex.tz);
        const end = moment.tz(to, ex.tz);
        if (end.isBefore(start))
            return -1 * day.diff(ex, from, to);
        const weeks = end.diff(start, 'weeks');
        if (weeks)
            return weeks * 5 + day.diff(ex, end, start.add(weeks, 'weeks'));
        else if (start.isoWeekday() > 5)
            return day.diff(ex, end, start.startOf('day').add(1, 'weeks').isoWeekday(1));
        else if (end.isoWeekday() > 6)
            return day.diff(ex, end.startOf('day').isoWeekday(6), start);
        else if (start.isoWeekday() < end.isoWeekday())
            return end.diff(start, 'days');
        else
            return Math.max(end.diff(start, 'days') -2, 0);
    }
};
const week = {
    value: 'week',
    millis: 7 * 24 * 60 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(dateTime, ex.tz).startOf('isoweek');
    },
    ceil: function(ex, dateTime) {
        const start = moment.tz(dateTime, ex.tz).startOf('isoweek');
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.isoWeek(start.isoWeek() + 1);
        return start;
    },
    inc: function(ex, dateTime, amount) {
        const start = week.ceil(ex, dateTime);
        return start.isoWeek(start.isoWeek() + amount);
    },
    dec: function(ex, dateTime, amount) {
        const start = week.floor(ex, dateTime);
        return start.isoWeek(start.isoWeek() + -amount);
    },
    diff: function(ex, to, from) {
        const start = moment.tz(from, ex.tz);
        const end = moment.tz(to, ex.tz);
        return end.diff(start, 'weeks');
    }
};
const month = {
    value: 'month',
    millis: 31 * 24 * 60 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(dateTime, ex.tz).startOf('month');
    },
    ceil: function(ex, dateTime) {
        const start = moment.tz(dateTime, ex.tz).startOf('month');
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.month(start.month() + 1);
        return start;
    },
    inc: function(ex, dateTime, amount) {
        const start = month.ceil(ex, dateTime);
        return start.month(start.month() + amount);
    },
    dec: function(ex, dateTime, amount) {
        const start = month.floor(ex, dateTime);
        return start.month(start.month() + -amount);
    },
    diff: function(ex, to, from) {
        const start = moment.tz(from, ex.tz);
        const end = moment.tz(to, ex.tz);
        return end.diff(start, 'months');
    }
};
const quarter = {
    value: 'quarter',
    millis: 3 * 31 * 24 * 60 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(dateTime, ex.tz).startOf('quarter');
    },
    ceil: function(ex, dateTime) {
        const start = quarter.floor(ex, dateTime);
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.add(3, 'months');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        const start = quarter.ceil(ex, dateTime);
        return start.add(3 * amount, 'months');
    },
    dec: function(ex, dateTime, amount) {
        const start = quarter.floor(ex, dateTime);
        return start.subtract(3 * amount, 'months');
    },
    diff: function(ex, to, from) {
        const start = quarter.ceil(ex, from);
        const end = quarter.floor(ex, to);
        const months = end.diff(start, 'months');
        if (months < 0)
            return Math.ceil(months /3);
        return Math.floor(months /3);
    }
};
const year = {
    value: 'year',
    millis: 365 * 24 * 60 * 60 * 1000,
    floor: function(ex, dateTime) {
        return moment.tz(dateTime, ex.tz).startOf('year');
    },
    ceil: function(ex, dateTime) {
        const start = year.floor(ex, dateTime);
        if (start.valueOf() < moment(dateTime).valueOf())
            return start.add(1, 'years');
        return start;
    },
    inc: function(ex, dateTime, amount) {
        return moment.tz(dateTime, ex.tz).add(amount, 'years');
    },
    dec: function(ex, dateTime, amount) {
        return moment.tz(dateTime, ex.tz).subtract(amount, 'years');
    },
    diff: function(ex, to, from) {
        const start = moment.tz(from, ex.tz);
        const end = moment.tz(to, ex.tz);
        return end.diff(start, 'years');
    }
};
const intervals = {
    m1: m1,
    m2: m2,
    m5: m5,
    m10: m10,
    m15: m15,
    m20: m20,
    m30: m30,
    m60: m60,
    m120: m120,
    m240: m240,
    day: day,
    week: week,
    month: month,
    quarter: quarter,
    year: year
};

module.exports.values = _.keys(intervals);

function marketHours(ex, start, before) {
    const h24 = ex.marketOpensAt == ex.marketClosesAt;
    const opens = moment.tz(start.format('YYYY-MM-DD') + 'T' + ex.marketOpensAt, ex.tz);
    const closes = h24 ? moment(opens) : moment.tz(start.format('YYYY-MM-DD') + 'T' + ex.marketClosesAt, ex.tz);
    if (!opens.isBefore(closes) && opens.isBefore(start))
        closes.add(1, 'days');
    else if (!closes.isAfter(opens) && closes.isAfter(start))
        opens.subtract(1, 'days');
    else if (before && !closes.isAfter(opens))
        opens.subtract(1, 'days');
    else if (!opens.isBefore(closes))
        closes.add(1, 'days');
    if (before && !opens.isBefore(start)) {
        opens.subtract(1, 'days');
        closes.subtract(1, 'days');
    } else if (!before && !closes.isAfter(start)) {
        opens.add(1, 'days');
        closes.add(1, 'days');
    }
    const wd = closes.isoWeekday();
    if (wd > 5 && before) {
        opens.subtract(wd - 5, 'days');
        closes.subtract(wd - 5, 'days');
    } else if (wd > 5) {
        opens.add(8 - wd, 'days');
        closes.add(8 - wd, 'days');
    }
    const minInDay = h24 ? 24*60 : closes.diff(opens, 'minutes');
    const hoursInDay = h24 ? 24 : Math.ceil(closes.diff(opens, 'hours', true));
    return {opens, closes, minInDay, hoursInDay};
}
