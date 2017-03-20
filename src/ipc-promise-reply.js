// ipc-promise-reply.js
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

const _ = require('underscore');
const AssertionError = require('chai').AssertionError;
const logger = require('./logger.js');

module.exports = function(process) {
    var seq = 0;
    var outstanding = {};
    var handlers = {};
    process.on('message', msg => {
        if (msg.cmd.indexOf('reply_to_') === 0 && outstanding[msg.in_reply_to]) {
            var pending = outstanding[msg.in_reply_to];
            try {
                if (!_.has(msg, 'error'))
                    return pending.onresponse(msg.payload);
                else if (!_.isObject(msg.error))
                    return pending.onerror(Error(msg.error));
                else if (msg.error.name == 'AssertionError')
                    return pending.onerror(new AssertionError(
                        msg.error.message + '\n' + _.rest(msg.error.stack.split('\n')).join('\n'),
                        msg.error));
                else
                    return pending.onerror(Error(msg.error.message));
            } catch (err) {
                return pending.onerror(err);
            } finally {
                delete outstanding[msg.in_reply_to];
            }
        } else if (handlers[msg.cmd]) {
            Promise.resolve(msg.payload).then(handlers[msg.cmd]).then(response => {
                if (msg.id) process.send({
                    cmd: 'reply_to_' + msg.cmd,
                    in_reply_to: msg.id,
                    payload: response
                });
            }, err => {
                if (msg.id) process.send({
                    cmd: 'reply_to_' + msg.cmd,
                    in_reply_to: msg.id,
                    error: serializeError(err)
                });
            });
        }
    });
    return {
        disconnect() {
            if (process.connected) return process.disconnect();
        },
        kill: process.kill.bind(process),
        on: process.on.bind(process),
        send(cmd, payload) {
            return new Promise(cb => process.send({
                cmd: cmd,
                payload: payload
            }, cb)).then(err => {
                if (err) throw err;
            });
        },
        request(cmd, payload) {
            return new Promise((response, error) => {
                var id = nextId(cmd);
                outstanding[id] = {
                    onresponse: response,
                    onerror: error
                };
                process.send({
                    cmd: cmd,
                    id: id,
                    payload: payload
                }, err => {
                    if (err) error(err);
                });
            });
        },
        handle(cmd, handler) {
            handlers[cmd] = handler;
            return this;
        },
        removeHandler(cmd, handler) {
            if (!handlers[cmd] || handler && handler != handlers[cmd])
                return false;
            delete handlers[cmd];
            return true;
        },
        process: process
    };

    function nextId(prefix) {
        var id;
        do {
            id = prefix + (++seq).toString(16);
        } while(outstanding[id]);
        return id;
    }
};

function serializeError(err) {
    try {
        if (err && _.isFunction(err.toJSON))
            return err.toJSON();
    } catch (e) {
        logger.error(e, e.stack);
    }
    if (err && err.stack)
        return err.stack;
    return err && err.message || err || true;
}
