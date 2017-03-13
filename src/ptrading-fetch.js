#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-fetch.js
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

const _ = require('underscore');
const commander = require('commander');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const Fetch = require('./fetch.js');
const replyTo = require('./ipc-promise-reply.js');
const config = require('./ptrading-config.js');

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Fetches remote data for the given symbol")
        .usage('<interval> <symbol.exchange> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--load <identifier>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--output <file>', "CSV file to write the result into")
        .option('--reverse', "Reverse the order of the rows")
        .option('--transpose', "Swap the columns and rows");
}

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    var fetch = Fetch();
    if (program.args.length) {
        var interval = program.args[0];
        var symbol = program.args[1];
        var exchange = program.args[2];
        if (!exchange && symbol && ~symbol.indexOf('.')) {
            exchange = symbol.substring(symbol.lastIndexOf('.')+1);
            symbol = symbol.substring(0, symbol.lastIndexOf('.'));
        }
        Promise.resolve().then(() => fetch(_.defaults({
            interval: interval,
            symbol: symbol,
            exchange: exchange
        }, config.opts())))
        .then(result => tabular(result))
        .catch(err => logger.error(err, err.stack))
        .then(() => fetch.close());
    } else if (process.send) {
        replyTo(process).handle('fetch', payload => {
            return fetch(_.defaults({}, payload, config.options()));
        });
        process.on('disconnect', () => fetch.close());
    } else {
        program.help();
    }
} else {
    var program = usage(new commander.Command());
    var child = replyTo(config.fork(module.filename, program));
    module.exports = function(options) {
        return child.request('fetch', options);
    };
    module.exports.process = child.process;
    module.exports.close = function() {
        child.disconnect();
    };
    module.exports.shell = shell.bind(this, program.description(), child);
}

function shell(desc, child, app) {
    app.on('quit', () => child.disconnect());
    app.on('exit', () => child.disconnect());
    // lookup
    app.cmd('lookup :symbol', "List securities with similar symbols", (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var exchange = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        child.request('fetch', _.defaults({
            interval: 'lookup',
            symbol: symbol,
            exchange: exchange
        }, config.options())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    // fundamental
    app.cmd('fundamental :symbol', "List fundamental information about security", (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var exchange = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        child.request('fetch', _.defaults({
            interval: 'fundamental',
            symbol: symbol,
            exchange: exchange
        }, config.options())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    // fetch
    app.cmd('fetch :interval :symbol', desc, (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var exchange = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        child.request('fetch', _.defaults({
            interval: cmd.params.interval,
            symbol: symbol,
            exchange: exchange
        }, config.options())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
// help
help(app, 'lookup', `
  Usage: lookup :symbol

  List securities and their exchange that have similar symbols
`);
help(app, 'fundamental', `
  Usage: fundamental :symbol.exchange

  List fundamental information about security

    :symbol.exchange
      The ticker symbol used by the exchange followed by a dot and one of the following exchange acronyms:
${listExchanges()}
  See also:
    help transpose  
`);
help(app, 'fetch', `
  Usage: fetch :interval :symbol.exchange

  ${desc}

    :interval
      One of the following bar lengths:
      year        List yearly quotes for security
      quarter     List quarterly quotes for security
      month       List monthly quotes for security
      week        List weekly quotes for security
      day         List daily quotes for security
      mX          List intraday quotes for security by X minutes

    :symbol.exchange
      The ticker symbol used by the exchange followed by a dot and one of the following exchange acronyms:
${listExchanges()}
  See also:
    help begin  
    help end  
    help output  
    help reverse  
`);
help(app, 'begin', `
  Usage: set begin YYYY-MM-DD  

  Sets the earliest date (or dateTime) to retrieve
`);
help(app, 'end', `
  Usage: set end YYYY-MM-DD HH:MM:SS  

  Sets the latest dateTime to retrieve
`);
help(app, 'output', `
  Usage: set output :filename

  When set the CSV output is saved to a file instead of stdout
`);
help(app, 'reverse', `
  Usage: set reverse true  

  When set to true the output is reverse chronological order
`);
help(app, 'transpose', `
  Usage: set transpose true  

  The rows become columns and the columns the rows in the output
`);
}

function listExchanges() {
    var buf = [];
    var exchanges = config('exchanges');
    _.keys(exchanges).forEach(exchange => {
        var desc = exchanges[exchange].description;
        buf.push("      ");
        buf.push(exchange);
        buf.push("        ".substring(Math.min(exchange.length,7)));
        if (desc && desc.length < 80 - 14) {
            buf.push(desc);
            buf.push('\n');
        } else if (desc) {
            var width = 80 - 14;
            var remain = desc.trim();
            while (remain) {
                var idx = remain.lastIndexOf(' ', width);
                if (idx <= 0) idx = remain.indexOf(' ', width);
                if (idx <= 0 || remain.length < width) idx = remain.length;
                buf.push(remain.substring(0, idx));
                buf.push('\n');
                remain = remain.substring(idx +1);
                if (remain) buf.push(_.range(14).map(i => " ").join(''));
            }
        }
        buf.push('\n');
    });
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
