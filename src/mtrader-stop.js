#!/usr/bin/env -S node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-stop.js
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
const commander = require('commander');
const logger = require('./logger.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const config = require('./config.js');
const version = require('./version.js');

function usage(command) {
    return command.version(version.version)
    .description("Stops a headless service using the listen interface")
    .option('-V, --version', "Output the version number(s)")
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

module.exports = function(settings = {}) {
    settings = {...settings, ...config('remote')};
    const address = settings.listen;
    if (!address) throw Error("Service listen address is required to stop service");
    const worker = replyTo(remote({...settings, location: settings.listen, checkServerIdentity: _.noop}))
        .on('error', err => logger.debug(err, err.stack))
        .on('error', () => worker.disconnect());
    return function(options = {}) {
        return new Promise((stopped, abort) => {
            process.on('SIGINT', abort);
            process.on('SIGTERM', abort);
            worker.handle('stop', stopped).request('stop').catch(abort);
        }).then(() => worker.disconnect(), err => {
            worker.disconnect();
            throw err;
        });
    };
}

if (require.main === module) {
    const program = usage(commander).parse(process.argv);
    const agent = new module.exports();
    agent().catch(err => err && err.stack && logger.debug(err, err.stack));
}
