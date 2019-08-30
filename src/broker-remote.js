// broker-remote.js
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

const _ = require('underscore');
const moment = require('moment-timezone');
const interrupt = require('./interrupt.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(settings) {
    if (settings.info=='help') return helpSettings();
    if (settings.info=='version') return [{version}];
    settings = {...settings, ...config('broker.remote')};
    let promiseBroker, closing;
    if (!settings.location) throw Error("No remote location configured");
    return Object.assign(options => broker(options), {
        close() {
            if (closing) return closing;
            return closing = (promiseBroker || Promise.reject()).then(broker => {
                if (broker.process.connected || broker.process.connecting) return broker.disconnect();
            }, err => {});
        }
    });

    async function broker(options, interrupted, delayed) {
        const check = interrupted || interrupt(true);
        const delay = (delayed || 500) *2;
        const client = await Broker(settings);
        return client.request('broker', options).then(result => {
            if (options.info!='version') return result;
            const location = client.process.pid;
            return result.map(version => ({...version, location, ...version}));
        }, err => {
            if (options.info!='version') throw err;
            const location = client.process.pid;
            return [{location, message: err.message}];
        }).catch(async err => {
            if (closing || await check() || delay > 5000 || !isConnectionError(err))
                throw err;
            // connection error wait and try again
            client.connectionError = true;
            logger.log("Connection error:", err.message);
            await new Promise(cb => _.delay(cb, delay));
            if (await check()) throw err;
            else return broker(options, check, delay).catch(e2 => {
                throw err;
            });
        });
    }

    async function Broker(settings) {
        return promiseBroker = (promiseBroker || Promise.reject()).catch(err => {
            return {process: {connected: false}};
        }).then(broker => {
            if (broker.connectionError) broker.disconnect();
            else if (broker.process.connected || broker.process.connecting) return broker;
            if (closing) throw Error("Closing remote connection");
            const location = settings.location;
            logger.log(`Connecting ${location} from ${process.pid}`);
            const connection = remote(settings);
            return replyTo(connection)
                .handle('stop', () => connection.disconnect());
        });
    }
};

/**
 * Array of one Object with description of module, including supported options
 */
function helpSettings() {
    return [{
        name: 'broker',
        usage: 'broker(settings)',
        description: "Information needed to identify the broker account",
        options: {
            location: {
                usage: '<uri>',
                description: "The remote location of the broker service"
            }
        }
    }];
}

function isConnectionError(err) {
    if (!err || !err.message) return false;
    else return ~err.message.indexOf('connect') ||
        ~err.message.indexOf('timed out') ||
        ~err.message.indexOf('ECONNRESET');
}
