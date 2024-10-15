#!/usr/bin/env node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-start.js
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

const fs = require('graceful-fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const http = require('http');
const https = require('https');
const _ = require('underscore');
const moment = require('moment-timezone');
const ws = require('ws');
const shell = require('shell');
const expect = require('chai').expect;
const commander = require('commander');
const merge = require('./merge.js');
const logger = require('./logger.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const Config = require('./mtrader-config.js');
const config = require('./config.js');
const date = require('./mtrader-date.js');
const shellError = require('./shell-error.js');
const version = require('./version.js');
const MTrader = require('./mtrader.js');

const DEFAULT_PATH = `/mtrader/${version.major_version}/remote`;
const WORKER_COUNT = require('os').cpus().length;

function usage(command) {
    return command.version(version.version)
    .description("Start a headless service on the listen interface")
    .option('-V, --version', "Output the version number(s)")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-q, --quiet', "Include less information about what the system is doing")
    .option('-x, --debug', "Include details about what the system is working on")
    .option('-X', "Hide details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--config-dir <dirname>', "Directory where stored sessions are kept")
    .option('--cache-dir <dirname>', "Directory where processed data is kept")
    .option('--load <filename>', "Read the given session settings")
    .option('--set <name=value>', "Name=Value pairs to be used in session");
}

process.setMaxListeners(process.getMaxListeners()+1);

if (require.main === module) {
    if (!config('remote.listen'))
        throw Error("Service listen address is required to start service");
    const server = new listen({...config.options(), ...config('remote')});
    process.on('SIGINT', () => server.close());
    process.on('SIGTERM', () => server.close());
    process.on('SIGTERM', () => {
        setTimeout(() => {
            if (process._getActiveHandles)
                console.log("Still active on", process.pid);
        }, 10000).unref();
    });
} else {
    module.exports = function(settings = {}) {
        return new listen({...settings, ...config('remote')});
    };
}

function listen(settings) {
    const connections = [];
    const traders = [];
    const address = settings.listen;
    const timeout = settings.timeout;
    const addr = parseLocation(address, false);
    const auth = addr.auth ? 'Basic ' + new Buffer(addr.auth).toString('base64') : undefined;
    const server = addr.protocol == 'https:' || addr.protocol == 'wss:' ? https.createServer({
        key: readFileSync(settings.key_pem),
        passphrase: readBase64FileSync(settings.passphrase_base64),
        cert: readFileSync(settings.cert_pem),
        ca: readFileSync(settings.ca_pem),
        crl: readFileSync(settings.crl_pem),
        ciphers: settings.ciphers,
        honorCipherOrder: settings.honorCipherOrder,
        ecdhCurve: settings.ecdhCurve,
        dhparam: readFileSync(settings.dhparam_pem),
        secureProtocol: settings.secureProtocol,
        secureOptions: settings.secureOptions,
        handshakeTimeout: settings.handshakeTimeout,
        requestCert: settings.requestCert,
        rejectUnauthorized: settings.rejectUnauthorized,
        NPNProtocols: settings.NPNProtocols,
        ALPNProtocols: settings.ALPNProtocols
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
        perMessageDeflate: settings.perMessageDeflate!=null ? settings.perMessageDeflate : true,
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
        const options = merge(..._.map(querystring.parse(url.parse(message.url).query), (value, name) => {
            const val = value == 'true' ? true : value == 'false' ? false :
                typeof value == 'string' && _.isFinite(value) || value == 'NaN' ? +value : value;
            return name.split('.').reduceRight((obj, path) => ({[path]: obj}), val);
        }));
        const mtrader = new MTrader({...options, ...settings, remoteAddress: socket.remoteAddress});
        traders.push(mtrader);
        const process = remote({label}, ws).on('error', err => {
            logger.error(err, err.stack);
            ws.close();
        });
        connections.push(new Promise(closed => {
            process.on('disconnect', () => {
                logger.log("Client", label, "disconnected");
                const idx = traders.indexOf(mtrader);
                if (~idx) traders.splice(idx, 1);
                mtrader.close()
                  .catch(err => logger.debug("remote mtrader client disconnected", err))
                  .then(closed);
            });
        }));
        replyTo(process)
            .handle('lookup', mtrader.lookup)
            .handle('contract', mtrader.contract)
            .handle('fundamental', mtrader.fundamental)
            .handle('fetch', mtrader.fetch)
            .handle('quote', mtrader.quote)
            .handle('collect', mtrader.collect)
            .handle('optimize', mtrader.optimize)
            .handle('bestsignals', mtrader.bestsignals)
            .handle('strategize', mtrader.strategize)
            .handle('broker', mtrader.broker)
            .handle('replicate', mtrader.replicate)
            .handle('tz', p => (moment.defaultZone||{}).name || moment.tz.guess())
            .handle('ending_format', p => moment.defaultFormat)
            .handle('version', () => version.toString())
            .handle('worker_count', () => config('collect.workers') != null ? config('collect.workers') : WORKER_COUNT)
            .handle('pending', () => {
                return Promise.all(traders.map(mtrader => mtrader.pending())).then(ar => [].concat(...ar));
            })
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
      .on('listening', () => logger.info(`Service ${version.patch_version} listening on port ${server.address().port}`));
    server.once('close', () => logger.log("Service has closed", address));
    const common = new MTrader(settings); // keep common resources open
    const server_close = server.close;
    server.close = () => {
        common.close();
        server_close.call(server);
        wsserver.clients.forEach(client => client.close());
        return Promise.all(connections);
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
