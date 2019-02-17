// promise-text.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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

const http = require('http');
const https = require('https');
const _ = require('underscore');
const logger = require('./logger.js');

process.setMaxListeners(process.getMaxListeners()+1);

module.exports = function(url) {
    const pending = _.isString(url) ? {url: url} : _.clone(url);
    return new Promise(function(resolve, reject) {
        pending.onerror = reject;
        outstanding.push(pending);
        logger.log(url.path || url);
        const protocol = (url.protocol || url).indexOf('https') === 0 ? https : http;
        protocol.get(url, res => {
            const buffer = [];
            saveCookies(url.headers, res.headers);
            res.setEncoding('utf8');
            res.on('data', data => {
                buffer.push(data);
            }).on('end', () => {
                clear(pending);
                const code = res.statusCode;
                const body = buffer.join('');
                if (code == 404 || code == 410) {
                    resolve();
                } else if (code != 200 && code != 203) {
                    logger.warn(res.statusMessage, code, url.path || url);
                    reject(Error(titleOf(body, res.statusMessage)));
                } else {
                    resolve(body);
                }
            });
        }).on('error', error => clear(pending) && reject(error));
    });
}

const outstanding = [];

process.on('SIGINT', () => {
    const error = Error('SIGINT');
    outstanding.forEach(pending => {
        pending.onerror(error);
    });
}).on('SIGTERM', () => {
    const error = Error('SIGTERM');
    outstanding.forEach(pending => {
        pending.onerror(error);
    });
});

function clear(pending) {
    const idx = outstanding.indexOf(pending);
    if (idx >= 0) {
        outstanding.splice(1, idx);
    }
}

function saveCookies(req, res) {
    if (!_.isEmpty(res['set-cookie']) && req) {
        const keys = _.object(_.keys(req).map(k=>k.toLowerCase()), _.keys(req));
        const key = keys.cookie || 'Cookie';
        let cookies = req[key] || "";
        res['set-cookie'].forEach(cookie => {
            const idx = cookie.indexOf(';');
            const pair = cookie.substring(0, idx > 0 ? idx : cookie.length);
            cookies = cookies ? cookies + "; " + pair : pair;
        });
        req[key] = cookies;
    }
}

function titleOf(html, status) {
    const lower = html.toLowerCase();
    const start = lower.indexOf('<title');
    const end = lower.indexOf('</title>');
    if (start < 0 || end < 0) return status;
    const text = html.substring(html.indexOf('>', start) + 1, end);
    const decoded = text.replace('&lt;','<').replace('&gt;', '>').replace('&amp;', '&');
    if (decoded.indexOf(status) >= 0) return decoded;
    else return decoded + ' ' + status;
}
