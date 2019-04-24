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
const xml = require('fast-xml-parser');
const IB = require('ib');
const logger = require('./logger.js');
const promiseThrottle = require('./throttle.js');
const debounce = require('./debounce.js');
const cache = require('./memoize-cache.js');
const storage = require('./storage.js');

let sequence_counter = Date.now() % 32768;
function nextval() {
    return ++sequence_counter;
}

module.exports = function(settings) {
    const host = settings && settings.host || 'localhost';
    const port = settings && settings.port || 7496;
    const clientId = settings && _.isFinite(settings.clientId) ? settings.clientId : nextval();
    const lib_dir = settings && settings.lib_dir;
    const self = new.target ? this : {};
    let opened_client = createClient(host, port, clientId, lib_dir);
    let promise_ib, closed = false;
    const open = () => {
        if (opened_client && !opened_client.disconnected) return opened_client.open();
        else return promise_ib = (promise_ib || Promise.reject())
          .catch(err => ({disconnected: true})).then(client => {
            if (!client.disconnected) return client;
            opened_client = createClient(host, port, clientId, lib_dir);
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


function createClient(host, port, clientId, lib_dir) {
    const ib = new IB({host, port, clientId});
    const once_connected = new Promise((ready, fail) => {
        let first_error = null;
        ib.once('connected', () => {
            self.connecting = false;
            self.connected = true;
            self.disconnected = false;
            logger.debug("ib-client connected", host, port, clientId);
        }).once('error', err => {
            first_error = err;
            if (!self.connected) {
                self.connecting = false;
                self.connected = false;
                self.disconnected = true;
                fail(err);
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
    const self = new.target ? this : {};
    return Object.assign(self, {
        connecting: false,
        connected: false,
        disconnected: false,
        async close() {
            let error;
            await self.flush().catch(err => error = err);  // execDetails
            if (self.connecting || self.connected) {
                if (!self.disconnected) ib.disconnect();
                await once_disconnected;
            }
            if (error) throw error;
        },
        open() {
            if (!self.connecting && !self.connected && !self.disconnected) {
                self.connecting = true;
                ib.connect();
            }
            return once_connected.then(() => self);
        }
    },
    nextValidId(ib),
    accountUpdates(ib),
    reqPositions(ib),
    openOrders(ib),
    currentTime(ib),
    requestFA(ib),
    execDetails(ib, lib_dir),
    reqContract(ib),
    requestWithId(ib));
}

function nextValidId(ib) {
    const valid_id_queue = [];
    const next_valid_id_queue = [];
    ib.on('nextValidId', order_id => {
        const next = next_valid_id_queue.shift();
        if (next) next(order_id);
        else valid_id_queue.push(order_id);
    });
    return {
        async reqIds() {
            ib.reqIds(1);
            const order_id = valid_id_queue.shift();
            if (order_id) return order_id;
            return new Promise(ready => {
                if (valid_id_queue.length)
                    return ready(valid_id_queue.shift());
                const reqId = nextval();
                next_valid_id_queue.push(ready);
                ib.reqIds(1);
            });
        }
    };
};

function accountUpdates(ib) {
    const account_updates = {};
    let current_account;
    let account_updates_end, account_updates_fail;
    let promise_account_updates = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!info || !info.id && !isNormal(info)) {
            if (account_updates_fail) account_updates_fail(err);
        }
    }).on('disconnected', () => {
        if (account_updates_fail) account_updates_fail(Error("TWS has disconnected"));
    }).on('updateAccountValue', function(key, value, currency, accountName) {
        current_account = accountName;
        const acct = account_updates[accountName] = account_updates[accountName] || {};
        acct[key] = currency ? acct[key] || (currency == value ? [] : {}) : value;
        if (_.isArray(acct[key])) acct[key].push(value);
        else if (currency) acct[key][currency] = value;
    }).on('updateAccountTime', function(timestamp) {
        const acct = account_updates[current_account] = account_updates[current_account] || {};
        acct.updateAccountTime = timestamp;
    }).on('updatePortfolio', function(contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, accountName) {
        current_account = accountName;
        const acct = account_updates[accountName] = account_updates[accountName] || {};
        acct.portfolio = acct.portfolio || {};
        acct.portfolio[contract.conId] = {position, marketPrice, marketValue, averageCost, unrealizedPNL};
    }).on('accountDownloadEnd', function(accountName) {
        current_account = accountName;
        const ready = account_updates_end;
        _.defer(() => {
            ib.reqAccountUpdates(false, accountName);
            if (ready) ready(account_updates[accountName]);
        });
    });
    return {
        reqAccountUpdate(acctCode) {
            return promise_account_updates = promise_account_updates.catch(logger.error)
              .then(() => new Promise((ready, fail) => {
                current_account = acctCode;
                account_updates_end = ready;
                account_updates_fail = fail;
                ib.reqAccountUpdates(true, acctCode);
            }));
        }
    };
};

function reqPositions(ib) {
    const positions = {};
    let positions_end, positions_fail;
    let promise_positions = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!info || !info.id && !isNormal(info)) {
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
            return promise_positions = promise_positions.catch(logger.error)
              .then(() => new Promise((ready, fail) => {
                positions_end = ready;
                positions_fail = fail;
                ib.reqPositions();
            }));
        }
    };
};

function openOrders(ib) {
    const open_orders = {};
    let orders_end, orders_fail;
    let promise_orders = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!info || !info.id && !isNormal(info)) {
            if (orders_fail) orders_fail(err);
        }
    }).on('disconnected', () => {
        if (orders_fail) orders_fail(Error("TWS has disconnected"));
    }).on('openOrder', function(orderId, contract, order, orderStatus) {
        open_orders[orderId] = Object.assign({}, order, orderStatus);
    }).on('orderStatus', function(orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice) {
        open_orders[orderId] = Object.assign({}, open_orders[orderId], orderStatus);
    }).on('openOrderEnd', function() {
        const ready = orders_end;
        _.defer(() => {
            if (ready) ready(open_orders);
        });
    });
    return {
        reqOpenOrders() {
            return promise_orders = promise_orders.catch(logger.error)
              .then(() => new Promise((ready, fail) => {
                orders_end = ready;
                orders_fail = fail;
                ib.reqOpenOrders();
            }));
        },
        reqAllOpenOrders() {
            return promise_orders = promise_orders.catch(logger.error)
              .then(() => new Promise((ready, fail) => {
                orders_end = ready;
                orders_fail = fail;
                ib.reqOpenOrders();
            }));
        },
        async reqAutoOpenOrders(autoBind) {
            return ib.reqAutoOpenOrders(autoBind);
        }
    };
}

function currentTime(ib) {
    let received, fail, promise = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!info || !info.id && !isNormal(info)) {
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
            }));
        }
    };
}

function requestFA(ib) {
    let received, fail, promise = Promise.resolve();
    ib.on('error', function (err, info) {
        if (!info || !info.id && !isNormal(info)) {
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
            }));
        },
        requestProfiles() {
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(IB.FA_DATA_TYPE.PROFILES);
            }));
        },
        requestAliases() {
            return promise = promise.catch(err => {})
              .then(() => new Promise((resolve, reject) => {
                received = resolve;
                fail = reject;
                return ib.requestFA(IB.FA_DATA_TYPE.ALIASES);
            }));
        }
    };
}

function execDetails(ib, lib_dir) {
    const details = {};
    const commissions = {};
    const req_queue = {};
    const managed_accounts = [];
    const store = lib_dir && storage(lib_dir);
    let flushed = false;
    const reduce_details = async(filter, cb, initial) => {
        const min_month = ((filter||{}).time||'').substring(0, 6);
        const acctNumbers = (filter||{}).acctCode ? [filter.acctCode] :
            _.union(managed_accounts, Object.keys(details));
        return acctNumbers.reduce(async(promise, acctCode) => {
            const memo = await promise;
            if (!store) return Object.keys(details[acctCode]||{}).reduce(async(promise, month) => {
                const memo = await promise;
                return details[acctCode][month].reduce((memo, exe) => {
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
            const min_month = _.min(Object.keys(details[acctCode]||{}));
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
        logger.log("execDetails", reqId, exe.time, exe.acctNumber, exe.side, exe.shares, exe.price);
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
        logger.log("commissionReport", commissionReport.commission, commissionReport.currency, commissionReport.realizedPNL);
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
                else if (filter.side && filter.side != exe.side) return executions;
                executions.push(exe);
                return executions;
            }, []);
            return req_queue[reqId].resolve(executions);
        })().catch(err => req_queue[reqId].reject(err));
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
        flush() {
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
                    fail(err);
                    setImmediate(() => {
                        delete req_queue[reqId];
                    });
                }
            };
            logger.log(cmd, ...args.map(arg => {
                return arg && (arg.conId || arg.localSymbol || arg.symbol) || arg;
            }));
            ib[cmd].call(ib, reqId, ...args);
        });
    }, 50);
    ib.on('error', function (err, info) {
        if (info && info.id && req_queue[info.id]) {
            req_queue[info.id].reject(err);
        } else if (info && info.code == 1101) {
            logger.info("ib-client", err.message);
        } else if (info && ~[2104, 2106, 2107, 2108].indexOf(info.code)) {
            logger.log("ib-client", err.message);
        } else if (info && info.code >= 2000 && info.code < 3000) {
            logger.warn("ib-client", err.message);
        } else {
            logger.error("ib-client", JSON.stringify(_.pick(err, _.keys(err))), err.message);
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
    }).on('tickOptionComputation', function (tickerId, tickType, impliedVolatility, delta, optPrice,
            pvDividend, gamma, vega, theta, undPrice) {
        const tick = _.omit({impliedVolatility, delta, optPrice,
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
    }).on('accountUpdateMulti', function(reqId, account, modelCode, key, value, currency) {
        if (!req_queue[reqId]) return;
        const sum = req_queue[reqId].accountUpdateMulti = req_queue[reqId].accountUpdateMulti || {};
        const model = modelCode ? sum[modelCode] = sum[modelCode] || {} : sum;
        const acct = account ? model[account] = model[account] || {} : model;
        acct[key] = currency ? acct[key] || (currency == value ? [] : {}) : value;
        if (_.isArray(acct[key])) acct[key].push(value);
        else if (currency) acct[key][currency] = value;
    }).on('accountUpdateMultiEnd', function(reqId) {
        ib.cancelAccountUpdatesMulti(+reqId);
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].accountUpdateMulti);
    }).on('accountSummary', function(tickerId, account, tag, value, currency) {
        if (!req_queue[tickerId]) return;
        const sum = req_queue[tickerId].accountSummary = req_queue[tickerId].accountSummary || {};
        const acct = sum[account] = sum[account] || {};
        acct[tag] = currency ? acct[tag] || (currency == value ? [] : {}) : value;
        if (_.isArray(acct[tag])) acct[tag].push(value);
        else if (currency) acct[tag][currency] = value;
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
        reqAccountUpdatesMulti(account, modelCode, ledgerAndNLV) {
            return request('reqAccountUpdatesMulti', account, modelCode || '', ledgerAndNLV || false);
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
    if (!req) return false;
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

