// fake-iqfeed.js
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

export const STATS_CONNECTED = 'S,STATS,66.112.148.225,60003,500,0,1,0,0,0,Nov 04 10:00AM,Nov 04 10:00AM,Connected,6.2.0.25,123,0,0,0,0,0,0';
export const STATS_NOT_CONNECTED = 'S,STATS,,,0,0,1,0,0,0,,,Not Connected,6.2.0.25,,0,0,0,0,0,0';

/**
 * A stand-in for IQConnect's admin, lookup and level 1 ports, for testing how
 * the client copes when IQFeed misbehaves. handlers maps each role (admin,
 * lookup, level1) to a function called with every line received, the socket
 * it came on and the fake. Each role listens on a free local port; pass
 * fake.ports to the client as its ports option. Lines, connections and
 * sockets are kept by role.
 */
export default async function fakeIQFeed(handlers) {
    const received = [];
    const connections = {};
    const timers = new Set();
    const ports = {};
    const listening = await Promise.allSettled(Object.entries(handlers).map(([role, onLine]) => {
        const sockets = new Set();
        connections[role] = 0;
        const server = net.createServer(socket => {
            connections[role]++;
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket)).on('error', () => {});
            let buf = '';
            socket.setEncoding('utf8');
            socket.on('data', data => {
                buf += data;
                let idx;
                while ((idx = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    received.push({role, line});
                    onLine(line, socket, fake);
                }
            });
        });
        return new Promise((ready, fail) => {
            server.once('error', fail).listen(0, '127.0.0.1', () => {
                ports[role] = server.address().port;
                ready({role, server, sockets});
            });
        });
    }));
    const servers = listening.filter(r => r.status == 'fulfilled').map(r => r.value);
    const failed = listening.find(r => r.status == 'rejected');
    if (failed) {
        await Promise.all(servers.map(({server}) => new Promise(closed => server.close(closed))));
        throw failed.reason;
    }
    const fake = {
        received,
        connections,
        ports,
        lines: role => received.filter(r => r.role == role).map(r => r.line),
        sockets: role => Array.from((servers.find(entry => entry.role == role) || {sockets: []}).sockets),
        every(ms, fn) {
            const timer = setInterval(fn, ms);
            timers.add(timer);
            return timer;
        },
        async stop() {
            timers.forEach(clearInterval);
            await Promise.all(servers.map(({server, sockets}) => {
                sockets.forEach(socket => socket.destroy());
                return new Promise(closed => server.close(closed));
            }));
        }
    };
    return fake;
}

/** Admin port handler: reports the given status every 100 ms after S,CONNECT */
export function admin(stats = STATS_CONNECTED) {
    return (line, socket, fake) => {
        if (line != 'S,CONNECT') return;
        const timer = fake.every(100, () => socket.writable && socket.write(stats + '\r\n'));
        socket.on('close', () => clearInterval(timer));
    };
}

/** Lookup port handler: answers SLM and SST, passing other lines to next */
export function lists(next = () => {}) {
    return (line, socket, fake) => {
        if (line == 'SLM') socket.write('1,NYSE,New York Stock Exchange\r\n!ENDMSG!,\r\n');
        else if (line == 'SST') socket.write('1,EQUITY,Equity\r\n!ENDMSG!,\r\n');
        else if (!line.startsWith('S,')) next(line, socket, fake);
    };
}
