// iqfeed-client-faults.spec.js
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


import iqfeedClient from '../src/iqfeed-client.js';
import fakeIQFeed, {admin, lists, STATS_NOT_CONNECTED} from './fake-iqfeed.js';
import like from './should-be-like.js';

const TIMEOUTS = {connect_timeout: 500, request_timeout: 300, max_resends: 1};
const tz = 'America/New_York';

/** Resolves or rejects like promise, or rejects if it is still pending after ms */
function within(promise, ms = 2000) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => timer = setTimeout(() => reject(Error(`still pending after ${ms} ms`)), ms))
    ]).finally(() => clearTimeout(timer));
}

const delay = ms => new Promise(cb => setTimeout(cb, ms));

async function until(condition, ms = 2000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > ms) throw Error(`condition not met within ${ms} ms`);
        await delay(10);
    }
}

/** History request handler: replies to HDT requests with one daily bar */
function oneBar(line, socket) {
    const args = line.split(',');
    if (args[0] != 'HDT') return;
    const id = args[6];
    socket.write(`${id},2026-01-02,11,9,10,10.5,1000,0,\r\n${id},!ENDMSG!,\r\n`);
}

describe("iqfeed-client faults", function() {
    this.timeout(10000);
    let fake, client;
    afterEach(async function() {
        if (client) await within(client.close(), 3000);
        if (fake) await fake.stop();
        client = fake = null;
    });
    async function start(handlers, timeouts = TIMEOUTS) {
        fake = await fakeIQFeed(handlers);
        client = iqfeedClient(null, {}, null, null, {...timeouts, ports: fake.ports});
        return client;
    }
    it("should fetch daily bars when IQFeed responds normally", async function() {
        await start({admin: admin(), lookup: lists(oneBar)});
        const bars = await within(client.day('IBM', '2026-01-01', null, tz));
        bars.should.be.like([{Date_Stamp: '2026-01-02', Close: '10.5'}]);
    });
    it("should fail to open when IQConnect stays Not Connected", async function() {
        await start({admin: admin(STATS_NOT_CONNECTED)});
        await within(client.open()).should.be.rejectedWith(/did not connect within 500 ms \(Not Connected\)/);
    });
    it("should fail to open when IQConnect closes the admin connection", async function() {
        // a clean close, without an error
        await start({admin: (line, socket) => line == 'S,CONNECT' && socket.end()});
        await within(client.open()).should.be.rejectedWith(/closed the admin connection before connecting/);
    });
    it("should close while still connecting", async function() {
        await start({admin: admin(STATS_NOT_CONNECTED)}, {...TIMEOUTS, connect_timeout: 30000});
        const opening = client.open().then(() => null, err => err);
        await until(() => fake.lines('admin').includes('S,CONNECT'));
        await within(client.close(), 1500);
        (await within(opening)).should.be.an('error');
    });
    it("should fail when IQFeed never finishes a list of markets", async function() {
        await start({admin: admin(), lookup: line => {}});
        await within(client.lookup('IBM')).should.be.rejectedWith(/did not finish SLM within 300 ms/);
    });
    it("should fail when IQFeed closes the connection before finishing a list", async function() {
        await start({admin: admin(), lookup: (line, socket) => line == 'SLM' && socket.end()});
        await within(client.lookup('IBM')).should.be.rejectedWith(/closed the connection before finishing SLM/);
    });
    it("should re-send a history request once, then fail", async function() {
        await start({admin: admin(), lookup: lists()});
        await within(client.day('IBM', '2026-01-01', null, tz), 3000)
            .should.be.rejectedWith(/did not respond to HDT,IBM,20260101.* within 300 ms/);
        fake.lines('lookup').filter(line => line.startsWith('HDT,')).should.have.length(2);
    });
    it("should reconnect when IQFeed closes the lookup connection", async function() {
        let closed = false;
        await start({admin: admin(), lookup: lists((line, socket) => {
            if (!line.startsWith('HDT,')) return;
            if (closed) return oneBar(line, socket);
            closed = true;
            socket.end(); // a clean close, without an error
        })}, {...TIMEOUTS, request_timeout: 30000});
        const bars = await within(client.day('IBM', '2026-01-01', null, tz), 3000);
        bars.should.be.like([{Date_Stamp: '2026-01-02'}]);
        fake.connections.lookup.should.equal(2);
    });
    it("should not reconnect while nothing is pending", async function() {
        await start({admin: admin(), lookup: lists(oneBar)});
        await within(client.day('IBM', '2026-01-01', null, tz));
        // from now on, IQConnect drops every lookup connection
        fake.every(20, () => fake.sockets('lookup').forEach(socket => socket.end()));
        const connections = fake.connections.lookup;
        await delay(2500); // more than two reconnect delays
        fake.connections.lookup.should.equal(connections);
        // the next request reconnects
        client.day('IBM', '2026-01-01', null, tz).catch(() => {}); // fails when the test closes it
        await until(() => fake.connections.lookup > connections);
    });
    it("should not reconnect after it is closed", async function() {
        await start({admin: admin(), lookup: lists(), level1: line => {}}, {...TIMEOUTS, request_timeout: 30000});
        const fetching = client.day('IBM', '2026-01-01', null, tz).then(() => null, err => err);
        const requesting = client.fundamental('IBM').then(() => null, err => err);
        await until(() => fake.lines('lookup').some(line => line.startsWith('HDT,')));
        await until(() => fake.lines('level1').includes('tIBM'));
        await within(client.close(), 1500);
        (await within(fetching)).should.match(/IQFeed is closing/);
        (await within(requesting)).should.match(/IQFeed is closing/);
        const connections = {...fake.connections};
        await delay(1500); // longer than the reconnect delay
        fake.connections.should.eql(connections);
        client = null;
    });
    it("should fail a level 1 request IQFeed never answers", async function() {
        await start({admin: admin(), lookup: lists(), level1: line => {}});
        await within(client.fundamental('IBM')).should.be.rejectedWith(/did not respond to IBM within 300 ms$/);
    });
    it("should include the level 1 error when IQFeed reports one", async function() {
        await start({admin: admin(), lookup: lists(), level1: (line, socket) => {
            if (line == 'tIBM') socket.write('E,!SYMBOL LIMIT REACHED!,\r\n');
        }});
        await within(client.fundamental('IBM')).should.be.rejectedWith(/did not respond to IBM within 300 ms: SYMBOL LIMIT REACHED/);
    });
    it("should reject level 1 requests when it is closed", async function() {
        await start({admin: admin(), lookup: lists(), level1: line => {}}, {...TIMEOUTS, request_timeout: 30000});
        const requesting = client.fundamental('IBM').then(() => null, err => err);
        await until(() => fake.lines('level1').includes('tIBM'));
        await within(client.close(), 1500);
        (await within(requesting)).should.match(/IQFeed is closing/);
        client = null;
    });
});
