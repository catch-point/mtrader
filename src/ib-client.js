// ib-client.js
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

const _ = require('underscore');
const moment = require('moment-timezone');
const xml = require('fast-xml-parser');
const IB = require('ib-tws-node');
const logger = require('./logger.js');
const promiseThrottle = require('./throttle.js');
const TimeLimit = require('./time-limit.js');
const debounce = require('./debounce.js');
const cache = require('./memoize-cache.js');
const storage = require('./storage.js');

let sequence_counter = (Date.now() * process.pid) % 32768;
function nextval() {
    return ++sequence_counter;
}

module.exports = async function(settings = {}) {
    const host = settings && settings.host || 'localhost';
    const port = settings && settings.port;
    if (!port) throw Error("Port is required to start IB TWS");
    const clientId = settings && _.isFinite(settings.clientId) ? settings.clientId : 0;
    const ib_tz = (settings||{}).tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const timeout = settings && settings.timeout || 600000;
    const self = new.target ? this : {};
    let promise_client = createClient(host, port, clientId, ib_tz, timeout, settings);
    let closed = false;
    const first_client = await promise_client;
    return Object.assign(self, _.mapObject(_.pick(first_client, _.isFunction), (fn, cmd) => async function() {
        if (cmd == 'close') {
            closed = true;
            const client = await promise_client;
            return client.close();
        } else if (closed) {
            throw Error(`IB API has been closed to ${clientId}`);
        } else {
            const caller_error = new Error("Called from");
            const client = await promise_client;
            return client[cmd].apply(client, arguments).catch(async(err) => {
                if (closed || !client.disconnected) throw err;
                promise_client = promise_client.then(client => client.open()).catch(async(disconnected) => {
                    if (closed) return client;
                    await client.close().catch(logger.error);
                    if (closed) throw Error(`IB API has been closed to ${clientId}`);
                    logger.log("ib-client reconnecting client to", host, port, "as", clientId);
                    return createClient(host, port, clientId, ib_tz, timeout, settings);
                });
                const new_client = await promise_client.then(client => client.open());
                if (closed || new_client.disconnected) throw err;
                return new_client[cmd].apply(client, arguments);
            }).catch(err => {
                logger.trace(err);
                const stack = (caller_error.stack || caller_error).toString();
                const msg = stack.replace(/(Error: )?Called from/, err.message || err);
                throw Error(msg);
            });
        }
    }));
};


async function createClient(host, port, clientId, ib_tz, timeout, settings = {}) {
    const self = new.target ? this : {};
    const ib = await IB(settings);
    ib.setMaxListeners(20);
    ib.on('error', (id_or_str, err_code, err_msg) => {
        // Some error messages might just be warnings
        // @see https://groups.io/g/twsapi/message/40551
        if (err_code == 1101) {
            logger.log("ib-client", clientId, err_msg);
        } else if (err_code == 1102) {
            logger.log("ib-client", clientId, err_msg);
        } else if (~[2104, 2106, 2107, 2108].indexOf(err_code)) {
            logger.debug("ib-client", clientId, err_msg);
        } else if (err_code >= 2000 && err_code < 3000) {
            logger.info("ib-client", clientId, err_msg || id_or_str || '');
        } else if (err_msg) {
            logger.warn("ib-client", clientId, err_msg, id_or_str);
        } else {
            logger.warn("ib-client", clientId, id_or_str);
        }
        if (self.connected) {
            ib.isConnected().catch(logger.error); // check if the error caused a disconnection
        }
    }).on('result', (event, args) => {
        logger.trace("ib", clientId, event, ...args);
    });
    const login_timeout = Date.now() + (settings.login_timeout || (settings.TradingMode ? 300 : 0)) * 1000;
    const once_connected = new Promise((ready, fail) => {
        let first_error = null;
        const on_error = (id_or_str, err_code, err_msg) => {
            first_error = first_error || Error(err_msg || id_or_str);
            if (self.connecting && !self.connected) {
                if (login_timeout < Date.now()) {
                    fail(Error(err_msg || id_or_str));
                    logger.log("ib-client could not login quick enough to", host, port, "as", clientId);
                    ib.removeListener('error', on_error);
                    ib.exit().catch(logger.error);
                } else {
                    // keep trying
                    ib.sleep(500).catch(fail);
                    ib.eConnect(host, port, clientId, false).catch(fail);
                }
            }
        };
        ib.once('nextValidId', order_id => {
            self.connecting = false;
            self.connected = true;
            self.disconnected = false;
            logger.log("ib-client connected to", host, port, "as", clientId);
            ready();
            ib.removeListener('error', on_error);
        }).once('exit', () => {
            fail(first_error || Error("disconnected"));
        }).on('error', on_error);
    });
    const once_disconnected = new Promise(ready => {
        once_connected.catch(err => {
            ready();
        });
        ib.once('exit', code => {
            self.connecting = false;
            self.connected = false;
            self.disconnected = true;
            logger.log("ib-client", ib.pid, "exited", code || '', "from", host, port, "as", clientId);
            ready();
        });
    });
    const version_promise = new Promise((ready, abort) => {
        ib.once('serverVersion', version => ready(version));
        once_disconnected.then(abort);
        ib.serverVersion().catch(abort);
    });
    if (settings.TradingMode) {
        await ib.login(settings.TradingMode, _.pick(settings, [
            'IBAPIBase64UserName', 'IBAPIBase64Password'
        ]), _.pick(settings, [
            'AcceptIncomingConnectionAction', 'AcceptNonBrokerageAccountWarning', 'AllowBlindTrading', 'DismissNSEComplianceNotice', 'ExistingSessionDetectedAction', 'LogComponents', 'MinimizeMainWindow', 'ReadOnlyLogin', 'StoreSettingsOnServer', 'SuppressInfoMessages'
        ]));
        await ib.enableAPI(settings.port, settings.ReadOnlyLogin);
    }
    self.connecting = true;
    self.connected = false;
    self.disconnected = false;
    await ib.eConnect(host, port, clientId, false);
    once_connected.then(() => {
        ib.on('isConnected', connected => {
            if (!connected) {
                logger.log("ib-client disconnected from", host, port, "as", clientId);
                ib.exit().catch(logger.error); // exit on disconnection
            }
        });
        ib.reqMarketDataType(settings.reqMarketDataType || 4);
    }, _.noop).catch(logger.error);
    const time_limit = new TimeLimit(timeout);
    const lib_dir = settings && settings.lib_dir;
    const store = lib_dir && storage(lib_dir);
    const modules = [
        reqPositions.call(self, ib),
        currentTime.call(self, ib),
        requestFA.call(self, ib),
        accountUpdates.call(self, ib, time_limit, store, ib_tz),
        openOrders.call(self, ib, time_limit, store, ib_tz, clientId),
        execDetails.call(self, ib, time_limit, store, ib_tz),
        reqContract.call(self, ib, time_limit),
        requestWithId.call(self, ib, time_limit)
    ];
    const methods = Object.assign({}, ...modules);
    let open_promise;
    return Object.assign(self, methods, {
        version: () => version_promise,
        async open() {
            await once_connected;
            if (self.disconnected) throw Error("disconnected");
            return open_promise = open_promise || new Promise((ready, abort) => {
                if (self.disconnected) return abort(Error("disconnected"));
                ib.once('isConnected', connected => connected ? ready() : abort(Error("disconnected")));
                once_disconnected.then(() => abort(Error("disconnected")), abort);
                ib.isConnected().catch(abort);
            }).then(() => {
                open_promise = null;
                return self;
            });
        },
        async close() {
            let error;
            await Promise.all(modules.map(module => {
                if (module.close) return module.close().catch(err => error = error || err);
            }));
            if (self.connecting || self.connected) {
                _.defer(() => !self.disconnected && ib.exit().catch(logger.error));
                await once_disconnected.catch(err => error = error || err);
            }
            if (store) await store.close().catch(err => error = error || err);
            await time_limit.close().catch(err => error = error || err);
            if (error) throw error;
        },
        async pending() {
            return time_limit.pending().map(item => ({label: item.label, options: item.args}));
        }
    });
}

function reqPositions(ib) {
    const positions = {};
    let positions_end, positions_fail;
    let promise_positions = Promise.resolve();
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (isGeneralError(id_or_str, err_code, err_msg)) {
            if (positions_fail) positions_fail(err_msg || id_or_str);
        }
    }).on('exit', () => {
        if (positions_fail) positions_fail(Error("TWS has disconnected"));
    }).on('position', function(account, contract, position, averageCost) {
        const acct = positions[account] = positions[account] || {};
        acct[contract.conid] = {position, averageCost};
    }).on('positionEnd', function() {
        const ready = positions_end;
        _.defer(() => {
            ib.cancelPositions().catch(logger.error);
            if (ready) ready(positions);
        });
    });
    return {
        reqPositions() {
            return promise_positions = promise_positions.catch(logger.debug)
              .then(() => new Promise((ready, fail) => {
                positions_end = ready;
                positions_fail = fail;
                logger.log('reqPositions');
                ib.reqPositions().catch(fail);
            }));
        }
    };
}

function currentTime(ib) {
    let received, fail, promise = Promise.resolve();
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (isGeneralError(id_or_str, err_code, err_msg)) {
            if (fail) fail(err_msg || id_or_str);
        }
    }).on('exit', () => {
        if (fail) fail(Error("TWS has disconnected"));
    }).on('currentTime', function(time) {
        received(time);
    });
    return {
        reqCurrentTime() {
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                ib.reqCurrentTime().catch(reject);
            }));
        }
    };
}

function requestFA(ib) {
    let fa_disabled;
    let received, fail, promise = Promise.resolve();
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (err_code == 321) {
            // Server error when validating an API client request.
            fa_disabled = err_msg;
            if (fail) fail(err_msg);
        } else if (isGeneralError(id_or_str, err_code, err_msg)) {
            // Error validating request: FA data operations ignored for non FA customers.
            if (err_code == 321 && received) received([]);
            else if (fail) fail(err_msg || id_or_str);
        }
    }).on('exit', () => {
        if (fail) fail(Error("TWS has disconnected"));
    }).on('receiveFA', function(faDataType, faXmlData) {
        received(_.flatten(_.values(parseXml(faXmlData)).map(_.values)).map(entry => {
            if (entry.ListOfAccts && entry.ListOfAccts.String)
                return Object.assign({}, entry, {ListOfAccts: [].concat(entry.ListOfAccts.String)});
            else if (entry.ListOfAllocations && entry.ListOfAllocations.Allocation)
                return Object.assign({}, entry, {ListOfAllocations: [].concat(entry.ListOfAllocations.Allocation)});
            else return entry;
        }));
    });
    return {
        requestGroups() {
            if (fa_disabled) throw fa_disabled;
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(getFaDataType('GROUPS')).catch(reject);
            }));
        },
        requestProfiles() {
            if (fa_disabled) throw fa_disabled;
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(getFaDataType('PROFILES')).catch(reject);
            }));
        },
        requestAliases() {
            if (fa_disabled) throw fa_disabled;
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(getFaDataType('ALIASES')).catch(reject);
            }));
        }
    };
}

function accountUpdates(ib, time_limit, store, ib_tz) {
    const managed_accounts = [];
    const subscriptions = {};
    const req_queue = {};
    let closed = false;
    const save = async(acctCode, month, summary) => {
        if (!store || closed) return summary;
        return store.open(acctCode, async(err, db) => {
            if (err) throw err;
            const balances = await db.collection('balances');
            return balances.lockWith([month], async() => {
                const values = balances.exists(month) ?
                    await balances.readFrom(month) : [];
                const last_time = (_.last(values)||{}).time || '';
                const last_net = (_.last(values)||{}).NetLiquidationByCurrency;
                const current_time = summary.time || '';
                const current_net = _.omit(summary.NetLiquidationByCurrency,'BASE');
                if (!values.length || last_time < current_time && !_.isMatch(last_net, current_net)) {
                    const replacement = values.concat(summary);
                    await balances.replaceWith(replacement, month);
                }
                return summary;
            });
        });
    };
    const flush = debounce(async() => {
        if (!store || closed) return;
        return Promise.all(_.values(subscriptions).map(reqId => {
            const summary = req_queue[reqId] && req_queue[reqId].summary;
            const month = moment().tz(ib_tz).format('YYYYMM');
            if (summary && summary.AccountCode && summary.time)
                return save(summary.AccountCode, month, summary);
        })).catch(err => logger.error("Could not flush IB balances", err));
    }, 60*1000); // 1m
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (req_queue[id_or_str]) {
            req_queue[id_or_str].fail(err_msg || id_or_str);
        } else if (isGeneralError(id_or_str, err_code, err_msg)) {
            Object.keys(req_queue).forEach(reqId => {
                const task = req_queue[reqId];
                delete req_queue[reqId];
                task.fail(err_msg || id_or_str);
            });
        }
    }).on('exit', () => {
        const err = Error("TWS has disconnected");
        Object.keys(req_queue).forEach(reqId => {
            const task = req_queue[reqId];
            delete req_queue[reqId];
            task.fail(err);
        });
    }).on('managedAccounts', accountsList => {
        _.compact(accountsList.split(',')).forEach(account => {
            if (!~managed_accounts.indexOf(account))
                managed_accounts.push(account);
        });
    }).on('updateAccountTime', function(timestamp) {
        _.values(req_queue).forEach(item => {
            item.summary.updateAccountTime = timestamp;
            const summary = item.summary;
            const F = 'YYYYMMDD HH:mm:ss';
            const now = moment().tz(ib_tz);
            const minutes = summary.updateAccountTime ? `${summary.updateAccountTime}:00` : '';
            const asof = minutes ? moment.tz(`${now.format('YYYY-MM-DD')} ${minutes}`, ib_tz) : now;
            summary.time = asof.isValid() ? asof.format(F) : now.format(F);
        });
    }).on('accountUpdateMulti', function(reqId, account, modelCode, key, value, currency) {
        if (req_queue[reqId]) {
            logger.debug('accountUpdateMulti', reqId, account, modelCode);
            const acct = req_queue[reqId].summary;
            acct[key] = currency ? acct[key] || (currency == value ? [] : {}) : value;
            if (currency && !_.isArray(acct[key])) acct[key][currency] = value;
            else if (_.isArray(acct[key]) && !~acct[key].indexOf(value)) acct[key].push(value);
        }
        if (!closed) flush();
    }).on('accountUpdateMultiEnd', function(reqId) {
        // TWS only returns one accountUpdateMultiEnd signal for each account
        logger.debug('accountUpdateMultiEnd', reqId);
        _.values(req_queue).filter(item => {
            return req_queue[reqId]
                && item.acctCode == req_queue[reqId].acctCode
                && item.modelCode == req_queue[reqId].modelCode;
        }).forEach(item => {
            item.complete = true;
            const summary = req_queue[reqId].summary;
            new Promise((ready, abort) => {
                if (closed) throw Error("TWS has disconnected");
                if (!~_.values(subscriptions).indexOf(+item.reqId)) {
                    logger.log('cancelAccountUpdatesMulti', item.acctCode);
                    logger.debug('cancelAccountUpdatesMulti', item.reqId, item.acctCode);
                    ib.cancelAccountUpdatesMulti(+item.reqId).catch(abort);
                    delete req_queue[item.reqId];
                }
                return ready(summary);
            }).then(item.ready, item.fail);
        });
    });
    const reqAccountUpdate = time_limit(async(acctCode, modelCode) => {
        const now = moment().tz(ib_tz).millisecond(0).seconds(0).subtract(1,'minutes');
        return new Promise((ready, fail) => {
            if (closed) throw Error("TWS has disconnected");
            const sub = req_queue[subscriptions[acctCode]];
            if (sub && sub.complete && sub.acctCode == acctCode && !modelCode) {
                ready(sub.summary);
            } else {
                const reqId = nextval();
                req_queue[reqId] = {reqId, acctCode, modelCode, summary:{}, ready, fail};
                if (~managed_accounts.indexOf(acctCode) && !modelCode)
                    subscriptions[acctCode] = +reqId;
                logger.log('reqAccountUpdatesMulti', acctCode, modelCode || '', false);
                logger.debug('reqAccountUpdatesMulti', +reqId, acctCode, modelCode || '', false);
                ib.reqAccountUpdatesMulti(+reqId, acctCode, modelCode || '', false).catch(fail);
            }
        });
    }, "ib-client reqAccountUpdatesMulti");
    return {
        reqAccountUpdate,
        reqAccountHistory(acctCode, time) {
            const min_month = time ? moment.tz(time.substring(0, 8), ib_tz).format('YYYYMM') : '';
            if (!store) return [];
            else if (closed) throw Error("IB client has closed");
            else return store.open(acctCode, async(err, db) => {
                if (err) throw err;
                const balances = await db.collection('balances');
                const months = balances.listNames().filter(month => min_month <= month);
                return balances.lockWith(months, async() => {
                    return months.reduce(async(promise, month) => {
                        const result = await promise;
                        const values = balances.exists(month) ?
                            await balances.readFrom(month) : [];
                        const filtered = values.filter(balance => time <= balance.time);
                        if (filtered.length) return result.concat(filtered);
                        else return result;
                    }, Promise.resolve([]));
                });
            });
        },
        async close() {
            await Promise.all(_.values(subscriptions).map(reqId => ib.cancelAccountUpdatesMulti(+reqId)));
            _.values(req_queue).forEach(item => item.fail(Error("IB client is closing")));
            return flush.flush().then(() => closed = true, err => {
                closed = true;
                throw err;
            });
        }
    };
}

function openOrders(ib, time_limit, store, ib_tz, clientId) {
    const self = this;
    const F = 'YYYYMMDD HH:mm:ss';
    let last_order_id = 0;
    const next_valid_id_queue = [];
    const placing_orders = {};
    const cancelling_orders = {};
    const watching_orders = {};
    const orders = {};
    const order_log = {};
    const managed_accounts = [];
    let flushed = false, closed = false;
    let orders_end, orders_fail;
    let promise_orders = Promise.resolve();
    let order_id_lock = Promise.resolve();
    const log = order => {
        const ord = _.mapObject(order, v => Number.isNaN(v) || v == Number.MAX_VALUE ? null : v);
        const account = order.account || order.faGroup || order.faProfile;
        if (account) {
            const acct_log = order_log[account] = order_log[account] || [];
            const matcher = _.matcher(_.omit(ord, 'posted_time', 'time'));
            if (!acct_log.reduceRight((found, entry) => found || matcher(entry), false)) {
                acct_log.push(ord);
            }
        }
        return ord;
    };
    const flusher = debounce(async() => {
        if (!store || closed) return;
        return Object.keys(order_log).reduce(async(promise, acctCode) => {
            if (closed) return;
            return store.open(acctCode, async(err, db) => {
                if (err) throw err;
                const acct_log = order_log[acctCode].splice(0, order_log[acctCode].length);
                if (!acct_log.length) return;
                const coll = await db.collection('orders');
                const first = moment.tz(_.first(acct_log).time, F, ib_tz).startOf('month');
                const last = moment.tz(_.last(acct_log).time, F, ib_tz).startOf('month');
                const months = _.compact([_.last(coll.listNames()), first.format('YYYYMM')]);
                while (first.isBefore(last)) months.push(first.add(1,'month').format('YYYYMM'));
                const posted_times = {};
                return coll.lockWith(_.uniq(months), async() => {
                    return months.reduce(async(promise, month) => {
                        const start = await promise;
                        const end = moment.tz(month, 'YYYYMM', ib_tz).add(1,'month').format(F);
                        const finish = _.sortedIndex(acct_log, {time: end}, 'time');
                        const values = coll.exists(month) ?
                            await coll.readFrom(month) : [];
                        values.reduce((posted_times, ord) => {
                            if (orders[ord.orderId] && orders[ord.orderId].permId == ord.permId) {
                                const posted = _.sortBy([orders[ord.orderId].posted_time, ord.posted_time])[0];
                                orders[ord.orderId].posted_time = posted;
                                posted_times[ord.orderId] = posted;
                            }
                            return posted_times;
                        }, posted_times);
                        if (start != end) {
                            const replacement = values.concat(acct_log.slice(start, finish).filter(ord => {
                                if (posted_times[ord.orderId]) ord.posted_time = posted_times[ord.orderId];
                                return ord;
                            }));
                            await coll.replaceWith(replacement, month);
                        }
                        return end;
                    }, Promise.resolve(0));
                });
            });
        }, Promise.resolve()).catch(err => logger.error("Could not flush IB orders", err));
    }, 10*60*1000); // 10m
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (placing_orders[id_or_str]) {
            const id = id_or_str;
            if (err_code == 481) { // Order size was reduced warning
                logger.debug('placeOrder', placing_orders[id].contract, placing_orders[id].order, err_msg);
            } else if (err_code >= 2000 && err_code < 3000) { // warning
                logger.debug('placeOrder', placing_orders[id].contract, placing_orders[id].order, err_msg);
            } else {
                placing_orders[id_or_str].fail(err_msg);
                delete placing_orders[id_or_str];
            }
        } else if (err_code == 202 || cancelling_orders[id_or_str]) {
            if (err_code == 202 && cancelling_orders[id_or_str]) {
                cancelling_orders[id_or_str].ready({...orders[id_or_str], status: 'ApiCancelled'});
                delete cancelling_orders[id_or_str];
            } else if (cancelling_orders[id_or_str]) {
                cancelling_orders[id_or_str].fail(err_msg);
                delete cancelling_orders[id_or_str];
            }
        } else if (err_code == 201) {
            // Order rejected
            const order = orders[id_or_str];
            if (order) {
                const m = (err_msg||'')
                  .match(/CASH AVAILABLE: (\d+\.\d+); CASH NEEDED FOR THIS ORDER AND OTHER PENDING ORDERS: (\d+\.\d+)/);
                // Only reduce quant if quant is whole number
                const whole = +order.totalQuantity == Math.round(order.totalQuantity);
                if (m && +order.totalQuantity && whole && order.secType == 'STK') {
                    const [, avail, needed] = m;
                    const totalQuantity = Math.floor(order.totalQuantity * avail / needed);
                    if (+totalQuantity != +order.totalQuantity) {
                        const contract = _.pick(order, 'conid', 'exchange', 'currency');
                        const update = {
                            ..._.omit(order, v => Number.isNaN(v) || v == Number.MAX_VALUE),
                            totalQuantity,
                            remaining: totalQuantity
                        };
                        self.reqId(orderId => {
                            logger.log('placeOrder', orderId, contract, update);
                            return ib.placeOrder(orderId, contract, update);
                        }).catch(err => logger.error("update order quant error", err_msg));
                    }
                }
            }
        } else if (err_code == 103 && orders[id_or_str]) {
            // An order was placed with an order ID that is less than or
            // equal to the order ID of a previous order from this client
            orders[id_or_str].status = 'Duplicate';
        } else if (err_code == 104 && orders[id_or_str]) {
            // An attempt was made to modify an order which has already been filled by the system.
            orders[id_or_str].status = 'Filled';
        } else if (err_code >= 2000 && err_code < 3000) {
            // warning
        } else if (isGeneralError(id_or_str, err_code, err_msg)) {
            Object.entries(placing_orders).forEach(([orderId, req]) => {
                delete placing_orders[orderId];
                req.fail(err_msg || id_or_str);
            });
            Object.entries(cancelling_orders).forEach(([orderId, req]) => {
                delete cancelling_orders[orderId];
                req.fail(err_msg || id_or_str);
            });
            Object.entries(watching_orders).forEach(([orderId, req]) => {
                delete watching_orders[orderId];
                req.fail(err_msg || id_or_str);
            });
            if (orders_fail) orders_fail(err_msg || id_or_str);
        }
    }).on('exit', () => {
        const err = Error("TWS has disconnected");
        Object.entries(placing_orders).forEach(([orderId, req]) => {
            req.fail(err);
            delete placing_orders[orderId];
        });
        Object.entries(cancelling_orders).forEach(([orderId, req]) => {
            req.fail(err);
            delete cancelling_orders[orderId];
        });
        Object.entries(watching_orders).forEach(([orderId, req]) => {
            req.fail(err);
            delete watching_orders[orderId];
        });
        if (orders_fail) orders_fail(err);
    }).on('nextValidId', order_id => {
        const next_id = last_order_id < order_id ? order_id : ++last_order_id;
        const next = next_valid_id_queue.shift();
        if (next) next(next_id);
    }).on('managedAccounts', accountsList => {
        _.compact(accountsList.split(',')).forEach(account => {
            if (!~managed_accounts.indexOf(account))
                managed_accounts.push(account);
        });
    }).on('openOrder', function(orderId, contract, order, orderStatus) {
        const time = moment().tz(ib_tz).milliseconds(0).format(F);
        expandComboLegs(self, contract).then(comboLegs => {
            orders[orderId] = Object.assign({
                    orderId,
                    conid: contract.conid,
                    comboLegsDescrip: contract.comboLegsDescrip,
                    symbol: contract.symbol,
                    localSymbol: contract.localSymbol,
                    secType: contract.secType,
                    exchange: contract.exchange,
                    primaryExch: contract.primaryExch,
                    currency: contract.currency,
                    multiplier: contract.multiplier,
                    posted_time: time, time
                },
                comboLegs,
                orders[orderId],
                {time},
                order, orderStatus
            );
            if (placing_orders[orderId] && placing_orders[orderId].status) {
                placing_orders[orderId].ready(orders[orderId]);
                delete placing_orders[orderId];
            } else if (placing_orders[orderId]) {
                logger.trace("waiting for palced order status", orderId);
            }
            if (flushed) flusher.flush();
            else flusher();
        }, err => logger.error);
    }).on('orderStatus', function(orderId, status, filled, remaining, avgFillPrice,
            permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice) {
        const order = orders[orderId] || {};
        if (orders[orderId] && orders[orderId].action)
            logger.info("order", orderId, `${order.orderRef || ''}`, order.action, order.symbol,
                status, order.orderType, order.tif, filled, '/', remaining, avgFillPrice);
        orders[orderId] = log(Object.assign({}, order, {
            time: moment().tz(ib_tz).milliseconds(0).format(F),
            status, filled, remaining, avgFillPrice, permId, parentId,
            lastFillPrice, clientId, whyHeld, mktCapPrice
        }));
        if (watching_orders[orderId]) {
            watching_orders[orderId].ready(orders[orderId]);
            delete watching_orders[orderId];
        }
        if (cancelling_orders[orderId] && ~status.indexOf('Cancel')) {
            cancelling_orders[orderId].ready(orders[orderId]);
            delete cancelling_orders[orderId];
        }
        if (placing_orders[orderId] && ~status.indexOf('Cancel')) {
            placing_orders[orderId].fail(Error(`${status} ${placing_orders[orderId].orderRef || orderId}`));
            delete placing_orders[orderId];
        } else if (placing_orders[orderId] && ~status.indexOf('Inactive')) {
            _.defer(() => { // if no errors, Inactive orders are successful
                if (placing_orders[orderId] && orders[orderId].action) {
                    placing_orders[orderId].ready(orders[orderId]);
                    delete placing_orders[orderId];
                }
            });
        } else if (placing_orders[orderId] && orders[orderId].action) {
            placing_orders[orderId].ready(orders[orderId]);
            delete placing_orders[orderId];
        }
        if (flushed) flusher.flush();
        else flusher();
    }).on('openOrderEnd', function() {
        flusher.flush().then(() => _.values(orders).filter(order => {
            const status = order.status;
            return status != 'Filled' && status != 'Cancelled' &&
                status != 'Inactive' && status != 'Duplicate' &&
                status != 'Untransmitted';
        })).then(orders => {
            if (orders.every(ord => ord.conid)) return orders;
            // give the system 1s for orderStatus, otherwise continue without those orders
            else return new Promise(ready => setTimeout(ready, 1000)).then(() => orders.filter(ord => ord.conid));
        }).then(orders_end, orders_fail);
    });
    return {
        async reqId(cb) {
            // IB requires orderIds to be used in sequence
            return order_id_lock = order_id_lock.catch(err => {}).then(() => {
                return new Promise((ready, abort) => {
                    next_valid_id_queue.push(ready);
                    return ib.reqIds(1).catch(abort);
                });
            }).then(cb);
        },
        placeOrder: time_limit(async(orderId, contract, order) => {
            logger.log('placeOrder', orderId, contract, order);
            await ib.placeOrder(orderId, contract, order);
            if (!order.transmit) {
                const placed = orders[orderId] = _.omit({
                    orderId,
                    conid: contract.conid,
                    symbol: contract.symbol,
                    localSymbol: contract.localSymbol,
                    secType: contract.secType,
                    exchange: contract.exchange,
                    primaryExch: contract.primaryExch,
                    currency: contract.currency,
                    multiplier: contract.multiplier,
                    status: 'Untransmitted',
                    ...await expandComboLegs(self, contract),
                    ...order
                }, v => v == null);
                return new Promise(ready => {
                    setTimeout(() => ready(placed), 1000);
                });
            }
            else return new Promise((ready, fail) => {
                const hdlr = combineListeners(placing_orders, orderId, {ready, fail, orderId, contract, order});
                const check_order = timeout => {
                    if (placing_orders[orderId] === hdlr) {
                        // Paper accounts don't change order status until filled
                        logger.log('reqOpenOrders');
                        ib.reqOpenOrders().catch(logger.error);
                        setTimeout(check_order.bind(this, Math.min(timeout*2,60000)), timeout).unref();
                    }
                };
                setTimeout(check_order.bind(this, 5000), 1000).unref();
            }).catch(err => logger.warn('placeOrder', orderId, contract, order, err.message) || Promise.reject(err));
        }, "ib-client placeOrder"),
        cancelOrder: time_limit(async(orderId) => {
            logger.log('cancelOrder', orderId);
            await ib.cancelOrder(orderId);
            return new Promise((ready, fail) => {
                const hdlr = combineListeners(cancelling_orders, orderId, {ready, fail});
                const check_order = timeout => {
                    if (cancelling_orders[orderId] === hdlr) {
                        // ApiCancelled does not trigger a notification, such as when market is closed
                        logger.log('reqOpenOrders');
                        ib.reqOpenOrders().catch(logger.error);
                        setTimeout(check_order.bind(this, Math.min(timeout*2,60000)), timeout).unref();
                    }
                };
                setTimeout(check_order.bind(this, 5000), 1000).unref();
            }).catch(err => logger.warn('cancelOrder', orderId, err.message) || Promise.reject(err));
        }, "ib-client cancelOrder"),
        async watchOrder(orderId, timeout) {
            const timer = setTimeout(() => {
                if (watching_orders[orderId] && orders[orderId]) {
                    watching_orders[orderId].ready(orders[orderId]);
                    delete watching_orders[orderId];
                } else if (watching_orders[orderId]) {
                    watching_orders[orderId].fail(Error("Order status has not changed"));
                    delete watching_orders[orderId];
                }
            }, timeout).unref();
            return new Promise((ready, fail) => {
                combineListeners(watching_orders, orderId, {ready, fail});
            }).then(result => clearTimeout(timer) || result, err => clearTimeout(timer) || Promise.reject(err));
        },
        async reqRecentOrders() {
            return _.values(orders).filter(order => {
                const status = order.status;
                return status != 'Filled' && status != 'Cancelled' &&
                    status != 'Inactive' && status != 'Duplicate' &&
                    status != 'Untransmitted';
            });
        },
        reqOpenOrders() {
            return promise_orders = promise_orders.catch(logger.debug)
              .then(() => new Promise((ready, fail) => {
                orders_end = ready;
                orders_fail = fail;
                logger.log('reqOpenOrders');
                ib.reqOpenOrders().catch(fail);
            })).then(orders => orders.filter(order => order.clientId == clientId));
        },
        reqAllOpenOrders() {
            return promise_orders = promise_orders.catch(logger.debug)
              .then(() => new Promise((ready, fail) => {
                orders_end = ready;
                orders_fail = fail;
                logger.log('reqAllOpenOrders');
                ib.reqAllOpenOrders().catch(fail);
            }));
        },
        async reqCompletedOrders(filter) {
            const acctCode = (filter||{}).acctCode;
            const accounts = acctCode ? [acctCode] : managed_accounts;
            const time = (filter||{}).time;
            const min_month = time ? moment.tz(time.substring(0, 8), ib_tz).format('YYYYMM') : '';
            if (store) await flusher.flush();
            const condition = order => {
                const status = order.status;
                if (status != 'Filled' && status != 'Cancelled' && status != 'Inactive') return false;
                else if (filter.clientId && filter.clientId != order.clientId) return false;
                else if (filter.acctCode && filter.acctCode != order.account) return false;
                else if (filter.time && filter.time > order.time) return false;
                else if (filter.symbol && filter.symbol != order.symbol) return false;
                else if (filter.secType && filter.secType != order.secType) return false;
                else if (filter.exchange && filter.exchange != order.exchange) return false;
                else if (filter.side && filter.side.charAt(0) != order.side.charAt(0)) return false;
                return true;
            };
            const orders = await accounts.reduce((result, acctCode) => {
                if (!store) return order_log[acctCode] || [];
                return store.open(acctCode, async(err, db) => {
                    if (err) throw err;
                    const orders = await db.collection('orders');
                    const months = orders.listNames().filter(month => min_month <= month);
                    return orders.lockWith(months, async() => {
                        return months.reduce(async(promise, month) => {
                            const result = await promise;
                            const values = orders.exists(month) ?
                                await orders.readFrom(month) : [];
                            const filtered = values.filter(condition);
                            if (filtered.length) return result.concat(filtered);
                            else return result;
                        }, Promise.resolve(result));
                    });
                });
            }, Promise.resolve([]));
            if (!filter) return orders;
            return orders;
        },
        reqAutoOpenOrders: time_limit(async(autoBind) => {
            logger.log('reqAutoOpenOrders', autoBind);
            return ib.reqAutoOpenOrders(autoBind);
        }, "ib-client reqAutoOpenOrders"),
        close() {
            flushed = true;
            return flusher.flush().then(() => closed = true, err => {
                closed = true;
                throw err;
            });
        }
    };
}

function execDetails(ib, time_limit, store, ib_tz) {
    const details = {};
    const commissions = {};
    const req_queue = {};
    const managed_accounts = [];
    const today = moment().tz(ib_tz).format('YYYYMMDD');
    let flushed = false, closed = false;
    const reduce_details = async(filter, cb, initial) => {
        const min_month = ((filter||{}).time||'').substring(0, 6);
        const acctNumbers = (filter||{}).acctCode ? [filter.acctCode] :
            _.union(managed_accounts, Object.keys(details));
        return acctNumbers.reduce(async(promise, acctCode) => {
            const memo = await promise;
            if (!store || closed) return Object.keys(details[acctCode]||{}).reduce(async(promise, month) => {
                const memo = await promise;
                return _.values(details[acctCode][month]).reduce((memo, exe) => {
                    const item = exe.execId in commissions ?
                        Object.assign(exe, commissions[exe.execId]) : exe;
                    return cb(memo, item);
                }, memo);
            }, initial);
            else return store.open(acctCode, async(err, db) => {
                if (err) throw err;
                const executions = await db.collection('executions');
                const months = _.union(executions.listNames(), Object.keys(details[acctCode]||{}))
                    .filter(month => min_month <= month);
                return executions.lockWith(months, async() => {
                    return months.reduce(async(promise, month) => {
                        const memo = await promise;
                        const existing = executions.exists(month) ?
                            await executions.readFrom(month) : [];
                        let corrected = false;
                        const acct = details[acctCode] = details[acctCode] || {};
                        const values = month in acct ? _.values(existing.reduce((hash, exe) => {
                            const key = exe.execId.substring(0, exe.execId.lastIndexOf('.'));
                            corrected |= hash[key] && hash[key].execId > exe.execId;
                            if (!hash[key] || hash[key].execId < exe.execId) hash[key] = exe;
                            return hash;
                        }, acct[month])) : existing;
                        const result = values.reduce((memo, exe) => {
                            const item = exe.execId in commissions ?
                                Object.assign(exe, commissions[exe.execId]) : exe;
                            return cb(memo, item);
                        }, memo);
                        if (corrected || existing.length < values.length) {
                            await executions.replaceWith(values, month);
                        }
                        return result;
                    }, memo);
                });
            });
        }, Promise.resolve(initial));
    };
    const flusher = debounce(async() => {
        return Promise.all(Object.keys(details).map(async(acctCode) => {
            const min_month = _.isEmpty(details[acctCode]) ? null : _.min(Object.keys(details[acctCode]));
            return store && !closed && reduce_details({time: min_month}, (nil, exe) => {}, null);
        })).catch(err => logger.error("Could not flush IB executions", err));
    }, 10000); // 10s
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (req_queue[id_or_str]) {
            req_queue[id_or_str].reject(err);
        } else if (isGeneralError(id_or_str, err_code, err_msg)) {
            Object.keys(req_queue).forEach(reqId => {
                const task = req_queue[reqId];
                delete req_queue[reqId];
                task.reject(err_msg || id_or_str);
            });
        }
    }).on('exit', () => {
        const err = Error("TWS has disconnected");
        Object.keys(req_queue).forEach(reqId => {
            const task = req_queue[reqId];
            delete req_queue[reqId];
            task.reject(err);
        });
    }).on('managedAccounts', accountsList => {
        _.compact(accountsList.split(',')).forEach(account => {
            if (!~managed_accounts.indexOf(account))
                managed_accounts.push(account);
        });
    }).on('execDetails', function(reqId, contract, exe) {
        const date = exe.time.substring(0, 8);
        const log = today <= date ? logger.info : logger.trace;
        log("execDetails", reqId, exe.time, exe.acctNumber, exe.side, exe.shares, exe.price);
        const month = exe.time.substring(0, 6);
        const key = exe.execId.substring(0, exe.execId.lastIndexOf('.'));
        const acct = details[exe.acctNumber] = details[exe.acctNumber] || {};
        const recent = acct[month] = acct[month] || {};
        recent[key] = Object.assign({}, {
            conid: contract.conid,
            comboLegsDescrip: contract.comboLegsDescrip,
            symbol: contract.symbol,
            localSymbol: contract.localSymbol,
            secType: contract.secType,
            exchange: contract.exchange,
            primaryExch: contract.primaryExch,
            currency: contract.currency,
            multiplier: contract.multiplier,
        }, exe);
        if (flushed) flusher.flush();
        else flusher();
    }).on('commissionReport', function(commissionReport) {
        const realizedPNL = commissionReport.realizedPNL == Number.MAX_VALUE ? '' : commissionReport.realizedPNL;
        logger.debug("commissionReport", commissionReport.commission, commissionReport.currency, realizedPNL);
        commissions[commissionReport.execId] = commissionReport;
        if (flushed) flusher.flush();
        else flusher();
    }).on('execDetailsEnd', function(reqId) {
        if (!req_queue[reqId]) return logger.warn('execDetailsEnd', reqId);
        (async() => {
            const filter = req_queue[reqId].filter || {};
            const executions = await reduce_details(filter, (executions, exe) => {
                if (filter.clientId && filter.clientId != exe.clientId) return executions;
                else if (filter.acctCode && filter.acctCode != exe.acctNumber) return executions;
                else if (filter.time && filter.time > exe.time) return executions;
                else if (filter.symbol && filter.symbol != exe.symbol) return executions;
                else if (filter.secType && filter.secType != exe.secType) return executions;
                else if (filter.exchange && filter.exchange != exe.exchange) return executions;
                else if (filter.side && filter.side.charAt(0) != exe.side.charAt(0)) return executions;
                executions.push(exe);
                return executions;
            }, []);
            if (req_queue[reqId]) return req_queue[reqId].resolve(executions);
        })().catch(err => req_queue[reqId] ? req_queue[reqId].reject(err) : logger.error(err));
    });
    return {
        async reqManagedAccts() {
            if (managed_accounts.length) return managed_accounts;
            else return new Promise(ready => {
                ib.once('managedAccounts', accountsList => {
                    ready(_.compact(accountsList.split(',')));
                });
            });
        },
        reqExecutions: time_limit((filter) => {
            return new Promise((ready, fail) => {
                const reqId = nextval();
                req_queue[reqId] = {
                    reqId,
                    filter: filter,
                    resolve(resolution) {
                        ready(resolution);
                        setImmediate(() => {
                            delete req_queue[reqId];
                        });
                    },
                    reject(err) {
                        logger.warn('reqExecutions', filter || '', err.message);
                        fail(err);
                        setImmediate(() => {
                            delete req_queue[reqId];
                        });
                    }
                };
                logger.log('reqExecutions', filter || '');
                ib.reqExecutions(reqId, filter || {}).catch(fail);
            });
        }, "ib-client reqExecutions"),
        close() {
            flushed = true;
            return flusher.flush().then(() => closed = true, err => {
                closed = true;
                throw err;
            });
        }
    };
}

function reqContract(ib, time_limit) {
    const req_queue = {};
    const reqContract = promiseThrottle(time_limit(function(conid) {
        return new Promise((ready, fail) => {
            const reqId = nextval();
            req_queue[reqId] = {
                reqId,
                resolve(resolution) {
                    ready(resolution);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                },
                reject(err) {
                    logger.warn('reqContractDetails', conid, err.message);
                    fail(err);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                }
            };
            logger.log('reqContractDetails', conid);
            ib.reqContractDetails(reqId, {conid}).catch(fail);
        });
    }, "ib-client reqContractDetails"), 1);
    const replaceEntry = contract => {
        if (contract.secType != 'BAG') {
            reqCachedContract.replaceEntry(contract.conid, contract);
        }
    };
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (req_queue[id_or_str]) {
            req_queue[id_or_str].reject(Error(err_msg));
        } else if (isGeneralError(id_or_str, err_code, err_msg)) {
            Object.keys(req_queue).forEach(reqId => {
                const task = req_queue[reqId];
                delete req_queue[reqId];
                task.reject(err_msg || id_or_str);
            });
        }
    }).on('exit', () => {
        const err = Error("TWS has disconnected");
        Object.keys(req_queue).forEach(reqId => {
            const task = req_queue[reqId];
            delete req_queue[reqId];
            task.reject(err);
        });
        reqCachedContract.close();
    }).on('updatePortfolio', function(contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, accountName) {
        replaceEntry(contract);
    }).on('position', function(account, contract, position, averageCost) {
        replaceEntry(contract);
    }).on('openOrder', function(orderId, contract, order, orderStatus) {
        replaceEntry(contract);
    }).on('contractDetails', (reqId, detail) => {
        if (req_queue[reqId]) req_queue[reqId].contract = detail.contract;
        replaceEntry(detail.contract);
    }).on('bondContractDetails', (reqId, detail) => {
        if (req_queue[reqId]) req_queue[reqId].contract = detail.contract;
        replaceEntry(detail.contract);
    }).on('contractDetailsEnd', reqId => {
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].contract);
    }).on('positionMulti', function(reqId, account, modelCode, contract, position, averageCost) {
        replaceEntry(contract);
    }).on('execDetails', function(reqId, contract, execution) {
        replaceEntry(contract);
    });
    const reqCachedContract = cache(reqContract, _.identity, 1000);
    return {reqContract: reqCachedContract};
}

function isGeneralError(id_or_str, err_code, err_msg) {
    if (id_or_str > 0) return false;
    else if (!err_code) return true;
    const code = err_code;
    if (code == 1101) return false; // Connectivity restored
    else if (code == 1102) return false; // Connectivity restored
    else if (code == 202) return false; // Order Canceled
    else if (code == 10167) return false; // Displaying delayed market data...
    else if (code >= 2000 && code < 3000) return false; // Warnings
    else return true;
}

function requestWithId(ib, time_limit) {
    const req_queue = {};
    const request = promiseThrottle(time_limit(function(cmd) {
        return new Promise((ready, fail) => {
            const reqId = nextval();
            const args = _.rest(_.toArray(arguments));
            const req = req_queue[reqId] = {
                reqId,
                cmd: cmd,
                args: args,
                ticks: 0,
                contractDetails: [],
                historicalData: [],
                tickData: {},
                resolve(resolution) {
                    ready(resolution);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                },
                reject(err) {
                    logger.warn(cmd, err.message || err, ...args.map(arg => {
                        return arg && (arg.localSymbol || arg.symbol || arg.comboLegsDescrip) || arg;
                    }));
                    if (cmd == 'reqMktData') ib.cancelMktData(reqId).catch(logger.error);
                    fail(err);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                },
                retry(err) {
                    req.retry = req.reject;
                    logger.log(cmd, err.message || err, ...args.map(arg => {
                        return arg && (arg.localSymbol || arg.symbol || arg.comboLegsDescrip) || arg;
                    }));
                    ib[cmd].call(ib, reqId, ...args).catch(fail);
                }
            };
            logger.log(cmd, ...args.map(arg => {
                return arg && (arg.localSymbol || arg.symbol || arg.comboLegsDescrip) || arg;
            }));
            ib[cmd].call(ib, reqId, ...args).catch(fail);
        });
    }, (cmd) => `ib-client ${cmd}`), 50);
    ib.on('error', function (id_or_str, err_code, err_msg) {
        if (req_queue[id_or_str]) {
            // E10167: Displaying delayed market data...
            if (err_code != 10167) _.delay(() => {
                const req = req_queue[id_or_str] || {};
                // E10197: connectivity problems or No market data during competing live session
                const fn = err_code == 10197 && req.retry || req.reject || _.noop;
                return fn(err_msg);
            }, err_code == 10197 ? 10000 : 0);
        } else if (isGeneralError(id_or_str, err_code, err_msg)) {
            Object.keys(req_queue).forEach(reqId => {
                const task = req_queue[reqId];
                delete req_queue[reqId];
                task.reject(err_msg || id_or_str);
            });
        }
    }).on('exit', () => {
        const err = Error("TWS has disconnected");
        Object.keys(req_queue).forEach(reqId => {
            const task = req_queue[reqId];
            delete req_queue[reqId];
            task.reject(err);
        });
    }).on('contractDetails', (reqId, contract) => {
        if (req_queue[reqId]) req_queue[reqId].contractDetails.push(contract);
    }).on('bondContractDetails', (reqId, contract) => {
        if (req_queue[reqId]) req_queue[reqId].contractDetails.push(contract);
    }).on('contractDetailsEnd', reqId => {
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].contractDetails);
    }).on('historicalData', (reqId, bar) => {
        const completedIndicator = 'finished';
        if (req_queue[reqId] && bar.time.substring(0, completedIndicator.length) == completedIndicator)
            return req_queue[reqId].resolve(req_queue[reqId].historicalData);
        if (req_queue[reqId]) req_queue[reqId].historicalData.push(_.omit(bar, v => v < 0));
    }).on('historicalDataEnd', (reqId, start, end) => {
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].historicalData);
    }).on('fundamentalData', (reqId, data) => {
        if (req_queue[reqId]) req_queue[reqId].resolve(parseXml(data));
    }).on('tickEFP', function (tickerId, tickType, basisPoints, formattedBasisPoints,
            impliedFuturesPrice, holdDays, futureLastTradeDate, dividendImpact, dividendsToLastTradeDate) {
        const tick = _.omit({
            basisPoints, formattedBasisPoints,
            impliedFuturesPrice, holdDays, futureLastTradeDate,
            dividendImpact, dividendsToLastTradeDate
        }, v => v == null);
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = tick;
        if (isTickComplete(ib, req_queue[tickerId])) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('tickGeneric', function (tickerId, tickType, value) {
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = value;
        if (isTickComplete(ib, req_queue[tickerId])) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('tickOptionComputation', function (tickerId, tickType, iv, delta, optPrice,
            pvDividend, gamma, vega, theta, undPrice) {
        const tick = _.omit({iv, delta, optPrice,
            pvDividend, gamma, vega, theta, undPrice}, v => v == null);
        const cmd = (req_queue[tickerId]||{}).cmd;
        if (cmd == 'calculateImpliedVolatility' || cmd == 'calculateOptionPrice')
            req_queue[tickerId].resolve(tick);
        else if (req_queue[tickerId])
            req_queue[tickerId].tickData[getTickTypeName(tickType)] = tick;
        if (isTickComplete(ib, req_queue[tickerId])) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('tickPrice', function (tickerId, tickType, price, attrib) {
        if (req_queue[tickerId] && price >= 0) req_queue[tickerId].tickData[getTickTypeName(tickType)] = price;
        else if (req_queue[tickerId]) delete req_queue[tickerId].tickData[getTickTypeName(tickType)];
        if (isTickComplete(ib, req_queue[tickerId])) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('tickSize', function (tickerId, tickType, size) {
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = size;
        if (isTickComplete(ib, req_queue[tickerId])) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('tickString', function (tickerId, tickType, value) {
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = value;
        if (isTickComplete(ib, req_queue[tickerId])) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('tickSnapshotEnd', function(tickerId) {
        if (req_queue[tickerId]) req_queue[tickerId].resolve(req_queue[tickerId].tickData);
    }).on('realtimeBar', function(tickerId, time, open, high, low, close, volume, wap, count) {
        ib.cancelRealTimeBars(tickerId).catch(logger.error);
        if (req_queue[tickerId]) req_queue[tickerId].resolve(_.omit({
            time, open, high, low, close, volume, wap, count
        }, value => value == -1));
    }).on('accountSummary', function(tickerId, account, tag, value, currency) {
        if (!req_queue[tickerId]) return;
        const sum = req_queue[tickerId].accountSummary = req_queue[tickerId].accountSummary || {};
        const acct = sum[account] = sum[account] || {};
        acct[tag] = currency ? acct[tag] || (currency == value ? [] : {}) : value;
        if (currency && !_.isArray(acct[tag])) acct[tag][currency] = value;
        else if (_.isArray(acct[tag]) && !~acct[tag].indexOf(value)) acct[tag].push(value);
    }).on('accountSummaryEnd', function(tickerId) {
        if (req_queue[tickerId]) req_queue[tickerId].resolve(req_queue[tickerId].accountSummary);
    }).on('positionMulti', function(reqId, account, modelCode, contract, position, averageCost) {
        if (!req_queue[reqId]) return;
        const sum = req_queue[reqId].positionMulti = req_queue[reqId].positionMulti || {};
        const model = modelCode ? sum[modelCode] = sum[modelCode] || {} : sum;
        const acct = account ? model[account] = model[account] || {} : model;
        acct[contract.conid] = {position, averageCost};
    }).on('positionMultiEnd', function(reqId) {
        ib.cancelPositionsMulti(+reqId).catch(logger.error);
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].positionMulti);
    });
    const reqContractDetails_cached = cache(
        request.bind(this, 'reqContractDetails'),
        ct => JSON.stringify(ct),
        1000
    );
    return {
        reqContractDetails(contract) {
            return reqContractDetails_cached(contract);
        },
        reqFundamentalData(contract, reportType) {
            return request('reqFundamentalData', contract, reportType);
        },
        reqHistoricalData: promiseThrottle((contract, endDateTime, durationString, barSizeSetting, whatToShow, useRTH, formatDate) => {
            return request('reqHistoricalData', contract, endDateTime, durationString,
                barSizeSetting, whatToShow, useRTH, formatDate, false, []);
        }, 50),
        reqMktData: promiseThrottle((contract, genericTickNameArray, snapshot, regulatorySnapshot, mktDataOptions) => {
            const genericTickList = (genericTickNameArray||[]).map(getTickTypeId).join(',');
            return request('reqMktData', contract, genericTickList, _.isEmpty(genericTickNameArray), regulatorySnapshot || false, mktDataOptions || []);
        }, 100),
        reqRealTimeBars(contract, whatToShow) {
            return request('reqRealTimeBars', contract, 0, whatToShow, false);
        },
        reqAccountSummary: promiseThrottle((group, tags) => {
            return request('reqAccountSummary', group || 'All', tags || getAllTags().join(','));
        }, 2),
        reqPositionsMulti(account, modelCode) {
            return request('reqPositionsMulti', account, modelCode || '');
        },
        calculateImpliedVolatility(contract, optionPrice, underPrice) {
            return request('calculateImpliedVolatility', contract, optionPrice, underPrice);
        },
        calculateOptionPrice(contract, volatility, underPrice) {
            return request('calculateOptionPrice', contract, volatility, underPrice);
        }
    };
}

function combineListeners(hash, key, handlers) {
    return hash[key] = hash[key] ? _.object(Object.keys(handlers).map(event => {
        if (typeof handlers[event] != 'function') return [event, handlers[event]];
        const listeners = hash[key][event].combined_listeners || [ hash[key][event] ];
        const combined_listeners = listeners.concat(handlers[event]);
        return [event, Object.assign(function() {
            return combined_listeners.reduce((ret, fn) => fn.apply(this, arguments), undefined);
        }, {combined_listeners})];
    })) : handlers;
}

async function expandComboLegs(self, contract) {
    const legs = !_.isEmpty(contract.comboLegs) ? contract.comboLegs :
            (contract.comboLegsDescrip||'').split(',').filter(item => item).map(descrip => {
        const [conid, ratio] = descrip.split('|', 2);
        const action = ratio > 0 ? 'BUY' : 'SELL';
        return {conid, ratio: Math.abs(ratio), action};
    });
    if (_.isEmpty(legs)) return {};
    const comboLegsDescrip = contract.comboLegsDescrip ? contract.comboLegsDescrip :
        legs.map(leg => {
            return `${leg.conid}|${leg.action == 'SELL' ? '-' : ''}${leg.ratio}`;
        }).join(',');
    const leg_contracts = await Promise.all(legs.map(async(leg) => self.reqContract(leg.conid)));
    const symbols = _.uniq(leg_contracts.map(leg => leg.symbol));
    const currencies = _.uniq(leg_contracts.map(leg => leg.currency));
    const exchanges = _.uniq(leg_contracts.map(leg => leg.exchange));
    return {
        secType: contract.secType || 'BAG',
        symbol: symbols.length == 1 ? symbols[0] : contract.symbol,
        currency: currencies.length == 1 ? currencies[0] : contract.currency,
        exchange: exchanges.length == 1 ? exchanges[0] : contract.exchange,
        comboLegsDescrip,
        comboLegs: legs.map((leg, i) => ({...leg,
            ..._.pick(leg_contracts[i], 'symbol', 'localSymbol', 'secType', 'exchange', 'primaryExch', 'currency', 'multiplier')
        }))
    };
}

function isTickComplete(ib, req) {
    if (!req || req.cmd != 'reqMktData') return false;
    const genericTickList = req.args[1];
    if (!genericTickList) return false;
    const genericTickNameArray = genericTickList.split(',').map(getTickTypeName);
    if (req.ticks++ < 100 && _.difference(genericTickNameArray, _.keys(req.tickData)).length) return false;
    if (!req.cancelled) {
        ib.cancelMktData(req.reqId).catch(logger.error);
        req.cancelled = true;
    }
    return true;
}

function parseXml(data) {
    return xml.parse(data, {
        ignoreAttributes: false,
        attributeNamePrefix: '',
        textNodeName: 'value'
    });
}

const TICK_TYPE = {
   BID_SIZE:0,
   BID:1,
   ASK:2,
   ASK_SIZE:3,
   LAST:4,
   LAST_SIZE:5,
   HIGH:6,
   LOW:7,
   VOLUME:8,
   CLOSE:9,
   BID_OPTION:10,
   ASK_OPTION:11,
   LAST_OPTION:12,
   MODEL_OPTION:13,
   OPEN:14,
   LOW_13_WEEK:15,
   HIGH_13_WEEK:16,
   LOW_26_WEEK:17,
   HIGH_26_WEEK:18,
   LOW_52_WEEK:19,
   HIGH_52_WEEK:20,
   AVG_VOLUME:21,
   OPEN_INTEREST:22,
   OPTION_HISTORICAL_VOL:23,
   OPTION_IMPLIED_VOL:24,
   OPTION_BID_EXCH:25,
   OPTION_ASK_EXCH:26,
   OPTION_CALL_OPEN_INTEREST:27,
   OPTION_PUT_OPEN_INTEREST:28,
   OPTION_CALL_VOLUME:29,
   OPTION_PUT_VOLUME:30,
   INDEX_FUTURE_PREMIUM:31,
   BID_EXCH:32,
   ASK_EXCH:33,
   AUCTION_VOLUME:34,
   AUCTION_PRICE:35,
   AUCTION_IMBALANCE:36,
   MARK_PRICE:37,
   BID_EFP_COMPUTATION:38,
   ASK_EFP_COMPUTATION:39,
   LAST_EFP_COMPUTATION:40,
   OPEN_EFP_COMPUTATION:41,
   HIGH_EFP_COMPUTATION:42,
   LOW_EFP_COMPUTATION:43,
   CLOSE_EFP_COMPUTATION:44,
   LAST_TIMESTAMP:45,
   SHORTABLE:46,
   FUNDAMENTAL_RATIOS:47,
   RT_VOLUME:48,
   HALTED:49,
   BID_YIELD:50,
   ASK_YIELD:51,
   LAST_YIELD:52,
   CUST_OPTION_COMPUTATION:53,
   TRADE_COUNT:54,
   TRADE_RATE:55,
   VOLUME_RATE:56,
   LAST_RTH_TRADE:57,
   RT_HISTORICAL_VOL:58,
   IB_DIVIDENDS:59,
   BOND_FACTOR_MULTIPLIER:60,
   REGULATORY_IMBALANCE:61,
   NEWS_TICK:62,
   SHORT_TERM_VOLUME_3_MIN:63,
   SHORT_TERM_VOLUME_5_MIN:64,
   SHORT_TERM_VOLUME_10_MIN:65,
   DELAYED_BID:66,
   DELAYED_ASK:67,
   DELAYED_LAST:68,
   DELAYED_BID_SIZE:69,
   DELAYED_ASK_SIZE:70,
   DELAYED_LAST_SIZE:71,
   DELAYED_HIGH:72,
   DELAYED_LOW:73,
   DELAYED_VOLUME:74,
   DELAYED_CLOSE:75,
   DELAYED_OPEN:76,
   RT_TRD_VOLUME:77,
   CREDITMAN_MARK_PRICE:78,
   CREDITMAN_SLOW_MARK_PRICE:79,
   DELAYED_BID_OPTION:80,
   DELAYED_ASK_OPTION:81,
   DELAYED_LAST_OPTION:82,
   DELAYED_MODEL_OPTION:83,
   LAST_EXCH:84,
   LAST_REG_TIME:85,
   FUTURES_OPEN_INTEREST:86,
   UNKNOWN:2147483647
};
const tick_type_names = _.object(_.values(TICK_TYPE), _.keys(TICK_TYPE).map(name => name.toLowerCase()));
function getTickTypeName(tickType) {
    return tick_type_names[tickType] || tickType;
}

function getTickTypeId(tickTypeName) {
    return TICK_TYPE[tickTypeName.toUpperCase()] || tickTypeName;
}

function getAllTags() {
    return [
        'AccountType',
        'NetLiquidation',
        'TotalCashValue',
        'SettledCash',
        'AccruedCash',
        'BuyingPower',
        'EquityWithLoanValue',
        'PreviousEquityWithLoanValue',
        'GrossPositionValue',
        'ReqTEquity',
        'ReqTMargin',
        'SMA',
        'InitMarginReq',
        'MaintMarginReq',
        'AvailableFunds',
        'ExcessLiquidity',
        'Cushion',
        'FullInitMarginReq',
        'FullMaintMarginReq',
        'FullAvailableFunds',
        'FullExcessLiquidity',
        'LookAheadNextChange',
        'LookAheadInitMarginReq',
        'LookAheadMaintMarginReq',
        'LookAheadAvailableFunds',
        'LookAheadExcessLiquidity',
        'HighestSeverity',
        'DayTradesRemaining',
        'Leverage',
        '$LEDGER:ALL'
    ];
}

function getFaDataType(name) {
    const FA_DATA_TYPE = {
      GROUPS: 1,
      PROFILES: 2,
      ALIASES: 3
    };
    return FA_DATA_TYPE[name];
}
