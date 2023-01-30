// ib-gateway.js
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

const os = require('os');
const util = require('util');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');
const fs = require('graceful-fs');
const _ = require('underscore');
const ib = require('./ib-client.js');
const config = require('./config.js');
const logger = require('./logger.js');

const key_client_settings = [
    'clientId',
    'twsApiPort', 'twsApiHost',
    'jsonApiPort', 'jsonApiHost',
];
const client_instances = {};

process.on('SIGINT', () => closeAllClients('SIGINT').catch(logger.error));
process.on('SIGTERM', () => closeAllClients('SIGTERM').catch(logger.error));

module.exports = async function(remote_settings) {
    const local_settings = config('ib') || {};
    const settings = {...remote_settings, ...local_settings};
    const market_functions = [
        'reqHistoricalData', 'reqMktData', 'reqRealTimeBars',
        'calculateImpliedVolatility', 'calculateOptionPrice'
    ];
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const port = settings.twsApiPort || settings.jsonApiPort || '';
    if ('clientId' in settings) {
        settings.lib_dir = path.resolve(lib_dir, `ib${port}_${settings.clientId}`);
    } else {
        settings.lib_dir = path.resolve(lib_dir, `ib${port}`);
    }
    let promise_market_client;
    const client = await borrow(settings);
    return Object.assign({}, _.mapObject(client, (fn, name) => {
        if (settings.market_data && ~market_functions.indexOf(name)) {
            return async function() {
                promise_market_client = promise_market_client || borrow({
                    ...settings.market_data,
                    ..._.omit(local_settings, 'market_data')
                });
                const market_client = await promise_market_client;
                return market_client[name].apply(market_client, arguments);
            };
        } else {
            return function() {
                return client[name].apply(client, arguments);
            };
        }
    }), {
        async close(closedBy) {
            if (promise_market_client) {
                await promise_market_client.then(client => client.close(closedBy));
            }
            await client.close(closedBy);
        }
    });
};


async function borrow(settings) {
    const json = _.object(key_client_settings.filter(key => key in settings).map(key => [key, settings[key]]));
    const key = crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
    const used = client_instances[key];
    const shared = client_instances[key] = client_instances[key] || (s => {
        logger.log("ib-gateway opening client", settings.clientId || '', key);
        return createClientInstance(s);
    })({label: key, ...settings});
    if (!used) {
        shared.leased = 1;
        shared.close = async(closedBy, force) => {
            if (--shared.leased && !force) return; // still in use
            if (shared == client_instances[key]) {
                delete client_instances[key];
                return shared.destroy(closedBy);
            }
        };
        return shared.open().then(() => shared);
    } else if (await shared.open().then(() => true, err => {
        logger.warn("ib-gateway client closed unexpectedly", settings.clientId || '', key, err);
        return false;
    })) {
        shared.leased++;
        return shared;
    } else {
        if (shared == client_instances[key]) {
            delete client_instances[key];
        }
        logger.log("ib-gateway closing shared client", settings.clientId || '', key);
        await shared.destroy('ib-gateway');
        return module.exports(settings);
    }
}

function createClientInstance(settings) {
    const self = new.target ? this : {};
    let init = null;
    return Object.assign(self, {
        async open() {
            init = init || assignClient(self, settings);
            const client = await init;
            return client.open();
        },
        async close(closedBy) {
            // released back to pool above
        },
        async destroy(closedBy) {
            // don't do anything unless instance is initialized below
            return Promise.resolve();
        }
    });
}

async function closeAllClients(closedBy) {
    // all clients are inactive, so close all of them
    logger.log("ib-gateway closing all", Object.keys(client_instances).length, "client(s) by", closedBy);
    await Promise.all(Object.keys(client_instances).map(key => {
        const client = client_instances[key];
        delete client_instances[key];
        if (client) return client.destroy(closedBy);
    }));
}

async function assignClient(self, settings) {
    const client = await ib(await setDefaultSettings(settings));
    return Object.assign(self, _.mapObject(client, (fn, name) => {
        if (name == 'close') {
            return self.close; // already a noop from above
        } else {
            return function() {
                return client[name].apply(client, arguments);
            };
        }
    }), {
        destroy(closedBy) {
            return client.close(closedBy);
        }
    });
}

async function setDefaultSettings(settings) {
    const keys = [
        'clientId', 'tz', 'timeout', 'login_timeout', 'reqMarketDataType', 'lib_dir',
        'jtsExeName', 'jtsInstallDir', 'jtsConfigDir', 'javaHome', 'launcher',
        'twsApiPath', 'twsApiJar', 'twsApiPort', 'twsApiHost',
        'jsonApiPort', 'jsonApiPortOffset', 'jsonApiInet', 'jsonApiHost',
    ];
    return {
        twsApiHost: settings.host,
        twsApiPort: settings.port,
        ..._.pick(settings, keys)
    };
}
