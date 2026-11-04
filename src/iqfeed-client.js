// iqfeed-client.js
/*
 *  Copyright (c) 2014-2021 James Leigh, Some Rights Reserved
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

import net from 'net';
import _ from 'underscore';
import childProcess from 'child_process';
import moment from 'moment-timezone';
import logger from './logger.js';
import promiseThrottle from './throttle.js';
import interrupt from './interrupt.js';
import like from './like.js';
import assert from 'node:assert';
const spawn = childProcess.spawn;

/** Milliseconds to wait for IQConnect to accept a connection and report it is connected */
export const DEFAULT_CONNECT_TIMEOUT = 60000;
/**
 * Milliseconds a request may go without any response from IQFeed before it is
 * re-sent (history) or fails (lists and level 1)
 */
export const DEFAULT_REQUEST_TIMEOUT = 60000;
/** Times a history request with no response is re-sent before it fails */
export const DEFAULT_MAX_RESENDS = 1;

/**
 * Client for the IQConnect admin (9300), lookup (9100) and level 1 (5009)
 * ports. options may set connect_timeout, request_timeout and max_resends, so
 * a request IQFeed never answers fails instead of waiting forever, and ports
 * ({admin, lookup, level1}) to connect elsewhere.
 */
export default function(command, env, productId, productVersion, options = {}) {
    if (command) assert.ok(Array.isArray(command), `Expected command to be an array`);
    const ctx = {
        sockets: new Set(), // every socket this client has open
        closing: null,
        connect_timeout: options.connect_timeout || DEFAULT_CONNECT_TIMEOUT,
        request_timeout: options.request_timeout || DEFAULT_REQUEST_TIMEOUT,
        max_resends: options.max_resends != null ? options.max_resends : DEFAULT_MAX_RESENDS,
        ports: {admin: 9300, lookup: 9100, level1: 5009, ...options.ports}
    };
    let adminPromise, closed;
    const admin = function(){
        return adminPromise = promiseSocket(adminPromise,
            promiseNewAdminSocket.bind(this, ctx, ctx.ports.admin, command, env, productId, productVersion));
    };
    const lookup = historical(ctx, nextval, admin);
    const throttled = promiseThrottle(lookup, 100);
    const level1 = watch(ctx, admin);
    let promised_markets, promised_types;
    const promiseMarkets = function() {
        return promised_markets = (promised_markets || Promise.reject()).catch(err => slm(ctx, admin));
    };
    const promiseTypes = function() {
        return promised_types = (promised_types || Promise.reject()).catch(err => sst(ctx, admin));
    };
    return {
        open() {
            return admin();
        },
        close() {
            if (closed) return closed;
            ctx.closing = Error("IQFeed is closing");
            // Closing every socket also settles any connection still being
            // established, so this never waits on IQFeed to respond.
            return closed = Promise.all([
                lookup('close'),
                level1('close'),
                ...Array.from(ctx.sockets).map(closeSocket)
            ]).then(() => {
                adminPromise = null;
            });
        },
        version: _.memoize(() => {
            return admin().then(socket => {
                return new Promise((ready, fail) => {
                    socket.on('close', fail);
                    onreceive(socket, function(line) {
                        if (line && line.indexOf('S,STATS,') === 0) {
                            const stats = _.object(['S', 'STATS', 'ServerIP', 'ServerPort', 'MaxSymbols', 'NumberOfSymbols', 'ClientsConnected', 'SecondsSinceLastUpdate', 'Reconnections', 'AttemptedReconnections', 'StartTime', 'MarketTime', 'Status', 'IQFeedVersion', 'LoginID', 'TotalKBsRecv', 'KBsPerSecRecv', 'AvgKBsPerSecRecv', 'TotalKBsSent', 'KBsPerSecSent', 'AvgKBsPerSecSent'], line.split(','));
                            ready(stats.IQFeedVersion);
                            socket.removeListener('close', fail);
                        }
                        return false;
                    });
                });
            });
        }),
        lookup(symbol, listed_markets) {
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            const listed_markets_ar = _.compact(_.flatten([listed_markets]));
            return promiseMarkets().then(markets => {
                return promiseTypes().then(types => {
                    const values = listed_markets_ar.map(market => {
                        const id = markets.indexOf(market);
                        if (id >= 0) return id;
                        else return market;
                    });
                    return sbf(throttled, {
                        field: 's',
                        search: symbol,
                        type: 'e',
                        value: values.join(' ')
                    }).then(lines => lines.map(line => {
                        const row = line.split(',', 5);
                        return _.extend({
                            symbol: row[1],
                            listed_market: markets[parseInt(row[2])] || row[2],
                            security_type: types[parseInt(row[3])] || row[3],
                            name: row[4]
                        });
                    }));
                });
            });
        },
        fundamental: promiseThrottle(symbol => {
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            return promiseMarkets().then(markets => {
                return promiseTypes().then(types => {
                    return level1({
                        fundamental: true,
                        symbol: symbol
                    }).then(datum => _.extend(datum, {
                        listed_market: markets[parseInt(datum.listed_market)] || datum.listed_market,
                        security_type: types[parseInt(datum.security_type)] || datum.security_type
                    }));
                });
            });
        }, 10),
        summary(symbol, update){
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            if (update) assert.ok(typeof update == 'function', `Expected update to be a function`);
            return level1({
                summary: true,
                symbol: symbol,
                update: update
            });
        },
        month(symbol, begin, end, tz) {
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            if (end) assert.ok(!(begin > end), `Expected begin to not be above end, got ${JSON.stringify(begin)}`);
            assert.ok(typeof tz == 'string' && /^\S+\/\S+$/.test(tz), `Expected tz to be a string and match /^\\S+\\/\\S+$/, got ${JSON.stringify(tz)}`);
            const now = moment().tz(tz);
            const earliest = moment.tz(begin, tz);
            if (!earliest.isValid()) throw Error("Invalid begin date " + begin);
            return hmx(throttled, {
                symbol: symbol,
                maxDatapoints: moment.tz(now, tz).diff(earliest, 'months') + 1
            }).then(parseDailyResults).then(results => {
                if (results.length && _.last(results).Date_Stamp <= earliest.format('Y-MM-DD'))
                    results.pop(); // today's trading session is not over
                return results.reverse();
            });
        },
        week(symbol, begin, end, tz) {
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            if (end) assert.ok(!(begin > end), `Expected begin to not be above end, got ${JSON.stringify(begin)}`);
            assert.ok(typeof tz == 'string' && /^\S+\/\S+$/.test(tz), `Expected tz to be a string and match /^\\S+\\/\\S+$/, got ${JSON.stringify(tz)}`);
            const now = moment().tz(tz);
            const earliest = moment.tz(begin, tz);
            if (!earliest.isValid()) throw Error("Invalid begin date " + begin);
            return hwx(throttled, {
                symbol: symbol,
                maxDatapoints: now.diff(earliest, 'weeks') + 1
            }).then(parseDailyResults).then(results => {
                if (results.length && _.last(results).Date_Stamp <= earliest.format('Y-MM-DD'))
                    results.pop(); // today's trading session is not over
                return results.reverse();
            });
        },
        day(symbol, begin, end, tz) {
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            if (end) assert.ok(!(begin > end), `Expected begin to not be above end, got ${JSON.stringify(begin)}`);
            assert.ok(typeof tz == 'string' && /^\S+\/\S+$/.test(tz), `Expected tz to be a string and match /^\\S+\\/\\S+$/, got ${JSON.stringify(tz)}`);
            const b = moment.tz(begin, tz);
            const e = end && moment.tz(end, tz);
            if (!b.isValid()) throw Error("Invalid begin date " + begin);
            if (e && !e.isValid()) throw Error("Invalid end date " + end);
            const now = moment().tz(tz);
            return hdt(throttled, {
                symbol: symbol,
                begin: b.format('YYYYMMDD'),
                end: e && e.format('YYYYMMDD'),
                dataDirection: 1
            }).then(parseDailyResults);
        },
        minute(minutes, symbol, begin, end, tz) {
            like.assert(minutes, _.isFinite);
            assert.ok(typeof symbol == 'string' && /^\S+$/.test(symbol), `Expected symbol to be a string and match /^\\S+$/, got ${JSON.stringify(symbol)}`);
            if (end) assert.ok(!(begin > end), `Expected begin to not be above end, got ${JSON.stringify(begin)}`);
            assert.ok(typeof tz == 'string' && /^\S+\/\S+$/.test(tz), `Expected tz to be a string and match /^\\S+\\/\\S+$/, got ${JSON.stringify(tz)}`);
            const now = moment().tz('America/New_York');
            const b = moment.tz(begin, 'America/New_York');
            if (!b.isValid()) throw Error("Invalid begin date " + begin);
            // include interval ending at begin
            b.minutes(minutes*(Math.ceil(b.minutes()/minutes)-1));
            const e = end && moment.tz(end, 'America/New_York');
            if (e && !e.isValid()) throw Error("Invalid end date " + end);
            if (e) e.minutes(minutes*Math.floor(e.minutes()/minutes)).subtract(1,'s');
            return hit(throttled, {
                symbol: symbol,
                seconds: 60 * minutes,
                begin: b.format('YYYYMMDD HHmmss'),
                end: e && e.format('YYYYMMDD HHmmss'),
                dataDirection: 1
            }).then(parseIntradayResults);
        }
    };
}

let sequence_counter = Date.now() % 32768;
function nextval() {
    return ++sequence_counter;
}

function parseDailyResults(lines) {
    return lines.map(line => _.object([
        'Request_ID','Date_Stamp','High','Low','Open','Close',
        'Period_Volume','Open_Interest'
    ], line.split(',')));
}

function parseIntradayResults(lines) {
    return lines.map(line => _.object([
        'Request_ID','Time_Stamp','High','Low','Open','Close',
        'Total_Volume','Period_Volume','Number_of_Trades'
    ], line.split(',')));
}

function hit(lookup, options) {
    return lookup(options.symbol, [
        "HIT",
        options.symbol,
        options.seconds,
        options.begin,
        options.end || '',
        options.maxDatapoints || '',
        options.beginFilterTime || '',
        options.endFilterTime || '',
        options.dataDirection || '0',
        '[RequestID]',
        options.datapointsPerSend || '',
        's'
    ]);
}

function hdt(lookup, options) {
    return lookup(options.symbol, [
        "HDT",
        options.symbol,
        options.begin,
        options.end || '',
        options.maxDatapoints || '',
        options.dataDirection || '0',
        '[RequestID]',
        options.datapointsPerSend || ''
    ]);
}

function hwx(lookup, options) {
    return lookup(options.symbol, [
        "HWX",
        options.symbol,
        options.maxDatapoints,
        options.dataDirection || '0',
        '[RequestID]',
        options.datapointsPerSend || ''
    ]);
}

function hmx(lookup, options) {
    return lookup(options.symbol, [
        "HMX",
        options.symbol,
        options.maxDatapoints,
        options.dataDirection || '0',
        '[RequestID]',
        options.datapointsPerSend || ''
    ]);
}

function sbf(lookup, options) {
    return lookup(options.search, [
        "SBF",
        options.field,
        options.search,
        options.type || '',
        options.value || '',
        '[RequestID]'
    ]);
}

function slm(ctx, ready) {
    return listOf(ctx, 'SLM', ready);
}

function sst(ctx, ready) {
    return listOf(ctx, 'SST', ready);
}

function listOf(ctx, cmd, ready) {
    let deadline;
    return (ready() || Promise.resolve()).then(() => openSocket(ctx, ctx.ports.lookup))
      .then(socket => promiseSend('S,SET PROTOCOL,5.1', socket)
      .then(socket => new Promise((ready, error) => {
        deadline = setTimeout(() => {
            error(Error(`IQFeed did not finish ${cmd} within ${ctx.request_timeout} ms`));
        }, ctx.request_timeout);
        socket.on('close', () => error(Error(`IQFeed closed the connection before finishing ${cmd}`)));
        const listed = [];
        onreceive(socket, function(line) {
            const values = line.split(',');
            if ('!ENDMSG!' == values[0]) {
                ready(listed);
                return false;
            } else if ('E' == values[0]) {
                const msg = line.replace(/E,!?/,'').replace(/!?,*$/,'');
                error(Error(msg));
                return false;
            } else if (isFinite(values[0])) {
                listed[+values[0]] = values[1];
                return false;
            }
        });
        send(cmd, socket);
    })).then(listed => {
        clearTimeout(deadline);
        return closeSocket(socket).then(() => listed);
    }).catch(function(error) {
        clearTimeout(deadline);
        return closeSocket(socket).then(() => Promise.reject(error));
    }));
}

function historical(ctx, nextval, ready) {
    const blacklist = {};
    let pending = {};
    let lookupPromise;
    let closing, marker;
    const mark = () => {
        const marked = _.pick(pending, _.property('marked'));
        if (!closing && !_.isEmpty(marked)) {
            // a request that was already re-sent and still has no response fails
            _.map(marked, (item, id) => {
                if (pending[id] && item.resends >= ctx.max_resends) {
                    item.error(Error(`IQFeed did not respond to ${item.cmd} within ${ctx.request_timeout} ms`));
                }
            });
            lookup().then(function(socketId){
                _.map(marked, (item, id) => {
                    if (pending[id]) {
                        const adj = item.socketId == socketId ? "same" : "new";
                        logger.warn(`Resending ${item.symbol} ${item.cmd} on ${adj} socket ${socketId}`);
                        delete pending[id];
                        submit(nextval, pending, socketId, {...item, resends: item.resends + 1});
                    }
                });
            }).catch(err => {
                _.map(marked, (item, id) => {
                    if (pending[id]) {
                        delete pending[id];
                        item.error(err);
                    }
                });
            });
        }
        _.forEach(pending, item => item.marked = true);
        return marker = setTimeout(mark, ctx.request_timeout).unref();
    };
    marker = mark();
    const lookup = function(){
        if (closing) throw closing;
        return lookupPromise = promiseSocket(lookupPromise, function(){
            return ready().then(function(){
                return promiseNewLookupSocket(ctx, blacklist, pending, ctx.ports.lookup, lookup);
            }, err => { // not ready, aborting
                const deleted = pending;
                pending = {};
                _.each(deleted, item => {
                    item.error(err);
                });
                throw err;
            });
        });
    };
    return function(symbol, args) {
        return Promise.resolve(args).then(function(args){
            if ('close' == symbol) {
                closing = Error("IQFeed is closing");
                clearTimeout(marker);
                _.forEach(_.clone(pending), item => item.error(closing));
                return lookupPromise && lookupPromise.then(closeSocket)
                  .then(() => lookupPromise = null, () => lookupPromise = null);
            }
            if (!symbol) throw Error("Missing symbol in " + args.join(','));
            return lookup().then(function(socketId){
                return new Promise(function(callback, error){
                    if (blacklist[symbol])
                        throw Error(blacklist[symbol] + ": " + symbol);
                    if (closing) throw closing;
                    submit(nextval, pending, socketId, {symbol, args, callback, error});
                });
            })
        });
    };
}

function submit(nextval, pending, socketId, item) {
    const id = nextval();
    pending[id] = {
        symbol: item.symbol,
        cmd: item.args.join(',').replace('[RequestID]', id),
        args: item.args,
        resends: item.resends || 0,
        buffer:[],
        socketId: socketId,
        callback: function(result) {
            delete pending[id];
            return item.callback(result);
        },
        error: function(e) {
            delete pending[id];
            return item.error(e);
        }
    };
    send(pending[id].cmd, socketId);
}

function watch(ctx, ready) {
    const blacklist = {};
    const watching = {};
    const errors = {last: null}; // the most recent E message on the level 1 socket
    let level1Promise;
    const level1 = function(){
        return level1Promise = promiseSocket(level1Promise, function(){
            return ready().then(function(){
                return promiseNewLevel1Socket(ctx, blacklist, watching, errors, ctx.ports.level1, level1);
            });
        });
    };
    return function(options) {
        return Promise.resolve(options).then(function(options){
            if ('close' == options) {
                const err = ctx.closing || Error("IQFeed is closing");
                _.each(_.flatten(_.values(watching)), item => item.error(err));
                return level1Promise && level1Promise.then(closeSocket)
                  .then(() => level1Promise = null, () => level1Promise = null);
            }
            if (!options || !options.symbol)
                throw Error("Missing symbol in " + JSON.stringify(options));
            return level1().then(function(socketId){
                return new Promise(function(callback, onerror){
                    const symbol = options.symbol;
                    // fail if IQFeed does not respond in time, with its last error if any
                    const deadline = setTimeout(() => {
                        const reason = errors.last ? `: ${errors.last}` : '';
                        pending.error(Error(`IQFeed did not respond to ${symbol} within ${ctx.request_timeout} ms${reason}`));
                    }, ctx.request_timeout);
                    const settle = result => {
                        clearTimeout(deadline);
                        return callback(result);
                    };
                    const pending = {
                        symbol: symbol,
                        socketId: socketId,
                        fundamental: function(result) {
                            if (!options.summary)
                                deregister(watching, socketId, symbol, pending);
                            if (options.fundamental)
                                return settle(result);
                        },
                        summary: function(result) {
                            if (!options.update)
                                deregister(watching, socketId, symbol, pending);
                            if (options.summary)
                                return settle(result);
                        },
                        update: function(result) {
                            try {
                                if (options.update) {
                                    const ret = options.update(result);
                                    if (ret) return ret;
                                }
                            } catch(e) {
                                logger.error("IQFeed", e);
                            }
                            deregister(watching, socketId, symbol, pending);
                        },
                        error: function(e) {
                            clearTimeout(deadline);
                            deregister(watching, socketId, symbol, pending);
                            return onerror(e);
                        }
                    };
                    const cmd = (_.isEmpty(watching[symbol]) ? 't' : 'f') + symbol;
                    if (!watching[symbol]) {
                        watching[symbol] = [];
                    }
                    watching[symbol].push(pending);
                    send(cmd, socketId);
                });
            });
        });
    };
}

function deregister(watching, socketId, symbol, pending) {
    if (!watching[symbol]) return;
    watching[symbol] = _.without(watching[symbol], pending);
    if (_.isEmpty(watching[symbol])) {
        delete watching[symbol];
        if (socketId.writable) send('r' + symbol, socketId);
    }
}

/**
 * Called when a lookup or level 1 socket closes: if requests are still pending
 * and the client is not closing, reconnect in a second, which re-sends them.
 * With nothing pending, the next request reconnects. Connection failures are
 * left to the pending requests' own errors and deadlines.
 */
function reconnectLater(ctx, isPending, retry) {
    if (ctx.closing || !isPending()) return;
    _.delay(() => {
        if (ctx.closing || !isPending()) return;
        Promise.resolve().then(retry).catch(err => logger.debug("IQFeed could not reconnect", err.message));
    }, 1000);
}

function promiseSocket(previous, createNewSocket) {
    const check = interrupt(true);
    return (previous || Promise.reject()).then(function(socket){
        if (!socket.destroyed) return socket;
        else throw Error("Socket not connected");
    }).catch(async(err) => {
        if (await check()) throw err;
        return createNewSocket();
    });
}

function promiseNewLookupSocket(ctx, blacklist, pending, port, retry) {
    return openSocket(ctx, port).then(function(socket) {
        return promiseSend('S,SET PROTOCOL,5.1', socket).then(function(socket) {
            socket.on('close', () => reconnectLater(ctx, () => !_.isEmpty(pending), retry));
            onreceive(socket, function(line) {
                const id = line.substring(0, line.indexOf(','));
                const item = pending[id];
                if (item) {
                    if (item.marked) item.marked = false;
                    if (line.indexOf(id + ',!ENDMSG!,') === 0) {
                        item.callback(item.buffer);
                        return false;
                    } else if (line.indexOf(id + ',E,') === 0) {
                        const error = line.replace(/\w+,E,!?/,'').replace(/!?,*$/,'');
                        if ("NO_DATA" != error) {
                            blacklist[item.symbol] = error;
                            item.error(Error(error + " for " + item.cmd));
                            return false;
                        }
                    } else {
                        item.buffer.push(line);
                        return false;
                    }
                }
            });
            // on reconnect, resend pending messages
            _.each(pending, function(item){
                send(item.cmd, socket);
            });
            return socket;
        }).catch(function(error) {
            return closeSocket(socket).then(() => Promise.reject(error));
        });
    });
}

function promiseNewLevel1Socket(ctx, blacklist, watching, errors, port, retry) {
    const fundamentalFormat = ['type', 'symbol', 'market_id', 'pe', 'average_volume', '52_week_high', '52_week_low', 'calendar_year_high', 'calendar_year_low', 'dividend_yield', 'dividend_amount', 'dividend_rate', 'pay_date', 'exdividend_date', 'reserved', 'reserved', 'reserved', 'short_interest', 'reserved', 'current_year_earnings_per_share', 'next_year_earnings_per_share', 'five_year_growth_percentage', 'fiscal_year_end', 'reserved', 'company_name', 'root_option_symbol', 'percent_held_by_institutions', 'beta', 'leaps', 'current_assets', 'current_liabilities', 'balance_sheet_date', 'long_term_debt', 'common_shares_outstanding', 'reserved', 'split_factor_1', 'split_factor_2', 'reserved', 'reserved', 'format_code', 'precision', 'sic', 'historical_volatility', 'security_type', 'listed_market', '52_week_high_date', '52_week_low_date', 'calendar_year_high_date', 'calendar_year_low_date', 'year_end_close', 'maturity_date', 'coupon_rate', 'expiration_date', 'strike_price', 'naics', 'market_root'];
    const summaryFormat = ['type', 'symbol', 'close', 'most_recent_trade_date', 'open', 'high', 'low', 'most_recent_trade_timems', 'most_recent_trade', 'bid_timems', 'bid', 'ask_timems', 'ask', 'total_volume', 'decimal_precision'];
    return openSocket(ctx, port).then(function(socket) {
        return promiseSend('S,SET PROTOCOL,5.1', socket)
          .then(send.bind(this, 'S,SELECT UPDATE FIELDS,Close,Most Recent Trade Date,Open,High,Low,Most Recent Trade TimeMS,Most Recent Trade,Bid TimeMS,Bid,Ask TimeMS,Ask,Total Volume,Decimal Precision'))
          .then(function(socket){
            socket.on('close', () => reconnectLater(ctx, () => !_.isEmpty(watching), retry));
            onreceive(socket, function(line) {
                const row = line.split(',');
                if ('T' == row[0]) { // Time
                    return false;
                } else if ('n' == row[0]) { // Symbol not found
                    const symbol = row[1];
                    _.each(watching[symbol], function(item){
                        item.error(Error("Symbol not found: " + symbol));
                    });
                    return false;
                } else if ('F' == row[0]) { // Fundamental
                    const trim = String.prototype.trim.call.bind(String.prototype.trim);
                    const object = _.omit(_.object(fundamentalFormat, row.map(trim)), _.isEmpty);
                    _.each(watching[object.symbol], function(item){
                        item.fundamental(object);
                    });
                    return false;
                } else if ('P' == row[0]) { // Summary
                    const object = _.object(summaryFormat, row);
                    _.each(watching[object.symbol], function(item){
                        item.summary(object);
                    });
                    return false;
                } else if ('Q' == row[0]) { // Update
                    const object = _.object(summaryFormat, row);
                    _.each(watching[object.symbol], function(item){
                        item.update(object);
                    });
                    return false;
                } else if ('E' == row[0]) { // Error, not tied to a symbol
                    errors.last = row.slice(1).join(',').replace(/^!|!?,*$/g, '');
                    logger.error("IQFeed", errors.last);
                    return false;
                }
            });
            // on reconnect, resend pending messages
            _.each(_.keys(watching), function(symbol){
                send('t' + symbol, socket);
            });
            return socket;
        }).catch(function(error) {
            return closeSocket(socket).then(() => Promise.reject(error));
        });
    });
}

function promiseNewAdminSocket(ctx, port, command, env, productId, productVersion) {
    const check = interrupt(true);
    return openSocket(ctx, port).catch(async(err) => {
        if (await check()) throw err;
        if (command && err.code == 'ECONNREFUSED') {
            // try launching command first
            return new Promise((ready, exit) => {
                logger.debug("launching", command);
                const p = spawn(_.first(command), _.rest(command), {
                    env: _.extend({}, process.env, env),
                    detached: true,
                    stdio: 'ignore'
                }).on('error', exit).on('exit', code => {
                    if (code) exit(Error("Process exitted with code " + code));
                    else ready();
                }).unref();
                ready();
            }).then(() => openSocket(ctx, port)).catch(async(err) => {
                if (await check()) throw err;
                if (err.code == 'ECONNREFUSED')
                    return new Promise(cb => _.delay(cb, 1000))
                        .then(() => openSocket(ctx, port)).catch(async(err) => {
                            if (await check()) throw err;
                            if (err.code == 'ECONNREFUSED')
                                return new Promise(cb => _.delay(cb, 4000))
                                    .then(() => openSocket(ctx, port));
                            else throw err;
                        });
                else throw err;
            });
        } else {
            throw err;
        }
    }).then(function(socket) {
        return promiseSend('S,CONNECT', socket).then(function(socket){
            return new Promise(function(connected, failed) {
                let registration, status = 'no status received';
                // IQConnect may never connect (not logged in, or DTN unreachable)
                const deadline = setTimeout(() => {
                    abort(Error(`IQFeed did not connect within ${ctx.connect_timeout} ms (${status})`));
                }, ctx.connect_timeout);
                const callback = socket => {
                    clearTimeout(deadline);
                    connected(socket);
                };
                const abort = error => {
                    clearTimeout(deadline);
                    failed(error);
                };
                const warning = _.throttle(msg => logger.warn(msg), 10000, {trailing: false});
                socket.on('error', error => {
                    logger.error("IQFeed", error, error.stack);
                    abort(error);
                });
                socket.on('close', () => {
                    abort(Error(`IQFeed closed the admin connection before connecting (${status})`));
                });
                let first = true;
                onreceive(socket, function(line) {
                    if (line && line.indexOf("S,STATS,") >= 0) {
                        status = line.substring(line.indexOf("S,STATS,")).split(',')[12] || status;
                        if (line.indexOf("Not Connected") > 0) {
                            const msg = "S,REGISTER CLIENT APP," + productId + "," + productVersion;
                            if (productId && registration != msg) {
                                registration = msg;
                                promiseSend(msg, socket)
                                  .then(send.bind(this, 'S,CONNECT'), abort);
                            } else {
                                warning(line);
                            }
                        } else {
                            callback(socket);
                            if (first) first = false;
                            else return false;
                        }
                    } else if (line && line.indexOf("S,REGISTER CLIENT APP COMPLETED") === 0) {
                        send('S,CONNECT', socket);
                    }
                });
            });
        }).catch(function(error) {
            return closeSocket(socket).then(() => Promise.reject(error));
        });
    });
}

function openSocket(ctx, port) {
    if (ctx.closing) return Promise.reject(ctx.closing);
    return new Promise(function(callback, abort) {
        logger.debug("IQFeed opening TCP Socket", port);
        const socket = net.connect(port, () => {
            socket.setTimeout(0); // the timeout only applies to connecting
            callback(socket);
        })
            .on('error', abort)
            .on('timeout', () => socket.destroy(Error(`IQFeed socket ${port} timeout`)))
            .on('close', () => {
                ctx.sockets.delete(socket);
                abort(Error(`IQFeed socket ${port} closed`));
            });
        socket.setTimeout(ctx.connect_timeout);
        ctx.sockets.add(socket);
    });
}

function closeSocket(socket) {
    let destroy;
    return new Promise(cb => {
        socket.on('close', cb).end();
        // wait 1s for remote to ACK FIN
        destroy = setTimeout(() => socket.destroy(), 1000);
        if (socket.closed) cb(socket.errored);
    }).then(() => clearTimeout(destroy));
}

function send(cmd, socket) {
    logger.log(cmd);
    socket.write(cmd + '\r\n');
    return socket;
}

function promiseSend(cmd, socket) {
    return new Promise(function(callback, abort) {
        logger.log(cmd);
        socket.on('error', abort);
        socket.write(cmd + '\r\n', () => {
            socket.removeListener('error', abort);
            callback(socket);
        });
    });
}

function onreceive(socket, listener) {
    let buffer = '';
    socket.setEncoding('utf-8');
    socket.on('data', data => {
        buffer = buffer ? buffer + data : data;
        while (buffer.indexOf('\n') >= 0) {
            const idx = buffer.indexOf('\n') + 1;
            const line = buffer.substring(0, idx).replace(/\s*$/,'');
            buffer = buffer.substring(idx);
            try {
                const ret = listener(line);
                if (ret !== false && !line.match(/^\d+,/)) {
                    logger.log(line);
                }
            } catch (e) {
                logger.error(e, e.stack);
            }
        }
    });
}
