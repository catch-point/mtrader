// collective2-client.js
/*
 *  Copyright (c) 2018-2019 James Leigh, Some Rights Reserved
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

const _ = require('underscore');
const fs = require('graceful-fs');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const config = require('./config.js');
const logger = require('./logger.js');
const expect = require('chai').expect;
const version = require('../package.json').version;

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
module.exports = function(systemid) {
    expect(systemid).to.be.a('string');
    const agent = new https.Agent({
        keepAlive: config('broker.collective2.keepAlive') || false,
        keepAliveMsecs: config('broker.collective2.keepAliveMsecs') || 1000,
        maxSockets: config('broker.collective2.maxSockets'),
        maxFreeSockets: config('broker.collective2.maxFreeSockets') || 256,
        ciphers: config('tls.ciphers'),
        honorCipherOrder: config('tls.honorCipherOrder'),
        ecdhCurve: config('tls.ecdhCurve'),
        secureProtocol: config('tls.secureProtocol'),
        secureOptions: config('tls.secureOptions'),
        handshakeTimeout: config('tls.handshakeTimeout'),
        requestCert: config('tls.requestCert'),
        rejectUnauthorized: config('tls.rejectUnauthorized'),
        NPNProtocols: config('tls.NPNProtocols'),
        ALPNProtocols: config('tls.ALPNProtocols')
    });
    const settings = _.extend({offline: config('offline')}, config('broker.collective2'));
    expect(settings).to.have.property('apikey').that.is.a('string');
    return ({
        submitSignal(signal) {
            return submit(agent, 'submitSignal', systemid, signal, settings);
        },
        cancelSignal(signalid) {
            return submit(agent, 'cancelSignal', systemid, signalid, settings);
        },
        requestMarginEquity() {
            return retrieve(agent, 'requestMarginEquity', systemid, settings);
        },
        retrieveSystemEquity() {
            return retrieve(agent, 'retrieveSystemEquity', systemid, settings);
        },
        retrieveSignalsWorking() {
            return retrieve(agent, 'retrieveSignalsWorking', systemid, settings);
        },
        requestTrades() {
            return retrieve(agent, 'requestTrades', systemid, settings);
        },
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Retrieve the collective2 response
 */
function retrieve(agent, name, systemid, settings) {
    expect(settings).to.have.property('apikey').that.is.a('string');
    return new Promise((ready, error) => {
        const uri = settings[name];
        const parsed = _.isString(uri) && url.parse(uri);
        if (_.isObject(uri)) {
            ready(JSON.stringify(uri));
        } else if (parsed.protocol == 'https:' || parsed.protocol == 'http:') {
            const client = parsed.protocol == 'https:' ? https : http;
            const request = client.request(_.defaults({
                method: 'POST',
                headers: {'User-Agent': 'mtrader/' + version},
                agent: parsed.protocol == 'https:' && agent
            }, parsed), res => {
                try {
                    if (res.statusCode >= 300)
                        throw Error("Unexpected response code " + res.statusCode);
                    if (!~res.headers['content-type'].indexOf('/json'))
                        throw Error("Unexpected response type " + res.headers['content-type']);
                    const data = [];
                    res.setEncoding('utf8');
                    res.on('data', chunk => {
                        data.push(chunk);
                    });
                    res.on('end', () => {
                        ready(data.join(''));
                    });
                } catch(err) {
                    error(err);
                }
            }).on('error', error);
            request.end(JSON.stringify({
                apikey: settings.apikey,
                systemid: systemid
            }));
        } else if (parsed.protocol == 'file:') {
            fs.readFile(parsed.pathname, 'utf8', (err, data) => err ? error(err) : ready(data));
        } else {
            throw Error("Unknown protocol " + uri);
        }
    }).then(JSON.parse).then(res => {
        if (!res.equity_data) logger.debug("collective2", name, JSON.stringify(res));
        if (res.title)
            logger.log(res.title);
        else if (res.error && res.error.title)
            logger.error(res.error.title);
        if (!+res.ok)
            throw Error(res.message || res.error && res.error.message || JSON.stringify(res));
        return res;
    });
}

/**
 * Submits a new or updated signal or cancels a signal
 */
function submit(agent, name, systemid, signal, settings) {
    expect(settings).to.have.property('apikey').that.is.a('string');
    const signalid = typeof signal == 'string' ? signal : undefined;
    const signalobj = typeof signal == 'object' ? signal : undefined;
    return new Promise((ready, error) => {
        const uri = settings[name];
        const parsed = _.isString(uri) && url.parse(uri);
        if (settings.offline || !parsed) {
            ready(JSON.stringify({
                ok: 1,
                signal: _.extend({
                    signalid: signalid
                }, signalobj)
            }));
        } else if (parsed.protocol == 'https:' || parsed.protocol == 'http:') {
            const client = parsed.protocol == 'https:' ? https : http;
            const request = client.request(_.defaults({
                method: 'POST',
                headers: {'User-Agent': 'mtrader/' + version},
                agent: parsed.protocol == 'https:' && agent
            }, parsed), res => {
                try {
                    if (res.statusCode >= 300)
                        throw Error("Unexpected response code " + res.statusCode);
                    if (!~res.headers['content-type'].indexOf('/json'))
                        throw Error("Unexpected response type " + res.headers['content-type']);
                    const data = [];
                    res.setEncoding('utf8');
                    res.on('data', chunk => {
                        data.push(chunk);
                    });
                    res.on('end', () => {
                        ready(data.join(''));
                    });
                } catch(err) {
                    error(err);
                }
            }).on('error', error);
            request.end(JSON.stringify({
                apikey: settings.apikey,
                systemid: systemid,
                signalid: signalid,
                signal: signalobj
            }));
        } else if (parsed.protocol == 'file:') {
            const data = JSON.stringify({signalid, signal: signalobj}, null, ' ');
            fs.writeFile(parsed.pathname, data, err => err ? error(err) : ready(JSON.stringify({
                ok: 1,
                signal: _.extend({
                    signalid: signalid || Math.floor(Math.random() * 100000000)
                }, signalobj)
            })));
        } else {
            throw Error("Unknown protocol " + uri);
        }
    }).then(JSON.parse).then(res => {
        logger.debug("collective2", name, JSON.stringify(signal), JSON.stringify(res));
        if (res.title)
            logger.log(res.title, res.signalid || '');
        else if (res.error && res.error.title)
            logger.error(res.error.title, res.signalid || '');
        if (name == 'cancelSignal' && _.property(['error', 'title'])(res) && res.error.title.indexOf('Signal already cancel'))
            return res;
        else if (!+res.ok)
            throw Error(res.message || res.error && res.error.message || JSON.stringify(res));
        else return res;
    });
}
