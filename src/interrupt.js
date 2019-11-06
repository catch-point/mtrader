// interrupt.js
/*
 *  Copyright (c) 2017-2018 James Leigh, Some Rights Reserved
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

/**
 * If SIGINT or SIGTERM was triggered, betwen callings this function and calling
 * its returned function, will return a promise of returnValue or reject an error.
 * Every 100k calls to any of the returned functions will await to check if a
 * SIGINT/SIGTERM was called.
 */
module.exports = function(returnValue) {
    const base = interrupted;
    if (arguments.length) return async() => {
        await delay();
        if (base != interrupted) return returnValue;
    }; else return async() => {
        await delay();
        if (base != interrupted) throw Error(signal);
    };
}

let signal;
let interrupted = 0;

process.setMaxListeners(process.getMaxListeners()+1);

process.on('SIGINT', () => {
    signal = 'SIGINT';
    interrupted++;
}).on('SIGTERM', () => {
    signal = 'SIGTERM';
    interrupted++;
});

const delay = debounce(() => {
    return new Promise(cb => setTimeout(cb, 1));
}, 100000, Promise.resolve());

function debounce(fn, ticks, initial) {
    let clock = 0;
    let result = initial;
    let until = ticks + clock;
    return function() {
        const now = clock++;
        if (now < until) return result;
        until = ticks + now;
        return result = fn.apply(this, arguments);
    };
}
