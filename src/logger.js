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

var colours = {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    reset: '\b\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    underscore: '\x1b[4m',
    blink: '\x1b[5m',
    reverse: '\x1b[7m',
    hidden: '\x1b[8m',
    dim_blue: '\x1b[2m\x1b[34m'
}

var logger = module.exports = {
    debug: !silent && debugging ? debug : nil,
    log: !silent && verbose ? verbose : nil,
    info: !silent ? info : nil,
    warn: !silent ? warn : nil,
    error: error
};

config.addListener((name, value) => {
    if (name == 'verbose')
        logger.log = value ? verbose : nil;
    if (name == 'debug')
        logger.debug = value ? debug: nil
    if (name == 'silent')
        logger.info = !value ? info: nil;
    if (name == 'silent')
        logger.warn = !value ? debug : nil;
});

function verbose() {
    return logWithColour(colours.dim, Array.prototype.slice.call(arguments, 0));
}

function debug() {
    return logWithColour(colours.dim_blue, Array.prototype.slice.call(arguments, 0));
}

function info() {
    return logWithColour(colours.cyan, Array.prototype.slice.call(arguments, 0));
}

function warn() {
    return logWithColour(colours.yellow, Array.prototype.slice.call(arguments, 0));
}

function error() {
    return logWithColour(colours.red, Array.prototype.slice.call(arguments, 0));
}

function logWithColour(colour, args) {
    if (typeof args[0] == 'string') args[0] = colour + args[0];
    else args.unshift(colour);
    args.push(colours.reset);
    return console.error.apply(console, args);
}

function nil() {
    // silence
}
