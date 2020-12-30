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
const ReadWriteLock = require('./read-write-lock.js');
const share = require('./share.js');
const ib = require('./ib-client.js');
const config = require('./config.js');
const logger = require('./logger.js');

const private_settings = [
    'TradingMode', 'IbLoginId', 'IbPassword',
    'auth_base64', 'auth_file', 'auth_salt', 'auth_sha256'
];
const client_settings = ['host', 'port', 'clientId'].concat(private_settings);
const active_instances = {};
const client_instances = {};

module.exports = async function(settings) {
    const json = _.object(client_settings.filter(key => key in settings).map(key => [key, settings[key]]));
    const key = crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
    const shared = active_instances[key] = client_instances[key] =
      client_instances[key] || share(createClientInstance, async(closedBy) => {
        const active = active_instances[key];
        delete active_instances[key];
        const connected = active.instance && await active.instance.isConnected().catch(err => false);
        if (!connected && active.instance) {
            if (active == client_instances[key]) {
                delete client_instances[key];
            }
            await active.instance.force_close();
        }
        if (_.isEmpty(active_instances)) {
            // all clients are inactive, so close all of them
            await Promise.all(Object.keys(client_instances).map(key => {
                const client = client_instances[key];
                delete client_instances[key];
                if (client && client.instance) return client.instance.force_close();
            }));
        }
    });
    const old_instance = shared.instance;
    const shared_instance = shared({label: key, ...settings});
    if (old_instance != shared_instance) {
        return shared_instance.open();
    } else if (await shared_instance.isConnected().catch(err => false)) {
        return shared_instance;
    } else {
        if (shared == client_instances[key]) {
            delete client_instances[key];
        }
        await shared_instance.force_close();
        return module.exports(settings);
    }
};

function createClientInstance(settings) {
    const self = new.target ? this : {};
    return Object.assign(self, {
        open: _.memoize(async() => {
            const client = await assignClient(self, settings);
            return client.open();
        }),
        async isConnected() {
            await self.open();
            return self.isConnected();
        },
        close(closedBy) {
            // released from active_instance pool
        },
        async force_close(closedBy) {
            // don't do anything unless instance is initialized below
            return Promise.resolve();
        }
    });
}

async function assignClient(self, options) {
    const install = config('ib') || {};
    const settings = await setDefaultSettings({...options, ...install});
    const market_functions = [
        'reqHistoricalData', 'reqMktData', 'reqRealTimeBars',
        'calculateImpliedVolatility', 'calculateOptionPrice'
    ];
    if ('clientId' in settings) {
        const {username} = await readAuthentication(settings);
        const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
        const default_dir = path.resolve(lib_dir, username || '.');
        settings.lib_dir = path.resolve(default_dir, `${settings.TradingMode || 'live'}${settings.clientId}`);
    } else {
        delete settings.lib_dir;
    }
    let client = await ib(settings);
    const market_client = settings.market_data && module.exports(settings.market_data);
    const locks = new ReadWriteLock();
    return Object.assign(self, _.mapObject(client, (fn, name) => {
        if (name == 'close') return self.close; // already a noop
        else if (name == 'open') return async function(openedBy) {
            const current_client = client;
            return locks.readLock(async() => {
                await client.open();
                return self;
            }).catch(err => {
                logger.debug("ib-client failed to open", err);
                return locks.writeLock(async() => {
                    if (current_client == client) {
                        // current_client could not open, try creating anew
                        await current_client.close();
                        client = await ib(settings);
                    }
                    // try again
                    await client.open();
                    return self;
                });
            });
        }; else if (market_client && ~market_functions.indexOf(name)) {
            return async function() {
                await market_client.open();
                return market_client[name].apply(market_client, arguments);
            };
        } else {
            return function() {
                return client[name].apply(client, arguments);
            };
        }
    }), {
        async force_close(closedBy) {
            if (market_client) await market_client.close(closedBy);
            await client.close(closedBy);
        }
    });
}

const black_listed_ports = [];
async function findAvailablePort(startFrom) {
    if (~black_listed_ports.indexOf(startFrom))
        return findAvailablePort(startFrom+1);
    return new Promise((ready, fail) => {
        const server = net.createServer()
          .once('error', function(err) {
            if (err.code === 'EADDRINUSE') {
                ready(findAvailablePort(startFrom+1));
            } else {
                fail(err);
            }
        }).once('listening', () => server.close())
          .once('close', () => {
            black_listed_ports.push(startFrom);
            ready(startFrom);
        })
          .listen(startFrom);
    });
}

async function setDefaultSettings(settings) {
    const overrideTwsApiPort = settings.OverrideTwsApiPort || settings.port ||
            await findAvailablePort(settings.TradingMode == 'paper' ? 4002 : 4001)
    const {username, password} = await readAuthentication(settings);
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const default_dir = path.resolve(lib_dir, settings.IbLoginId || username || '');
    return {
        ...settings,
        IBAPIBase64UserName: username ? new Buffer(username).toString('base64') : null,
        IBAPIBase64Password: password ? new Buffer(password).toString('base64') : null,
        port: overrideTwsApiPort,
        "tws-settings-path": path.resolve(settings.IbDir || default_dir)
    };
}

async function readAuthentication(settings) {
    if (settings.IbLoginId && settings.IbPassword)
        return {username: settings.IbLoginId, password: settings.IbPassword};
    const readFile = util.promisify(fs.readFile);
    const auth_file = settings.auth_file && path.resolve(config('prefix'), 'etc', settings.auth_file);
    const token = settings.auth_base64 ? settings.auth_base64 :
        auth_file ? (await readFile(auth_file, 'utf8')||'').trim() : '';
    const [username, password] = new Buffer.from(token, 'base64').toString().split(/:/, 2);
    if (auth_file && username) {
        const string = `${username}:${settings.auth_salt||''}:${password}`;
        const hash = crypto.createHash('sha256').update(string).digest('hex');
        if (hash == settings.auth_sha256) return {username, password};
        else throw Error("auth_sha256 of username:auth_salt:password is required when using auth_file");
    } else {
        return {username: settings.IbLoginId};
    }
}
