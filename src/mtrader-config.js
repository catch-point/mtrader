#!/usr/bin/env -S node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-config.js
/*
 *  Copyright (c) 2016-2019 James Leigh, Some Rights Reserved
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
const logger = require('./logger.js');
const config = require('./config.js');
const merge = require('./merge.js');
const version = require('./version.js').version;
const readCallSave = require('./read-call-save.js');

if (require.main === module) {
    const program = require('commander').version(version)
        .description("View or change stored options")
        .usage('<name> [value] [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
        .option('--save <identifier>', "Modify the settings in the given stored session")
        .parse(process.argv);
    if (program.args.length) {
        try {
            const name = _.first(program.args);
            const str = _.rest(program.args).join(' ');
            const chr = str.charAt(0);
            const value = chr == '{' || chr == '"' || chr == '[' ||
                str == 'true' || str == 'false' || _.isFinite(str) ?
                JSON.parse(str) : str;
            if (config('save') && program.args.length > 1) {
                readCallSave(config('save'), data => {
                    config.session(name, value);
                    return merge(config.read(config('save')), config.session());
                }, config('save'))
                  .catch(err => logger.error(err, err.stack) || (process.exitCode = 1));
            } else if (program.args.length > 1) {
                config.store(name, value);
            } else {
                console.log(JSON.stringify(config(name)));
            }
        } catch(err) {
            logger.error(err, err.stack);
        }
    } else {
        console.log(JSON.stringify(config(), null, 2));
    }
}

module.exports = function() {
    const instance = _.extend(function(name, value) {
        return config.apply(config, arguments);
    }, _.mapObject(_.pick(config,_.isFunction), fn => fn.bind(config)));
    if (!instance.close) instance.close = () => Promise.resolve();
    instance.shell = shell;
    return instance;
};

function shell(app) {
    app.cmd('config :option', "Show the active option value for this session", (cmd, sh, cb) => {
        try {
            const value = config(cmd.params.option);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('set :option :value([\\S\\s]+)',
            "Changes the given option value for this session using a dot path notation", (cmd, sh, cb) => {
        try {
            const str = cmd.params.value;
            const chr = str.charAt(0);
            const value = chr == '{' || chr == '"' || chr == '[' ||
                str == 'true' || str == 'false' || _.isFinite(str) ?
                JSON.parse(str) : str;
            config(cmd.params.option, value);
            sh.white(JSON.stringify(config(cmd.params.option))).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('add :option :label',
            "Adds the given label to the option set for this session", (cmd, sh, cb) => {
        try {
            const key = cmd.params.option.split('.').concat(cmd.params.label);
            config.add(key, cmd.params.label);
            const value = config(key);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('add :option :label :value([\\S\\s]+)',
            "Adds the given label value to the option set for this session", (cmd, sh, cb) => {
        try {
            const str = cmd.params.value;
            const chr = str.charAt(0);
            const value = chr == '{' || chr == '"' || chr == '[' ||
                str == 'true' || str == 'false' || _.isFinite(str) ?
                JSON.parse(str) : str;
            const key = cmd.params.option.split('.').concat(cmd.params.label.replace(/s?$/,'s'));
            config.add(key, value);
            sh.white(JSON.stringify(config(key))).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('remove :option :label',
            "Removes the given label from the option for this session", (cmd, sh, cb) => {
        try {
            const key = cmd.params.option.split('.').concat(cmd.params.label.replace(/s?$/,'s'));
            config.remove(key);
            const value = config(cmd.params.option);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd("list",
            "List previous saved sessions that can be used with load", (cmd, sh, cb) => {
        try {
            const list = config.list();
            if (list.length) {
                const width = Math.floor(80/Math.floor(80/Math.min(_.max(_.pluck(list, 'length')) +1,80)));
                const columns = Math.floor(Math.min(80/width, Math.sqrt(list.length)));
                const rows = Math.ceil(list.length / columns);
                _.range(rows).forEach(r => {
                    _.range(columns).forEach(c => {
                        const text = list[r*columns+c] || '';
                        sh.white(text).white(_.range(width - text.length).fill(' ').join(''));
                    });
                    sh.ln();
                });
            }
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd("save :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)",
            "Saves this session values to a file for later use", (cmd, sh, cb) => {
        try {
            const name = cmd.params.name;
            config.save(name);
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd("load :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)",
            "Loads the stored session, resetting any temporary session values", (cmd, sh, cb) => {
        try {
            const name = cmd.params.name;
            if (!config.load(name)) throw Error("Could not load: " + name);
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('config :option :value([\\S\\s]+)',
            "Changes the given option value persistently", (cmd, sh, cb) => {
        try {
            const str = cmd.params.value;
            const chr = str.charAt(0);
            const value = chr == '{' || chr == '"' || chr == '[' ||
                str == 'true' || str == 'false' || _.isFinite(str) ?
                JSON.parse(str) : str;
            config.store(cmd.params.option, value);
            sh.white(JSON.stringify(config(cmd.params.option))).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('unset :option',
            "Resets the given option value persistently", (cmd, sh, cb) => {
        try {
            config.unset(cmd.params.option);
            const value = config(cmd.params.option);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
help(app, 'set', `
  Usage: set :option :value
  Changes the given option value for this session
`);
help(app, 'unset', `
  Usage: unset :option
  Resets the given option value persistently
`);
help(app, 'add', `
  Usage: add :option :label :value
  Adds the label/value pair to option for this session
`);
help(app, 'remove', `
  Usage: remove :option label
  Removes the label from option for this session
`);
help(app, 'list', `
  Usage: list  
  List previous saved sessions that can be used with load
`);
help(app, 'save', `
  Usage: save :name
  Saves this session values to a file for later use
`);
help(app, 'load', `
  Usage: load :name
  Loads the stored session, resetting any temporary session values
`);
help(app, 'config', `
  Usage: config :option

  Show the active option value for this session

  Usage: config :option :value

  Changes the given option value persistently
  in ${config.configFilename()}
`);
};

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
