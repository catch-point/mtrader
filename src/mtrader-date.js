#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader-date.js
/*
 *  Copyright (c) 2018-2019 James Leigh, Some Rights Reserved
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
const logger = require('./logger.js');
const config = require('./config.js');
const version = require('./version.js').version;

const months = _.once(function() {
    const date = moment('2010-01-01');
    return _.range(0, 12).reduce((months, m) => {
        const mdate = date.month(m);
        months[mdate.format('MMM')] = m;
        months[mdate.format('MMMM')] = m;
        return months;
    }, {});
});

const dates = _.once(function() {
    const date = moment('2010-03-01');
    return _.range(1, 32).reduce((dates, d) => {
        const mdate = date.date(d);
        dates[mdate.format('Do')] = d;
        return dates;
    }, {});
});

const days = _.once(function() {
    const date = moment('2010-03-01');
    return _.range(0, 7).reduce((days, d) => {
        const mdate = date.day(d);
        days[mdate.format('dd')] = d;
        days[mdate.format('ddd')] = d;
        days[mdate.format('dddd')] = d;
        return days;
    }, {});
});

if (require.main === module) {
    const program = require('commander').version(version)
        .description("Date manipulation")
        .usage('<format> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
        .option('--now <date>', "Use this date value as the base timestamp")
        .option('-d, --duration <durationOrValue>', "Advance or reverse the date by these comma separated durations or to values")
        .parse(process.argv);
    if (program.args.length) {
        try {
            const format = program.args.join(' ');
            console.log(formatDate(format, config()));
        } catch(err) {
            logger.error(err, err.stack);
            process.exit(2);
        }
    } else {
        logger.error("No date format provided");
        process.exit(1);
    }
}

module.exports = function() {
    return Object.assign((format, options) => formatDate(format, options), {
        shell: shell,
        close: () => Promise.resolve()
    });
};

function formatDate(format, options) {
    const date = moment(options.now);
    const durations = _.isArray(options.duration) ? options.duration :
        _.isString(options.duration) ? options.duration.split(',') : [];
    const advanced = durations.reduce((date, d) => {
        if (d.match(/^[PYMWDTHMS0-9\-\+,.:]+$/)) return date.add(moment.duration(d));
        else if (d == 'open') return nextOpen(date);
        else if (d == '-open') return lastOpen(date);
        else if (d && d.charAt(0) == '-') return reverse(date, d.substring(1));
        else return advance(date, d);
    }, date);
    return advanced.format(format);
}

function advance(date, w) {
    const startOf = ['year', 'month', 'quarter', 'week', 'isoWeek',
            'day', 'date', 'hour', 'minute', 'second'];
    const advanced = ~startOf.indexOf(w) ? moment(date).startOf(w) :
        _.has(months(), w) ? moment(date).month(months()[w]) :
        _.has(dates(), w) ? moment(date).date(dates()[w]) :
        _.has(days(), w) ? moment(date).day(days()[w]) : null;
    if (!advanced) throw Error(`Unknown duration format ${w}`);
    else if (!advanced.isBefore(date)) return advanced;
    else return ~startOf.indexOf(w) ? moment(date).add(1, w).startOf(w) :
            _.has(months(), w) ? moment(date).add(1, 'year').month(months()[w]) :
            _.has(dates(), w) ? moment(date).add(1, 'month').date(dates()[w]) :
            _.has(days(), w) ? moment(date).add(1, 'week').day(days()[w]) : null;
}

function reverse(date, w) {
    const startOf = ['year', 'month', 'quarter', 'week', 'isoWeek',
            'day', 'date', 'hour', 'minute', 'second'];
    const reversed = ~startOf.indexOf(w) ? moment(date).startOf(w) :
        _.has(months(), w) ? moment(date).month(months()[w]) :
        _.has(dates(), w) ? moment(date).date(dates()[w]) :
        _.has(days(), w) ? moment(date).day(days()[w]) : null;
    if (!reversed) throw Error(`Unknown duration format ${w}`);
    else if (!reversed.isAfter(date)) return reversed;
    else return ~startOf.indexOf(w) ? moment(date).subtract(1, w).startOf(w) :
            _.has(months(), w) ? moment(date).subtract(1, 'year').month(months()[w]) :
            _.has(dates(), w) ? moment(date).subtract(1, 'month').date(dates()[w]) :
            _.has(days(), w) ? moment(date).subtract(1, 'week').day(days()[w]) : null;
}

function nextOpen(date) {
    while (date.isoWeekday() > 5 || isOptionsMarketHoliday(date)) {
        date = date.add(1, 'days');
    }
    return date;
}

function lastOpen(date) {
    while (date.isoWeekday() > 5 || isOptionsMarketHoliday(date)) {
        date = date.subtract(1, 'days');
    }
    return date;
}

/**
 * If the holiday falls on a Saturday, the holiday will be observed on the
 * previous day (Friday), except for New Year's Day. If the holiday falls on a
 * Sunday, the holiday will be observed on the next day (Monday).
 * @see http://cfe.cboe.com/about-cfe/holiday-calendar
 */
function isOptionsMarketHoliday(date) {
    if (isNewYearsDay(date)) return true;
    if (isMartinLutherKingDay(date)) return true;
    if (isWashingtonsBirthday(date)) return true;
    if (isGoodFriday(date)) return true;
    if (isMemorialDay(date)) return true;
    if (isIndependenceDay(date)) return true;
    if (isLaborDay(date)) return true;
    if (isThanksgiving(date)) return true;
    if (isChristmasDay(date)) return true;
    else return false;
}

function isNewYearsDay(date) {
    const d = date.date();
    const w = date.isoWeekday();
    return date.month() == 0 && (d == 1 || d == 2 && w == 1);
}

function isMartinLutherKingDay(date) {
    return date.month() == 0 && date.isoWeekday() == 1 && 15 <= date.date() && date.date() <= 21;
}

function isWashingtonsBirthday(date) {
    return date.month() == 1 && date.isoWeekday() == 1 && 15 <= date.date() && date.date() <= 21;
}

function isGoodFriday(date) {
    const m = date.month();
    return 2 <= m && m <= 3 && date.isoWeekday() == 5 && isEaster(moment(date).add(2, 'days'));
}

function isEaster(date) {
    const easter = [
        '2000-04-23', '2001-04-15', '2002-03-31', '2003-04-20', '2004-04-11',
        '2005-03-27', '2006-04-16', '2007-04-08', '2008-03-23', '2009-04-12',
        '2010-04-04', '2011-04-24', '2012-04-08', '2013-03-31', '2014-04-20',
        '2015-04-05', '2016-03-27', '2017-04-16', '2018-04-01', '2019-04-21',
        '2020-04-12', '2021-04-04', '2022-04-17', '2023-04-09', '2024-03-31',
        '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16', '2029-04-01',
        '2030-04-21', '2031-04-13', '2032-03-28', '2033-04-17', '2034-04-09',
        '2035-03-25', '2036-04-13', '2037-04-05', '2038-04-25', '2039-04-10'
    ];
    return ~easter.indexOf(date.format('Y-MM-DD'));
}

function isMemorialDay(date) {
    return date.month() == 4 && date.isoWeekday() == 1 && 25 <= date.date();
}

function isIndependenceDay(date) {
    const d = date.date();
    const w = date.isoWeekday();
    return date.month() == 6 && (d == 3 && w == 5 || d == 4 || d == 5 && w == 1);
}

function isLaborDay(date) {
    return date.month() == 8 && date.isoWeekday() == 1 && date.date() <= 7;
}

function isThanksgiving(date) {
    return date.month() == 10 && date.isoWeekday() == 4 && 22 <= date.date() && date.date() <= 28;
}

function isChristmasDay(date) {
    const d = date.date();
    const w = date.isoWeekday();
    return date.month() == 11 && (d == 24 && w == 5 || d == 25 || d == 26 && w == 1);
}

function shell(app) {
    app.cmd('date :format', "Show the time now for this session", (cmd, sh, cb) => {
        try {
            const value = formatDate(cmd.params.format, config());
            sh.white(value).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
help(app, 'date', `
  Usage: date :format

  Show the time now for this session

  Usage: date :format

  Show the time now for this session in the given format. If a duration value
  is provided the time now is advanced by the comma separated values of the
  ISO 8601 duration or to start of period or weekday or day of month or month.
  A dash '-' before the term indicates the date should be reversed to the period.
  The term open is used to indicate a day that the CBOE market is open.
  Other than durations, the following values are also permitted:
    open
    ${wrap(['year', 'month', 'quarter', 'week', 'isoWeek',
            'day', 'date', 'hour', 'minute', 'second'].join(' '), '    ', 80)}
    ${wrap(_.keys(months()).join(' '), '    ', 80)}
    ${wrap(_.keys(dates()).join(' '), '    ', 80)}
    ${wrap(_.keys(days()).join(' '), '    ', 80)}
`);
};

function wrap(desc, indent, len) {
    const buf = [];
    if (desc && desc.length < len - indent.length) {
        buf.push(desc);
    } else if (desc) {
        const width = len - indent.length;
        let remain = desc.trim();
        while (remain) {
            let idx = remain.lastIndexOf(' ', width);
            if (idx <= 0) idx = remain.indexOf(' ', width);
            if (idx <= 0 || remain.length < width) idx = remain.length;
            buf.push(remain.substring(0, idx));
            remain = remain.substring(idx +1);
            if (remain) buf.push('\n' + indent);
        }
    }
    return buf.join('');
}

function help(app, cmd, usage) {
    app.cmd('help ' + cmd, (cmd, sh, cb) => {
        usage.split('\n').forEach(line => {
            if (~line.indexOf(' :')) {
                sh.cyan(line).ln();
            } else if (~line.indexOf(' ')) {
                sh.cyan(line.substring(0, line.lastIndexOf('  '))).white(line.substring(line.lastIndexOf('  '))).ln();
            } else {
                sh.white(line).ln();
            }
        });
        sh.prompt();
    });
}
