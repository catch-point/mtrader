#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader-collective2.js
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

const fs = require('fs');
const _ = require('underscore');
const moment = require('moment-timezone');
const commander = require('commander');
const tabular = require('./tabular.js');
const logger = require('./logger.js');
const replyTo = require('./promise-reply.js');
const config = require('./mtrader-config.js');
const Collective2 = require('./collective2.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');
const readCallSave = require('./read-call-save.js');

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Changes workers orders to align with signal orders in result")
        .usage('<identifier> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--log <filename>', "Also appends log messages to given file")
        .option('--load <filename>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<exchange> to search")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--filter <expression>', "Expression that must evaluate to non-zero to be included in result")
        .option('-o, --offline', "Disable data updates")
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
        var collective2 = createInstance(program);
        process.on('SIGINT', () => collective2.close());
        process.on('SIGTERM', () => collective2.close());
        Promise.all(program.args.map(name => {
            return readCallSave(name, collective2)
              .then(result => tabular(result, config()))
        })).catch(err => logger.error(err, err.stack))
          .then(() => collective2.close());
    } else {
        program.help();
    }
} else {
    module.exports = createInstance(usage(new commander.Command()));
}

function createInstance(program) {
    var collect = require('./mtrader-collect.js');
    var collective2 = Collective2(collect);
    var promiseKeys;
    var instance = function(options) {
        if (!promiseKeys) {
            promiseKeys = collective2({help: true})
                .then(_.first).then(info => ['help'].concat(_.keys(info.options)));
        }
        return promiseKeys.then(keys => _.pick(options, keys)).then(collective2);
    };
    instance.close = function() {
        return collective2.close().then(collect.close);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    return instance;
}

function shell(desc, collective2, app) {
    app.on('quit', () => collective2.close());
    app.on('exit', () => collective2.close());
    app.cmd('collective2', desc, (cmd, sh, cb) => {
        readCallSave(null, collective2, config('save'))
          .then(() => sh.prompt(), cb);
    });
    app.cmd("collective2 :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        readCallSave(cmd.params.name, collective2, config('save'))
          .then(() => sh.prompt(), cb);
    });
// help
return collective2({help: true}).then(_.first).then(info => {
help(app, 'collective2', `
  Usage: collective2 :name

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
