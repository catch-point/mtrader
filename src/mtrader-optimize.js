#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader-optimize.js
/*
 *  Copyright (c) 2017-2019 James Leigh, Some Rights Reserved
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
const logger = require('./logger.js');
const replyTo = require('./promise-reply.js');
const config = require('./config.js');
const Optimize = require('./optimize.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');
const readCallSave = require('./read-call-save.js');
const version = require('./version.js').version;
const Collect = require('./mtrader-collect.js');

function usage(command) {
    return command.version(version)
        .description("Optimizes the parameter values in the given portfolio")
        .usage('<identifier> [options]')
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
        .option('--pad-leading <number>', "Number of work days prior to begin to compute initial variables")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<market> to search")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--criteria <expression>', "Expression that must evaluate to a non-zero to be retained")
        .option('--filter <expression>', "Expression that must evaluate to non-zero to be included in result")
        .option('--precedence <expression>', "Indicates the order in which securities should be checked fore inclusion in the result")
        .option('--order <expression>', "Comma separated list of expressions to indicate the result order")
        .option('--reset-every <Duration>', "Duration of time to reset rolling variables (ex. P1Y)")
        .option('--head <number>', "Limits the rows in the result to the given first few")
        .option('--tail <number>', "Include the given last few rows in the result")
        .option('--eval-score <expression>', "Expression that determines the score for a sample")
        .option('--solution-count <number>', "Number of solutions to include in result")
        .option('-o, --offline', "Disable data updates")
        .option('-u, --update', "Update the last bar of assets")
        .option('--solution-count <number>', "Number of solutions to include in result")
        .option('--termination <Duration>', "Amount of time spent searching for a solution before the best yet is used")
        .option('--amend', "If the result should include option properties from the input")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--save <file>', "JSON file to write the result into");
}

process.setMaxListeners(process.getMaxListeners()+1);

if (require.main === module) {
    const program = usage(commander).parse(process.argv);
    if (program.args.length) {
        const optimize = createInstance(program);
        process.on('SIGINT', () => optimize.close());
        process.on('SIGTERM', () => optimize.close());
        const save = config('save');
        Promise.all(program.args.map((name, i) => {
            return readCallSave(name, optimize, _.isArray(save) ? save[i] : save);
        })).catch(err => logger.error(err, err.stack) || (process.exitCode = 1))
          .then(() => optimize.close());
    } else {
        program.help();
    }
} else {
    module.exports = function() {
        return createInstance(usage(new commander.Command()));
    };
}

function createInstance(program) {
    const collect = new Collect();
    const optimize = new Optimize(collect);
    let promiseKeys, closed;
    const instance = function(options) {
        if (!promiseKeys) {
            promiseKeys = optimize({info:'help'})
                .then(_.first).then(info => ['info'].concat(_.keys(info.options)));
        }
        return promiseKeys.then(keys => _.pick(options, keys)).then(optimize);
    };
    instance.seed = optimize.seed;
    instance.close = function() {
        if (closed) return closed;
        else return closed = Promise.all([
            collect && collect.close(),
            optimize.close()
        ]);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    return instance;
}

function shell(desc, optimize, app) {
    app.on('quit', () => optimize.close());
    app.on('exit', () => optimize.close());
    app.cmd('optimize', desc, (cmd, sh, cb) => {
        readCallSave(null, optimize, config('save'))
          .then(() => sh.prompt(), cb);
    });
    app.cmd("optimize :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        readCallSave(cmd.params.name, optimize, config('save'))
          .then(() => sh.prompt(), cb);
    });
// help
return optimize({info:'help'}).then(_.first).then(info => {
help(app, 'optimize', `
  Usage: optimize :name

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
});
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
