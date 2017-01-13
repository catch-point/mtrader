#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-quote.js
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

var os = require('os');
const _ = require('underscore');
const commander = require('commander');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const Quote = require('./quote.js');
const replyTo = require('./ipc-promise-reply.js');
const config = require('./ptrading-config.js');
const expect = require('chai').expect;
const common = require('./common-functions.js');
const lookback = require('./lookback-functions.js');
const indicator = require('./indicator-functions.js');

function usage(command) {
    return command.version('0.0.1')
        .description("Quotes historical data for the given symbol")
        .usage('<symbol> [exchange] [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-begin <number>', "Number of bars before begin dateTime")
        .option('--pad-end <number>', "Number of bars after end dateTime")
        .option('--columns <list>', "Comma separated list of columns (such as day.close)")
        .option('--output <file>', "CSV file to write the result into")
        .option('--reverse', "Reverse the order of the rows")
        .option('--transpose', "Swap the columns and rows");
}

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    if (program.args.length) {
        var fetch = require('./ptrading-fetch.js');
        var quote = Quote(fetch);
        Promise.resolve(program.args)
            .then(args => quote(_.defaults({
                symbol: args[0],
                exchange: args[1]
            }, config.opts())))
            .then(result => tabular(result))
            .catch(err => logger.error(err, err.stack))
            .then(() => quote.close())
            .then(() => fetch.close());
    } else if (process.send) {
        var parent = replyTo(process).handle('quote', payload => {
            return quote(_.defaults({}, payload, config.session()));
        });
        var quote = Quote(function(options) {
            return parent.request('fetch', options);
        });
        process.on('disconnect', () => quote.close());
    } else {
        program.help();
    }
} else {
    var fetch = require('./ptrading-fetch.js');
    var program = usage(new commander.Command());
    var workers = commander.workers || os.cpus().length;
    var children = _.range(workers).map(() => {
        return replyTo(config.fork(module.filename, program)).handle('fetch', payload => {
            var options = _.defaults({}, payload, config.session());
            return fetch(options);
        });
    });
    module.exports = function(options) {
        return chooseWorker(children, options.symbol).request('quote', options);
    };
    module.exports.close = function() {
        children.forEach(child => child.disconnect());
        fetch.close();
    };
    module.exports.shell = shell.bind(this, program.description(), children);
}

function chooseWorker(workers, string) {
    expect(workers).to.be.an('array').and.not.empty;
    var mod = workers.length;
    var w = (hashCode(string) % mod + mod) % mod;
    return workers[w];
}

function hashCode(str){
    var hash = 0, i, char;
    if (str.length === 0) return hash;
    for (i = 0, l = str.length; i < l; i++) {
        char = str.charCodeAt(i);
        hash = char + (hash << 6) + (hash << 16) - hash;
    }
    return hash;
}

function shell(desc, children, app) {
    app.on('quit', () => children.forEach(child => child.disconnect()));
    app.on('exit', () => children.forEach(child => child.disconnect()));
    app.cmd('quote :symbol :exchange?', desc, (cmd, sh, cb) => {
        chooseWorker(children, cmd.params.symbol).request('quote', _.defaults({
            symbol: cmd.params.symbol,
            exchange: cmd.params.exchange
        }, config.session())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    _.forEach(common, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
    _.forEach(lookback, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
    _.forEach(indicator, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
// help
help(app, 'quote', `
  Usage: quote :symbol[ :exchange]

  ${desc}

    :symbol
      The ticker symbol used by the exchange
    :exchange
      If provided, one of the following exchange acronyms:
${listExchanges()}
  See also:
    help begin  
    help end  
    help pad_begin  
    help pad_end  
    help columns  
    help criteria  
    help output  
    help reverse  
`);
help(app, 'pad_begin', `
  Usage: set pad_begin 0  

  Sets the number of additional rows to include before the begin date (might be less)
`);
help(app, 'pad_end', `
  Usage: set pad_end 0  

  Sets the number of additional rows to include after the end date (might be less)
`);
help(app, 'columns', `
  Usage: set columns [:expression[ AS ":label"],..]  

  Comma separated list of expressions and their labels

    :label
      The quoted string used as the output column name

    ${listExpressions()}

  See also:
    help common-functions  
    help lookback-functions  
    help indicator-functions  
`);
help(app, 'criteria', `
  Usage: set criteria :expression

  An expression that must evaluate to a non-zero value for an interval bar to be
  included in the output.

    ${listExpressions()}

  See also:
    help common-functions  
    help lookback-functions  
    help indicator-functions  
`);
help(app, 'common-functions', `
  Common functions have no restrictions on what expressions they can be used in.

  ${listFunctions(common)}
`);
help(app, 'lookback-functions', `
  Lookback functions may read data is the past to determine the current value.

  ${listFunctions(lookback)}
`);
help(app, 'indicator-functions', `
  Indicator functions must be prefixed by an interval and a dot and take numbers
  as paratemeters.

  ${listFunctions(indicator)}
`);
}

function functionHelp(name, fn) {
    var args = fn.args || _.property(1)(fn.toString().match(/^[^(]*\(\s*\w+\s*,\s*([^)]*)\)/)) || '';
    var usage = ['\n', '  Usage: ', name, '(', args, ')', '  \n'].join('');
    var source = fn.toString().replace(/[^\{]*\{([\s\S]*)\}[^}]*/,'$1');
    var desc = fn.description ? '\n  ' + wrap(fn.description, 2, 80) + '\n' : source;
    var seeAlso = fn.seeAlso ? '\n  See also:\n' + fn.seeAlso.map(name => {
        return '    help ' + name + '  ';
    }).join('\n') + '\n' : '';
    return usage + desc + seeAlso;
}

function listExchanges() {
    var buf = [];
    var exchanges = config('exchanges');
    _.keys(exchanges).forEach(exchange => {
        var desc = exchanges[exchange].description;
        buf.push("      ");
        buf.push(exchange);
        buf.push("        ".substring(Math.min(exchange.length,7)));
        buf.push(wrap(desc, 14, 80));
        buf.push('\n');
    });
    return buf.join('');
}

function listExpressions() {
    return `:expression
      An expression is any combination of field, constants, and function calls
      connected by an operator or operators.

      A constant can be a number or a quoted string.

      A function call has a name followed parentheses enclosed comma separated
      list of expressions.

      A field can be one of the following without a prefix:
      symbol    Represents the symbol used by the exchange
      exchange  Represents the exchange acronym
      ending    Represents the dateTime of when an interval ended

      A field can also be one of the following prefixed by an interval:
      <interval>.ending  The dateTime when the interval ends (interval prefix is optional)
      <interval>.open    The price when the interval began
      <interval>.high    The highest price during the interval
      <interval>.low     The lowest price during the interval
      <interval>.close   The price when the interval ended
      <interval>.volume  The volume during the interval

      An <interval> can be one of the following:
      year        List yearly quotes for security
      quarter     List quarterly quotes for security
      month       List monthly quotes for security
      week        List weekly quotes for security
      day         List daily quotes for security
      mX          List intraday quotes for security by X minutes

      Operators include the following:
      OR   0 if both expressions are 0.
      AND  0 if either expression is 0.
      =    0 if both expressions have the same value.
      !=   0 if either expression has a different value.
      <>   0 if either expression has a different value.
      <=   0 if the left expression is larger than the right.
      >=   0 if the right expression is larger than the left.
      <    0 if the left expression is larger than or equal to the right.
      >    0 if the right expression is larger than or equal to the left.
      +    Adds both values together.
      -    Subtracts the right value from the left value.
      *    Multiples the values together.
      /    Divides the right values into the left value.
      %    Returns the integer remainder of a division
      !    0 if the expression was not zero
      ()   Groups expressions together to possibly change their precedence.`;
}

function listFunctions(functions) {
    var buf = ['The following functions are available:\n'];
    var indent = _.reduce(functions, (max, fn, name) => Math.max(max, name.length), 0) + 8;
    var pad = _.range(indent - 6).map(i => " ").join('');
    _.forEach(functions, (fn, name) => {
        buf.push("      ");
        buf.push(name);
        buf.push(pad.substring(Math.min(name.length,indent - 5)));
        var args = fn.args || _.property(1)(fn.toString().match(/^[^(]*\(\s*\w+\s*,\s*([^)]*)\)/)) || '';
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
