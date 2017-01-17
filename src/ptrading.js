#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading.js
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
const shell = require('shell');
const config = require('./ptrading-config.js');
const shellError = require('./shell-error.js');

var program = require('commander').version('0.0.1')
    .description("Produces data for trading securities in CSV format")
    .command('config <name> [value]', "View or change stored options")
    .command('fetch <interval> <symbol> [exchange]', "Historic information of a security")
    .command('quote <interval> <symbol> [exchange]', "Historic information of a security")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-s, --silent', "Include less information about what the system is doing")
    .option('--debug', "Include details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--workers <numOfWorkers>', 'Number of workers to spawn');

if (require.main === module) {
    if (process.argv.length > 2) {
        // don't call an executable if no command given
        program.executables = false;
        program.addImplicitHelpCommand();
        program.executeSubCommand = _.wrap(program.executeSubCommand, (fn, argv, args, unknown) => {
            // include known options in sub-command
            var arg = [].concat(
                args,
                ['--prefix', config('prefix')],
                parseKnownOptions(program, argv)
            );
            return fn.call(program, argv, arg, unknown);
        });
        program.parse(process.argv);
    }
    if (_.isEmpty(program.args)) {
        var app = new shell({isShell: true});
        app.configure(function(){
            app.use(shell.history({shell: app}));
            app.use(shell.completer({shell: app}));
            app.use(shell.router({shell: app}));
            app.use(shell.help({shell: app, introduction: true}));
            app.use(shellError({shell: app}));
        });
        config.shell(app);
        require('./ptrading-fetch.js').shell(app);
        require('./ptrading-quote.js').shell(app);
    }
} else {
    var fetch = require('./ptrading-fetch.js');
    var quote = require('./ptrading-quote.js');
    module.exports = {
        config: config,
        store(name, value) {
            return config.store(name, value);
        },
        unset(name) {
            return config.unset(name);
        },
        lookup(options) {
            return fetch(_.defaults({
                interval: 'lookup'
            }, options));
        },
        fundamental(options) {
            return fetch(_.defaults({
                interval: 'fundamental'
            }, options)).then(_.first);
        },
        fetch: fetch,
        quote: quote,
        close() {
            return quote.close();
        },
        shell(app) {
            config.shell(app);
            fetch.shell(app);
            quote.shell(app);
        }
    };
}

function parseKnownOptions(program, argv) {
    return _.filter(argv, (arg, i) => {
        if (program.optionFor(arg)) return true;
        else if (i === 0) return false;
        var prior = program.optionFor(argv[i-1]);
        // if prior option is required or optional and not a flag
        return prior && prior.required && arg ||
            prior && prior.optional && ('-' != arg[0] || '-' == arg);
    });
}
