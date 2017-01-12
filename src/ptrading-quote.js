#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-quote.js
/* 
 *  Copyright (c) 2016 James Leigh, Some Rights Reserved
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
    module.exports = function(interval, symbol, exchange, options) {
        return chooseWorker(childern, symbol).request('quote', _.defaults({
            interval: interval,
            symbol: symbol,
            exchange: exchange
        }, options));
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
    app.cmd('quote :symbol :exchange?', desc, (cmd, sh, cb) => {
        chooseWorker(children, cmd.params.symbol).request('quote', _.defaults({
            symbol: cmd.params.symbol,
            exchange: cmd.params.exchange
        }, config.session())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    app.cmd('help :cmd', (cmd, sh, cb) => {
        if (cmd.params.cmd != 'quote') return cb();
        help(desc, sh);
        sh.prompt();
    });
    app.on('quit', () => children.forEach(child => child.disconnect()));
    app.on('exit', () => children.forEach(child => child.disconnect()));
}

function help(desc, sh) {
    sh.ln().white("  ").white(desc).ln();
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
    sh.white("  ").white("Some commands use the following settings:").ln();
    sh.cyan("    ").cyan("begin       ").white("Date or DateTime of the earlier historic quote to include").ln();
    sh.cyan("    ").cyan("end         ").white("Date or DateTime of the latest historic quote to include").ln();
    sh.cyan("    ").cyan("pad_begin   ").white("Additional rows to include before the begin date (might be less)").ln();
    sh.cyan("    ").cyan("pad_end     ").white("Additional rows to include after the end date (might be less)").ln();
    sh.cyan("    ").cyan("columns     ").white("Comma separated list of columns/functions").ln();
    sh.cyan("    ").cyan("output      ").white("CSV filename to store the result of the command").ln();
}
