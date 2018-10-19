#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader-fetch.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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
const replyTo = require('./promise-reply.js');
const config = require('./mtrader-config.js');

function usage(command) {
    return command.version(require('./version.js').version)
        .description("Fetches remote data for the given symbol")
        .usage('<interval> <symbol.market> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('--append', "Append the new rows to the end of the file")
        .option('--transpose', "Swap the columns and rows");
}

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    if (program.args.length) {
        var interval = program.args[0];
        var symbol = program.args[1];
        var market = program.args[2];
        if (!market && symbol && ~symbol.indexOf('.')) {
            market = symbol.substring(symbol.lastIndexOf('.')+1);
            symbol = symbol.substring(0, symbol.lastIndexOf('.'));
        }
        var fetch = Fetch();
        process.on('SIGINT', () => fetch.close());
        process.on('SIGTERM', () => fetch.close());
        Promise.resolve().then(() => fetch(_.defaults({
            interval: interval,
            symbol: symbol,
            market: market
        }, config.options())))
        .then(result => tabular(result, config()))
        .catch(err => logger.error(err, err.stack))
        .then(() => fetch.close());
    } else if (process.send) {
        replyTo(process).handle('fetch', payload => {
            return fetch()(payload);
        });
        var fetch = _.once(() => Fetch());
        process.on('disconnect', () => fetch().close());
        process.on('SIGHUP', () => {
            fetch().close();
            fetch = _.once(() => Fetch());
        });
    } else {
        program.help();
    }
} else if (config('workers') == 0) {
    var fetch;
    var closed = false;
    module.exports = function(options) {
        if (closed) throw Error("Fetch is closed");
        if (!fetch) fetch = Fetch();
        return fetch(options);
    };
    module.exports.open = function() {
        closed = false;
        return Promise.resolve();
    };
    module.exports.close = function() {
        closed = true;
        if (fetch) try {
            return fetch.close();
        } finally {
            fetch = null;
        } else return Promise.resolve();
    };
    process.on('SIGINT', module.exports.close);
} else {
    var program = usage(new commander.Command());
    var child;
    module.exports = function(options) {
        if (!child) {
            child = replyTo(config.fork(module.filename, program));
            module.exports.process = child.process;
        }
        return child.request('fetch', options);
    };
    module.exports.close = function() {
        if (child) try {
            return child.disconnect();
        } finally {
            child = null;
        } else return Promise.resolve();
    };
    module.exports.shell = shell.bind(this, program.description(), module.exports);
    process.on('SIGINT', module.exports.close);
    process.on('SIGTERM', module.exports.close);
}

function shell(desc, fetch, app) {
    app.on('quit', () => fetch.close());
    app.on('exit', () => fetch.close());
    // lookup
    app.cmd('lookup :symbol', "List securities with similar symbols", (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var market = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        fetch(_.defaults({
            interval: 'lookup',
            symbol: symbol,
            market: market
        }, config.options())).then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
    // fundamental
    app.cmd('fundamental :symbol', "List fundamental information about security", (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var market = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        fetch(_.defaults({
            interval: 'fundamental',
            symbol: symbol,
            market: market
        }, config.options())).then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
    // fetch
    app.cmd('fetch :interval :symbol', desc, (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var market = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        fetch(_.defaults({
            interval: cmd.params.interval,
            symbol: symbol,
            market: market
        }, config.options())).then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
// help
return fetch({help: true}).then(info => _.indexBy(info, 'name')).then(info => {
help(app, 'lookup', `
  Usage: lookup :symbol

  List securities and their market that have similar symbols

  Options:
${listOptions(info.lookup.options)}
`);
if (info.fundamental) help(app, 'fundamental', `
  Usage: fundamental :symbol.market

  List fundamental information about security

    :symbol.market
      The ticker symbol used by the market followed by a dot and one of the following market acronyms:
${listOptions(config('markets'))}

  Options:
${listOptions(info.fundamental.options)}
  See also:
    help transpose  
`);
help(app, 'fetch', `
  Usage: fetch :interval :symbol.market

  ${desc}

    :interval
      One of the following bar lengths:
      year        List yearly quotes for security
      quarter     List quarterly quotes for security
      month       List monthly quotes for security
      week        List weekly quotes for security
      day         List daily quotes for security
      mX          List intraday quotes for security by X minutes

    :symbol.market
      The ticker symbol used by the market followed by a dot and one of the following market acronyms:
${listOptions(config('markets'))}
  Options:
${listOptions(_.omit(info.interday.options, ['symbol', 'market', 'interval']))}
  See also:
    help begin  
    help end  
    help output  
    help reverse  
`);
_.values(info).map(info => info.options).forEach(options => _.each(options, (option, name) => {
help(app, name, `
  Usage: set ${name} ${option.usage || 'value'}  

  ${option.description}
`);
}));
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
});
}

function listOptions(options) {
    var buf = [];
    var left = Math.max(_.max(_.keys(options).map(name => name.length)), 5) + 8;
    var indent = new Array(left+1).join(' ');
    var width = 80 - indent.length;
    _.each(options, (option, name) => {
        buf.push(indent.substring(0,6));
        buf.push(name);
        buf.push(indent.substring(6 + name.length));
        buf.push(wrap(option.description, indent, 80));
        buf.push('\n');
    });
    return buf.join('');
}

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