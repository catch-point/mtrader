// snapshot.js
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

const util = require('util');
const _ = require('underscore');

module.exports = Snapshot;

function Snapshot(target, stateful) {
    if (typeof target == 'function') {
        const calls = [];
        return Object.assign(function() {
            const args = _.toArray(arguments);
            const key = JSON.stringify(args);
            const call = calls.find(call => call.key == key);
            const repeat_of = !stateful && call ? call.result : null;
            const result = repeat_of || Snapshot(target.apply(this, arguments));
            const getter = JSON.parse(key)[0] == args[0] && args.length == 1;
            calls.push({key, getter, repeat: !!repeat_of, args, result});
            return result;
        }, {
            [util.inspect.custom](depth, options) {
                if (!calls.length) {
                    return '() => {}';
                } else if (!calls[0].args.length && calls.filter(call => !call.repeat).length == 1) {
                    return `() => ${util.inspect(_.first(calls).result, options)}`;
                } else if (calls.filter(call => !call.repeat).length == 1) {
                    return `(...args) => {expect(args).to.be.like(${util.inspect(calls[0].args, options)});` +
                        `return ${util.inspect(_.first(calls).result, options)};}`;
                } else if (!stateful && calls.every(call => call.getter)) {
                    const one_of = calls.map(call => call.args[0]);
                    return `(arg) => {switch(arg) {\n` +
                        calls.map(call => {
                            const key = JSON.stringify(call.args[0]);
                            return `case ${key}: return ${util.inspect(call.result, options)}`;
                        }).join('\n') +
                        `\ndefault: expect(arg).to.be.oneOf(${util.inspect(one_of, options)})` + `\n}}`;
                } else {
                    return `(()=>{let count=0;return(...args) => {switch(count++) {\n` +
                        calls.map((call, count) => {
                            const key = JSON.stringify(call.args[0]);
                            return `case ${count}: expect(args).to.be.like(${util.inspect(call.args, options)});`+
                                `return ${util.inspect(call.result, options)}`;
                        }).join('\n') +
                        `\ndefault: throw Error("Too many times")` + `\n}}})()`;
                }
            }
        });
    } else if (target instanceof Promise) {
        let resolved, rejected;
        return Object.assign(target.then(value => {
            return resolved = Snapshot(value);
        }, err => {
            rejected = err;
            throw err;
        }), {
            [util.inspect.custom](depth, options) {
                if (rejected) return `Promise.reject(Error(${JSON.stringify(rejected.message)}))`;
                else if (resolved === undefined) return `Promise.resolve()`;
                else return `Promise.resolve(${util.inspect(resolved, options)})`;
            }
        });
    } else if (Array.isArray(target)) {
        return target.map(value => Snapshot(value));
    } else if (target && typeof target == 'object') {
        const mock_code = {};
        return new Proxy(target, {
            get(target, prop, receiver) {
                if (prop == util.inspect.custom) {
                    return function(depth, options) {
                        return mock_code;
                    };
                } else if (prop == 'constructor') { // call by util.inspect
                    return target[prop];
                } else {
                    return target[prop] === undefined ? target[prop] :
                        (mock_code[prop] = mock_code[prop] || Snapshot(target[prop]));
                }
            }
        });
    } else {
        return target;
    }
}
