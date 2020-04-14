#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader-replicate.js
/*
 *  Copyright (c) 2018-2020 James Leigh, Some Rights Reserved
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
const commander = require('commander');
const tabular = require('./tabular.js');
const merge = require('./merge.js');
const logger = require('./logger.js');
const replyTo = require('./promise-reply.js');
const config = require('./config.js');
const Replicate = require('./replicate.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');
const readCallSave = require('./read-call-save.js');
const Fetch = require('./mtrader-fetch.js');
const Collect = require('./mtrader-collect.js');
const Broker = require('./mtrader-broker.js');

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Changes workers orders to align with signal orders in result")
        .usage('<identifier> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('-i, --runInBand', "Runs in the same process rather than spawning or using remote workers")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--log <filename>', "Also appends log messages to given file")
        .option('--load <filename>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<market> to search")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--filter <expression>', "Expression that must evaluate to non-zero to be included in result")
        .option('-o, --offline', "Disable data updates")
        .option('-n, --dry-run', "Disable order submission")
        .option('--allocation-pct <percent>', "Percentage 0-100 of the balance that should be allocated to this strategy")
        .option('--allocation-peak-pct <percent>', "Percentage 0-100 of the maximum balance in the past 12 months to allocate")
        .option('--reserve-peak-allocation <number>', "Amount to exclude from allocation at peak balance in the past 12 month")
        .option('--allocation-min <number>', "Minimum monetary amount that should be allocated to this strategy")
        .option('--allocation-max <number>', "Maximum monetary amount that should be allocated to this strategy")
        .option('-f, --force', "Change live position even if it was changed more recently then model")
        .option('-w, --working-orders-only', "Don't try to align positions sizes, only submit working orders")
        .option('-W, --exclude-working-orders', "Only update positions sizes, don't submit/update working orders")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('-a, --append', "Append the new rows to the end of the file")
        .option('-z, --gzip', "Compress the output file")
        .option('--transpose', "Swap the columns and rows");
}

process.setMaxListeners(process.getMaxListeners()+1);

if (require.main === module) {
    const program = usage(commander).parse(process.argv);
    if (program.args.length) {
        const replicate = createInstance(program, config.options());
        process.on('SIGINT', () => replicate.close());
        process.on('SIGTERM', () => replicate.close());
        Promise.all(program.args.map(name => {
            return readCallSave(name, replicate).catch(err => {
                logger.error(err, err.stack);
                process.exitCode = 1;
            });
        })).then(results => [].concat(...results))
          .then(result => !result.length || _.compact(result).length ? result : null)
          .then(result => _.isArray(result) && tabular(result, config()))
          .then(() => replicate.close());
    } else {
        program.help();
    }
} else {
    module.exports = function(settings = {}) {
        return createInstance(usage(new commander.Command()), settings);
    };
}

function createInstance(program, settings = {}) {
    const fetch = new Fetch();
    const collect = new Collect(settings);
    const broker = new Broker(settings);
    const replicate = new Replicate(broker, fetch, collect, merge(settings.replicate, config('replicate')));
    let promiseKeys, closed;
    const instance = function(options) {
        if (!promiseKeys) {
            promiseKeys = replicate({info:'help'})
                .then(_.first).then(info => ['info'].concat(_.keys(info.options)));
        }
        return promiseKeys.then(keys => _.pick(options, keys)).then(replicate);
    };
    instance.close = function() {
        if (closed) return closed;
        else return closed = Promise.all([
            replicate.close(),
            broker.close(),
            collect.close(),
            fetch.close()
        ]);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    return instance;
}

function shell(desc, replicate, app) {
    app.on('quit', () => replicate.close());
    app.on('exit', () => replicate.close());
return replicate({info:'help'}).then(_.first).then(info => {
    app.cmd('replicate', desc, (cmd, sh, cb) => {
        readCallSave(null, replicate, config('save'))
          .then(() => sh.prompt(), cb);
    });
    app.cmd("replicate :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        readCallSave(cmd.params.name, replicate, config('save'))
          .then(() => sh.prompt(), cb);
    });
// help
help(app, 'replicate', `
  Usage: replicate :name

  ${desc}

    :name
      Uses the values from the named stored session to override the values of
      the current session.

  Options:
${listOptions(info.options)}
`);
_.each(info.options, (option, name) => {
help(app, name, `
  Usage: set ${name} ${option.usage || 'value'}  

  ${option.description}
` + (option.seeAlso ? `
  See also:` +
option.seeAlso.reduce((buf, also) => buf + `
    help ${also}  `, '') + `  
` : ''));
});
}).catch(err => logger.debug(err));
}

function listOptions(options) {
    const buf = [];
    const left = Math.max(_.max(_.keys(options).map(name => name.length)), 5) + 8;
    const indent = new Array(left+1).join(' ');
    const width = 80 - indent.length;
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
