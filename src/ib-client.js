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
const IB = require('ib');
const logger = require('./logger.js');
const promiseThrottle = require('./throttle.js');

let sequence_counter = Date.now() % 32768;
function nextval() {
    return ++sequence_counter;
}

module.exports = Object.assign(function(host = 'localhost', port = 7496, client_id) {
    const clientId = _.isFinite(client_id) ? client_id : nextval();
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
    const managed_accounts = [];
    const valid_id_queue = [];
    const next_valid_id_queue = [];
    const req_queue = {};
    ib.on('error', function (err, info) {
        if (info && info.id && req_queue[info.id]) {
            req_queue[info.id].reject(err);
        } else if (info && info.code == 1101) {
            logger.info("ib-client", err.message);
        } else if (info && ~[2104, 2106, 2107, 2108].indexOf(info.code)) {
            logger.log("ib-client", err.message);
        } else if (info && info.code >= 2000 && info.code < 3000) {
            logger.warn("ib-client", err.message);
        } else if (!_.isEmpty(req_queue)) {
            _.keys(req_queue).forEach(reqId => {
                req_queue[reqId].reject(err);
            });
        } else {
            logger.error("ib-client", JSON.stringify(_.pick(err, _.keys(err))), err.message);
        }
    }).on('result', function (event, args) {
        if (!req_queue[args[0]]) logger.debug("ib-client", ..._.toArray(arguments).map(JSON.stringify));
    }).on('disconnected', () => {
        self.disconnected = true;
        const err = Error("TWS has disconnected");
        _.keys(req_queue).forEach(reqId => {
            req_queue[reqId].reject(err);
        });
    }).on('nextValidId', order_id => {
        const next = next_valid_id_queue.shift();
        if (next) next(order_id);
        else valid_id_queue.push(order_id);
    }).on('managedAccounts', accountsList => {
        _.compact(accountsList.split(',')).forEach(account => {
            if (!~managed_accounts.indexOf(account))
                managed_accounts.push(account);
        });
    }).on('contractDetails', (reqId, contract) => {
        req_queue[reqId].contractDetails.push(contract);
    }).on('bondContractDetails', (reqId, contract) => {
        req_queue[reqId].contractDetails.push(contract);
    }).on('contractDetailsEnd', reqId => {
        req_queue[reqId].resolve(req_queue[reqId].contractDetails);
    }).on('historicalData', (reqId, time, open, high, low, close, volume, count, wap, hasGaps) => {
        const completedIndicator = 'finished';
        if (req_queue[reqId] && time.substring(0, completedIndicator.length) == completedIndicator)
            return req_queue[reqId].resolve(req_queue[reqId].historicalData);
        const bar = _.omit({time, open, high, low, close, volume, wap, count}, value => value < 0);
        if (req_queue[reqId]) req_queue[reqId].historicalData.push(bar);
    }).on('historicalDataEnd', (reqId, start, end) => {
        if (req_queue[reqId]) req_queue[reqId].resolve(req_queue[reqId].historicalData);
    }).on('fundamentalData', (reqId, data) => {
        if (req_queue[reqId]) req_queue[reqId].resolve(data);
    }).on('tickEFP', function (tickerId, tickType, basisPoints, formattedBasisPoints,
            impliedFuturesPrice, holdDays, futureLastTradeDate, dividendImpact, dividendsToLastTradeDate) {
        const tick = _.omit({
            basisPoints, formattedBasisPoints,
            impliedFuturesPrice, holdDays, futureLastTradeDate,
            dividendImpact, dividendsToLastTradeDate
        }, v => v == null);
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = tick;
    }).on('tickGeneric', function (tickerId, tickType, value) {
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = value;
    }).on('tickOptionComputation', function (tickerId, tickType, impliedVolatility, delta, optPrice,
            pvDividend, gamma, vega, theta, undPrice) {
        const tick = _.omit({impliedVolatility, delta, optPrice,
            pvDividend, gamma, vega, theta, undPrice}, v => v == null);
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = tick;
    }).on('tickPrice', function (tickerId, tickType, price) {
        if (req_queue[tickerId] && price >= 0) req_queue[tickerId].tickData[getTickTypeName(tickType)] = price;
        else if (req_queue[tickerId]) delete req_queue[tickerId].tickData[getTickTypeName(tickType)];
    }).on('tickSize', function (tickerId, tickType, size) {
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = size;
    }).on('tickString', function (tickerId, tickType, value) {
        if (req_queue[tickerId]) req_queue[tickerId].tickData[getTickTypeName(tickType)] = value;
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
        if (_.isArray(acct[tag])) acct[tag].push(value);
        else if (currency) acct[tag][currency] = value;
    }).on('accountSummaryEnd', function(tickerId, account, tag, value, currency) {
        if (req_queue[tickerId]) req_queue[tickerId].resolve(req_queue[tickerId].accountSummary);
    });
    const request = promiseThrottle(function(cb) {
        return new Promise((ready, fail) => {
            if (self.disconnected) return fail(Error("TWS is disconnected"));
            const reqId = nextval();
            req_queue[reqId] = {
                reqId,
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
            if (typeof cb == 'function') {
                cb(reqId);
            } else {
                const args = _.rest(_.toArray(arguments));
                logger.log(cb, args.map(arg => {
                    return arg && (arg.conId || arg.localSymbol || arg.symbol) || arg;
                }).join(','));
                ib[cb].call(ib, reqId, ...args);
            }
        });
    }, 50);
    const self = Object.assign(new.target ? this : {}, {
        connecting: false,
        connected: false,
        disconnected: false,
        close() {
            if (!self.connecting && !self.connected) return Promise.resolve();
            if (!self.disconnected) ib.disconnect();
            return once_disconnected;
        },
        open() {
            if (!self.connecting && !self.connected && !self.disconnected) {
                self.connecting = true;
                ib.connect();
            }
            return once_connected.then(() => self);
        },
        async reqIds() {
            ib.reqIds(1);
            const order_id = valid_id_queue.shift();
            if (order_id) return order_id;
            else return request(reqId => {
                if (valid_id_queue.length)
                    return req_queue[reqId].resolve(valid_id_queue.shift());
                next_valid_id_queue.push(order_id => req_queue[reqId].resolve(order_id));
                ib.reqIds(1);
            });
        },
        async reqManagedAccts() {
            if (managed_accounts.length) return managed_accounts;
            else if (self.disconnected) return fail(Error("TWS is disconnected"));
            else return new Promise(ready => {
                ib.once('managedAccounts', accountsList => {
                    ready(_.compact(accountsList.split(',')));
                });
            });
        },
        reqContractDetails(contract) {
            return request(reqId => ib.reqContractDetails(reqId, contract));
        },
        reqFundamentalData(contract, reportType) {
            return request('reqFundamentalData', contract, reportType);
        },
        reqHistoricalData(contract, endDateTime, durationString, barSizeSetting, whatToShow, useRTH, formatDate) {
            return request('reqHistoricalData', contract, endDateTime, durationString,
                barSizeSetting, whatToShow, useRTH, formatDate, false);
        },
        reqMktData(contract, genericTickList, snapshot, regulatorySnapshot, mktDataOptions) {
            return request('reqMktData', contract, genericTickList || '', true, regulatorySnapshot || false, mktDataOptions || []);
        },
        reqRealTimeBars(contract, whatToShow) {
            return request('reqRealTimeBars', contract, 0, whatToShow, false);
        },
        reqAccountSummary(group, tags) {
            return request('reqAccountSummary', group || 'All', tags || getAllTags().join(','));
        }
    });
    return self;
}, {
    TICK_TYPE: IB.TICK_TYPE
});

const tick_type_names = _.object(_.values(IB.TICK_TYPE), _.keys(IB.TICK_TYPE).map(name => name.toLowerCase()));
function getTickTypeName(tickType) {
    return tick_type_names[tickType] || tickType;
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

