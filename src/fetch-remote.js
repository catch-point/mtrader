// fetch-remote.js
/*
 *  Copyright (c) 2017 James Leigh, Some Rights Reserved
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

const _ = require('underscore');
const moment = require('moment-timezone');
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    var promiseFetch = Promise.reject();
    return {
        close() {
            return promiseFetch.then(fetch => {
                if (fetch.connected) return fetch.disconnect();
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

    function fetch(options, interrupted, delayed) {
        var check = interrupted || interrupt(true);
        var delay = (delayed || 500) *2;
        return Fetch().then(client => client.request('fetch', options).catch(err => {
            if (check() || delay > 5000 || !isConnectionError(err))
                throw err;
            // connection error wait and try again
            client.connectionError = true;
            return new Promise(cb => _.delay(cb, delay)).then(() => {
                if (check()) throw err;
                else return fetch(options, check, delay).catch(e2 => {
                    throw err;
                });
            });
        }));
    }

    function Fetch() {
        return promiseFetch = promiseFetch.catch(err => {
            return {connected: false};
        }).then(fetch => {
            if (fetch.connectionError) fetch.disconnect();
            else if (fetch.connected) return fetch;
            return replyTo(remote(config('fetch.remote.location')))
                .handle('stop', () => fetch.disconnect());
        });
    }
};

function isConnectionError(err) {
    if (!err || !err.message) return false;
    else return ~err.message.indexOf('connect') ||
        ~err.message.indexOf('timed out') ||
        ~err.message.indexOf('ECONNRESET');
}
