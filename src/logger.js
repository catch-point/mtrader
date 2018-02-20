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
const _ = require('underscore');
const config = require('./config.js');

var relative = path.relative(process.cwd(), path.dirname(__filename));
var quiet = process.argv.some(arg => /^--quiet$|^-\w*q/.test(arg));
var verbosity = !relative || relative == 'src' || process.argv.some(arg => /^--verbose$|^-\w*v/.test(arg));
var debugging = !relative || relative == 'src' || process.argv.some(arg => /^--debug$|^-\w*x/.test(arg));
var noDebugging = process.argv.some(arg => /^-\w*X/.test(arg));

var tty_colours = {
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
    hidden: '\x1b[8m'
};

var colours = process.stderr.isTTY ? tty_colours : _.mapObject(tty_colours, _.constant(''));

var logger = module.exports = cfg('quiet', quiet) ? {
    trace: nil,
    debug: nil,
    log: nil,
    info: nil,
    warn: nil,
    error: error
} : {
    trace: cfg('trace', false) ? trace : nil,
    debug: cfg('debug', debugging && !noDebugging) ? debug : nil,
    log: cfg('verbose', verbosity) ? verbose : nil,
    info: info,
    warn: warn,
    error: error
};

process.on('SIGINT', () => {
    logger.log = nil;
    logger.info = nil;
    logger.warn = nil;
    logger.error = nil;
}).on('SIGTERM', () => {
    logger.log = nil;
    logger.info = nil;
    logger.warn = nil;
    logger.error = nil;
}).on('SIGHUP', () => {
    if (cfg('quiet', quiet)) {
        logger.trace = nil;
        logger.debug = nil;
        logger.log = nil;
        logger.info = nil;
        logger.warn = nil;
    } else {
        logger.trace = cfg('trace', false) ? trace : nil;
        logger.debug = cfg('debug', debugging && !noDebugging) ? debug: nil;
        logger.log = cfg('verbose', verbosity) ? verbose : nil;
        logger.info = info;
        logger.warn = warn;
    }
});

function cfg(name, def) {
    var bool = config(name);
    return bool == null ? def : bool;
}

function trace() {
    return logWithColour(colours.magenta, Array.prototype.slice.call(arguments, 0));
}

function debug() {
    return logWithColour(colours.blue, Array.prototype.slice.call(arguments, 0));
}

function verbose() {
    return logWithColour(colours.dim, Array.prototype.slice.call(arguments, 0));
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
