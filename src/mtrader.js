#!/usr/bin/env node
// vim: set filetype=javascript:
// mtrader.js
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

const fs = require('graceful-fs');
const path = require('path');
const url = require('url');
const http = require('http');
const https = require('https');
const _ = require('underscore');
const moment = require('moment-timezone');
const ws = require('ws');
const shell = require('shell');
const expect = require('chai').expect;
const merge = require('./merge.js');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const common = require('./common-functions.js');
const Parser = require('../src/parser.js');
const replyTo = require('./promise-reply.js');
const Config = require('./mtrader-config.js');
const config = require('./config.js');
const date = require('./mtrader-date.js');
const shellError = require('./shell-error.js');
const version = require('./version.js');
const Dater = require('./mtrader-date.js');
const Fetch = require('./mtrader-fetch.js');
const Quote = require('./mtrader-quote.js');
const Collect = require('./mtrader-collect.js');
const Optimize = require('./mtrader-optimize.js');
const Bestsignals = require('./mtrader-bestsignals.js');
const Strategize = require('./mtrader-strategize.js');
const Broker = require('./mtrader-broker.js');
const Replicate = require('./mtrader-replicate.js');

const program = require('commander')
    .description(version.description)
    .command('config <name> [value]', "View or change stored options")
    .command('date <format>', "Formats the time now")
    .command('fetch <interval> <symbol.market>', "Fetches remote data for the given symbol")
    .command('quote <symbol.market>', "Historic information of a security")
    .command('collect [identifier]', "Collects historic portfolio data")
    .command('optimize [identifier]', "Optimizes the parameter values in the given portfolio")
    .command('bestsignals [identifier]', "Determines the best signals for the given portfolio")
    .command('strategize [identifier]', "Modifies a strategy looking for improvements")
    .command('replicate [identifier]', "Changes workers orders to align with collected signal orders")
    .command('broker [action]', "Retrieve or execute orders in broker account")
    .command('start', "Start a headless service on the listen interface")
    .command('stop', "Stops a headless service using the listen interface")
    .option('-V, --version', "Output the version number(s)")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-q, --quiet', "Include less information about what the system is doing")
    .option('-x, --debug', "Include details about what the system is working on")
    .option('-X', "Hide details about what the system is working on")
    .option('-i, --runInBand', "Runs in the same process rather than spawning processes")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--config-dir <dirname>', "Directory where stored sessions are kept")
    .option('--cache-dir <dirname>', "Directory where processed data is kept")
    .option('--load <filename>', "Read the given session settings")
    .option('-o, --offline', "Disable data updates")
    .option('--set <name=value>', "Name=Value pairs to be used in session");

let program_args_version = false;
program.on('option:version', async function() {
    program_args_version = true;
    const mtrader = createInstance(config.options());
    return mtrader.version().then(versions => versions.map(version => {
        if (!version.message) return version;
        return {...version, message: version.message.replace(/^(Error:\s+)+/g, '').replace(/[\r\n][\S\s]*/,'')};
    })).catch(err => {
        logger.warn("While detecting mtrader version", err);
        return [{version: version.toString()}];
    }).then(versions => tabular(versions, config()))
      .catch(logger.error).then(() => mtrader.close());
});

process.setMaxListeners(process.getMaxListeners()+1);

if (require.main === module) {
    if (process.argv.length > 2) {
        // don't call an executable if no command given
        program.executables = false;
        program.addImplicitHelpCommand();
        program.executeSubCommand = _.wrap(program.executeSubCommand, (fn, argv, args, unknown) => {
            // include known options in sub-command
            const arg = [].concat(
                args,
                ['--prefix', config('prefix')],
                parseKnownOptions(program, argv)
            );
            return fn.call(program, argv, arg, unknown);
        });
        program.parse(process.argv);
    }
    if (!program_args_version && _.isEmpty(program.args)) {
        const app = new shell({isShell: true});
        const settings = {shell: app, introduction: true};
        app.configure(function(){
            app.use(shell.history(settings));
            app.use(shell.completer(settings));
            app.use(shell.router(settings));
            app.use(shell.help(settings));
            app.use(shellError(settings));
        });
        settings.sensitive = null; // disable case insensitivity in commands
        const mtrader = createInstance(config.options());
        mtrader.shell(app);
        process.on('SIGINT', () => app.quit());
        process.on('SIGTERM', () => app.quit());
        app.on('quit', () => mtrader.close());
        app.on('exit', () => mtrader.close());
    }
    process.on('SIGTERM', () => {
        setTimeout(() => {
            if (process._getActiveHandles)
                console.log("Still active on", process.pid, process._getActiveHandles());
        }, 10000).unref();
    });
} else {
    module.exports = Object.assign(createInstance, {
        date: new Dater(),
        config: new Config()
    });
}

function parseKnownOptions(program, argv) {
    return _.filter(argv, (arg, i) => {
        if (program.optionFor(arg)) return true;
        else if (i === 0) return false;
        const prior = program.optionFor(argv[i-1]);
        // if prior option is required or optional and not a flag
        return prior && prior.required && arg ||
            prior && prior.optional && ('-' != arg[0] || '-' == arg);
    });
}

function createInstance(settings = {}) {
    const config = new Config(settings);
    settings = merge(config(), settings);
    const date = new Dater(settings);
    const fetch = new Fetch(settings);
    const quote = new Quote(settings);
    const collect = new Collect(settings);
    const optimize = new Optimize(settings);
    const bestsignals = new Bestsignals(settings);
    const strategize = new Strategize(settings);
    const broker = new Broker(settings);
    const replicate = new Replicate(settings);
    let closed;
    return Object.assign(new.target ? this : {}, {
        config: config,
        date: date,
        lookup(options) {
            return fetch(_.defaults({
                interval: 'lookup'
            }, options));
        },
        contract(options) {
            return fetch(_.defaults({
                interval: 'contract'
            }, options));
        },
        fundamental(options) {
            return fetch(_.defaults({
                interval: 'fundamental'
            }, options)).then(_.first);
        },
        adjustments(options) {
            return fetch(_.defaults({
                interval: 'adjustments'
            }, options)).then(_.first);
        },
        fetch: fetch,
        quote: quote,
        collect: collect,
        optimize: optimize,
        bestsignals: bestsignals,
        strategize: strategize,
        broker: broker,
        replicate: replicate,
        version() {
            return Promise.all([
                fetch({info:'version'}).catch(err => [{message:err.message}]),
                quote({info:'version'}).catch(err => [{message:err.message}]),
                collect({info:'version'}).catch(err => [{message:err.message}]),
                optimize({info:'version'}).catch(err => [{message:err.message}]),
                bestsignals({info:'version'}).catch(err => [{message:err.message}]),
                strategize({info:'version'}).catch(err => [{message:err.message}]),
                broker({info:'version'}).catch(err => [{message:err.message}]),
                replicate({info:'version'}).catch(err => [{message:err.message}])
            ]).then(versions => [].concat(...versions))
              .then(versions => _.values(_.indexBy(versions, JSON.stringify.bind(JSON))))
              .then(versions => versions.map(version => ({...version, name: 'mtrader', ...version})))
              .then(versions => _.sortBy(_.sortBy(_.sortBy(versions, 'version'), 'location'), 'name'));
        },
        seed(number) {
            optimize.seed(number);
            strategize.seed(number);
        },
        close() {
            if (closed) return closed;
            else return closed = Promise.all([
                config.close(),
                date.close(),
                fetch.close(),
                quote.close(),
                collect.close(),
                optimize.close(),
                bestsignals.close(),
                strategize.close(),
                broker.close(),
                replicate.close()
            ]).then(() => {});
        },
        async shell(app) {
            await Promise.all([
                config.shell(app),
                date.shell(app),
                fetch.shell(app),
                quote.shell(app),
                collect.shell(app),
                optimize.shell(app),
                bestsignals.shell(app),
                strategize.shell(app),
                broker.shell(app),
                replicate.shell(app)
            ]).catch(err => console.error("Could not complete shell setup", err));
            app.cmd('exec :expression([\\s\\S]+)', "Evaluate common expressions using the values in this session", async(cmd, sh, cb) => {
                try {
                    logger.debug("exec", cmd.params);
                    var parser = new Parser({
                        constant(value) {
                            return () => value;
                        },
                        variable(name) {
                            return () => config(name);
                        },
                        expression(expr, name, args) {
                            return common(name, args);
                        }
                    });
                    const expr = cmd.params.expression;
                    sh.white(await parser.parse(expr)({})).ln();
                    sh.prompt();
                } catch(err) {
                    cb(err);
                }
            });
        }
    });
}
