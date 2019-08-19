// remote-process.js
/*
 *  Copyright (c) 2017-2018 James Leigh, Some Rights Reserved
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
const ws = require('ws');
const EventEmitter = require('events');
const _ = require('underscore');
const expect = require('chai').expect;
const logger = require('./logger.js');
const config = require('./config.js');
const AssertionError = require('chai').AssertionError;
const version = require('./version.js');

const EOM = '\r\n\r\n';

const DEFAULT_PATH = `/mtrader/${version.minor_version}/remote`;

const remote = module.exports = function(settings = {}, socket = null) {
    if (_.isEmpty(settings) && !socket) throw Error("No remote location given");
    if (typeof settings == 'string' || typeof settings == 'number')
        return remote({label: settings, location: settings}, socket);
    if (!socket) return remote(
        _.extend({label: settings.location}, settings),
        new ws(getSocketUrl(settings), _.extend({
            key: readFileSync(config('remote.key_pem')),
            passphrase: readBase64FileSync(config('remote.passphrase_base64')),
            cert: readFileSync(config('remote.cert_pem')),
            ca: readFileSync(config('remote.ca_pem')),
            crl: readFileSync(config('remote.crl_pem')),
            ciphers: config('remote.ciphers'),
            honorCipherOrder: config('remote.honorCipherOrder'),
            ecdhCurve: config('remote.ecdhCurve'),
            dhparam: readFileSync(config('remote.dhparam_pem')),
            secureProtocol: config('remote.secureProtocol'),
            secureOptions: config('remote.secureOptions'),
            handshakeTimeout: config('remote.handshakeTimeout'),
            requestCert: config('remote.requestCert'),
            rejectUnauthorized: config('remote.rejectUnauthorized'),
            NPNProtocols: config('remote.NPNProtocols'),
            ALPNProtocols: config('remote.ALPNProtocols'),
            perMessageDeflate: config('remote.perMessageDeflate')!=null ? config('remote.perMessageDeflate') : true,
            headers: {'User-Agent': 'mtrader/' + version},
            agent: false
        }, settings))
    );
    let buf = '';
    const label = settings.label;
    const timeout = config('remote.timeout');
    const emitter = new EventEmitter();
    socket.on('open', () => {
        if (timeout) {
            // remove handshakeTimeout event handler
            socket._socket.removeAllListeners('timeout');
            socket._socket.setTimeout(timeout/2);
            let pings = 0;
            socket._socket.on('timeout', () => pings++ ? socket.close() : socket.ping());
            socket._socket.on('pong', () => ping--);
        }
        emitter.connecting = false;
        emitter.connected = true;
        emitter.emit('connect');
    }).on('message', data => {
        try {
            let chunks = data.split('\r\n\r\n');
            if (buf) chunks[0] = buf + chunks[0];
            buf = chunks.pop();
            if (_.isEmpty(chunks) && ~buf.lastIndexOf(EOM)) {
                chunks = chunks.concat(buf.split(EOM));
                buf = chunks.pop();
            }
            chunks.forEach(chunk => emitter.emit('message', JSON.parse(chunk)));
        } catch(err) {
            emitter.emit('error', err);
        }
    }).on('close', (code, reason) => {
        emitter.connecting = false;
        emitter.connected = false;
        try {
            if (buf) emitter.emit('message', JSON.parse(buf));
        } catch(err) {
            emitter.emit('error', err);
        } finally {
            emitter.emit('disconnect');
        }
    }).on('unexpected-response', (request, response) => {
        if (response.statusCode == 400) {
            emitter.emit('error', Error(`Version mismatch ${response.headers.server} with ${label}`));
        } else if (response.statusCode == 401) {
            emitter.emit('error', Error(`Wrong credentials ${label}`));
        } else {
            emitter.emit('error', Error("unexpected server response (" + response.statusCode + ")"));
        }
    }).on('error', err => {
        if (label) emitter.emit('error', Error(`${err.message} from ${label}`));
        else emitter.emit('error', err);
    });
    emitter.remote = true;
    emitter.pid = label || '';
    emitter.send = (message, onerror) => {
        logger.trace(message.payload && message.payload.label || message.cmd, label || '');
        return socket.send(JSON.stringify(message) + EOM, onerror);
    };
    emitter.disconnect = () => socket.close();
    emitter.kill = () => socket.terminate();
    emitter.connecting = true;
    return _.extend(emitter, {
        get connected() {
            return socket.readyState == 1;
        }
    });
};

function readBase64FileSync(filename) {
    if (filename) return Buffer.from(readFileSync(filename), 'base64').toString();
}

function readFileSync(filename) {
    if (filename) {
        const file = path.resolve(config('prefix'), filename);
        return fs.readFileSync(file, {encoding: 'utf-8'});
    }
}

function getSocketUrl(settings) {
    const base = parseLocation(settings.location, false).href;
    const params = flattenObjectPaths(_.omit(settings, 'location', 'enabled'));
    const qs = querystring.stringify(params);
    return `${base}?${qs}`;
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
    parsed.hostname = parsed.hostname || 'localhost';
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

function flattenObjectPaths(settings) {
    return _.reduce(settings, (params, value, name) => {
        if (value == null) return params;
        else if (!value || typeof value != 'object') return Object.assign(params, {[name]: `${value}`});
        else return _.reduce(flattenObjectPaths(value), (params, value, suffix) => {
            return Object.assign(params, {[`${name}.${suffix}`]: value});
        }, params);
    }, {});
}
