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
    'ibg_name', 'ibg_version', 'TradingMode', 'IbLoginId', 'IbPassword',
    'auth_base64', 'auth_file', 'auth_salt', 'auth_sha256'
];
const client_settings = ['host', 'port', 'clientId'].concat(private_settings);
const gateway_instances = {};
const client_instances = {};

module.exports = function(settings) {
    const json = _.object(client_settings.filter(key => key in settings).map(key => [key, settings[key]]));
    const key = crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
    const shared = client_instances[key] = client_instances[key] || share(createClientInstance, async() => {
        delete client_instances[key];
        if (_.isEmpty(client_instances)) {
            // all clients are closed, so close all gateways
            await Promise.all(Object.keys(gateway_instances).map(gateway_key => {
                const gateway = gateway_instances[gateway_key];
                delete gateway_instances[gateway_key];
                if (gateway) return gateway.close();
            }));
        }
    });
    return shared({label: key, ...settings});
};

function createClientInstance(settings) {
    const self = new.target ? this : {};
    return Object.assign(self, {
        open: _.memoize(async() => {
            const client = await assignClient(self, settings);
            return client.open();
        }),
        close(closedBy) {
            return self.force_close(closedBy);
        },
        async force_close(closedBy) {
            // don't do anything unless instance is initialized
            return Promise.resolve();
        }
    });
}

async function assignClient(self, settings) {
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
    const install = (config('ibgateway_installs')||[])
      .find(inst => inst.ibg_version == settings.ibg_version && inst.ibg_name == settings.ibg_name);
    if (settings.ibg_name && !install)
        throw Error(`IB Gateway ${settings.ibg_name}/${settings.ibg_version} is not installed or configured correctly`);
    const timeout = Date.now() + (install && install.login_timeout || 300) * 1000;
    let gateway = await getSharedGateway(install, settings);
    let client = await ib({
        ..._.omit(settings, private_settings),
        host: settings.host || gateway.host,
        port: gateway.port
    });
    const market_client = settings.market_data && module.exports(settings.market_data);
    const locks = new ReadWriteLock();
    return Object.assign(self, _.mapObject(client, (fn, name) => {
        if (name == 'close') return self.close; // this was overriden by share.js already
        else if (name == 'open') return async function(openedBy) {
            const current_client = client;
            return locks.readLock(async() => {
                await gateway.open();
                await client.open();
                return self;
            }).catch(err => {
                logger.debug("ib-client failed to open", err);
                return locks.writeLock(async() => {
                    if (current_client == client) {
                        // current_client could not open, try creating anew
                        await current_client.close();
                        if (timeout < Date.now()) {
                            await gateway.close();
                            gateway = await getSharedGateway(install, settings);
                        }
                        client = await ib({
                            ..._.omit(settings, private_settings),
                            host: settings.host || gateway.host,
                            port: gateway.port
                        });
                    }
                    // try again
                    await gateway.open();
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
            // all gateways are kept open until all clients are closed
        }
    });
}

function getSharedGateway(install, settings) {
    const json = _.object(private_settings.filter(key => key in settings).map(key => [key, settings[key]]));
    const key = crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
    let gateway = gateway_instances[key] = gateway_instances[key] ||
        createGatewayInstance(install, {label: key, ...settings});
    return gateway.open().catch(async(err) => {
        logger.debug("IB Gateway", err);
        await gateway.close();
        if (gateway == gateway_instances[key]) {
            // replace gateway (if not already replaced)
            gateway = gateway_instances[key] = createGatewayInstance(install, {label: key, ...settings});
        }
        // try again
        return gateway_instances[key].open();
    });
};

function createGatewayInstance(install, settings) {
    if (!settings || !settings.ibg_version || !settings.ibg_name) return {
        host: settings.host,
        port: settings.port,
        async open() {return this;},
        async close() {}
    };
    const self = new.target ? this : {};
    return Object.assign(self, {
        open: _.memoize(async() => {
            const gateway = await promiseInitializedInstance(self, install, settings);
            return gateway.open();
        }),
        close(closedBy) {
            return self.force_close(closedBy);
        },
        async force_close(closedBy) {
            // don't do anything unless instance is initialized
            return Promise.resolve();
        }
    });
}

let initialization_lock = Promise.resolve();

async function promiseInitializedInstance(self, install, settings) {
    return initialization_lock = initialization_lock.catch(err => logger.trace).then(() => {
        return promiseInstance(self, install, settings);
    });
}

async function promiseInstance(self, install, settings) {
    if (install.ibg_name) logger.info(`Launching ${install.ibg_name} ${settings.label||''}`);
    const overrideTwsApiPort = settings.OverrideTwsApiPort || settings.port ||
        await findAvailablePort(settings.TradingMode == 'paper' ? 4002 : 4001);
    const commandServerPort = settings.CommandServerPort ||
        await findAvailablePort(settings.TradingMode == 'paper' ? 7462 : 7461);
    const ibc = await spawn(install.ibc_command, overrideTwsApiPort, commandServerPort, {...install, ...settings});
    const ibc_exit = ibc.connected ? new Promise(exit => ibc.on('exit', exit)) : Promise.resolve();
    const timeout = (install.login_timeout || 300) * 1000;
    const host = settings.BindAddress || install.BindAddress || 'localhost';
    const ibc_socket = await createSocket(commandServerPort, host, Date.now() + timeout);
    return Object.assign(self, {
        host: 'localhost',
        port: overrideTwsApiPort,
        async open() {
            if (!ibc_socket.destroyed) return self;
            else throw Error("IBC connection already destroyed");
        },
        // close was overriden by share.js already
        async force_close(closedBy) {
            const force_quit = setTimeout(() => {
                if (!ibc_socket.destroyed) ibc_socket.destroy();
                if (!ibc.killed) ibc.kill();
            }, timeout).unref();
            await new Promise(closed => {
                if (ibc_socket.destroyed) closed();
                ibc_socket.once('close', closed);
                ibc_socket.write('STOP\n', 'utf8');
            });
            await ibc_exit;
            clearTimeout(force_quit);
        }
    });
}

async function findAvailablePort(startFrom) {
    return new Promise((ready, fail) => {
        const server = net.createServer()
          .once('error', function(err) {
            if (err.code === 'EADDRINUSE') {
                ready(findAvailablePort(startFrom+1));
            } else {
                fail(err);
            }
        }).once('listening', () => server.close())
          .once('close', () => ready(startFrom))
          .listen(startFrom);
    });
}

async function spawn(ibc_command, overrideTwsApiPort, commandServerPort, settings) {
    const ini_file = await createIniFile(overrideTwsApiPort, commandServerPort, settings);
    return new Promise((ready, fail) => {
        const args = _.rest(ibc_command).concat(ini_file, settings.TradingMode || 'live');
        logger.debug(_.first(ibc_command), ...args);
        const ibc = child_process.spawn(_.first(ibc_command), args, {
            env: _.extend({}, process.env, settings.env)
        });
        ibc.once('exit', (code, signal) => fail(Error(`IBC exited with code ${code} ${signal}`)));
        ibc.once('error', fail);
        const regex = /\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d:\d\d\d IBC: |\s+$/g;
        ibc.stdout.setEncoding('utf8').on('data', txt => {
            const entry = txt.replace(regex,'');
            if (entry) logger.log(entry);
        });
        ibc.stderr.setEncoding('utf8').on('data', txt => {
            const entry = txt.replace(regex,'');
            if (entry) logger.error(entry);
        });
        const timer = setTimeout(() => {
            ibc.kill();
            fail(Error("IBC login timed out"));
        }, (settings.login_timeout || 300) * 1000).unref();
        let port_config = false
        const onlogin = data => {
            if (data && ~data.indexOf('Performing port configuration')) {
                port_config = true;
            }
            if (port_config && data && ~data.indexOf('Configuration') && ~data.indexOf('event=Closed')) {
                clearTimeout(timer);
                pipe.removeListener('data', onlogin);
                ready(ibc);
            }
        };
        const pipe = ibc.stdout.setEncoding('utf8').on('data', onlogin);
    }).then(ibc => {
        return util.promisify(fs.unlink)(ini_file).then(() => ibc);
    }, err => {
        return util.promisify(fs.unlink)(ini_file).then(() => Promise.reject(err));
    });
}

async function createIniFile(overrideTwsApiPort, commandServerPort, settings) {
    const values = await setDefaultSettings(overrideTwsApiPort, commandServerPort, settings);
    const content = Object.keys(values).map(key => {
        return `${key}=${JSON.stringify(values[key]).replace(/^"|"$/g, '')}`;
    }).join('\r\n');
    const dir = os.tmpdir();
    const name = `ibc_${Date.now().toString(16)}.ini`;
    var file = path.resolve(dir, name);
    await util.promisify(fs.writeFile)(file, '', 'utf8');
    await util.promisify(fs.chmod)(file, fs.constants.S_IRUSR | fs.constants.S_IWUSR);
    await util.promisify(fs.writeFile)(file, content, 'utf8');
    return file;
}

async function setDefaultSettings(overrideTwsApiPort, commandServerPort, settings) {
    const {username, password} = await readAuthentication(settings);
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const default_dir = path.resolve(lib_dir, settings.IbLoginId || username || '');
    return {
        ...settings,
        IbLoginId: username || '',
        IbPassword: password || '',
        OverrideTwsApiPort: overrideTwsApiPort,
        CommandServerPort: commandServerPort,
        BindAddress: settings.BindAddress || '127.0.0.1',
        IbDir: path.resolve(settings.IbDir || default_dir)
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

async function createSocket(port, timeout) {
    return new Promise((connection, failure) => {
        const socket = net.connect(port)
          .once('connect', () => connection(socket))
          .once('error', err => {
            if (err.code != 'ECONNREFUSED') failure(err);
            else if (timeout < Date.now()) failure(err);
            else connection(delay(() => createSocket(port, timeout)));
        }).once('close', () => failure(Error("Connection closed")))
          .on('data', logger.log);
    });
}

async function delay(fn) {
    return new Promise(ready => setTimeout(ready, 500)).then(fn);
}
