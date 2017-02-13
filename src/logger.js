// logger.js
/*
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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

const path = require('path');
const process = require('process');
const config = require('./config.js');

var silent = process.argv.some(arg => /^--silent$|^-\w*s/.test(arg)) || config('silent');
var verbose = process.argv.some(arg => /^--verbose$|^-\w*v/.test(arg)) || config('verbose');
var relative = path.relative(process.cwd(), path.dirname(__filename));
var debugging = !relative || relative == 'src' || process.argv.indexOf('--debug') >= 0 || config('debug');

var logger = module.exports = {
    debug: !silent && debugging ? console.error.bind(console) : () => {},
    log: !silent && verbose ? console.error.bind(console) : () => {},
    info: !silent ? console.error.bind(console) : () => {},
    warn: console.error.bind(console),
    error: console.error.bind(console)
};

config.addListener((name, value) => {
    if (name == 'verbose')
        logger.log = value ? console.error.bind(console) : () => {};
    if (name == 'debug')
        logger.debug = value ? console.error.bind(console) : () => {};
    if (name == 'silent')
        logger.info = !value ? console.error.bind(console) : () => {};
});
