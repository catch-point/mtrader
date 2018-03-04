// iqfeed-client.js
/*
 *  Copyright (c) 2014-2017 James Leigh, Some Rights Reserved
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

const net = require('net');
const _ = require('underscore');
const spawn = require('child_process').spawn;
const moment = require('moment-timezone');
const logger = require('./logger.js');
const promiseThrottle = require('./throttle.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(command, env, productId, productVersion) {
    if (command) expect(command).to.be.an('array');
    var adminPromise;
    var admin = function(){
        return adminPromise = promiseSocket(adminPromise,
            promiseNewAdminSocket.bind(this, 9300, command, env, productId, productVersion));
    };
    var lookup = historical(admin);
    var throttled = promiseThrottle(lookup, 10);
    var level1 = watch(admin);
    return {
        open() {
            return admin();
        },
        close() {
            return Promise.all([
                adminPromise ? admin().then(closeSocket).then(() => adminPromise = null) : Promise.resolve(),
                lookup('close'),
                level1('close')
            ]);
        },
        lookup(symbol, listed_market) {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            return sbf(throttled, {
                field: 's',
                search: symbol,
                type: 'e',
                value: listed_market
            }).then(lines => lines.map(line => {
                var row = line.split(',', 5);
                return _.extend({
                    symbol: row[1],
                    listed_market: parseFloat(row[2]),
                    securityTypeID: parseFloat(row[3]),
                    name: row[4]
                });
            }));
        },
        fundamental: promiseThrottle(symbol => {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            return level1({
                type: 'fundamental',
                symbol: symbol
            });
        }, 10),
        summary(symbol, update){
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (update) expect(update).to.be.a('function');
            return level1({
                type: 'summary',
                symbol: symbol,
                update: update
            });
        },
        month(symbol, begin, end, marketClosesAt, tz) {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(marketClosesAt).to.be.a('string').and.match(/^\d\d:\d\d(:00)?$/);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var now = moment().tz(tz);
            var earliest = moment.tz(begin, tz);
            if (!earliest.isValid()) throw Error("Invalid begin date " + begin);
            return hmx(throttled, {
                symbol: symbol,
                maxDatapoints: moment(now).tz(tz).diff(earliest, 'months') + 1
            }).then(parseDailyResults.bind(this, 'month', marketClosesAt, tz, now)).then(results => {
                if (results.length && _.last(results).Date_Stamp <= earliest.format('Y-MM-DD'))
                    results.pop(); // today's trading session is not over
                return results;
            });
        },
        week(symbol, begin, end, marketClosesAt, tz) {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(marketClosesAt).to.be.a('string').and.match(/^\d\d:\d\d(:00)?$/);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var now = moment().tz(tz);
            var earliest = moment.tz(begin, tz);
            if (!earliest.isValid()) throw Error("Invalid begin date " + begin);
            return hwx(throttled, {
                symbol: symbol,
                maxDatapoints: now.diff(earliest, 'weeks') + 1
            }).then(parseDailyResults.bind(this, 'week', marketClosesAt, tz, now)).then(results => {
                if (results.length && _.last(results).Date_Stamp <= earliest.format('Y-MM-DD'))
                    results.pop(); // today's trading session is not over
                return results;
            });
        },
        day(symbol, begin, end, marketClosesAt, tz) {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(marketClosesAt).to.be.a('string').and.match(/^\d\d:\d\d(:00)?$/);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var b = moment(begin).tz(tz);
            var e = end && moment(end).tz(tz);
            if (!b.isValid()) throw Error("Invalid begin date " + begin);
            if (e && !e.isValid()) throw Error("Invalid end date " + end);
            var now = moment().tz(tz);
            return hdt(throttled, {
                symbol: symbol,
                begin: b.format('YYYYMMDD'),
                end: e && e.format('YYYYMMDD')
            }).then(parseDailyResults.bind(this, 'day', marketClosesAt, tz, now));
        },
        minute(minutes, symbol, begin, end, tz) {
            expect(minutes).to.be.like(_.isFinite);
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var now = moment().tz('America/New_York');
            var b = moment(begin).tz('America/New_York');
            if (!b.isValid()) throw Error("Invalid begin date " + begin);
            // include interval ending at begin
            b.minutes(minutes*(Math.ceil(b.minutes()/minutes)-1));
            var e = end && moment(end).tz('America/New_York');
            if (e && !e.isValid()) throw Error("Invalid end date " + end);
            if (e) e.minutes(minutes*Math.floor(e.minutes()/minutes)).subtract(1,'s');
            return hit(throttled, {
                symbol: symbol,
                seconds: 60 * minutes,
                begin: b.format('YYYYMMDD HHmmss'),
                end: e && e.format('YYYYMMDD HHmmss')
            }).then(parseIntradayResults.bind(this, minutes, tz, now));
        }
    };
}

function parseDailyResults(unit, marketClosesAt, tz, now, lines) {
    return lines.map(line => _.object([
        'Request_ID','Date_Stamp','High','Low','Open','Close',
        'Period_Volume','Open_Interest'
    ], line.split(',')));
}

function parseIntradayResults(minutes, tz, now, lines) {
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

function historical(ready) {
    var seq = 0;
    var blacklist = {};
    var pending = {};
    var lookupPromise;
    var lookup = function(){
        return lookupPromise = promiseSocket(lookupPromise, function(){
            return ready().then(function(){
                return promiseNewLookupSocket(blacklist, pending, 9100, lookup);
            }, err => { // not ready, aborting
                var deleted = pending;
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
            if ('close' == symbol)
                return lookupPromise && lookup().then(closeSocket).then(() => lookupPromise = null);
            if (!symbol) throw Error("Missing symbol in " + args.join(','));
            return lookup().then(function(socketId){
                var id = ++seq;
                var cmd = args.join(',').replace('[RequestID]', id);
                return new Promise(function(callback, onerror){
                    if (blacklist[symbol])
                        throw Error(blacklist[symbol] + ": " + symbol);
                    pending[id] = {
                        symbol: symbol,
                        cmd: cmd,
                        buffer:[],
                        socketId: socketId,
                        callback: function(result) {
                            delete pending[id];
                            return callback(result);
                        },
                        error: function(e) {
                            delete pending[id];
                            return onerror(e);
                        }
                    };
                    send(cmd, socketId);
                });
            })
        });
    };
}

function watch(ready) {
    var blacklist = {};
    var watching = {};
    var level1Promise;
    var level1 = function(){
        return level1Promise = promiseSocket(level1Promise, function(){
            return ready().then(function(){
                return promiseNewLevel1Socket(blacklist, watching, 5009, level1);
            });
        });
    };
    return function(options) {
        return Promise.resolve(options).then(function(options){
            if ('close' == options)
                return level1Promise && level1().then(closeSocket).then(() => level1Promise = null);;
            if (!options || !options.symbol)
                throw Error("Missing symbol in " + JSON.stringify(options));
            return level1().then(function(socketId){
                return new Promise(function(callback, onerror){
                    var symbol = options.symbol;
                    var pending = {
                        symbol: symbol,
                        socketId: socketId,
                        fundamental: function(result) {
                            if (!options.update) {
                                deregister(watching, socketId, symbol, pending);
                                return callback(result);
                            }
                        },
                        summary: function(result) {
                            if (options.update) callback(result);
                        },
                        update: function(result) {
                            try {
                                if (options.update) return options.update(result);
                            } catch(e) {
                                logger.error("IQFeed", e);
                            }
                            deregister(watching, socketId, symbol, pending);
                        },
                        error: function(e) {
                            deregister(watching, socketId, symbol, pending);
                            return onerror(e);
                        }
                    };
                    var cmd = (_.isEmpty(watching[symbol]) ? 't' : 'f') + symbol;
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
    watching[symbol] = _.without(watching[symbol], pending);
    if (_.isEmpty(watching[symbol])) {
        delete watching[symbol];
        send('r' + symbol, socketId);
    }
}

function promiseSocket(previous, createNewSocket) {
    return (previous || Promise.reject()).then(function(socket){
        if (!socket.destroyed) return socket;
        else throw Error("Socket not connected");
    }).catch(createNewSocket);
}

function promiseNewLookupSocket(blacklist, pending, port, retry) {
    return openSocket(port).then(function(socket) {
        return send('S,SET PROTOCOL,5.1', socket).then(function(socket) {
            socket.on('close', error => {
                // close and reconnect in a second
                if (error) _.delay(retry, 1000);
            });
            onreceive(socket, function(line) {
                var id = line.substring(0, line.indexOf(','));
                if (line.indexOf(id + ',!ENDMSG!,') === 0) {
                    if (pending[id]) {
                        pending[id].callback(pending[id].buffer);
                        return false;
                    }
                } else if (line.indexOf(id + ',E,') === 0) {
                    if (pending[id]) {
                        var error = line.replace(/\w+,E,!?/,'').replace(/!?,*$/,'');
                        if ("NO_DATA" != error) {
                            blacklist[pending[id].symbol] = error;
                            pending[id].error(Error(error + " for " + pending[id].cmd));
                            return false;
                        }
                    }
                } else if (pending[id]) {
                    pending[id].buffer.push(line);
                    return false;
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

function promiseNewLevel1Socket(blacklist, watching, port, retry) {
    var fundamentalFormat = ['type', 'symbol', 'exchange_id', 'pe', 'average_volume', '52_week_high', '52_week_low', 'calendar_year_high', 'calendar_year_low', 'dividend_yield', 'dividend_amount', 'dividend_rate', 'pay_date', 'exdividend_date', 'reserved', 'reserved', 'reserved', 'short_interest', 'reserved', 'current_year_earnings_per_share', 'next_year_earnings_per_share', 'five_year_growth_percentage', 'fiscal_year_end', 'reserved', 'company_name', 'root_option_symbol', 'percent_held_by_institutions', 'beta', 'leaps', 'current_assets', 'current_liabilities', 'balance_sheet_date', 'long_term_debt', 'common_shares_outstanding', 'reserved', 'split_factor_1', 'split_factor_2', 'reserved', 'reserved', 'format_code', 'precision', 'sic', 'historical_volatility', 'security_type', 'listed_market', '52_week_high_date', '52_week_low_date', 'calendar_year_high_date', 'calendar_year_low_date', 'year_end_close', 'maturity_date', 'coupon_rate', 'expiration_date', 'strike_price', 'naics', 'exchange_root'];
    var summaryFormat = ['type', 'symbol', 'close', 'most_recent_trade_date', 'most_recent_trade_timems', 'most_recent_trade'];
    return openSocket(port).then(function(socket) {
        return send('S,SET PROTOCOL,5.1', socket).then(send.bind(this, 'S,SELECT UPDATE FIELDS,Close,Most Recent Trade Date,Most Recent Trade TimeMS,Most Recent Trade')).then(function(socket){
            socket.on('close', error => {
                // close and reconnect in a second
                if (error) _.delay(retry, 1000);
            });
            onreceive(socket, function(line) {
                var row = line.split(',');
                if ('T' == row[0]) { // Time
                    return false;
                } else if ('n' == row[0]) { // Symbol not found
                    var symbol = row[1];
                    _.each(watching[symbol], function(item){
                        item.error(Error("Symbol not found: " + symbol));
                    });
                    return false;
                } else if ('F' == row[0]) { // Fundamental
                    var trim = String.prototype.trim.call.bind(String.prototype.trim);
                    var object = _.omit(_.object(fundamentalFormat, row.map(trim)), _.isEmpty);
                    _.each(watching[object.symbol], function(item){
                        item.fundamental(object);
                    });
                    return false;
                } else if ('P' == row[0]) { // Summary
                    var object = _.object(summaryFormat, row);
                    _.each(watching[object.symbol], function(item){
                        item.summary(object);
                    });
                    return false;
                } else if ('Q' == row[0]) { // Update
                    var object = _.object(summaryFormat, row);
                    _.each(watching[object.symbol], function(item){
                        item.update(object);
                    });
                    return false;
                } else if ('E' == row[0]) { // Update
                    logger.error("IQFeed", row[1]);
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

function promiseNewAdminSocket(port, command, env, productId, productVersion) {
    return openSocket(port).catch(err => {
        if (command && err.code == 'ECONNREFUSED') {
            // try launching command first
            return new Promise((ready, exit) => {
                logger.debug("launching", command);
                var p = spawn(_.first(command), _.rest(command), {
                    env: env,
                    detached: true,
                    stdio: 'ignore'
                }).on('error', exit).on('exit', code => {
                    if (code) exit(Error("Process exitted with code " + code));
                    else ready();
                }).unref();
                ready();
            }).then(() => openSocket(port)).catch(err => {
                if (err.code == 'ECONNREFUSED')
                    return new Promise(cb => _.delay(cb, 1000))
                        .then(() => openSocket(port)).catch(err => {
                            if (err.code == 'ECONNREFUSED')
                                return new Promise(cb => _.delay(cb, 4000))
                                    .then(() => openSocket(port));
                            else throw err;
                        });
                else throw err;
            });
        } else {
            throw err;
        }
    }).then(function(socket) {
        return send('S,CONNECT', socket).then(function(socket){
            return new Promise(function(callback, abort) {
                var registration;
                var warning = _.throttle(msg => logger.warn(msg), 10000, {trailing: false});
                socket.on('error', error => {
                    logger.error("IQFeed", error, error.stack);
                    abort(error);
                });
                onreceive(socket, function(line) {
                    if (line && line.indexOf("S,STATS,") >= 0) {
                        if (line.indexOf("Not Connected") > 0) {
                            var msg = "S,REGISTER CLIENT APP," + productId + "," + productVersion;
                            if (productId && registration != msg) {
                                registration = msg;
                                send(msg, socket).then(send.bind(this, 'S,CONNECT'), abort);
                            } else {
                                warning(line);
                            }
                        } else {
                            callback(socket);
                            return false;
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

function openSocket(port) {
    return new Promise(function(callback, abort) {
        logger.debug("Opening TCP Socket", port);
        var socket = net.connect(port, () => callback(socket)).on('error', abort);
    });
}

function closeSocket(socket) {
    return new Promise(cb => {
        socket.on('close', cb).end();
        // wait 1s for remote to ACK FIN
        _.delay(() => socket.destroy(), 1000);
    });
}

function send(cmd, socket) {
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
    var buffer = '';
    socket.setEncoding('utf-8');
    socket.on('data', data => {
        buffer = buffer ? buffer + data : data;
        while (buffer.indexOf('\n') >= 0) {
            var idx = buffer.indexOf('\n') + 1;
            var line = buffer.substring(0, idx).replace(/\s*$/,'');
            buffer = buffer.substring(idx);
            try {
                var ret = listener(line);
                if (ret !== false) {
                    logger.log(line);
                }
            } catch (e) {
                logger.error(e, e.stack);
            }
        }
    });
}
