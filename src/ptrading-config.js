#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-config.js
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
const logger = require('./logger.js');
const config = require('./config.js');

if (require.main === module) {
    var program = require('commander').version(require('../package.json').version)
        .description("View or change stored options")
        .usage('<name> [value] [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--output <file>', "JSON file to write the setting value into")
        .parse(process.argv);
    if (program.args.length) {
        try {
            if (program.args.length > 1) {
                config.store(program.args[0], program.args[1]);
            } else {
                console.log(JSON.stringify(config(program.args[0])));
            }
        } catch(err) {
            logger.error(err, err.stack);
        }
    } else {
        console.log(JSON.stringify(config(), null, 2));
    }
}

module.exports = _.extend(function(name, value) {
    return config.apply(config, arguments);
}, _.mapObject(_.pick(config,_.isFunction), fn => fn.bind(config)));

module.exports.shell = function(app) {
    app.cmd('config :option', "Show the active option value for this session", (cmd, sh, cb) => {
        try {
            var value = config(cmd.params.option);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('set :option :value([\\S\\s]+)',
            "Changes the given option value for this session using a dot path notation", (cmd, sh, cb) => {
        try {
            var str = cmd.params.value;
            var value = str == "true" ? true : str == "false" ? false :
                _.isFinite(str) && parseFloat(str).toString() == str ? parseFloat(str) : str;
            config(cmd.params.option, value);
            var value = config(cmd.params.option);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('config :option :value([\\S\\s]+)',
            "Changes the given option value persistently", (cmd, sh, cb) => {
        try {
            var str = cmd.params.value;
            var value = str == "true" ? true : str == "false" ? false :
                _.isFinite(str) && parseFloat(str).toString() == str ? parseFloat(str) : str;
            config.store(cmd.params.option, value);
            var value = config(cmd.params.option);
            sh.white(JSON.stringify(value)).ln();
            sh.prompt();
        } catch(err) {
            cb(err);
        }
    });
    app.cmd('unset :option',
            "Resets the given option value persistently", (cmd, sh, cb) => {
        try {
            config.unset(cmd.params.option);
            var value = config(cmd.params.option);
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
