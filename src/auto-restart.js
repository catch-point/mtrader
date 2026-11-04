// auto-restart.js
/*
 *  Copyright (c) 2022 James Leigh, Some Rights Reserved
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
import logger from './logger.js';

/**
 * Given a factory function and time limit, where the factory function
 * returns an object of async functions, this factory function returns a wrapped
 * object and recreates it (and calls again) when time limit is reached on a
 * async response. A call that reaches the time limit again after max_restarts
 * restarts fails instead. Closing an object (to restart it or on close) waits
 * at most limit_ms, up to 30 seconds, so a close that never finishes cannot
 * block the restart.
 */
export default function(factory, limit_ms, label_fn, max_restarts = Infinity) { // new AutoRestart factory
    return function() { // new object wrapper instance
        const interval = Math.min(limit_ms, 1000), active = [];
        const close_limit = Math.min(limit_ms, 30000);
        const factory_this = this, factory_args = Array.from(arguments);
        const object = factory.apply(factory_this, factory_args), self = new.target ? this : {};
        let closed = false, restarting = false, pulse_timeout, pulse_counter = 0;
        let promise_object = Promise.resolve(object);
        return Object.assign(self, _.mapObject(object, (fn, cmd) => _.isFunction(fn) ? async function() {
            const label = typeof label_fn == 'function' ? label_fn.apply(this, arguments) : `${label_fn}.${cmd}`;
            if (closed) throw Error(`${label} has been closed`);
            return new Promise((ready, abort) => {
                const entry = {
                    label,
                    cmd, args: Array.from(arguments),
                    expires: pulse_counter +limit_ms,
                    restarts: 0,
                    ready, abort
                };
                active.push(entry);
                ignite(entry);
                if (!pulse_timeout) pulse_timeout = setTimeout(pulse, interval).unref();
            });
        } : fn), {
            pending() {
                return active.map(entry => ({label: entry.label, args: entry.args}));
            },
            async close() {
                closed = true;
                if (pulse_timeout) clearTimeout(pulse_timeout);
                const object = await promise_object;
                if (_.isFunction(object.close)) await closeWithin(object, arguments);
                return Promise.all(active.splice(0, active.length).map(entry => {
                    return Promise.reject(Error(`${entry.label} is being closed`))
                      .then(entry.ready, entry.abort);
                }));
            }
        });

        function ignite(entry) {
            return promise_object.then(object => {
                return Promise.resolve().then(() => object[entry.cmd].apply(object, entry.args))
                  .then(result => {
                    const idx = active.indexOf(entry);
                    if (~idx) active.splice(idx, 1);
                    return entry.ready(result);
                }, async(err) => {
                    if (object === await promise_object) {
                        // only fail if object hasn't changed
                        const idx = active.indexOf(entry);
                        if (~idx) active.splice(idx, 1);
                        return entry.abort(err);
                    }
                });
            });
        }

        async function closeWithin(object, args) {
            let timer;
            const timeout = new Promise(cb => timer = setTimeout(cb, close_limit, 'timeout'));
            const result = await Promise.race([
                Promise.resolve().then(() => object.close.apply(object, args || [])),
                timeout
            ]).finally(() => clearTimeout(timer));
            if (result == 'timeout') {
                const label = typeof label_fn == 'string' ? label_fn : 'object';
                logger.warn(`${label} did not close within ${close_limit} ms`);
            }
        }

        function pulse() {
            pulse_counter+= interval;
            _.defer(() => {
                const expired = active.filter(entry => entry.expires < pulse_counter);
                if (expired.length && !closed) {
                    // calls that have been restarted enough times fail
                    expired.filter(entry => entry.restarts >= max_restarts).forEach(entry => {
                        active.splice(active.indexOf(entry), 1);
                        entry.abort(Error(`${entry.label} did not respond within ${limit_ms} ms`));
                    });
                }
                if (active.some(entry => entry.expires < pulse_counter) && !closed) {
                    promise_object = promise_object.then(async(object) => {
                        if (!closed && _.isFunction(object.close)) await closeWithin(object).catch(_.noop);
                        if (!closed) return factory.apply(factory_this, factory_args);
                        else return object;
                    });
                    active.forEach(entry => {
                        if (entry.expires < pulse_counter) entry.restarts++;
                        entry.expires = pulse_counter +limit_ms;
                        ignite(entry); // call again on new object
                    });
                }
                if (active.length && !closed) pulse_timeout = setTimeout(pulse, interval).unref();
                else pulse_timeout = null;
            });
        }
    };
};
