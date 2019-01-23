// iqfeed-client.js
/*
 *  Copyright (c) 2014-2018 James Leigh, Some Rights Reserved
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
const d3 = require('d3-format');
const logger = require('./logger.js');
const promiseThrottle = require('./throttle.js');
const interrupt = require('./interrupt.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(command, env, productId, productVersion) {
    if (command) expect(command).to.be.an('array');
    var adminPromise;
    var admin = function(){
        return adminPromise = promiseSocket(adminPromise,
            promiseNewAdminSocket.bind(this, 9300, command, env, productId, productVersion));
    };
    var lookup = historical(nextval, admin);
    var throttled = promiseThrottle(lookup, 100);
    var level1 = watch(admin);
    var promised_markets, promised_types;
    var promiseMarkets = function() {
        return promised_markets = (promised_markets || Promise.reject()).catch(err => slm(admin));
    };
    var promiseTypes = function() {
        return promised_types = (promised_types || Promise.reject()).catch(err => sst(admin));
    };
    return {
        open() {
            return admin();
        },
        close() {
            return Promise.all([
                !adminPromise ? Promise.resolve() : adminPromise.then(closeSocket)
                  .then(() => adminPromise = null, () => adminPromise = null),
                lookup('close'),
                level1('close')
            ]);
        },
        lookup(symbol, listed_markets) {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            var listed_markets_ar = _.compact(_.flatten([listed_markets]));
            var listed_market = listed_markets_ar.length == 1 ? listed_markets_ar[0] : null;
            if (listed_market == 'OPRA') {
                var opra = lookupOptions(symbol);
                if (opra) return Promise.resolve([opra]);
            }
            return promiseMarkets().then(markets => {
                return promiseTypes().then(types => {
                    var values = listed_markets_ar.map(market => {
                        var id = markets.indexOf(market);
                        if (id >= 0) return id;
                        else return market;
                    });
                    return sbf(throttled, {
                        field: 's',
                        search: symbol,
                        type: 'e',
                        value: values.join(' ')
                    }).then(lines => lines.map(line => {
                        var row = line.split(',', 5);
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
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
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
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (update) expect(update).to.be.a('function');
            return level1({
                summary: true,
                symbol: symbol,
                update: update
            });
        },
        month(symbol, begin, end, tz) {
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var now = moment().tz(tz);
            var earliest = moment.tz(begin, tz);
            if (!earliest.isValid()) throw Error("Invalid begin date " + begin);
            if (isOptionExpired(symbol, earliest, end, tz)) return Promise.resolve([]);
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
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var now = moment().tz(tz);
            var earliest = moment.tz(begin, tz);
            if (!earliest.isValid()) throw Error("Invalid begin date " + begin);
            if (isOptionExpired(symbol, earliest, end, tz)) return Promise.resolve([]);
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
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var b = moment.tz(begin, tz);
            var e = end && moment.tz(end, tz);
            if (!b.isValid()) throw Error("Invalid begin date " + begin);
            if (e && !e.isValid()) throw Error("Invalid end date " + end);
            var now = moment().tz(tz);
            if (isOptionExpired(symbol, b, e, tz)) return Promise.resolve([]);
            return hdt(throttled, {
                symbol: symbol,
                begin: b.format('YYYYMMDD'),
                end: e && e.format('YYYYMMDD'),
                dataDirection: 1
            }).then(parseDailyResults);
        },
        minute(minutes, symbol, begin, end, tz) {
            expect(minutes).to.be.like(_.isFinite);
            expect(symbol).to.be.a('string').and.match(/^\S+$/);
            if (end) expect(begin).to.be.below(end);
            expect(tz).to.be.a('string').and.match(/^\S+\/\S+$/);
            var now = moment().tz('America/New_York');
            var b = moment.tz(begin, 'America/New_York');
            if (!b.isValid()) throw Error("Invalid begin date " + begin);
            // include interval ending at begin
            b.minutes(minutes*(Math.ceil(b.minutes()/minutes)-1));
            var e = end && moment.tz(end, 'America/New_York');
            if (e && !e.isValid()) throw Error("Invalid end date " + end);
            if (e) e.minutes(minutes*Math.floor(e.minutes()/minutes)).subtract(1,'s');
            if (isOptionExpired(symbol, b, e, tz)) return Promise.resolve([]);
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

var sequence_counter = Date.now() % 32768;
function nextval() {
    return ++sequence_counter;
}

var calls = {
    A: 'JAN', B: 'FEB', C: 'MAR', D: 'APR', E: 'MAY', F: 'JUN',
    G: 'JUL', H: 'AUG', I: 'SEP', J: 'OCT', K: 'NOV', L: 'DEC'
};
var puts = {
    M: 'JAN', N: 'FEB', O: 'MAR', P: 'APR', Q: 'MAY', R: 'JUN',
    S: 'JUL', T: 'AUG', U: 'SEP', V: 'OCT', W: 'NOV', X: 'DEC'
};
var months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
var strike_format = d3.format(".2f");
function lookupOptions(symbol) {
    var m = symbol.match(/^(.*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return null;
    var underlying = m[1];
    var yy = +m[2];
    var cc = yy<50 ? 2000 : 1900;
    var year = cc + yy;
    var day = m[3];
    var mo = months[m[4]];
    var cmonth = calls[m[4]];
    var pmonth = puts[m[4]];
    var pc = cmonth ? 'C' : 'P';
    var month = cmonth || pmonth;
    var strike = strike_format(+m[5]);
    return {
        symbol: symbol,
        listed_market: 'OPRA',
        security_type: 'IEOPTION',
        name: `${underlying} ${month} ${year} ${pc} ${strike}`,
        strike_price: strike,
        expiration_date: `${year}-${mo}-${day}`
    };
}

function isOptionExpired(symbol, begin, end, tz) {
    var m = symbol.match(/^(.*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return false;
    var yy = +m[2];
    var cc = yy<50 ? 2000 : 1900;
    var year = cc + yy;
    var mo = months[m[4]];
    var day = m[3];
    var expiration_date = `${year}-${mo}-${day}`;
    if (moment.tz(expiration_date,tz).endOf('day').isBefore(begin))
        return true;
    else if (end && moment.tz(expiration_date,tz).subtract(6,'months').isAfter(end))
        return true;
    else
        return false;
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

function slm(ready) {
    return listOf('SLM', ready);
}

function sst(ready) {
    return listOf('SST', ready);
}

function listOf(cmd, ready) {
    return (ready() || Promise.resolve()).then(() => openSocket(9100))
      .then(socket => promiseSend('S,SET PROTOCOL,5.1', socket)
      .then(socket => new Promise((ready, error) => {
        socket.on('close', err => err && error(err));
        var listed = [];
        onreceive(socket, function(line) {
            var values = line.split(',');
            if ('!ENDMSG!' == values[0]) {
                ready(listed);
                return false;
            } else if ('E' == values[0]) {
                var msg = line.replace(/E,!?/,'').replace(/!?,*$/,'');
                error(Error(msg));
                return false;
            } else if (isFinite(values[0])) {
                listed[+values[0]] = values[1];
                return false;
            }
        });
        send(cmd, socket);
    })).then(listed => {
        return closeSocket(socket).then(() => listed);
    }).catch(function(error) {
        return closeSocket(socket).then(() => Promise.reject(error));
    }));
}

function historical(nextval, ready) {
    var blacklist = {};
    var pending = {};
    var lookupPromise;
    var closing;
    var mark = () => {
        var marked = _.pick(pending, _.property('marked'));
        if (!closing && !_.isEmpty(marked)) {
            lookup().then(function(socketId){
                _.map(marked, (item, id) => {
                    if (pending[id]) {
                        var adj = item.socketId == socketId ? "same" : "new";
                        logger.warn(`Resending ${symbol} ${item.cmd} on ${adj} socket ${socketId}`);
                        delete pending[id];
                        submit(nextval, pending, socketId, item);
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
        return marker = setTimeout(mark, 60000).unref();
    };
    var marker = mark();
    var lookup = function(){
        if (closing) throw closing;
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
    var id = nextval();
    pending[id] = {
        symbol: item.symbol,
        cmd: item.args.join(',').replace('[RequestID]', id),
        args: item.args,
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
                            if (!options.summary)
                                deregister(watching, socketId, symbol, pending);
                            if (options.fundamental)
                                return callback(result);
                        },
                        summary: function(result) {
                            if (!options.update)
                                deregister(watching, socketId, symbol, pending);
                            if (options.summary)
                                return callback(result);
                        },
                        update: function(result) {
                            try {
                                if (options.update) {
                                    var ret = options.update(result);
                                    if (ret) return ret;
                                }
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
    var check = interrupt(true);
    return (previous || Promise.reject()).then(function(socket){
        if (!socket.destroyed) return socket;
        else throw Error("Socket not connected");
    }).catch(err => {
        if (check()) throw err;
        return createNewSocket();
    });
}

function promiseNewLookupSocket(blacklist, pending, port, retry) {
    return openSocket(port).then(function(socket) {
        return promiseSend('S,SET PROTOCOL,5.1', socket).then(function(socket) {
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
    var check = interrupt(true);
    var fundamentalFormat = ['type', 'symbol', 'market_id', 'pe', 'average_volume', '52_week_high', '52_week_low', 'calendar_year_high', 'calendar_year_low', 'dividend_yield', 'dividend_amount', 'dividend_rate', 'pay_date', 'exdividend_date', 'reserved', 'reserved', 'reserved', 'short_interest', 'reserved', 'current_year_earnings_per_share', 'next_year_earnings_per_share', 'five_year_growth_percentage', 'fiscal_year_end', 'reserved', 'company_name', 'root_option_symbol', 'percent_held_by_institutions', 'beta', 'leaps', 'current_assets', 'current_liabilities', 'balance_sheet_date', 'long_term_debt', 'common_shares_outstanding', 'reserved', 'split_factor_1', 'split_factor_2', 'reserved', 'reserved', 'format_code', 'precision', 'sic', 'historical_volatility', 'security_type', 'listed_market', '52_week_high_date', '52_week_low_date', 'calendar_year_high_date', 'calendar_year_low_date', 'year_end_close', 'maturity_date', 'coupon_rate', 'expiration_date', 'strike_price', 'naics', 'market_root'];
    var summaryFormat = ['type', 'symbol', 'close', 'most_recent_trade_date', 'open', 'high', 'low', 'most_recent_trade_timems', 'most_recent_trade', 'bid_timems', 'bid', 'ask_timems', 'ask', 'total_volume', 'decimal_precision'];
    return openSocket(port).then(function(socket) {
        return promiseSend('S,SET PROTOCOL,5.1', socket)
          .then(send.bind(this, 'S,SELECT UPDATE FIELDS,Close,Most Recent Trade Date,Open,High,Low,Most Recent Trade TimeMS,Most Recent Trade,Bid TimeMS,Bid,Ask TimeMS,Ask,Total Volume,Decimal Precision'))
          .then(function(socket){
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
    var check = interrupt(true);
    return openSocket(port).catch(err => {
        if (check()) throw err;
        if (command && err.code == 'ECONNREFUSED') {
            // try launching command first
            return new Promise((ready, exit) => {
                logger.debug("launching", command);
                var p = spawn(_.first(command), _.rest(command), {
                    env: _.extend({}, process.env, env),
                    detached: true,
                    stdio: 'ignore'
                }).on('error', exit).on('exit', code => {
                    if (code) exit(Error("Process exitted with code " + code));
                    else ready();
                }).unref();
                ready();
            }).then(() => openSocket(port)).catch(err => {
                if (check()) throw err;
                if (err.code == 'ECONNREFUSED')
                    return new Promise(cb => _.delay(cb, 1000))
                        .then(() => openSocket(port)).catch(err => {
                            if (check()) throw err;
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
        return promiseSend('S,CONNECT', socket).then(function(socket){
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
                                promiseSend(msg, socket)
                                  .then(send.bind(this, 'S,CONNECT'), abort);
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
    var destroy;
    return new Promise(cb => {
        socket.on('close', cb).end();
        // wait 1s for remote to ACK FIN
        destroy = setTimeout(() => socket.destroy(), 1000);
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
