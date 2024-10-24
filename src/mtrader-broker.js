#!/usr/bin/env -S node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-broker.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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
const Broker = require('./broker.js');
const Quote = require('./mtrader-quote.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Retrieve or execute orders in broker account")
        .usage('<action> [options]')
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
        .option('-o, --offline', "Disable data updates")
        .option('-u, --update', "Update the last bar of assets")
        .option('--amend', "If the result should include option properties from the input")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('-a, --append', "Append the new rows to the end of the file")
        .option('-c, --csv', "Use comma delimited output")
        .option('-z, --gzip', "Compress the output file")
        .option('-t, --transpose', "Swap the columns and rows");
}

process.setMaxListeners(process.getMaxListeners()+1);

if (require.main === module) {
    const program = usage(commander).parse(process.argv);
    if (program.args.length) {
        const broker = createInstance(program, config.options());
        process.on('SIGINT', () => broker.close());
        process.on('SIGTERM', () => broker.close());
        const action = program.args.join(' ');
        const save = config('save');
        return broker({...config.options(), action})
          .then(result => tabular(result, config()))
          .catch(err => logger.error(err, err.stack) || (process.exitCode = 1))
          .then(() => broker.close());
    } else {
        program.help();
    }
} else {
    module.exports = function(settings = {}) {
        return createInstance(usage(new commander.Command()), settings);
    };
}

function createInstance(program, settings = {}) {
    const quote = new Quote(settings);
    const broker = new Broker(merge(settings.broker, config('broker')), quote);
    let promiseKeys, closed;
    const instance = function(options) {
        if (!promiseKeys) {
            promiseKeys = broker({info:'help'})
                .then(info => info.reduce((keys, info) => _.uniq(keys.concat(_.keys(info.options))), ['info']));
        }
        return promiseKeys.then(keys => _.pick(options, keys)).then(broker);
    };
    instance.close = function() {
        if (closed) return closed;
        else return closed = Promise.all([broker.close(), quote.close()]);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    return instance;
}

function shell(desc, broker, app) {
    app.on('quit', () => broker.close());
    app.on('exit', () => broker.close());
return broker({info:'help'}).then(array => merge(...array)).then(info => {
    app.cmd("broker :name([a-zA-Z0-9]+)", desc, (cmd, sh, cb) => {
        broker({...config.options(), action: cmd.params.name})
          .then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
// help
help(app, 'broker', `
  Usage: broker :action

  ${desc}

    :action
      order action or other command for the broker

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
