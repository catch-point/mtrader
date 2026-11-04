// remote-process.spec.js
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


import {WebSocket, WebSocketServer} from 'ws';
import config from '../src/config.js';
import remote, {DEFAULT_TIMEOUT} from '../src/remote-process.js';
import like from './should-be-like.js';

describe("remote-process", function() {
    this.timeout(10000);
    const TIMEOUT = 200;
    let server, port, connections, clients;
    beforeEach(async function() {
        connections = [];
        clients = [];
        server = new WebSocketServer({port: 0, host: 'localhost'});
        server.on('connection', ws => connections.push(ws));
        await new Promise(ready => server.once('listening', ready));
        port = server.address().port;
    });
    afterEach(async function() {
        config.unset('remote.timeout');
        clients.forEach(client => client.connected && client.kill());
        connections.forEach(ws => ws.terminate());
        await new Promise(closed => server.close(closed));
    });
    function connect(socket) {
        const location = `ws://localhost:${port}/`;
        const client = socket ? remote({label: location}, socket) : remote({label: location, location});
        clients.push(client);
        client.on('error', () => {}); // a dropped connection is reported by disconnect
        return new Promise((resolve, reject) => {
            client.once('connect', () => resolve(client)).once('disconnect', () => reject(Error("disconnected")));
        });
    }
    function disconnected(client) {
        return new Promise(resolve => client.once('disconnect', resolve));
    }
    const delay = ms => new Promise(cb => setTimeout(cb, ms));
    it("should ping an idle service and stay connected while it answers", async function() {
        config('remote.timeout', TIMEOUT);
        const client = await connect();
        let pings = 0;
        connections[0].on('ping', () => pings++);
        await delay(TIMEOUT * 5);
        client.connected.should.be.true;
        pings.should.be.at.least(3);
    });
    it("should drop a service that stops responding", async function() {
        config('remote.timeout', TIMEOUT);
        const client = await connect();
        // a dead peer: nothing it is sent is read, so no pong and no close frame
        connections[0]._socket.pause();
        const start = Date.now();
        await disconnected(client);
        const elapsed = Date.now() - start;
        elapsed.should.be.at.least(TIMEOUT * 0.9);
        elapsed.should.be.below(TIMEOUT * 3);
        client.connected.should.be.false;
    });
    it("should treat other traffic as a sign of life", async function() {
        config('remote.timeout', TIMEOUT);
        const client = await connect();
        // the service never answers pings, but sends a message after each
        // ping goes out, before the next idle period would drop it
        connections[0]._socket.pause();
        const messages = [];
        client.on('message', msg => messages.push(msg));
        const timer = setInterval(() => connections[0].send(JSON.stringify({cmd: 'tick'}) + '\r\n\r\n'), TIMEOUT * 3 / 4);
        try {
            await delay(TIMEOUT * 5);
        } finally {
            clearInterval(timer);
        }
        client.connected.should.be.true;
        messages.length.should.be.at.least(5);
    });
    it("should keep the connection alive by default", async function() {
        config.unset('remote.timeout');
        const socket = new WebSocket(`ws://localhost:${port}/`);
        await connect(socket);
        DEFAULT_TIMEOUT.should.be.a('number').and.above(0);
        socket._socket.timeout.should.equal(DEFAULT_TIMEOUT / 2);
    });
});
