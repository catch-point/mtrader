// fetch-remote.js
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

const _ = require('underscore');
const moment = require('moment-timezone');
const interrupt = require('./interrupt.js');
const logger = require('./logger.js');
const config = require('./config.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    let promiseFetch, closing;
    if (!config('fetch.remote.location')) throw Error("No remote location configured");
    return {
        close() {
            if (closing) return closing;
            return closing = (promiseFetch || Promise.reject()).then(fetch => {
                if (fetch.process.connected || fetch.process.connecting) return fetch.disconnect();
            }, err => {});
        },
        help() {
            return fetch({help: true});
        },
        lookup(options) {
            return fetch(options);
        },
        fundamental(options) {
            return fetch(options);
        },
        interday(options) {
            return fetch(options);
        },
        intraday(options) {
            return fetch(options);
        }
    };

    async function fetch(options, interrupted, delayed) {
        const check = interrupted || interrupt(true);
        const delay = (delayed || 500) *2;
        const client = await Fetch();
        return client.request('fetch', options).catch(async err => {
            if (closing || await check() || delay > 5000 || !isConnectionError(err))
                throw err;
            // connection error wait and try again
            client.connectionError = true;
            logger.log("Connection error:", err.message);
            await new Promise(cb => _.delay(cb, delay));
            if (await check()) throw err;
            else return fetch(options, check, delay).catch(e2 => {
                throw err;
            });
        });
    }

    async function Fetch() {
        return promiseFetch = (promiseFetch || Promise.reject()).catch(err => {
            return {process: {connected: false}};
        }).then(fetch => {
            if (fetch.connectionError) fetch.disconnect();
            else if (fetch.process.connected || fetch.process.connecting) return fetch;
            if (closing) throw Error("Closing remote connection");
            const location = config('fetch.remote.location');
            logger.log(`Connecting ${location} from ${process.pid}`);
            const connection = remote(location);
            return replyTo(connection)
                .handle('stop', () => connection.disconnect());
        });
    }
};

function isConnectionError(err) {
    if (!err || !err.message) return false;
    else return ~err.message.indexOf('connect') ||
        ~err.message.indexOf('timed out') ||
        ~err.message.indexOf('ECONNRESET');
}
