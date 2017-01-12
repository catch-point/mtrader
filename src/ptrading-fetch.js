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
    return command.version('0.0.1')
        .description("Fetches remote data for the given symbol")
        .usage('<interval> <symbol> [exchange] [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
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
        Promise.resolve(program.args)
            .then(args => fetch(_.defaults({
                interval: args[0],
                symbol: args[1],
                exchange: args[2]
            }, config.opts())))
            .then(result => tabular(result))
            .catch(err => logger.error(err, err.stack))
            .then(() => fetch.close());
    } else if (process.send) {
        replyTo(process).handle('fetch', payload => {
            return fetch(_.defaults({}, payload, config.session()));
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
    app.cmd('lookup :symbol', "List securities with similar symbols", (cmd, sh, cb) => {
        child.request('fetch', _.defaults({
            interval: 'lookup',
            symbol: cmd.params.symbol
        }, config.session())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    app.cmd('fundamental :symbol :exchange', desc, (cmd, sh, cb) => {
        child.request('fetch', _.defaults({
            interval: 'fundamental',
            symbol: cmd.params.symbol,
            exchange: cmd.params.exchange
        }, config.session())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    app.cmd('fetch :interval :symbol :exchange', "List fundamental information about security", (cmd, sh, cb) => {
        child.request('fetch', _.defaults({
            interval: cmd.params.interval,
            symbol: cmd.params.symbol,
            exchange: cmd.params.exchange
        }, config.session())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    app.cmd('help :cmd', (cmd, sh, cb) => {
        if (cmd.params.cmd != 'fetch') return cb();
        help(desc, sh);
        sh.prompt();
    });
    app.on('quit', () => child.disconnect());
    app.on('exit', () => child.disconnect());
}

function help(desc, sh) {
    sh.ln().white("  ").white(desc).ln();
    sh.ln().cyan("    ").cyan(":interval").ln();
    sh.white("      ").white("One of the following bar lengths:").ln();
    sh.cyan("      ").cyan("year        ").white("List yearly quotes for security").ln();
    sh.cyan("      ").cyan("quarter     ").white("List quarterly quotes for security").ln();
    sh.cyan("      ").cyan("month       ").white("List monthly quotes for security").ln();
    sh.cyan("      ").cyan("week        ").white("List weekly quotes for security").ln();
    sh.cyan("      ").cyan("day         ").white("List daily quotes for security").ln();
    sh.cyan("      ").cyan("mX          ").white("List intraday quotes for security by X minutes").ln();
    sh.ln().cyan("    ").cyan(":symbol").ln();
    sh.white("      ").white("The ticker symbol used by the exchange").ln();
    sh.ln().cyan("    ").cyan(":exchange").ln();
    sh.white("      ").white("If provided, one of the following exchange acronyms:").ln();
    var exchanges = config('exchanges');
    _.keys(exchanges).forEach(exchange => {
        var desc = exchanges[exchange].description;
        sh.cyan("      ").cyan(exchange).cyan("        ".substring(Math.min(exchange.length,7)));
        if (desc && desc.length < 80 - 14) {
            sh.white(desc).ln();
        } else if (desc) {
            var width = 80 - 14;
            var remain = desc.trim();
            while (remain) {
                var idx = remain.lastIndexOf(' ', width);
                if (idx <= 0) idx = remain.indexOf(' ', width);
                if (idx <= 0 || remain.length < width) idx = remain.length;
                sh.white(remain.substring(0, idx)).ln();
                remain = remain.substring(idx +1);
                if (remain) sh.white(_.range(14).map(i => " ").join(''));
            }
        }
        sh.ln();
    });
    sh.white("  ").white("Command uses the following settings:").ln();
    sh.cyan("    ").cyan("begin   ").white("Date or DateTime of the earlier historic quote to fetch").ln();
    sh.cyan("    ").cyan("end     ").white("Date or DateTime of the latest historic quote to fetch").ln();
    sh.cyan("    ").cyan("output  ").white("CSV filename to store the result of the command").ln();
}
