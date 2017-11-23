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

const fs = require('fs');
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
const config = require('./ptrading-config.js');
const shellError = require('./shell-error.js');
const minor_version = require('../package.json').version.replace(/^(\d+\.\d+).*$/,'$1.0');

const DEFAULT_PATH = '/ptrading/' + minor_version + '/workers';
const WORKER_COUNT = require('os').cpus().length;

var program = require('commander').version(require('../package.json').version)
    .description(require('../package.json').description)
    .command('config <name> [value]', "View or change stored options")
    .command('fetch <interval> <symbol.exchange>', "Fetches remote data for the given symbol")
    .command('quote <symbol.exchange>', "Historic information of a security")
    .command('collect [identifier]', "Collects historic portfolio data")
    .command('optimize [identifier]', "Optimizes the parameter values in the given portfolio")
    .command('bestsignals [identifier]', "Determines the best signals for the given portfolio")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-s, --silent', "Include less information about what the system is doing")
    .option('--debug', "Include details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--load <identifier>', "Read the given session settings")
    .option('-o, --offline', "Disable data updates")
    .option('--workers <numOfWorkers>', 'Number of workers to spawn')
    .option('--remote-workers <host:port,..>', "List of host:port addresses to connect to")
    .option('--set <name=value>', "Name=Value pairs to be used in session")
    .option('--listen [address:port]', "Interface and TCP port to listen for jobs")
    .option('--stop', "Signals all remote workers to stop and shutdown");

program.command('start').description("Start a headless service on the listen interface").action(() => {
    if (!config('listen')) throw Error("Service listen address is required to start service");
});
program.command('stop').description("Stops a headless service using the listen interface").action(() => {
    var address = config('listen');
    if (!address) throw Error("Service listen address is required to stop service");
    var worker = replyTo(remote(address)).on('error', () => worker.disconnect());
    return new Promise((stopped, abort) => {
        process.on('SIGINT', abort);
        process.on('SIGTERM', abort);
        worker.handle('stop', stopped).request('stop').catch(abort);
    }).catch(err => worker.connected && err && logger.error(err, err.stack)).then(() => worker.disconnect());
});

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
        var ptrading = createInstance();
        ptrading.shell(app);
        process.on('SIGINT', () => app.quit());
        process.on('SIGTERM', () => app.quit());
        if (config('listen')) {
            var server = listen(config('listen'), ptrading);
            app.on('quit', () => server.close());
            app.on('exit', () => server.close());
        }
    } else if (config('listen') && !~['stop','config','fetch'].indexOf(program.args[0]) &&
            !~['stop','config','fetch'].indexOf(program.args[0].name && program.args[0].name())) {
        var ptrading = createInstance();
        var server = listen(config('listen'), ptrading);
        process.on('SIGINT', () => ptrading.close())
            .on('SIGTERM', () => ptrading.close());
        server.on('close', () => ptrading.close());
    }
} else {
    module.exports = createInstance();
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

function createInstance() {
    var fetch = require('./ptrading-fetch.js');
    var quote = require('./ptrading-quote.js');
    var collect = require('./ptrading-collect.js');
    var optimize = require('./ptrading-optimize.js');
    var bestsignals = require('./ptrading-bestsignals.js');
    return {
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
        optimize: optimize,
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
                optimize.shell(app),
                bestsignals.shell(app)
            ]).catch(err => console.error("Could not complete shell setup", err));
        }
    };
}

function listen(address, ptrading) {
    var addr = parseLocation(address, false);
    var auth = addr.auth ? 'Basic ' + addr.auth.toString('base64') : undefined;
    var server = addr.scheme == 'https:' || addr.scheme == 'wss:' ? https.createServer({
        key: readFileSync(config('tls.key_pem')),
        cert: readFileSync(config('tls.cert_pem')),
        ca: readFileSync(config('tls.ca_pem')),
        requestCert: config('tls.request_cert'),
        rejectUnauthorized: config('tls.reject_unauthorized')
    }) : http.createServer();
    var wsserver = new ws.Server({
        server: server, path: addr.path,
        clientTracking: true, perMessageDeflate: true,
        verifyClient: auth ? info => {
            return info.req.headers.authorization == auth;
        } : undefined
    });
    wsserver.on('connection', (ws, message) => {
        var socket = message.socket;
        var label = socket.remoteAddress + ':' + socket.remotePort
        logger.log("Client", label, "connected");
        var process = remote(ws, label).on('error', err => {
            logger.error(err, err.stack);
            ws.close();
        }).on('disconnect', () => {
            logger.log("Client", label, "disconnected");
        });
        replyTo(process)
            .handle('lookup', ptrading.lookup)
            .handle('fundamental', ptrading.fundamental)
            .handle('fetch', ptrading.fetch)
            .handle('quote', ptrading.quote)
            .handle('collect', ptrading.collect)
            .handle('optimize', ptrading.optimize)
            .handle('bestsignals', ptrading.bestsignals)
            .handle('worker_count', () => config('workers') != null ? config('workers') : WORKER_COUNT)
            .handle('stop', () => {
                server.close();
                wsserver.clients.forEach(client => {
                    if (client.readyState <= 1) client.send(JSON.stringify({cmd:'stop'}) + '\r\n\r\n');
                });
            });
    }).on('error', err => logger.error(err, err.stack))
      .on('listening', () => logger.info("Service listening on port", server.address().port));
    server.once('close', () => logger.log("Service has closed", address));
    var server_close = server.close;
    server.close = () => {
        server_close.call(server);
        wsserver.clients.forEach(client => client.close());
    };
    process.on('SIGINT', () => server.close()).on('SIGTERM', () => server.close());
    if (address && typeof address == 'boolean') {
        server.listen();
    } else {
        if (addr.address) {
            server.listen(addr.port, addr.hostname);
        } else {
            server.listen(addr.port);
        }
    }
    return server;
}

function readFileSync(filename) {
    if (filename) return fs.readFileSync(path.resolve(config('prefix'), filename));
}

function parseLocation(location, secure) {
    var parsed = typeof location == 'number' || location.match(/^\d+$/) ? {port: +location} :
        ~location.indexOf('//') ? url.parse(location) :
        secure ? url.parse('wss://' + location) :
        url.parse('ws://' + location);
    parsed.scheme = parsed.scheme || (secure ? 'wss:' : 'ws:');
    parsed.port = parsed.port || (secure ? 443 : 80);
    parsed.hostname = parsed.hostname || 'localhost';
    parsed.host = parsed.host || (parsed.hostname + ':' + parsed.port);
    parsed.href = parsed.href || (parsed.scheme + '//' + parsed.host);
    if (!parsed.path) parsed.href = parsed.href + DEFAULT_PATH;
    parsed.path = parsed.path || DEFAULT_PATH;
    return parsed;
}
