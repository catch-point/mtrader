// remote-process.js
/*
 *  Copyright (c) 2017 James Leigh, Some Rights Reserved
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

const ws = require('ws');
const EventEmitter = require('events');
const _ = require('underscore');
const expect = require('chai').expect;
const logger = require('./logger.js');
const AssertionError = require('chai').AssertionError;
const minor_version = require('../package.json').version.replace(/^(\d+\.\d+).*$/,'$1.0');

const EOM = '\r\n\r\n';

const PATH = '/ptrading/' + minor_version + '/workers';

var remote = module.exports = function(socket, label) {
    if (typeof socket == 'string' && ~socket.indexOf('://'))
        return remote(new ws(socket), label || socket);
    if (typeof socket == 'string')
        return remote(new ws('ws://' + socket + PATH), label || socket);
    var buf = '';
    var emitter = new EventEmitter();
    socket.on('open', (code, reason) => {
        emitter.connecting = false;
        emitter.connected = true;
        emitter.emit('connect');
    }).on('message', data => {
        try {
            var chunks = data.split('\r\n\r\n');
            if (buf) chunks[0] = buf + chunks[0];
            buf = chunks.pop();
            if (_.isEmpty(chunks) && ~buf.indexOf(EOM)) {
                chunks = chunks.concat(buf.split(EOM));
                buf = chunks.pop();
            }
            chunks.forEach(chunk => emitter.emit('message', JSON.parse(chunk)));
        } catch(err) {
            socket.close();
            emitter.emit('error', err);
        }
    }).on('close', (code, reason) => {
        try {
            if (buf) emitter.emit('message', JSON.parse(buf));
        } catch(err) {
            emitter.emit('error', err);
        }
        emitter.connecting = false;
        emitter.connected = false;
        emitter.emit('disconnect');
    }).on('error', err => {
        emitter.emit('error', err);
    });
    emitter.remote = true;
    emitter.pid = label || '';
    emitter.send = (message, onerror) => socket.send(JSON.stringify(message) + EOM, onerror);
    emitter.disconnect = () => socket.close();
    emitter.kill = () => socket.terminate();
    return _.extend(emitter, {
        get connected() {
            return socket.readyState == 1;
        },
        get connecting() {
            return socket.readyState === 0;
        }
    });
};

function parseAddressPort(addr) {
    expect(addr).to.be.a('string');
    var port = addr.match(/:\d+$/) ? parseInt(addr.substring(addr.lastIndexOf(':')+1)) :
        addr.match(/^\d+$/) ? parseInt(addr) : 0;
    var address = addr.match(/^\[.*\]:\d+$/) ? addr.substring(1, addr.lastIndexOf(':')-1) :
        addr.match(/:\d+$/) ? addr.substring(0, addr.lastIndexOf(':')) :
        addr.match(/^\d+$/) ? null : addr;
    return {address, port};
}
