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

var program = require('commander').version(require('../package.json').version)
    .description(require('../package.json').description)
    .command('config <name> [value]', "View or change stored options")
    .command('fetch <interval> <symbol.exchange>', "Fetches remote data for the given symbol")
    .command('quote <symbol.exchange>', "Historic information of a security")
    .command('collect [identifier]', "Collects historic portfolio data")
    .command('bestsignals [identifier]', "Determines the best signals for the given portfolio")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-s, --silent', "Include less information about what the system is doing")
    .option('--debug', "Include details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--load <identifier>', "Read the given session settings")
    .option('--workers <numOfWorkers>', 'Number of workers to spawn')
    .option('--set <name=value>', "Name=Value pairs to be used in session");

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
        var settings = {shell: app, introduction: true};
        app.configure(function(){
            app.use(shell.history(settings));
            app.use(shell.completer(settings));
            app.use(shell.router(settings));
            app.use(shell.help(settings));
            app.use(shellError(settings));
        });
        settings.sensitive = null; // disable case insensitivity in commands
        config.shell(app);
        require('./ptrading-fetch.js').shell(app);
        require('./ptrading-quote.js').shell(app);
        require('./ptrading-collect.js').shell(app);
        require('./ptrading-bestsignals.js').shell(app);
        process.on('SIGINT', () => app.quit());
    }
} else {
    var fetch = require('./ptrading-fetch.js');
    var quote = require('./ptrading-quote.js');
    var collect = require('./ptrading-collect.js');
    var bestsignals = require('./ptrading-bestsignals.js');
    module.exports = {
        config: config,
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
        collect: collect,
        bestsignals: bestsignals,
        close() {
            return bestsignals.close();
        },
        shell(app) {
            Promise.all([
                config.shell(app),
                fetch.shell(app),
                quote.shell(app),
                collect.shell(app),
                bestsignals.shell(app)
            ]).catch(err => console.error("Could not complete shell setup", err));
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
