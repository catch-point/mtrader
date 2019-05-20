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
module.exports = function(settings) {
    expect(settings).to.have.property('systemid').that.is.ok;
    const systemid = settings.systemid;
    const agent = new https.Agent({
        keepAlive: settings.keepAlive || false,
        keepAliveMsecs: settings.keepAliveMsecs || 1000,
        maxSockets: settings.maxSockets,
        maxFreeSockets: settings.maxFreeSockets || 256,
        ciphers: settings.ciphers,
        honorCipherOrder: settings.honorCipherOrder,
        ecdhCurve: settings.ecdhCurve,
        secureProtocol: settings.secureProtocol,
        secureOptions: settings.secureOptions,
        handshakeTimeout: settings.handshakeTimeout,
        requestCert: settings.requestCert,
        rejectUnauthorized: settings.rejectUnauthorized,
        NPNProtocols: settings.NPNProtocols,
        ALPNProtocols: settings.ALPNProtocols
    });
    expect(settings).to.have.property('apikey').that.is.a('string');
    return ({
        submitSignal(signal) {
            return submit(agent, 'submitSignal', systemid, signal, settings).then(_.property('signal'));
        },
        cancelSignal(signalid) {
            return submit(agent, 'cancelSignal', systemid, signalid, settings).then(_.property('signal'));
        },
        requestMarginEquity() {
            return retrieve(agent, 'requestMarginEquity', {}, systemid, settings);
        },
        retrieveSystemEquity() {
            return retrieve(agent, 'retrieveSystemEquity', {}, systemid, settings).then(_.property('equity_data'));
        },
        retrieveSignalsWorking() {
            return retrieve(agent, 'retrieveSignalsWorking', {}, systemid, settings).then(_.property('response'));
        },
        requestTrades() {
            return retrieve(agent, 'requestTrades', {}, systemid, settings).then(_.property('response'));
        },
        requestTradesOpen() {
            return retrieve(agent, 'requestTradesOpen', {}, systemid, settings).then(_.property('response'));
        },
        retrieveSignalsAll(filter) {
            return retrieve(agent, 'retrieveSignalsAll', filter, systemid, settings).then(_.property('response'));
        },
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Retrieve the collective2 response
 */
async function retrieve(agent, name, posted, systemid, settings) {
    expect(settings).to.have.property('apikey').that.is.a('string');
    const uri = settings[name];
    const parsed = _.isString(uri) && url.parse(uri);
    const body = await new Promise((ready, error) => {
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
            logger.log(uri, posted);
            request.end(JSON.stringify(Object.assign({
                apikey: settings.apikey,
                systemid: systemid
            }, posted)));
        } else if (parsed.protocol == 'file:') {
            fs.readFile(parsed.pathname, 'utf8', (err, data) => err ? error(err) : ready(data));
        } else {
            throw Error("Unknown protocol " + uri);
        }
    });
    const res = JSON.parse(body);
    if (!res.equity_data && parsed.protocol != 'file:')
        logger.debug("collective2", name, JSON.stringify(res));
    else if (parsed.protocol != 'file:')
        logger.debug("collective2", name, JSON.stringify(Object.assign(_.omit(res,'equity_data'), {
            equity_data: res.equity_data.slice(Math.max(res.equity_data.length-20,0))
        })));
    else
        logger.trace("collective2", name, JSON.stringify(res));
    if (res.title)
        logger.log(res.title);
    else if (res.error && res.error.title)
        logger.error(res.error.title);
    if (!+res.ok)
        throw Error(res.message || res.error && res.error.message || JSON.stringify(res));
    return res;
}

/**
 * Submits a new or updated signal or cancels a signal
 */
async function submit(agent, name, systemid, signal, settings) {
    expect(settings).to.have.property('apikey').that.is.a('string');
    const signalid = typeof signal == 'string' ? signal : undefined;
    const signalobj = typeof signal == 'object' ? signal : undefined;
    const uri = settings[name];
    const parsed = _.isString(uri) && url.parse(uri);
    const body = await new Promise((ready, error) => {
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
            logger.log(uri);
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
    });
    const res = JSON.parse(body);
    if (parsed.protocol != 'file:') logger.debug("collective2", name, JSON.stringify(signal), JSON.stringify(res));
    else logger.trace("collective2", name, JSON.stringify(signal), JSON.stringify(res));
    if (res.title)
        logger.log(res.title, res.signalid || '');
    else if (res.error && res.error.title)
        logger.error(res.error.title, res.signalid || '');
    if (name == 'cancelSignal' && _.property(['error', 'title'])(res) && res.error.title.indexOf('Signal already cancel'))
        return res;
    else if (!+res.ok)
        throw Error(res.message || res.error && res.error.message || JSON.stringify(res));
    else return res;
}
