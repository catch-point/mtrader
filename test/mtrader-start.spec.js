// mtrader-start.spec.js
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


import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import _ from 'underscore';
import config from '../src/config.js';
import version from '../src/version.js';
import remote from '../src/remote-process.js';
import replyTo from '../src/promise-reply.js';
import Start from '../src/mtrader-start.js';
import like from './should-be-like.js';
import createTempDir from './create-temp-dir.js';

describe("mtrader-start", function() {
    this.timeout(60000);
    let port, server, client;
    before(async function() {
        config('prefix', createTempDir('mtrader-start'));
        config('runInBand', true);
        config('fetch.files.enabled', true);
        config('fetch.files.dirname', path.resolve(import.meta.dirname, 'data'));
        ['ib', 'iqfeed', 'ivolatility', 'yahoo', 'remote'].forEach(name => {
            config(`fetch.${name}.enabled`, false);
        });
        port = await freePort();
        server = Start({listen: `localhost:${port}`});
        await new Promise((ready, fail) => server.once('listening', ready).once('error', fail));
        client = await connect(`ws://localhost:${port}`);
    });
    after(async function() {
        if (client) client.process.disconnect();
        if (server) await server.close();
        config.unset('fetch');
        config.unset('runInBand');
        config.unset('prefix');
    });
    it("should answer plain HTTP requests with 404", async function() {
        const response = await get(`http://localhost:${port}/`);
        response.statusCode.should.equal(404);
        response.headers.server.should.equal(`mtrader/${version}`);
        response.body.should.match(/^Try using mtrader\//);
    });
    it("should turn away websockets on another path as a version mismatch", async function() {
        const err = await connect(`ws://localhost:${port}/other/path`).then(c => {
            c.process.disconnect();
            return null;
        }, err => err);
        err.should.be.an('error');
        err.message.should.match(/^Version mismatch mtrader\//);
    });
    it("should report its version", function() {
        return client.request('version').should.eventually.equal(version.toString());
    });
    it("should report its worker count", function() {
        return client.request('worker_count').should.eventually.be.a('number').and.above(0);
    });
    it("should report its time zone", function() {
        return client.request('tz').should.eventually.be.a('string').and.not.be.empty;
    });
    it("should list no pending requests", function() {
        return client.request('pending').should.eventually.be.an('array');
    });
    it("should fetch daily bars from the files source", function() {
        return client.request('fetch', {
            interval: 'day',
            symbol: 'SPY', market: 'NYSE',
            begin: '2017-01-03', end: '2017-01-07',
            tz: 'America/New_York'
        }).then(bars => bars.map(bar => ({ending: bar.ending, close: +bar.close.toFixed(2)}))).should.eventually.be.like([
            {ending: /^2017-01-03/, close: 225.24},
            {ending: /^2017-01-04/, close: 226.58},
            {ending: /^2017-01-05/, close: 226.4},
            {ending: /^2017-01-06/, close: 227.21}
        ]);
    });
    it("should reject requests with credentials it does not expect", async function() {
        const secured = Start({listen: `ws://user:secret@localhost:${await freePort()}`});
        await new Promise(ready => secured.once('listening', ready));
        try {
            const p = secured.address().port;
            const wrong = await connect(`ws://user:wrong@localhost:${p}`).then(c => {
                c.process.disconnect();
                return null;
            }, err => err);
            wrong.should.be.an('error');
            wrong.message.should.match(/Wrong credentials|401/);
            const right = await connect(`ws://user:secret@localhost:${p}`);
            await right.request('version').should.eventually.equal(version.toString());
            right.process.disconnect();
        } finally {
            await secured.close();
        }
    });
});

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer().once('error', reject).listen(0, 'localhost', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function connect(location) {
    return new Promise((resolve, reject) => {
        const connection = remote({location, label: location});
        const client = replyTo(connection).handle('stop', () => connection.disconnect());
        connection.once('connect', () => resolve(client))
            .once('error', reject)
            .once('disconnect', () => reject(Error(`disconnected from ${location}`)));
    });
}

function get(location) {
    return new Promise((resolve, reject) => {
        http.get(location, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => body += chunk);
            response.on('end', () => resolve({...response, statusCode: response.statusCode, headers: response.headers, body}));
        }).on('error', reject);
    });
}
