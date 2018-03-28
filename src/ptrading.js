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
const version = require('./version.js');

const DEFAULT_PATH = '/ptrading/' + version.minor_version + '/workers';
const WORKER_COUNT = require('os').cpus().length;

var program = require('commander')
    .description(version.description)
    .command('config <name> [value]', "View or change stored options")
    .command('fetch <interval> <symbol.exchange>', "Fetches remote data for the given symbol")
    .command('quote <symbol.exchange>', "Historic information of a security")
    .command('collect [identifier]', "Collects historic portfolio data")
    .command('optimize [identifier]', "Optimizes the parameter values in the given portfolio")
    .command('bestsignals [identifier]', "Determines the best signals for the given portfolio")
    .command('strategize [identifier]', "Modifies a strategy looking for improvements")
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
    var address = config('listen');
    if (!address) throw Error("Service listen address is required to stop service");
    var worker = replyTo(remote(address, {checkServerIdentity: _.noop}))
        .on('error', err => logger.debug(err, err.stack))
        .on('error', () => worker.disconnect());
    return new Promise((stopped, abort) => {
        process.on('SIGINT', abort);
        process.on('SIGTERM', abort);
        worker.handle('stop', stopped).request('stop').catch(abort);
    }).catch(err => err && err.stack && logger.debug(err, err.stack)).then(() => worker.disconnect());
});
var program_args_version = false;
program.on('option:version', function() {
    program_args_version = true;
    process.stdout.write(version + '\n');
    if (config('remote_workers')) {
        var Remote = require('./remote-workers.js');
        var remote = Remote();
        remote.version().then(remote_version => {
            _.forEach(remote_version, (worker_version, worker) => {
                process.stdout.write(`${worker_version} ${worker}` + '\n');
            });
        }).then(remote.close);
    }
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
    if (!program_args_version && _.isEmpty(program.args)) {
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
        app.on('quit', () => ptrading.close());
        app.on('exit', () => ptrading.close());
        if (config('listen')) {
            ptrading.listen(config('listen'));
        }
    } else if (!program_args_version && config('listen') &&
            !~['stop','config','fetch','version'].indexOf(program.args[0]) &&
            !~['stop','config','fetch','version'].indexOf(program.args[0].name && program.args[0].name())) {
        var ptrading = createInstance();
        var server = ptrading.listen(config('listen'));
        process.on('SIGINT', () => ptrading.close());
        process.on('SIGTERM', () => ptrading.close());
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
    var strategize = require('./ptrading-strategize.js');
    var servers = [];
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
        strategize: strategize,
        seed(number) {
            optimize.seed(number);
            strategize.seed(number);
        },
        close() {
            return Promise.all(servers.map(server => {
                return new Promise(cb => server.close(cb));
            })).then(() => {
                strategize.close();
            });
        },
        shell(app) {
            Promise.all([
                config.shell(app),
                fetch.shell(app),
                quote.shell(app),
                collect.shell(app),
                optimize.shell(app),
                bestsignals.shell(app),
                strategize.shell(app)
            ]).catch(err => console.error("Could not complete shell setup", err));
        },
        listen(address) {
            var server = listen(this, address);
            server.once('close', () => {
                var idx = servers.indexOf(server);
                if (idx >= 0) {
                    servers.splice(idx, 1);
                }
            });
            servers.push(server);
            return server;
        }
    };
}

function listen(ptrading, address) {
    var timeout = config('tls.timeout');
    var addr = parseLocation(address, false);
    var auth = addr.auth ? 'Basic ' + new Buffer(addr.auth).toString('base64') : undefined;
    var server = addr.protocol == 'https:' || addr.protocol == 'wss:' ? https.createServer({
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
            var msg = `Try using ptrading/${version}\r\n`;
            socket.write(
                `HTTP/1.1 400 ${http.STATUS_CODES[400]}\r\n` +
                `Server: ptrading/${version}\r\n` +
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
        response.setHeader('Server', 'ptrading/' + version);
        if (wsserver.shouldHandle(request)) return;
        var msg = `Try using ptrading/${version}\r\n`;
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/plain');
        response.setHeader('Content-Length', Buffer.byteLength(msg));
        response.end(msg);
    });
    var wsserver = new ws.Server({
        server: server, path: addr.path,
        clientTracking: true,
        perMessageDeflate: config('tls.perMessageDeflate')!=null ? config('tls.perMessageDeflate') : true,
        verifyClient: auth ? info => {
            return info.req.headers.authorization == auth;
        } : undefined
    });
    wsserver.on('headers', (headers, request) => {
        headers.push('Server: ptrading/' + version);
    });
    wsserver.on('connection', (ws, message) => {
        var socket = message.socket;
        if (timeout) {
            socket.setTimeout(timeout);
            socket.on('timeout', () => ws.ping());
        }
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
            .handle('strategize', ptrading.strategize)
            .handle('version', () => version.toString())
            .handle('worker_count', () => config('workers') != null ? config('workers') : WORKER_COUNT)
            .handle('stop', () => {
                try {
                    var stop = JSON.stringify({cmd:'stop'}) + '\r\n\r\n';
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
    var server_close = server.close;
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
        var file = path.resolve(config('prefix'), filename);
        return fs.readFileSync(file, {encoding: 'utf-8'});
    }
}

function parseLocation(location, secure) {
    var parsed = typeof location == 'number' || location.match(/^\d+$/) ? {port: +location} :
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
