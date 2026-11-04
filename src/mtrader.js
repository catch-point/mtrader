#!/usr/bin/env -S node --max-http-header-size=65536
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
const child_process = require('child_process');
const ws = require('ws');
const commander = require('commander');
const Shell = require('./shell.js');
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

// the shared program, read by config.js, only when run as the mtrader command
const program = (require.main === module ? commander.program : new commander.Command()).name('mtrader')
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
    .command('pending', "Lists pending queues in remote system(s)")
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
    .option('-u, --update', "Update the last bar of assets")
    .option('--set <name=value>', "Name=Value pairs to be used in session")
    // with options alone, start the shell (rather than displaying help)
    .action(() => {});

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
    const argv = process.argv.slice(2);
    const index = findCommandIndex(program, argv);
    if (index >= 0) {
        runCommand(program, argv, index);
    } else {
        if (argv.length) program.parse(process.argv);
        if (!program_args_version) startShell();
    }
    process.on('SIGTERM', () => {
        setTimeout(() => {
            if (process._getActiveHandles)
                console.log("Still active on", process.pid);
        }, 10000).unref();
    });
} else {
    module.exports = Object.assign(createInstance, {
        date: new Dater(),
        config: new Config(),
        version: version
    });
}

function startShell() {
    const app = new Shell({introduction: true});
    app.use(shellError({shell: app}));
    const mtrader = createInstance(config.options());
    mtrader.shell(app);
    process.on('SIGINT', () => app.quit());
    process.on('SIGTERM', () => app.quit());
    app.on('quit', () => mtrader.close());
    app.on('exit', () => mtrader.close());
}

/**
 * Index of the first argument that is not one of the program's options (or
 * an option's value), which names the command to run, or -1
 */
function findCommandIndex(program, argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg == '--') return i + 1 < argv.length ? i + 1 : -1;
        if (arg[0] != '-' || arg == '-') return i;
        const option = findOption(program, arg);
        if (option && !~arg.indexOf('=') && takesValue(option, argv[i+1])) i++;
    }
    return -1;
}

/**
 * Runs src/mtrader-<command>.js in a child process, passing on the program's
 * options given before the command
 */
function runCommand(program, argv, index) {
    const names = program.commands.map(cmd => cmd.name());
    const name = argv[index];
    if (name == 'help') {
        const topic = argv[index+1];
        if (!topic) return program.outputHelp();
        else if (!~names.indexOf(topic)) return program.error(`error: unknown command '${topic}'`);
        else return spawnCommand(topic, ['--help']);
    } else if (!~names.indexOf(name)) {
        return program.error(`error: unknown command '${name}'`);
    }
    const args = [].concat(
        argv.slice(index + 1),
        ['--prefix', config('prefix')],
        parseKnownOptions(program, argv.slice(0, index))
    );
    return spawnCommand(name, args);
}

function spawnCommand(name, args) {
    const file = path.resolve(__dirname, `mtrader-${name}.js`);
    const child = child_process.spawn(process.execPath, [...process.execArgv, file, ...args], {stdio: 'inherit'});
    const signals = ['SIGTERM', 'SIGHUP', 'SIGUSR1', 'SIGUSR2'];
    const forward = signal => child.kill(signal);
    signals.forEach(signal => process.on(signal, forward));
    child.on('error', err => {
        logger.error(`Could not run ${name}`, err);
        process.exitCode = 1;
    }).on('exit', (code, signal) => {
        signals.forEach(signal => process.removeListener(signal, forward));
        process.exitCode = code == null ? (signal ? 1 : 0) : code;
    });
    return child;
}

function findOption(program, arg) {
    const flag = arg.startsWith('--') && ~arg.indexOf('=') ? arg.substring(0, arg.indexOf('=')) : arg;
    return program.options.find(option => option.is(flag));
}

function takesValue(option, next) {
    return option.required || option.optional && next != null && (next[0] != '-' || next == '-');
}

function parseKnownOptions(program, argv) {
    return _.filter(argv, (arg, i) => {
        if (findOption(program, arg)) return true;
        else if (i === 0) return false;
        const prior = findOption(program, argv[i-1]);
        // if prior option is required or optional and not a flag
        return prior && !~argv[i-1].indexOf('=') && takesValue(prior, arg);
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
                fetch({info:'version'}).catch(err => [{cmd: 'fetch', message:err.message}]),
                quote({info:'version'}).catch(err => [{cmd: 'quote', message:err.message}]),
                collect({info:'version'}).catch(err => [{cmd: 'collect', message:err.message}]),
                optimize({info:'version'}).catch(err => [{cmd: 'optimize', message:err.message}]),
                bestsignals({info:'version'}).catch(err => [{cmd: 'bestsignals', message:err.message}]),
                strategize({info:'version'}).catch(err => [{cmd: 'strategize', message:err.message}]),
                broker({info:'version'}).catch(err => [{cmd: 'broker', message:err.message}]),
                replicate({info:'version'}).catch(err => [{cmd: 'replicate', message:err.message}])
            ]).then(versions => [].concat(...versions))
              .then(versions => _.values(_.indexBy(versions, JSON.stringify.bind(JSON))))
              .then(versions => versions.map(version => ({...version, name: 'mtrader', ...version})))
              .then(versions => _.sortBy(_.sortBy(_.sortBy(versions, 'version'), 'location'), 'name'));
        },
        pending() {
            return Promise.all([
                fetch({info:'pending'}).catch(err => [{cmd: 'fetch', message:err.message}]),
                quote({info:'pending'}).catch(err => [{cmd: 'quote', message:err.message}]),
                collect({info:'pending'}).catch(err => [{cmd: 'collect', message:err.message}]),
                optimize({info:'pending'}).catch(err => [{cmd: 'optimize', message:err.message}]),
                bestsignals({info:'pending'}).catch(err => [{cmd: 'bestsignals', message:err.message}]),
                strategize({info:'pending'}).catch(err => [{cmd: 'strategize', message:err.message}]),
                broker({info:'pending'}).catch(err => [{cmd: 'broker', message:err.message}]),
                replicate({info:'pending'}).catch(err => [{cmd: 'replicate', message:err.message}])
            ]).then(pending => [].concat(...pending));
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
