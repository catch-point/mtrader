#!/usr/bin/env -S node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-pending.js
/*
 *  Copyright (c) 2020-2021 James Leigh, Some Rights Reserved
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

import _ from 'underscore';
import isMainModule from './is-main-module.js';
import moment from 'moment-timezone';
import * as commander from 'commander';
import merge from './merge.js';
import logger from './logger.js';
import tabular from './tabular.js';
import remote from './remote-process.js';
import replyTo from './promise-reply.js';
import Config from './mtrader-config.js';
import config from './config.js';
import shellError from './shell-error.js';
import version from './version.js';
import MTrader from './mtrader.js';

function usage(command) {
    return command.version(version.version)
    .description("Lists pending queues in the hosting service")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-q, --quiet', "Include less information about what the system is doing")
    .option('-x, --debug', "Include details about what the system is working on")
    .option('-X', "Hide details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--config-dir <dirname>', "Directory where stored sessions are kept")
    .option('--cache-dir <dirname>', "Directory where processed data is kept")
    .option('--load <filename>', "Read the given session settings")
    .option('--set <name=value>', "Name=Value pairs to be used in session");
}

process.setMaxListeners(process.getMaxListeners()+1);

const Pending = function(settings = {}) {
    settings = {...settings, ...config('remote')};
    const address = settings.listen;
    if (!address) throw Error("Service listen address is required to connect to service");
    const worker = replyTo(remote({...settings, location: settings.listen, checkServerIdentity: _.noop}))
        .on('error', err => logger.debug(err, err.stack))
        .on('error', () => worker.disconnect());
    return function(options = {}) {
        return new Promise((ready, abort) => {
            process.on('SIGINT', abort);
            process.on('SIGTERM', abort);
            worker.request('pending').then(ready, abort);
        }).then(result => {
            worker.disconnect();
            return result;
        }, err => {
            worker.disconnect();
            throw err;
        }).then(result => tabular(result, config()))
        .catch(err => logger.error(err, err.stack) || (process.exitCode = 1));
    };
}

if (isMainModule(import.meta)) {
    const program = usage(commander.program).allowExcessArguments().parse(process.argv);
    const agent = new Pending();
    agent().catch(err => err && err.stack && logger.debug(err, err.stack));
}

export default Pending;
