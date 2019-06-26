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
const share = require('./share.js');
const ib = require('./ib-client.js');
const config = require('./config.js');
const logger = require('./logger.js');

const private_settings = ['ibg_version', 'IbLoginId', 'IbPassword', 'auth_base64', 'auth_file'];
const instances = {};

module.exports = function(settings) {
    const json = private_settings.filter(key => key in settings).map(key => [key, settings[key]]);
    const key = crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
    const shared = instances[key] = instances[key] || share(createInstance, () => {
        delete instances[key];
    });
    return shared(settings);
};

function createInstance(settings) {
    if (!settings || !settings.ibg_version) return new ib(settings);
    const install = (config('ibgateway_installs')||[])
      .find(inst => inst.ibg_version == settings.ibg_version);
    if (!install) throw Error(`IB Gateway ${ibg_version} is not installed or configured correctly`);
    const self = new.target ? this : {};
    return Object.assign(self, {
        async open() {
            const client = await promiseInitializedInstance(self, settings);
            return client.open();
        },
        async close() {
            // don't do anything until instance is initialized
            return Promise.resolve();
        }
    });
}

let initialization_lock = Promise.resolve();

async function promiseInitializedInstance(self, settings) {
    return initialization_lock = initialization_lock.catch(err => logger.trace).then(() => {
        return promiseInstance(self, settings);
    });
}

async function promiseInstance(self, settings) {
    const install = (config('ibgateway_installs')||[])
      .find(inst => inst.ibg_version == settings.ibg_version);
    if (install.name) logger.info(`Launching ${install.name}`);
    const overrideTwsApiPort = settings.OverrideTwsApiPort || settings.port || await findAvailablePort(4001);
    const commandServerPort = settings.CommandServerPort || await findAvailablePort(7462);
    const ibc = await spawn(install.ibc_command, overrideTwsApiPort, commandServerPort, {...install, ...settings});
    const timeout = (install.login_timeout || 90) * 1000;
    const host = settings.BindAddress || install.BindAddress || 'localhost';
    const ibc_socket = await createSocket(commandServerPort, host, Date.now() + timeout);
    const client = new ib({
        ..._.omit(settings, private_settings),
        host: settings.host || 'localhost',
        port: overrideTwsApiPort
    });
    const shared_close = self.close;
    return Object.assign(self, _.mapObject(client, (fn, name) => {
        if (name == 'close') return async function(closedBy) {
            await client.close(closedBy);
            await new Promise(closed => {
                if (ibc.connected) ibc.once('close', closed);
                else closed();
                if (!ibc_socket.destroyed) ibc_socket.write('STOP\n', 'utf8');
            });
            if (!ibc_socket.destroyed) ibc_socket.destroy();
            if (!ibc.killed) ibc.kill();
            return shared_close.apply(self, arguments);
        }
        else return fn.bind(client);
    }));
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
        ibc.stdout.setEncoding('utf8').on('data', logger.log);
        ibc.stderr.setEncoding('utf8').on('data', logger.error);
        const timer = setTimeout(() => {
            ibc.kill();
            fail(Error("IBC login timed out"));
        }, (settings.login_timeout || 90) * 1000);
        const onlogin = data => {
            if (data && ~data.indexOf('IBC: Login completed')) {
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
    const readFile = util.promisify(fs.readFile);
    const auth_file = path.resolve(config('prefix'), 'etc', settings.auth_file);
    const token = settings.auth_base64 ? settings.auth_base64 :
        settings.auth_file ? (await readFile(auth_file, 'utf8')||'').trim() : '';
    const [username, password] = new Buffer.from(token, 'base64').toString().split(/:/, 2);
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const default_dir = path.resolve(lib_dir, settings.IbLoginId || username || '');
    return {
        ...settings,
        IbLoginId: settings.IbLoginId || username || '',
        IbPassword: settings.IbPassword || password || '',
        OverrideTwsApiPort: overrideTwsApiPort,
        CommandServerPort: commandServerPort,
        BindAddress: settings.BindAddress || '127.0.0.1',
        IbDir: path.resolve(settings.IbDir || default_dir)
    };
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
