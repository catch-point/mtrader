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
        interval: int => expect(int).to.be.oneOf(module.exports.values),
        open_time: /\d\d:\d\d(:00)?/,
        liquid_hours: /\d\d:\d\d(:00)? - \d\d:\d\d(:00)?/,
        trading_hours: /\d\d:\d\d(:00)? - \d\d:\d\d(:00)?/,
        security_tz: tz => moment.tz.zone(tz),
        tz: tz => moment.tz.zone(tz)
        
    });
    const period = createPeriods(options);
    return {
        value: period.value,
        millis: period.millis,
        floor(dateTime) {
            const point = moment.tz(dateTime, options.tz).tz(options.security_tz);
            if (!point.isValid()) throw Error(`Invalid dateTime: ${dateTime}`);
            return period.floor(point).tz(options.tz);
        },
        ceil(dateTime) {
            const point = moment.tz(dateTime, options.tz).tz(options.security_tz);
            if (!point.isValid()) throw Error(`Invalid dateTime: ${dateTime}`);
            return period.ceil(point).tz(options.tz);
        },
        inc(dateTime, amount) {
            const point = moment.tz(dateTime, options.tz).tz(options.security_tz);
            if (!point.isValid()) throw Error(`Invalid dateTime: ${dateTime}`);
            return period.inc(point, amount).tz(options.tz);
        },
        dec(dateTime, amount) {
            const point = moment.tz(dateTime, options.tz).tz(options.security_tz);
            if (!point.isValid()) throw Error(`Invalid dateTime: ${dateTime}`);
            return period.dec(point, amount).tz(options.tz);
        },
        diff(to, from) {
            const m_to = moment.tz(to, options.tz).tz(options.security_tz);
            const m_from = moment.tz(from, options.tz).tz(options.security_tz);
            if (!m_to.isValid()) throw Error(`Invalid dateTime: ${to}`);
            if (!m_from.isValid()) throw Error(`Invalid dateTime: ${from}`);
            return period.diff(m_to, m_from);
        }
    };
};

module.exports.sort = periods => _.sortBy(periods, period => {
    if (_.isString(period) && !~module.exports.values.indexOf(period))
        throw Error("Unknown interval: " + period + " must be one of " + module.exports.values.join(', '));
    return _.isString(period) ? createPeriods({
        interval: period,
        trading_hours: "04:00:00 - 20:00:00",
        liquid_hours: "09:30:00 - 16:00:00",
        open_time: "09:30:00",
        security_tz: "America/New_York"
    }).millis : period.millis;
});

module.exports.values = [
    'm1', 'm2', 'm5', 'm10', 'm15', 'm20', 'm30',
    'm60', 'm120', 'm240',
    'day', 'week',
    'month', 'quarter', 'year'
];

function createPeriods(options) {
    switch(options.interval) {
    case 'm1': return intervalInMinutes(1, options);
    case 'm2': return intervalInMinutes(2, options);
    case 'm5': return intervalInMinutes(5, options);
    case 'm10': return intervalInMinutes(10, options);
    case 'm15': return intervalInMinutes(15, options);
    case 'm20': return intervalInMinutes(20, options);
    case 'm30': return intervalInMinutes(30, options);
    case 'm60': return intervalInHours(1, options);
    case 'm120': return intervalInHours(2, options);
    case 'm240': return intervalInHours(4, options);
    case 'day': return intervalInDays('day', options);
    case 'week': return intervalInWeeks('week', options);
    case 'month': return intervalInMonths('month', options);
    case 'quarter': return intervalInMonths('quarter', options);
    case 'year': return intervalInMonths('year', options);
    default:
        throw Error(`Unknown interval: ${options.interval} must be one of ${module.exports.values.join(', ')}`);
    }
}

function intervalInMinutes(m, ex) {
    const sample_hours = marketHours(ex, moment.tz('2010-03-01T12:00:00', ex.security_tz));
    return {
        value: `m${m}`,
        millis: m * 60 * 1000,
        session_length: Math.ceil(sample_hours.minInDay/m),
        floor(dateTime) {
            const hours = marketHours(ex, dateTime);
            const minInDay = Math.ceil(hours.minInDay/m)*m;
            if (!dateTime.isBefore(hours.ends) && (minInDay < 24*60 || hours.ends.day() == 5))
                return marketHours(ex, moment(dateTime).add(1,'days')).opens;
            const millis = (dateTime.minute() *60 + dateTime.second()) *1000 + dateTime.millisecond();
            const point = moment(dateTime).add(Math.floor(millis /m /60 /1000) *m *60 *1000 - millis, 'ms');
            if (hours.opens.isBefore(point) || minInDay == 24*60 && hours.ends.day() > 1) return point;
            else return hours.opens;
        },
        ceil(dateTime) {
            const hours = marketHours(ex, dateTime, true);
            const minInDay = Math.ceil(hours.minInDay/m)*m;
            if (!hours.opens.isBefore(dateTime) && (minInDay < 24*60 || hours.ends.day() == 1))
                return marketHours(ex, moment(dateTime).subtract(1,'days'), true).ends;
            const millis = (dateTime.minute() *60 + dateTime.second()) *1000 + dateTime.millisecond();
            const point = moment(dateTime).add(Math.ceil(millis /m /60 /1000) *m *60 *1000 - millis, 'ms');
            if (point.isBefore(hours.ends) || minInDay == 24*60 && hours.ends.day() < 5) return point;
            else return hours.ends;
        },
        inc(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 1) return this.dec(dateTime, -amount);
            const start = this.floor(dateTime).startOf('minute');
            start.subtract(start.minute() % m, 'minutes');
            const hours = marketHours(ex, start);
            const friday = moment(hours.ends).day(5);
            const minInDay = Math.ceil(hours.minInDay/m)*m;
            const untilClose = Math.ceil(Math.max(hours.ends.diff(start, 'minutes', true)/m,0));
            const daysUntilFriday = Math.max(5 - hours.ends.day(),0);
            const minUntilFriday = Math.ceil(Math.max(friday.diff(start, 'minutes', true)/m,0));
            if (untilClose + daysUntilFriday*minInDay/m < amount && minInDay < 24*60) // over weekend
                return this.inc(friday, amount - untilClose - daysUntilFriday*minInDay/m);
            else if (untilClose && untilClose < amount && minInDay < 24*60)
                return this.inc(hours.ends, amount - untilClose);
            else if (minUntilFriday < amount) // market open 24hr over weekend
                return this.inc(friday, amount - minUntilFriday);
            else
                return this.ceil(this.floor(start.add(amount*m, 'minutes')));
        },
        dec(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 1) return this.inc(dateTime, -amount);
            const start = this.ceil(dateTime);
            start.add((m - start.minute() %m) %m, 'minutes');
            const hours = marketHours(ex, start, true);
            const sunday = moment(hours.opens).subtract(hours.ends.day()-1, 'days');
            const minInDay = Math.ceil(hours.minInDay/m)*m;
            const sinceOpen = Math.max(Math.ceil(start.diff(hours.opens, 'minutes', true)/m),0);
            const daysSinceSunday = Math.max(hours.ends.day() -1,0);
            const minSinceSunday = Math.ceil(Math.max(start.diff(sunday, 'minutes', true)/m,0));
            if (sinceOpen + daysSinceSunday*minInDay/m < amount && minInDay < 24*60)
                return this.dec(sunday, amount - sinceOpen - daysSinceSunday*minInDay/m);
            else if (sinceOpen && sinceOpen < amount && minInDay < 24*60)
                return this.dec(hours.ends.subtract(1, 'days'), amount - sinceOpen);
            else if (minSinceSunday < amount) // market open 24hr over weekend
                return this.dec(sunday, amount - minSinceSunday);
            else
                return this.ceil(start.subtract(amount*m, 'minutes'));
        },
        diff(to, from) {
            if (to.isBefore(from)) return -1 * this.diff(from, to);
            else if (to.isSame(from)) return 0;
            const start = this.floor(from);
            start.subtract(start.minute() % m, 'minutes');
            const end = this.ceil(to);
            end.add((m - end.minute() %m) %m, 'minutes');
            const hours = marketHours(ex, start);
            const friday = moment(hours.ends).day(5);
            const minInDay = Math.ceil(hours.minInDay/m)*m;
            const untilClose = Math.ceil(Math.max(hours.ends.diff(start, 'minutes', true)/m,0));
            const daysUntilFriday = Math.max(5 - hours.ends.day(),0);
            const minUntilFriday = Math.ceil(Math.max(friday.diff(start, 'minutes', true)/m,0));
            if (!end.isBefore(friday) && minInDay < 24*60)
                return untilClose + daysUntilFriday*minInDay/m + this.diff(end, friday);
            else if (!end.isBefore(hours.ends) && minInDay < 24*60)
                return untilClose + this.diff(end, hours.opens.add(1, 'days'));
            else if (!end.isBefore(friday)) // market open 24hr over weekend
                return minUntilFriday + this.diff(end, friday);
            else if (hours.opens.isBefore(end))
                return Math.max(Math.ceil(end.diff(start, 'minutes', true)/m),0);
            else
                return 0;
        }
    };
}

function intervalInHours(h, ex) {
    const m = h*60;
    const sample_hours = marketHours(ex, moment.tz('2010-03-01T12:00:00', ex.security_tz));
    return {
        value: `m${h * 60}`,
        millis: h * 60 * 60 * 1000,
        session_length: Math.ceil(sample_hours.hoursInDay/h),
        floor(dateTime) {
            const hours = marketHours(ex, dateTime);
            const hoursInDay = Math.ceil(hours.hoursInDay/h)*h;
            if (!dateTime.isBefore(hours.ends) && (hoursInDay < 24 || hours.ends.day() == 5))
                return marketHours(ex, moment(dateTime).add(1,'days')).opens;
            const millis = (((dateTime.hour() *60) + dateTime.minute()) *60 + dateTime.second()) *1000 + dateTime.millisecond();
            const point = moment(dateTime).add(Math.floor(millis /h /60 /60 /1000) *h *60 *60 *1000 - millis, 'ms');
            if (hours.opens.isBefore(point) || hoursInDay == 24 && hours.ends.day() > 1) return point;
            else return hours.opens;
        },
        ceil(dateTime) {
            const hours = marketHours(ex, dateTime, true);
            const hoursInDay = Math.ceil(hours.hoursInDay/h)*h;
            if (!hours.opens.isBefore(dateTime) && (hoursInDay < 24 || hours.ends.day() == 1))
                return marketHours(ex, moment(dateTime).subtract(1,'days'), true).ends;
            const millis = (((dateTime.hour() *60) + dateTime.minute()) *60 + dateTime.second()) *1000 + dateTime.millisecond();
            const point = moment(dateTime).add(Math.ceil(millis /h /60 /60 /1000) *h *60 *60 *1000 - millis, 'ms');
            if (point.isBefore(hours.ends) || hoursInDay == 24 && hours.ends.day() < 5) return point;
            else return hours.ends;
        },
        inc(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 1) return this.dec(dateTime, -amount);
            const start = this.floor(dateTime).startOf('hour');
            start.subtract((start.hour()*60+start.minute()) % m, 'minutes');
            const hours = marketHours(ex, start);
            const friday = moment(hours.ends).day(5);
            const hoursInDay = Math.ceil(hours.hoursInDay/h)*h;
            const untilClose = Math.ceil(Math.max(hours.ends.diff(start, 'hours', true)/h,0));
            const daysUntilFriday = Math.max(5 - hours.ends.day(),0);
            const hoursUntilFriday = Math.ceil(Math.max(friday.diff(start, 'hours', true)/h,0));
            if (untilClose + daysUntilFriday*hoursInDay/h < amount && hoursInDay < 24) // over weekend
                return this.inc(friday, amount - untilClose - daysUntilFriday*hoursInDay/h);
            else if (untilClose && untilClose < amount && hoursInDay < 24)
                return this.inc(hours.ends, amount - untilClose);
            else if (hoursUntilFriday < amount) // market open 24hr over weekend
                return this.inc(friday, amount - hoursUntilFriday);
            else
                return this.ceil(this.floor(start.add(amount*h, 'hours')));
        },
        dec(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 1) return this.inc(dateTime, -amount);
            const start = this.ceil(dateTime);
            start.add((m - (start.hour()*60+start.minute()) %m) %m, 'minutes');
            const hours = marketHours(ex, start, true);
            const sunday = moment(hours.opens).subtract(hours.ends.day()-1, 'days');
            const hoursInDay = Math.ceil(hours.hoursInDay/h)*h;
            const sinceOpen = Math.max(Math.ceil(start.diff(hours.opens, 'hours', true)/h),0);
            const daysSinceSunday = Math.max(hours.ends.day() -1,0);
            const hoursSinceSunday = Math.ceil(Math.max(start.diff(sunday, 'hours', true)/h,0));
            if (sinceOpen + daysSinceSunday*hoursInDay/h < amount && hoursInDay < 24)
                return this.dec(sunday, amount - sinceOpen - daysSinceSunday*hoursInDay/h);
            else if (sinceOpen && sinceOpen < amount && hoursInDay < 24)
                return this.dec(hours.ends.subtract(1, 'days'), amount - sinceOpen);
            else if (hoursSinceSunday < amount) // market open 24hr over weekend
                return this.dec(sunday, amount - hoursSinceSunday);
            else
                return this.ceil(start.subtract(amount*h, 'hours'));
        },
        diff(to, from) {
            if (to.isBefore(from)) return -1 * this.diff(from, to);
            else if (to.isSame(from)) return 0;
            const start = this.floor(from);
            start.subtract((start.hour()*60+start.minute()) % m, 'minutes');
            const end = this.ceil(to);
            end.add((m - (end.hour()*60+end.minute()) % m) % m, 'minutes');
            const hours = marketHours(ex, start);
            const friday = moment(hours.ends).day(5);
            const hoursInDay = Math.ceil(hours.hoursInDay/h)*h;
            const untilClose = Math.ceil(Math.max(hours.ends.diff(start, 'hours', true)/h,0));
            const daysUntilFriday = Math.max(5 - hours.ends.day(),0);
            const hoursUntilFriday = Math.ceil(Math.max(friday.diff(start, 'hours', true)/h,0));
            if (!end.isBefore(friday) && hoursInDay < 24)
                return untilClose + daysUntilFriday*hoursInDay/h + this.diff(end, friday);
            else if (!end.isBefore(hours.ends) && hoursInDay < 24)
                return untilClose + this.diff(end, hours.opens.add(1, 'days'));
            else if (!end.isBefore(friday)) // market open 24hr over weekend
                return hoursUntilFriday + this.diff(end, friday);
            else if (hours.opens.isBefore(end))
                return Math.max(Math.ceil(end.diff(start, 'hours', true)/h),0);
            else
                return 0;
        }
    };
}

function intervalInDays(measurement, ex) {
    const sample_hours = marketHours(ex, moment.tz('2010-03-01T12:00:00', ex.security_tz));
    return {
        value: 'day',
        millis: sample_hours.minInDay * 60 * 1000,
        session_length: 1,
        floor(dateTime) {
            const hours = marketHours(ex, dateTime);
            if (dateTime.isBefore(hours.ends)) return hours.opens;
            else return marketHours(ex, moment(dateTime).add(1,'days')).opens;
        },
        ceil(dateTime) {
            const hours = marketHours(ex, dateTime, true);
            if (hours.opens.isBefore(dateTime)) return hours.ends;
            else return marketHours(ex, moment(dateTime).subtract(1,'days'), true).ends;
        },
        inc(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 1) return this.dec(dateTime, -amount);
            const start = this.floor(dateTime);
            const hours = marketHours(ex, start);
            const wd = hours.ends.isoWeekday();
            const w = Math.floor((wd -1 + amount -1) / 5);
            const days = amount -1 - w *5;
            const wday = wd + days < 6 ? wd + days : wd +2 + days;
            return moment(hours.ends).isoWeek(hours.ends.isoWeek() + w).isoWeekday(wday);
        },
        dec(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 1) return this.inc(dateTime, -amount);
            const start = this.ceil(dateTime);
            const wd = start.isoWeekday();
            if (amount >= 1 && wd == 1)
                return this.dec(start.subtract(3, 'days'), amount -1)
            else if (wd == 7)
                return this.dec(start.subtract(1, 'days'), amount);
            const w = Math.floor(amount / 5);
            const days = amount - w*5;
            const wday = wd > days ? wd - days : wd -2 - days;
            const date = start.isoWeek(start.isoWeek() - w).isoWeekday(wday);
            return this.ceil(date);
        },
        diff(to, from) {
            if (to.isBefore(from)) return -1 * this.diff(from, to);
            else if (to.isSame(from)) return 0;
            const hours = marketHours(ex, from);
            if (!to.isAfter(hours.opens)) return 0;
            if (to.isBefore(hours.ends)) return 1;
            if (from.isBefore(hours.ends)) return 1 + this.diff(to, hours.ends);
            const start = hours.ends;
            const end = this.ceil(to);
            const weeks = end.diff(start, 'weeks');
            if (weeks)
                return weeks * 5 + this.diff(end, start.add(weeks, 'weeks'));
            else if (start.isoWeekday() > 5)
                return this.diff(end, start.startOf('day').add(1, 'weeks').isoWeekday(1));
            else if (end.isoWeekday() > 6)
                return this.diff(end.startOf('day').isoWeekday(6), start);
            else if (start.isoWeekday() < end.isoWeekday())
                return end.diff(start, 'days');
            else
                return Math.max(end.diff(start, 'days') -2, 0);
        }
    };
}

function intervalInWeeks(measurement, ex) {
    const day = intervalInDays('day', ex);
    return {
        value: 'week',
        millis: 5 * 24 * 60 * 60 * 1000,
        session_length: 1/5,
        floor(dateTime) {
            if (dateTime.day() >= 5) {
                const hours = marketHours(ex, dateTime);
                if (!dateTime.isBefore(hours.ends))
                    return marketHours(ex, moment(dateTime).day(6)).opens; // start of next
                if (hours.opens.day() != 5 && dateTime.isBefore(hours.opens))
                    return hours.opens; // start of next
            }
            return day.floor(moment(dateTime).day(1).startOf('day')); // start of week
        },
        ceil(dateTime) {
            if (dateTime.day() <= 1) {
                const hours = marketHours(ex, dateTime);
                if (hours.opens.day() <= 1 && !hours.opens.isBefore(dateTime))
                    return this.ceil(moment(dateTime).subtract(2, 'days')); // prior week
            }
            return day.ceil(moment(dateTime).day(5).endOf('day')); // end of week
        },
        inc(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 0) return this.dec(dateTime, -amount);
            const start = this.floor(dateTime);
            return this.ceil(start.isoWeek(start.isoWeek() + amount).subtract(2, 'days'));
        },
        dec(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 0) return this.inc(dateTime, -amount);
            const start = this.ceil(dateTime);
            return start.isoWeek(start.isoWeek() - amount);
        },
        diff(to, from) {
            if (to.isBefore(from)) return -1 * this.diff(from, to);
            else if (to.isSame(from)) return 0;
            const days = day.diff(this.ceil(to), this.floor(from));
            return Math.ceil(days/5);
        }
    };
}

function intervalInMonths(measurement, ex) {
    const jan1 = moment('2010-01-01');
    const days_in_measurement = moment(jan1).add(1,measurement).diff(jan1, 'days')/7*5;
    const day = intervalInDays('day', ex);
    return {
        value: measurement,
        millis: days_in_measurement * 24 * 60 * 60 * 1000,
        session_length: 1/days_in_measurement,
        floor(dateTime) {
            const end_of = marketHours(ex, moment(dateTime).endOf(measurement).hour(12), true).ends;
            if (!dateTime.isBefore(end_of))
                return marketHours(ex, moment(dateTime).endOf(measurement)).opens; // start of next
            return marketHours(ex, moment(dateTime).startOf(measurement)).opens; // start of month
        },
        ceil(dateTime) {
            const first = moment(dateTime).startOf(measurement);
            const floor = day.floor(first);
            if (!floor.isBefore(dateTime))
                return day.ceil(first.subtract(12, 'hours')); // prior month
            return day.ceil(moment(dateTime).endOf(measurement).hour(12));
        },
        inc(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 0) return this.dec(dateTime, -amount);
            const start = this.floor(dateTime);
            return this.ceil(start.add(amount, measurement).subtract(1,'weeks'));
        },
        dec(dateTime, amount) {
            if (!amount) return moment.min(dateTime, this.ceil(dateTime));
            else if (amount < 0) return this.inc(dateTime, -amount);
            const start = this.ceil(dateTime);
            return this.ceil(start.subtract(amount, measurement));
        },
        diff(to, from) {
            if (to.isBefore(from)) return -1 * this.diff(from, to);
            else if (to.isSame(from)) return 0;
            const start = this.floor(from);
            const end = this.ceil(to);
            return Math.ceil(end.diff(start, measurement, true));
        }
    };
}

function marketHours(ex, point, priorIfOutsideTrading) {
    const rth = ex.interval.charAt(0) != 'm' || ex.interval == 'month';
    const open_time = rth ? ex.open_time || ex.liquid_hours.substring(0, 8) : ex.trading_hours.substring(0, 8);
    const end_time = rth ? ex.liquid_hours.substring(11) : ex.trading_hours.substring(11);
    const opens = parseTime(point, open_time);
    const ends = open_time == end_time ? moment(opens) : parseTime(point, end_time);
    if (!opens.isBefore(ends) && !opens.isAfter(point) && ends.day() < 5) {
        ends.add(1, 'days');
    } else if (!opens.isBefore(ends) && !point.isAfter(ends) && opens.day() > 0) {
        opens.subtract(1, 'days');
    } else if (!opens.isBefore(ends) && priorIfOutsideTrading) {
        opens.subtract(1, 'days');
    } else if (!opens.isBefore(ends) && !priorIfOutsideTrading) {
        ends.add(1, 'days');
    }
    if (priorIfOutsideTrading && point.isBefore(opens)) {
        opens.subtract(1, 'days');
        ends.subtract(1, 'days');
    } else if (!priorIfOutsideTrading && ends.isBefore(point)) {
        opens.add(1, 'days');
        ends.add(1, 'days');
    }
    const wd = ends.isoWeekday() > 5 ? moment(ends).subtract(1,'ms').isoWeekday() : ends.isoWeekday();
    if (wd > 5 && priorIfOutsideTrading) {
        opens.subtract(wd - 5, 'days');
        ends.subtract(wd - 5, 'days');
    } else if (wd > 5) {
        opens.add(8 - wd, 'days');
        ends.add(8 - wd, 'days');
    }
    const minInDay = ends.diff(opens, 'minutes');
    const hoursInDay = Math.ceil(ends.diff(opens, 'hours', true));
    return {opens, ends, minInDay, hoursInDay};
}

function parseTime(date, time) {
    const hour = +time.substring(0, 2);
    const minute = +time.substring(3, 5);
    const second = +time.substring(6, 8);
    return moment(date).millisecond(0).second(second).minute(minute).hour(hour);
}
