#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader-date.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
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
const logger = require('./logger.js');
const config = require('./config.js');

var months = _.once(function() {
    var date = moment('2010-01-01');
    return _.range(0, 12).reduce((months, m) => {
        var mdate = date.month(m);
        months[mdate.format('MMM')] = m;
        months[mdate.format('MMMM')] = m;
        return months;
    }, {});
});

var dates = _.once(function() {
    var date = moment('2010-03-01');
    return _.range(1, 32).reduce((dates, d) => {
        var mdate = date.date(d);
        dates[mdate.format('Do')] = d;
        return dates;
    }, {});
});

var days = _.once(function() {
    var date = moment('2010-03-01');
    return _.range(0, 7).reduce((days, d) => {
        var mdate = date.day(d);
        days[mdate.format('dd')] = d;
        days[mdate.format('ddd')] = d;
        days[mdate.format('dddd')] = d;
        return days;
    }, {});
});

if (require.main === module) {
    var program = require('commander').version(require('./version.js').version)
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
        .option('--tz <timeZone>', "Use this time zone when manipulating dates")
        .option('-d, --duration <durationOrValue>', "Advance the date by these comma separated durations or to values")
        .parse(process.argv);
    if (program.args.length) {
        try {
            var format = program.args.join(' ');
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

module.exports = formatDate;

function formatDate(format, options) {
    var tz = options.tz || moment.tz.guess();
    var date = moment.tz(options.now, tz);
    var durations = _.isArray(options.duration) ? options.duration :
        _.isString(options.duration) ? options.duration.split(',') : [];
    var startOf = ['year', 'month', 'quarter', 'week', 'isoWeek',
            'day', 'date', 'hour', 'minute', 'second'];
    var advanced = durations.reduce((date, d) => {
        if (d.match(/^[PYMWDTHMS0-9\-\+,.:]+$/)) return date.add(moment.duration(d));
        var advanced = ~startOf.indexOf(d) ? moment(date).startOf(d) :
            _.has(months(), d) ? moment(date).month(months()[d]) :
            _.has(dates(), d) ? moment(date).date(dates()[d]) :
            _.has(days(), d) ? moment(date).day(days()[d]) : null;
        if (!advanced) throw Error(`Unknown duration format ${d}`);
        else if (!advanced.isBefore(date)) return advanced;
        else return ~startOf.indexOf(d) ? moment(date).add(1, d).startOf(d) :
                _.has(months(), d) ? moment(date).add(1, 'year').month(months()[d]) :
                _.has(dates(), d) ? moment(date).add(1, 'month').date(dates()[d]) :
                _.has(days(), d) ? moment(date).add(1, 'week').day(days()[d]) : null;
    }, date);
    return advanced.format(format);
}

module.exports.shell = function(app) {
    app.cmd('date :format', "Show the time now for this session", (cmd, sh, cb) => {
        try {
            var value = formatDate(cmd.params.format, config());
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
  Other than durations, the following values are also permitted:
    ${wrap(['year', 'month', 'quarter', 'week', 'isoWeek',
            'day', 'date', 'hour', 'minute', 'second'].join(' '), '    ', 80)}
    ${wrap(_.keys(months()).join(' '), '    ', 80)}
    ${wrap(_.keys(dates()).join(' '), '    ', 80)}
    ${wrap(_.keys(days()).join(' '), '    ', 80)}
`);
};

function wrap(desc, indent, len) {
    var buf = [];
    if (desc && desc.length < len - indent.length) {
        buf.push(desc);
    } else if (desc) {
        var width = len - indent.length;
        var remain = desc.trim();
        while (remain) {
            var idx = remain.lastIndexOf(' ', width);
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
