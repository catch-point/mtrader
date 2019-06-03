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
const IB = require('ib');
const logger = require('./logger.js');
const promiseThrottle = require('./throttle.js');
const debounce = require('./debounce.js');
const cache = require('./memoize-cache.js');
const storage = require('./storage.js');

let sequence_counter = (Date.now() * process.pid) % 32768;
function nextval() {
    return ++sequence_counter;
}

module.exports = function(settings) {
    const host = settings && settings.host || 'localhost';
    const port = settings && settings.port || 7496;
    const clientId = settings && _.isFinite(settings.clientId) ? settings.clientId : nextval();
    const lib_dir = settings && settings.lib_dir;
    const ib_tz = (settings||{}).tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const self = new.target ? this : {};
    let opened_client = createClient(host, port, clientId, lib_dir, ib_tz);
    let promise_ib, closed = false;
    const open = () => {
        if (opened_client && !opened_client.disconnected) return opened_client.open();
        else return promise_ib = (promise_ib || Promise.reject())
          .catch(err => ({disconnected: true})).then(client => {
            if (!client.disconnected) return client;
            opened_client = createClient(host, port, clientId, lib_dir, ib_tz);
            return opened_client.open();
        });
    };
    return Object.assign(self, _.mapObject(_.pick(opened_client, _.isFunction), (fn, cmd) => async function() {
        if (cmd == 'close') {
            closed = true;
            return opened_client.close();
        } else if (closed) {
            throw Error("IB API has been closed");
        } else if (cmd == 'open') {
            return open();
        } else {
            const client = await open();
            return client[cmd].apply(client, arguments);
        }
    }));
};


function createClient(host, port, clientId, lib_dir, ib_tz) {
    const ib = new IB({host, port, clientId});
    ib.setMaxListeners(20);
    const once_connected = new Promise((ready, fail) => {
        let first_error = null;
        ib.once('connected', () => {
            self.connecting = false;
            self.connected = true;
            self.disconnected = false;
            logger.debug("ib-client connected", host, port, clientId);
        }).once('error', (err, info) => {
            first_error = err;
            if (!self.connected) {
                self.connecting = false;
                self.connected = false;
                self.disconnected = true;
                fail(err);
            // Some error messages might just be warnings
            // @see https://groups.io/g/twsapi/message/40551
            } else if (info && info.code == 1101) {
                logger.info("ib-client", err.message);
            } else if (info && ~[2104, 2106, 2107, 2108].indexOf(info.code)) {
                logger.log("ib-client", err.message);
            } else if (info && info.code >= 2000 && info.code < 3000) {
                logger.warn("ib-client", err.message);
            } else {
                logger.error("ib-client", JSON.stringify(_.pick(err, _.keys(err))), err.message);
            }
        }).once('nextValidId', order_id => {
            ready();
        }).once('disconnected', () => {
            fail(first_error || Error("disconnected"));
        });
    });
    const once_disconnected = new Promise(ready => {
        once_connected.catch(err => {
            ready();
        });
        ib.once('disconnected', () => {
            self.connecting = false;
            self.connected = false;
            self.disconnected = true;
            logger.debug("ib-client disconnected", host, port, clientId);
            ready();
        });
    });
    const store = lib_dir && storage(lib_dir);
    const modules = [
        reqPositions(ib),
        currentTime(ib),
        requestFA(ib),
        accountUpdates(ib, store, ib_tz),
        openOrders(ib, store, ib_tz, clientId),
        execDetails(ib, store),
        reqContract(ib),
        requestWithId(ib)
    ];
    const self = new.target ? this : {};
    return Object.assign(self, ...modules, {
        connecting: false,
        connected: false,
        disconnected: false,
        async close() {
            let error;
            await Promise.all(modules.map(module => {
                if (module.close) return module.close().catch(err => error = error || err);
            }));
            if (self.connecting || self.connected) {
                if (!self.disconnected) ib.disconnect();
                await once_disconnected;
            }
            if (store) await store.close();
            if (error) throw error;
        },
        open() {
            if (!self.connecting && !self.connected && !self.disconnected) {
                self.connecting = true;
                ib.connect();
            }
            return once_connected.then(() => self);
        }
    });
}

function reqPositions(ib) {
    const positions = {};
    let positions_end, positions_fail;
    let promise_positions = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!isNormal(info)) {
            if (positions_fail) positions_fail(err);
        }
    }).on('disconnected', () => {
        if (positions_fail) positions_fail(Error("TWS has disconnected"));
    }).on('position', function(account, contract, position, averageCost) {
        const acct = positions[account] = positions[account] || {};
        acct[contract.conId] = {position, averageCost};
    }).on('positionEnd', function() {
        const ready = positions_end;
        _.defer(() => {
            ib.cancelPositions();
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
                ib.reqPositions();
            })).catch(err => logger.warn('reqPositions', err.message) || Promise.reject(err));
        }
    };
}

function currentTime(ib) {
    let received, fail, promise = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!isNormal(info)) {
            if (fail) fail(err);
        }
    }).on('disconnected', () => {
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
                ib.reqCurrentTime();
            })).catch(err => logger.warn('reqCurrentTime', err.message) || Promise.reject(err));
        }
    };
}

function requestFA(ib) {
    let received, fail, promise = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!isNormal(info)) {
            if (fail) fail(err);
        }
    }).on('disconnected', () => {
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
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(IB.FA_DATA_TYPE.GROUPS);
            })).catch(err => logger.warn('requestFA', err.message) || Promise.reject(err));
        },
        requestProfiles() {
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(IB.FA_DATA_TYPE.PROFILES);
            })).catch(err => logger.warn('requestFA', err.message) || Promise.reject(err));
        },
        requestAliases() {
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(IB.FA_DATA_TYPE.ALIASES);
            })).catch(err => logger.warn('requestFA', err.message) || Promise.reject(err));
        }
    };
}

function accountUpdates(ib, store, ib_tz) {
    const managed_accounts = [];
    const subscriptions = {};
    const req_queue = {};
    let closed = false;
    const save = async(acctCode, month, summary) => {
        if (!store) return summary;
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
        if (!store) return;
        return Promise.all(_.values(subscriptions).map(reqId => {
            const summary = req_queue[reqId].summary;
            const month = moment().tz(ib_tz).format('YYYYMM');
            return save(summary.AccountCode, month, summary);
        })).catch(err => logger.error("Could not flush IB balances", err));
    }, 60*1000); // 1m
    ib.on('error', function (err, info) {
        if (info && info.id && req_queue[info.id]) {
            req_queue[info.id].fail(err);
        }
    }).on('disconnected', () => {
        const err = Error("TWS has disconnected");
        Object.keys(req_queue).forEach(reqId => {
            req_queue[reqId].fail(err);
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
            const acct = req_queue[reqId].summary;
            acct[key] = currency ? acct[key] || (currency == value ? [] : {}) : value;
            if (currency && !_.isArray(acct[key])) acct[key][currency] = value;
            else if (_.isArray(acct[key]) && !~acct[key].indexOf(value)) acct[key].push(value);
        }
        if (!closed) flush();
    }).on('accountUpdateMultiEnd', function(reqId) {
        const item = req_queue[reqId];
        if (item) {
            new Promise(ready => {
                if (closed) throw Error("TWS has disconnected");
                const summary = item.summary;
                if (!~_.values(subscriptions).indexOf(+reqId)) {
                    ib.cancelAccountUpdatesMulti(+reqId);
                    delete req_queue[reqId];
                }
                return ready(summary);
            }).then(item.ready, item.fail);
        }
    });
    const reqAccountUpdate = async(acctCode, modelCode) => {
        const now = moment().tz(ib_tz).millisecond(0).seconds(0).subtract(1,'minutes');
        return new Promise((ready, fail) => {
            if (closed) throw Error("TWS has disconnected");
            const reqId = nextval();
            req_queue[reqId] = {reqId, acctCode, modelCode, summary:{}, ready, fail};
            if (~managed_accounts.indexOf(acctCode) && !modelCode)
                subscriptions[acctCode] = +reqId;
            logger.log('reqAccountUpdates', acctCode, modelCode || '', false);
            ib.reqAccountUpdatesMulti(+reqId, acctCode, modelCode || '', false);
        }).catch(err => logger.warn('reqAccountUpdates', err.message) || Promise.reject(err));
    };
    return {
        reqAccountUpdate,
        reqAccountHistory(acctCode, time) {
            const min_month = time ? moment.tz(time.substring(0, 8), ib_tz).format('YYYYMM') : '';
            if (!store) return [];
            return store.open(acctCode, async(err, db) => {
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
            closed = true;
            _.values(subscriptions).forEach(reqId => ib.cancelAccountUpdatesMulti(+reqId));
            _.values(req_queue).forEach(item => item.fail(Error("IB client is closing")));
            return flush.flush();
        }
    };
}

function openOrders(ib, store, ib_tz, clientId) {
    const F = 'YYYYMMDD HH:mm:ss';
    let last_order_id = 0;
    const valid_id_queue = [];
    const next_valid_id_queue = [];
    const placing_orders = {};
    const cancelling_orders = {};
    const orders = {};
    const order_log = {};
    const managed_accounts = [];
    let flushed = false;
    let orders_end, orders_fail;
    let promise_orders = Promise.resolve();
    const log = order => {
        const ord = _.mapObject(order, v => Number.isNaN(v) || v == Number.MAX_VALUE ? null : v);
        const account = order.account || order.faGroup || order.faProfile;
        const acct_log = order_log[account] = order_log[account] || [];
        if (!_.isMatch(_.last(acct_log), _.omit(ord, 'posted_time', 'time'))) acct_log.push(ord);
        return ord;
    };
    const flusher = debounce(async() => {
        if (!store) return;
        return Object.keys(order_log).reduce(async(promise, acctCode) => {
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
    ib.on('error', function (err, info) {
        if (info && info.id && placing_orders[info.id]) {
            //placing_orders[info.id].fail(err);
            //delete placing_orders[info.id];
        } else if (info && info.id && cancelling_orders[info.id]) {
            cancelling_orders[info.id].fail(err);
            delete cancelling_orders[info.id];
        } else if (!isNormal(info)) {
            Object.entries(placing_orders).forEach(([orderId, req]) => {
                req.fail(err);
                delete placing_orders[orderId];
            });
            Object.entries(cancelling_orders).forEach(([orderId, req]) => {
                req.fail(err);
                delete cancelling_orders[orderId];
            });
            if (orders_fail) orders_fail(err);
        }
    }).on('disconnected', () => {
        const err = Error("TWS has disconnected");
        Object.entries(placing_orders).forEach(([orderId, req]) => {
            req.fail(err);
            delete placing_orders[orderId];
        });
        Object.entries(cancelling_orders).forEach(([orderId, req]) => {
            req.fail(err);
            delete cancelling_orders[orderId];
        });
        if (orders_fail) orders_fail(err);
    }).on('nextValidId', order_id => {
        const next_id = last_order_id < order_id ? order_id : ++last_order_id;
        const next = next_valid_id_queue.shift();
        if (next) next(next_id);
        else valid_id_queue.push(next_id);
    }).on('managedAccounts', accountsList => {
        _.compact(accountsList.split(',')).forEach(account => {
            if (!~managed_accounts.indexOf(account))
                managed_accounts.push(account);
        });
    }).on('openOrder', function(orderId, contract, order, orderStatus) {
        const time = moment().tz(ib_tz).milliseconds(0).format(F);
        orders[orderId] = Object.assign({
                orderId,
                conId: contract.conId,
                symbol: contract.symbol,
                secType: contract.secType,
                exchange: contract.exchange,
                primaryExch: contract.primaryExch,
                currency: contract.currency,
                multiplier: contract.multiplier,
                posted_time: time, time
            },
            orders[orderId],
            {time},
            order, orderStatus
        );
        if (placing_orders[orderId]) {
            placing_orders[orderId].ready(orders[orderId]);
            delete placing_orders[orderId];
        }
        if (flushed) flusher.flush();
        else flusher();
    }).on('orderStatus', function(orderId, status, filled, remaining, avgFillPrice,
            permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice) {
        const order = orders[orderId] || {};
        logger.info(`${order.orderRef || orderId}`, order.action, order.symbol,
            status, order.orderType, order.tif, filled, '/', remaining, avgFillPrice);
        orders[orderId] = log(Object.assign({}, order, {
            time: moment().tz(ib_tz).milliseconds(0).format(F),
            status, filled, remaining, avgFillPrice, permId, parentId,
            lastFillPrice, clientId, whyHeld, mktCapPrice
        }));
        if (cancelling_orders[orderId]) {
            cancelling_orders[orderId].ready(orders[orderId]);
        }
        if (flushed) flusher.flush();
        else flusher();
    }).on('openOrderEnd', function() {
        flusher.flush().then(() => _.values(orders).filter(order => {
            const status = order.status;
            return status != 'Filled' && status != 'Cancelled' && status != 'Inactive';
        })).then(orders_end, orders_fail);
    });
    return {
        async reqId() {
            ib.reqIds(1);
            const order_id = valid_id_queue.shift();
            if (order_id) return last_order_id = order_id;
            return new Promise(ready => {
                if (valid_id_queue.length)
                    return ready(last_order_id = valid_id_queue.shift());
                const reqId = nextval();
                next_valid_id_queue.push(ready);
                ib.reqIds(1);
            });
        },
        async placeOrder(orderId, contract, order) {
            if (contract.secType == 'BAG' && !order.transmit) {
                logger.warn(`Transmit flag should be enabled to submit combo orders for ${contract.symbol} ${order.orderRef}`, orderId, contract, order);
            }
            logger.log('placeOrder', orderId, contract, order);
            ib.placeOrder(orderId, contract, order);
            if (!order.transmit) return orders[orderId] = _.omit({
                orderId,
                conId: contract.conId,
                symbol: contract.symbol || contract.localSymbol,
                secType: contract.secType,
                exchange: contract.exchange,
                primaryExch: contract.primaryExch,
                currency: contract.currency,
                multiplier: contract.multiplier,
                status: 'ApiPending',
                ...order
            }, v => v == null);
            else return new Promise((ready, fail) => {
                placing_orders[orderId] = {ready, fail};
            }).catch(err => logger.warn('placeOrder', orderId, contract, order, err.message) || Promise.reject(err));
        },
        async cancelOrder(orderId) {
            logger.log('cancelOrder', orderId);
            ib.cancelOrder(orderId);
            return new Promise((ready, fail) => {
                cancelling_orders[orderId] = {ready, fail};
            }).catch(err => logger.warn('cancelOrder', orderId, err.message) || Promise.reject(err));
        },
        reqRecentOrders() {
            return _.values(orders).filter(order => {
                const status = order.status;
                return status != 'Filled' && status != 'Cancelled' && status != 'Inactive';
            });
        },
        reqOpenOrders() {
            return promise_orders = promise_orders.catch(logger.debug)
              .then(() => new Promise((ready, fail) => {
                orders_end = ready;
                orders_fail = fail;
                logger.log('reqOpenOrders');
                ib.reqOpenOrders();
            })).then(orders => orders.filter(order => order.clientId == clientId))
              .catch(err => logger.warn('reqOpenOrders', err.message) || Promise.reject(err));
        },
        reqAllOpenOrders() {
            return promise_orders = promise_orders.catch(logger.debug)
              .then(() => new Promise((ready, fail) => {
                orders_end = ready;
                orders_fail = fail;
                logger.log('reqAllOpenOrders');
                ib.reqAllOpenOrders();
            })).catch(err => logger.warn('reqAllOpenOrders', err.message) || Promise.reject(err));
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
        async reqAutoOpenOrders(autoBind) {
            logger.log('reqAutoOpenOrders', autoBind);
            return ib.reqAutoOpenOrders(autoBind);
        },
        close() {
            flushed = true;
            return flusher.flush();
        }
    };
}

function execDetails(ib, store) {
    const details = {};
    const commissions = {};
    const req_queue = {};
    const managed_accounts = [];
    let flushed = false;
    const reduce_details = async(filter, cb, initial) => {
        const min_month = ((filter||{}).time||'').substring(0, 6);
        const acctNumbers = (filter||{}).acctCode ? [filter.acctCode] :
            _.union(managed_accounts, Object.keys(details));
        return acctNumbers.reduce(async(promise, acctCode) => {
            const memo = await promise;
            if (!store) return Object.keys(details[acctCode]||{}).reduce(async(promise, month) => {
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
            return store && reduce_details({time: min_month}, (nil, exe) => {}, null);
        })).catch(err => logger.error("Could not flush IB executions", err));
    }, 10000); // 10s
    ib.on('error', function (err, info) {
        if (info && info.id && req_queue[info.id]) {
            req_queue[info.id].reject(err);
        }
    }).on('disconnected', () => {
        const err = Error("TWS has disconnected");
        _.keys(req_queue).forEach(reqId => {
            req_queue[reqId].reject(err);
        });
    }).on('managedAccounts', accountsList => {
        _.compact(accountsList.split(',')).forEach(account => {
            if (!~managed_accounts.indexOf(account))
                managed_accounts.push(account);
        });
    }).on('execDetails', function(reqId, contract, exe) {
        logger.info("execDetails", reqId, exe.time, exe.acctNumber, exe.side, exe.shares, exe.price);
        const month = exe.time.substring(0, 6);
        const key = exe.execId.substring(0, exe.execId.lastIndexOf('.'));
        const acct = details[exe.acctNumber] = details[exe.acctNumber] || {};
        const recent = acct[month] = acct[month] || {};
        recent[key] = Object.assign({},
            {conId: contract.conId, symbol: contract.symbol, secType: contract.secType},
            exe
        );
        if (flushed) flusher.flush();
        else flusher();
    }).on('commissionReport', function(commissionReport) {
        logger.log("commissionReport", commissionReport.commission, commissionReport.currency, commissionReport.realizedPNL == Number.MAX_VALUE ? '' : commissionReport.realizedPNL);
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
            return req_queue[reqId].resolve(executions);
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
        reqExecutions(filter) {
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
                ib.reqExecutions(reqId, filter || {});
            });
        },
        close() {
            flushed = true;
            return flusher.flush();
        }
    };
}

function reqContract(ib) {
    const req_queue = {};
    const reqContract = promiseThrottle(function(conId) {
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
                    logger.warn('reqContractDetails', conId, err.message);
                    fail(err);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                }
            };
            logger.log('reqContractDetails', conId);
            ib.reqContractDetails(reqId, {conId});
        });
    }, 1);
    ib.on('error', function (err, info) {
        if (info && info.id && req_queue[info.id]) {
            req_queue[info.id].reject(err);
        }
    }).on('disconnected', () => {
        const err = Error("TWS has disconnected");
        _.keys(req_queue).forEach(reqId => {
            req_queue[reqId].reject(err);
        });
        reqCachedContract.close();
    }).on('updatePortfolio', function(contract) {
        reqCachedContract.replaceEntry(contract.conId, contract);
    }).on('position', function(account, contract, position, averageCost) {
        reqCachedContract.replaceEntry(contract.conId, contract);
    }).on('openOrder', function(orderId, contract, order, orderStatus) {
        reqCachedContract.replaceEntry(contract.conId, contract);
    }).on('contractDetails', (reqId, detail) => {
        if (req_queue[reqId]) req_queue[reqId].contract = detail.summary;
        reqCachedContract.replaceEntry(detail.summary.conId, detail.summary);
    }).on('bondContractDetails', (reqId, detail) => {
        if (req_queue[reqId]) req_queue[reqId].contract = detail.summary;
        reqCachedContract.replaceEntry(detail.summary.conId, detail.summary);
    }).on('contractDetailsEnd', reqId => {
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].contract);
    }).on('positionMulti', function(reqId, account, modelCode, contract, position, averageCost) {
        reqCachedContract.replaceEntry(contract.conId, contract);
    }).on('execDetails', function(reqId, contract, execution) {
        reqCachedContract.replaceEntry(contract.conId, contract);
    });
    const reqCachedContract = cache(reqContract, _.identity, 1000);
    return {reqContract: reqCachedContract};
}

function isNormal(info) {
    if (!info) return false;
    else if (info.id && info.id > 0) return false;
    const code = (info||{}).code;
    return code == 1101 || ~[2104, 2106, 2107, 2108].indexOf(code) ||  code >= 2000 && code < 3000;
}

function requestWithId(ib) {
    const req_queue = {};
    const request = promiseThrottle(function(cmd) {
        return new Promise((ready, fail) => {
            const reqId = nextval();
            const args = _.rest(_.toArray(arguments));
            req_queue[reqId] = {
                reqId,
                cmd: cmd,
                args: args,
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
                    logger.warn(cmd, ...args, err.message);
                    fail(err);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                }
            };
            logger.log(cmd, ...args.map(arg => {
                return arg && (arg.localSymbol || arg.symbol || arg.conId) || arg;
            }));
            ib[cmd].call(ib, reqId, ...args);
        });
    }, 50);
    ib.on('error', function (err, info) {
        if (info && info.id && req_queue[info.id]) {
            _.defer(() => ((req_queue[info.id]||{}).reject||logger.warn)(err));
        }
    }).on('disconnected', () => {
        const err = Error("TWS has disconnected");
        _.keys(req_queue).forEach(reqId => {
            req_queue[reqId].reject(err);
        });
    }).on('contractDetails', (reqId, contract) => {
        if (req_queue[reqId]) req_queue[reqId].contractDetails.push(contract);
    }).on('bondContractDetails', (reqId, contract) => {
        if (req_queue[reqId]) req_queue[reqId].contractDetails.push(contract);
    }).on('contractDetailsEnd', reqId => {
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].contractDetails);
    }).on('historicalData', (reqId, time, open, high, low, close, volume, count, wap, hasGaps) => {
        const completedIndicator = 'finished';
        if (req_queue[reqId] && time.substring(0, completedIndicator.length) == completedIndicator)
            return req_queue[reqId].resolve(req_queue[reqId].historicalData);
        const bar = _.omit({time, open, high, low, close, volume, wap, count}, value => value < 0);
        if (req_queue[reqId]) req_queue[reqId].historicalData.push(bar);
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
    }).on('tickPrice', function (tickerId, tickType, price) {
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
        ib.cancelRealTimeBars(tickerId);
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
    }).on('accountSummaryEnd', function(tickerId, account, tag, value, currency) {
        if (req_queue[tickerId]) req_queue[tickerId].resolve(req_queue[tickerId].accountSummary);
    }).on('positionMulti', function(reqId, account, modelCode, contract, position, averageCost) {
        if (!req_queue[reqId]) return;
        const sum = req_queue[reqId].positionMulti = req_queue[reqId].positionMulti || {};
        const model = modelCode ? sum[modelCode] = sum[modelCode] || {} : sum;
        const acct = account ? model[account] = model[account] || {} : model;
        acct[contract.conId] = {position, averageCost};
    }).on('positionMultiEnd', function(reqId) {
        ib.cancelPositionsMulti(+reqId);
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].positionMulti);
    });
    return {
        reqContractDetails(contract) {
            return request('reqContractDetails', contract);
        },
        reqFundamentalData(contract, reportType) {
            return request('reqFundamentalData', contract, reportType);
        },
        reqHistoricalData(contract, endDateTime, durationString, barSizeSetting, whatToShow, useRTH, formatDate) {
            return request('reqHistoricalData', contract, endDateTime, durationString,
                barSizeSetting, whatToShow, useRTH, formatDate, false);
        },
        reqMktData(contract, genericTickNameArray, snapshot, regulatorySnapshot, mktDataOptions) {
            const genericTickList = (genericTickNameArray||[]).map(getTickTypeId).join(',');
            return request('reqMktData', contract, genericTickList, _.isEmpty(genericTickNameArray), regulatorySnapshot || false, mktDataOptions || []);
        },
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

function isTickComplete(ib, req) {
    if (!req || req.cmd != 'reqMktData') return false;
    const genericTickList = req.args[1];
    if (!genericTickList) return false;
    const genericTickNameArray = genericTickList.split(',').map(getTickTypeName);
    if (_.difference(genericTickNameArray, _.keys(req.tickData)).length) return false;
    ib.cancelMktData(req.reqId);
    return true;
}

function parseXml(data) {
    return xml.parse(data, {
        ignoreAttributes: false,
        attributeNamePrefix: '',
        textNodeName: 'value'
    });
}

const tick_type_names = _.object(_.values(IB.TICK_TYPE), _.keys(IB.TICK_TYPE).map(name => name.toLowerCase()));
function getTickTypeName(tickType) {
    return tick_type_names[tickType] || tickType;
}

function getTickTypeId(tickTypeName) {
    return IB.TICK_TYPE[tickTypeName.toUpperCase()] || tickTypeName;
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

