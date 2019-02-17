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
const ws = require('ws');
const shell = require('shell');
const expect = require('chai').expect;
const logger = require('./logger.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const Remote = require('./remote-workers.js');
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

const DEFAULT_PATH = '/mtrader/' + version.minor_version + '/workers';
const WORKER_COUNT = require('os').cpus().length;

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
    .command('collective2 [identifier]', "Changes workers orders to align with collected signal orders")
    .option('-V, --version', "Output the version number(s)")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-q, --quiet', "Include less information about what the system is doing")
    .option('-x, --debug', "Include details about what the system is working on")
    .option('-X', "Hide details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--config-dir <dirname>', "Directory where stored sessions are kept")
    .option('--cache-dir <dirname>', "Directory where processed data is kept")
    .option('--load <filename>', "Read the given session settings")
    .option('-o, --offline', "Disable data updates")
    .option('--set <name=value>', "Name=Value pairs to be used in session")
    .option('--listen [address:port]', "Interface and TCP port to listen for jobs")
    .option('--stop', "Signals all remote workers to stop and shutdown");

program.command('start').description("Start a headless service on the listen interface").action(() => {
    if (!config('listen')) throw Error("Service listen address is required to start service");
});
program.command('stop').description("Stops a headless service using the listen interface").action(() => {
    const address = config('listen');
    if (!address) throw Error("Service listen address is required to stop service");
    const worker = replyTo(remote(address, {checkServerIdentity: _.noop}))
        .on('error', err => logger.debug(err, err.stack))
        .on('error', () => worker.disconnect());
    return new Promise((stopped, abort) => {
        process.on('SIGINT', abort);
        process.on('SIGTERM', abort);
        worker.handle('stop', stopped).request('stop').catch(abort);
    }).catch(err => err && err.stack && logger.debug(err, err.stack))
      .then(() => worker.disconnect());
});
let program_args_version = false;
program.on('option:version', async function() {
    program_args_version = true;
    process.stdout.write(version + '\n');
    if (config('remote_workers')) {
        const remote = new Remote();
        const remote_version = await remote.version();
        _.forEach(remote_version, (worker_version, worker) => {
            process.stdout.write(`${worker_version} ${worker}` + '\n');
        });
        return remote.close();
    }
});

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
        const mtrader = createInstance();
        mtrader.shell(app);
        process.on('SIGINT', () => app.quit());
        process.on('SIGTERM', () => app.quit());
        app.on('quit', () => mtrader.close());
        app.on('exit', () => mtrader.close());
        if (config('listen')) {
            mtrader.listen(config('listen'));
        }
    } else if (!program_args_version && config('listen') &&
            !~['stop','config','fetch','version'].indexOf(program.args[0]) &&
            !~['stop','config','fetch','version'].indexOf(program.args[0].name && program.args[0].name())) {
        const mtrader = createInstance();
        const server = mtrader.listen(config('listen'));
        process.on('SIGINT', () => mtrader.close());
        process.on('SIGTERM', () => mtrader.close());
        server.on('close', () => mtrader.close());
    }
    process.on('SIGTERM', () => {
        setTimeout(() => {
            if (process._getActiveHandles)
                console.log("Still active on", process.pid, process._getActiveHandles());
        }, 10000).unref();
    });
} else {
    module.exports = createInstance;
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

function createInstance() {
    const config = new Config();
    const date = new Dater();
    const fetch = new Fetch();
    const quote = new Quote();
    const collect = new Collect();
    const optimize = new Optimize();
    const bestsignals = new Bestsignals();
    const strategize = new Strategize();
    const servers = [];
    let closed;
    return Object.assign(new.target ? this : {}, {
        config: config,
        date: date,
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
        optimize: optimize,
        bestsignals: bestsignals,
        strategize: strategize,
        seed(number) {
            optimize.seed(number);
            strategize.seed(number);
        },
        close() {
            if (closed) return closed;
            else return closed = Promise.all(servers.map(server => {
                return new Promise(cb => server.close(cb));
            })).then(() => {
                return Promise.all([
                    config.close(),
                    date.close(),
                    fetch.close(),
                    quote.close(),
                    collect.close(),
                    optimize.close(),
                    bestsignals.close(),
                    strategize.close()
                ]);
            });
        },
        shell(app) {
            Promise.all([
                config.shell(app),
                date.shell(app),
                fetch.shell(app),
                quote.shell(app),
                collect.shell(app),
                optimize.shell(app),
                bestsignals.shell(app),
                strategize.shell(app)
            ]).catch(err => console.error("Could not complete shell setup", err));
        },
        listen(address) {
            const server = listen(this, address);
            server.once('close', () => {
                const idx = servers.indexOf(server);
                if (idx >= 0) {
                    servers.splice(idx, 1);
                }
            });
            servers.push(server);
            return server;
        }
    });
}

function listen(mtrader, address) {
    const timeout = config('tls.timeout');
    const addr = parseLocation(address, false);
    const auth = addr.auth ? 'Basic ' + new Buffer(addr.auth).toString('base64') : undefined;
    const server = addr.protocol == 'https:' || addr.protocol == 'wss:' ? https.createServer({
        key: readFileSync(config('tls.key_pem')),
        passphrase: readBase64FileSync(config('tls.passphrase_base64')),
        cert: readFileSync(config('tls.cert_pem')),
        ca: readFileSync(config('tls.ca_pem')),
        crl: readFileSync(config('tls.crl_pem')),
        ciphers: config('tls.ciphers'),
        honorCipherOrder: config('tls.honorCipherOrder'),
        ecdhCurve: config('tls.ecdhCurve'),
        dhparam: readFileSync(config('tls.dhparam_pem')),
        secureProtocol: config('tls.secureProtocol'),
        secureOptions: config('tls.secureOptions'),
        handshakeTimeout: config('tls.handshakeTimeout'),
        requestCert: config('tls.requestCert'),
        rejectUnauthorized: config('tls.rejectUnauthorized'),
        NPNProtocols: config('tls.NPNProtocols'),
        ALPNProtocols: config('tls.ALPNProtocols')
    }) : http.createServer();
    server.on('upgrade', (request, socket, head) => {
        if (wsserver.shouldHandle(request)) return;
        else if (socket.writable) {
            const msg = `Try using mtrader/${version}\r\n`;
            socket.write(
                `HTTP/1.1 400 ${http.STATUS_CODES[400]}\r\n` +
                `Server: mtrader/${version}\r\n` +
                'Connection: close\r\n' +
                'Content-type: text/plain\r\n' +
                `Content-Length: ${Buffer.byteLength(msg)}\r\n` +
                '\r\n' +
                msg
            );
            socket.destroy();
        }
    });
    server.on('request', (request, response) => {
        response.setHeader('Server', 'mtrader/' + version);
        if (wsserver.shouldHandle(request)) return;
        const msg = `Try using mtrader/${version}\r\n`;
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/plain');
        response.setHeader('Content-Length', Buffer.byteLength(msg));
        response.end(msg);
    });
    const wsserver = new ws.Server({
        server: server, path: addr.path,
        clientTracking: true,
        perMessageDeflate: config('tls.perMessageDeflate')!=null ? config('tls.perMessageDeflate') : true,
        verifyClient: auth ? info => {
            return info.req.headers.authorization == auth;
        } : undefined
    });
    wsserver.on('headers', (headers, request) => {
        headers.push('Server: mtrader/' + version);
    });
    wsserver.on('connection', (ws, message) => {
        const socket = message.socket;
        if (timeout) {
            socket.setTimeout(timeout);
            socket.on('timeout', () => ws.ping());
        }
        const label = socket.remoteAddress + ':' + socket.remotePort
        logger.log("Client", label, "connected");
        const process = remote(ws, label).on('error', err => {
            logger.error(err, err.stack);
            ws.close();
        }).on('disconnect', () => {
            logger.log("Client", label, "disconnected");
        });
        replyTo(process)
            .handle('lookup', mtrader.lookup)
            .handle('fundamental', mtrader.fundamental)
            .handle('fetch', mtrader.fetch)
            .handle('quote', mtrader.quote)
            .handle('collect', mtrader.collect)
            .handle('optimize', mtrader.optimize)
            .handle('bestsignals', mtrader.bestsignals)
            .handle('strategize', mtrader.strategize)
            .handle('version', () => version.toString())
            .handle('worker_count', () => config('workers') != null ? config('workers') : WORKER_COUNT)
            .handle('stop', () => {
                try {
                    const stop = JSON.stringify({cmd:'stop'}) + '\r\n\r\n';
                    wsserver.clients.forEach(client => {
                        if (client.readyState == 1) client.send(stop);
                    });
                } finally {
                    server.close();
                }
            });
    }).on('error', err => logger.error(err, err.stack))
      .on('listening', () => logger.info("Service listening on port", server.address().port));
    server.once('close', () => logger.log("Service has closed", address));
    const server_close = server.close;
    server.close = () => {
        server_close.call(server);
        wsserver.clients.forEach(client => client.close());
    };
    if (addr.hostname) {
        server.listen(addr.port, addr.hostname);
    } else {
        server.listen(addr.port);
    }
    return server;
}

function readBase64FileSync(filename) {
    if (filename) return Buffer.from(readFileSync(filename), 'base64').toString();
}

function readFileSync(filename) {
    if (filename) {
        const file = path.resolve(config('prefix'), filename);
        return fs.readFileSync(file, {encoding: 'utf-8'});
    }
}

function parseLocation(location, secure) {
    const parsed = typeof location == 'number' || location.match(/^\d+$/) ? {port: +location} :
        ~location.indexOf('//') ? url.parse(location) :
        secure ? url.parse('wss://' + location) :
        url.parse('ws://' + location);
    parsed.protocol = parsed.protocol || (secure ? 'wss:' : 'ws:');
    parsed.port = parsed.port || (
        parsed.protocol == 'ws:' || parsed.protocol == 'http:' ? 80 :
        parsed.protocol == 'wss:' || parsed.protocol == 'https:' ? 443 :
        secure ? 443 : 80
    );
    parsed.hostname = parsed.hostname || '';
    parsed.host = parsed.host || (parsed.hostname + ':' + parsed.port);
    parsed.href = parsed.href || (parsed.protocol + '//' + parsed.host);
    if (parsed.path == '/' && !parsed.hash && location.charAt(location.length-1) != '/') {
        parsed.path = DEFAULT_PATH;
        parsed.href = parsed.href + DEFAULT_PATH.substring(1);
    } else if (!parsed.path && !parsed.hash) {
        parsed.path = DEFAULT_PATH;
        parsed.href = parsed.href + DEFAULT_PATH;
    }
    return parsed;
}
