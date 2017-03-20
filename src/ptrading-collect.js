#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-collect.js
/*
 *  Copyright (c) 2017 James Leigh, Some Rights Reserved
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

var os = require('os');
const _ = require('underscore');
const moment = require('moment-timezone');
const commander = require('commander');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const replyTo = require('./ipc-promise-reply.js');
const config = require('./ptrading-config.js');
const Collect = require('./collect.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Collects historic portfolio data")
        .usage('[date] [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--load <identifier>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-begin <number>', "Number of bars before begin dateTime")
        .option('--pad-end <number>', "Number of bars after end dateTime")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<exchange> to search")
        .option('--columns <list>', "Comma separated list of columns (such as day.close)")
        .option('--retain <expression>', "Conditional expression that must evaluate to a non-zero to be retained in the result")
        .option('--precedence <expression>', "Indicates the order in which securities should be checked fore inclusion in the result")
        .option('--output <file>', "CSV file to write the result into")
        .option('--reverse', "Reverse the order of the rows")
        .option('--transpose', "Swap the columns and rows");
}

if (process.send) {
    var parent = replyTo(process).handle('collect', payload => {
        return collect()(_.defaults({}, payload, config.options()));
    });
    var collect = _.once(() => Collect(function(options) {
        return parent.request('quote', options);
    }));
    process.on('disconnect', () => collect().close());
} else {
    var quote = require('./ptrading-quote.js');
    var collect = Collect(quote);
    var program = require.main === module ?
        usage(commander).parse(process.argv) : usage(new commander.Command());
    var workers = commander.workers || os.cpus().length;
    var children = _.range(workers).map(() => {
        return replyTo(config.fork(module.filename, program)).handle('quote', payload => {
            return quote(_.defaults({}, payload, config.options()));
        });
    });
    var seq = 0;
    module.exports = function(segments, options) {
        if (!options) options = segments;
        if (!_.isArray(segments) && !_.isString(segments)) segments = options.begin;
        if (!segments) throw Error("Collect needs a begin date to start from");
        if (!_.isArray(segments)) segments = [segments];
        var ranges = segments.map(segment => readRange(segment)).map((range, i, ranges) => {
            if (range.end || i == ranges.length -1) return range;
            else return _.extend(range, {end: ranges[i+1].begin});
        });
        return Promise.all(ranges.map((range, i, ranges) => {
            var opts = i > 0 && i < ranges.length -1 ? {pad_begin: 0, pad_end: 0} :
                i > 0 ? {pad_begin: 0} : i < ranges.length -1 ? {pad_end: 0} : {};
            return children[seq++ % workers].request('collect', _.defaults(opts, range, options));
        })).then(dataset => {
            return _.flatten(dataset, true);
        });
    };
    module.exports.close = function() {
        children.forEach(child => child.disconnect());
        return quote.close();
    };
    module.exports.shell = shell.bind(this, program.description(), module.exports);
    if (require.main === module && program.args.length) {
        Promise.resolve(program.args).then(args => {
            return module.exports(args, config.options());
        }).then(result => tabular(result))
          .catch(err => logger.error(err, err.stack))
          .then(() => module.exports.close());
    } else if (require.main === module) {
        program.help();
    }
}

function readRange(begin) {
    if (!begin) return {};
    else if (begin.match(/^\d\d\d\d$/)) return {
        begin: begin + '-01-01',
        end: (1 + +begin) + '-01-01'
    };
    else if (begin.match(/^\d\d\d\d-\d\d$/)) return {
        begin: begin + '-01',
        end: moment(begin + '-01').add(1, 'month').format('YYYY-MM-DD')
    };
    else if (begin.match(/^\d\d\d\d-?W\d\d(-?\d)?$/)) return {
        begin: begin,
        end: moment(begin).add(1, 'week').format('YYYY-MM-DD')
    };
    else return {
        begin: begin,
    };
}

function shell(desc, collect, app) {
    app.on('quit', () => collect.close());
    app.on('exit', () => collect.close());
    app.cmd('collect', desc, (cmd, sh, cb) => {
        collect(options).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    app.cmd('collect :begin([\\d\\-:+.WTZ ]+)', desc, (cmd, sh, cb) => {
        collect(cmd.params.begin.split(' '), config.options())
            .then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    _.forEach(rolling.functions, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
// help
help(app, 'collect', `
  Usage: collect :begins...

  ${desc}

    :begins..
      List of ranges: year, month, week, or start date that should be collected.
      These will then be appended together. Use pad_leading to run up PREV values
      between ranges.

  See also:
    help begin  
    help end  
    help pad_begin  
    help pad_end  
    help pad_leading  
    help columns  
    help retain  
    help precedence  
    help output  
    help reverse  
`);
help(app, 'pad_leading', `
  Usage: set pad_leading 0  

  Sets the number of additional rows to to compute as a warmup, but not included in the result
`);
help(app, 'precedence', `
  Usage: set precedence :expression

  The order that securities should be checked for inclusion in the result.
  A comma separated list of expressions can be provided and each may be
  wrapped in a DESC function to indicate the order should be reversed.

  See also:
    help expression  
    help common-functions  
    help lookback-functions  
    help indicator-functions  
    help rolling-functions  
    help LEADING  
    help DESC  
    help ASC  
`);
help(app, 'rolling-functions', `
  Aggregate functions may read already retained securities and the proposed security values.

  ${listFunctions(rolling.functions)}
`);
help(app, 'DESC', `
  Usage: DESC(expression)  

  Indicates the expression order should be reversed
`);
help(app, 'ASC', `
  Usage: ASC(expression)  

  Indicates the expression order should not be reversed
`);
}

function functionHelp(name, fn) {
    var source = fn.toString();
    var m = source.match(/^[^(]*\(([^)]*)\)/);
    var args = _.isString(fn.args) ? fn.args : _.property(1)(m) || '';
    var usage = ['\n', '  Usage: ', name, '(', args, ')', '  \n'].join('');
    var body = source.replace(/[^\{]*\{([\s\S]*)\}[^}]*/,'$1');
    var desc = fn.description ? '\n  ' + wrap(fn.description, 2, 80) + '\n' : body;
    var seeAlso = fn.seeAlso ? '\n  See also:\n' + fn.seeAlso.map(name => {
        return '    help ' + name + '  ';
    }).join('\n') + '\n' : '';
    return usage + desc + seeAlso;
}

function listFunctions(functions) {
    var buf = ['The following functions are available:\n'];
    var indent = _.reduce(functions, (max, fn, name) => Math.max(max, name.length), 0) + 8;
    var pad = _.range(indent - 6).map(i => " ").join('');
    _.forEach(functions, (fn, name) => {
        buf.push("      ");
        buf.push(name);
        buf.push(pad.substring(Math.min(name.length,indent - 5)));
        var source = fn.toString();
        var m = source.match(/^[^(]*\(\s*opt\w*\s*,\s*([^)]*)\)/) ||
            source.match(/^[^(]*\(([^)]*)\)/);
        var args = fn.args || _.property(1)(m) || '';
        var desc = fn.description || name + '(' + args + ')';
        buf.push(wrap(desc, indent, 80));
        buf.push('\n');
    });
    return buf.join('');
}

function wrap(desc, indent, len) {
    var buf = [];
    if (desc && desc.length < len - indent) {
        buf.push(desc);
    } else if (desc) {
        var width = len - indent;
        var remain = desc.trim();
        while (remain) {
            var idx = remain.lastIndexOf(' ', width);
            if (idx <= 0) idx = remain.indexOf(' ', width);
            if (idx <= 0 || remain.length < width) idx = remain.length;
            buf.push(remain.substring(0, idx));
            remain = remain.substring(idx +1);
            if (remain) buf.push('\n' + _.range(indent).map(i => " ").join(''));
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
