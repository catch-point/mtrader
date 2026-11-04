// auto-restart.spec.js
/*
 *  Copyright (c) 2026 James Leigh, Some Rights Reserved
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


import autoRestart from '../src/auto-restart.js';
import like from './should-be-like.js';

const never = () => new Promise(() => {});

/** A factory whose nth object (from 0) is built by objects[n], or the last one */
function factoryOf(...objects) {
    const factory = function() {
        const n = factory.created++;
        return objects[Math.min(n, objects.length - 1)]();
    };
    factory.created = 0;
    return factory;
}

function within(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => timer = setTimeout(() => reject(Error(`still pending after ${ms} ms`)), ms))
    ]).finally(() => clearTimeout(timer));
}

describe("auto-restart", function() {
    this.timeout(10000);
    it("should restart a call that times out and answer it from the new object", async function() {
        const factory = factoryOf(
            () => ({call: never, close: async() => {}}),
            () => ({call: async(x) => x * 2, close: async() => {}})
        );
        const wrapper = new (autoRestart(factory, 100, 'test'))();
        await within(wrapper.call(21), 2000).should.eventually.equal(42);
        factory.created.should.equal(2);
        await wrapper.close();
    });
    it("should fail a call that still times out after max_restarts restarts", async function() {
        const factory = factoryOf(() => ({call: never, close: async() => {}}));
        const wrapper = new (autoRestart(factory, 100, 'test', 1))();
        await within(wrapper.call(), 2000).should.be.rejectedWith(/test.call did not respond within 100 ms/);
        factory.created.should.equal(2);
        wrapper.pending().should.be.empty;
        await wrapper.close();
    });
    it("should restart even when the old object never finishes closing", async function() {
        const factory = factoryOf(
            () => ({call: never, close: never}),
            () => ({call: async() => 'answered', close: async() => {}})
        );
        const wrapper = new (autoRestart(factory, 100, 'test'))();
        await within(wrapper.call(), 2000).should.eventually.equal('answered');
        await wrapper.close();
    });
    it("should close even when the object never finishes closing", async function() {
        const factory = factoryOf(() => ({call: never, close: never}));
        const wrapper = new (autoRestart(factory, 5000, 'test'))();
        const calling = wrapper.call().then(() => null, err => err);
        await within(wrapper.close(), 6000);
        (await calling).should.match(/test is being closed|test.call is being closed/);
    });
});
