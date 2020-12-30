// time-limit.js
/*
 *  Copyright (c) 2020 James Leigh, Some Rights Reserved
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

const fs = require('graceful-fs');
const path = require('path');
const util = require('util');
const _ = require('underscore');

/**
 * Wraps a function and return a promise that will resolve within the time limit
 */
module.exports = function(limit_ms) { // new TimeLimit
    const interval = Math.min(limit_ms, 1000), active = [];
    let pulse_timeout, pulse_counter = 0;
    return Object.assign(function(fn, label_fn) { // wrap given function
        return function() { // function called
            return new Promise((ready, abort) => { // promise resolution or timeout
                const label = typeof label_fn == 'function' ?
                        label_fn.apply(this, arguments) : label_fn || fn.name;
                const entry = {
                    label,
                    self: this, args: Array.from(arguments),
                    expires: pulse_counter +limit_ms,
                    ontimeout: () => Promise.reject(Error(`${label} time limit has been reached`)),
                    ready, abort
                };
                active.push(entry);
                if (!pulse_timeout) pulse_timeout = setTimeout(pulse, interval).unref();
                return Promise.resolve()
                  .then(() => fn.apply(this, arguments))
                  .then(result => {
                    const idx = active.indexOf(entry);
                    if (~idx) active.splice(idx, 1);
                    return ready(result);
                }, err => {
                    const idx = active.indexOf(entry);
                    if (~idx) active.splice(idx, 1);
                    return abort(err);
                });
            });
        };
    }, {
        pending() {
            return active.map(entry => ({label: entry.label, args: entry.args}));
        },
        close() {
            if (pulse_timeout) clearTimeout(pulse_timeout);
            return Promise.all(active.splice(0, active.length).map(entry => {
                return Promise.resolve()
                  .then(() => entry.ontimeout.apply(entry.self, entry.args))
                  .then(entry.ready, entry.abort);
            }));
        }
    });
    function pulse() {
        pulse_counter+= interval;
        _.defer(() => {
            const expired = active.filter(entry => entry.expires < pulse_counter);
            expired.forEach(entry => {
                Promise.resolve()
                  .then(() => entry.ontimeout.apply(entry.self, entry.args))
                  .then(entry.ready, entry.abort);
                const idx = active.indexOf(entry);
                if (~idx) active.splice(idx, 1);
            });
            if (active.length) pulse_timeout = setTimeout(pulse, interval).unref();
            else pulse_timeout = null;
        });
    }
};
