// broker-ib.js
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

const util = require('util');
const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const Big = require('big.js');
const logger = require('./logger.js');
const config = require('./config.js');
const IB = require('./ib-client.js');
const Fetch = require('./fetch.js');
const expect = require('chai').expect;

/**
 * Array of one Object with description of module, including supported options
 */
function helpSettings() {
    return Promise.resolve([{
        name: 'broker',
        usage: 'broker(settings)',
        description: "Information needed to identify the broker account",
        options: {
            account: {
                usage: '<string>',
                description: "IB account and/or model"
            }
        }
    }]);
}

/**
 * Array of one Object with description of module, including supported options
 */
function helpOptions() {
    return Promise.resolve([{
        name: 'balances',
        usage: 'broker(options)',
        description: "List a summary of current account balances",
        properties: [
            'asof', 'acctNumber', 'currency', 'rate',
            'net', 'settled', 'accrued', 'realized', 'unrealized', 'margin'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'balances'
                ]
            },
            begin: {
                usage: '<dateTime>',
                description: "Include summary of position changes since this dateTime"
            }
        }
    }, {
        name: 'positions',
        usage: 'broker(options)',
        description: "List a summary of recent trades and their effect on the account position",
        properties: [
            'asof', 'acctNumber', 'price', 'change', 'dividend', 'action', 'quant', 'position',
            'traded_price', 'net_change', 'commission', 'symbol', 'market', 'currency', 'secType'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'positions'
                ]
            },
            begin: {
                usage: '<dateTime>',
                description: "Include summary of position changes since this dateTime"
            }
        }
    }, {
        name: 'orders',
        usage: 'broker(options)',
        description: "List a summary of open orders",
        properties: [
            'asof', 'action', 'quant', 'type', 'limit', 'offset', 'tif',
            'order_ref', 'parent_ref', 'group_ref', 'bag_ref',
            'acctNumber', 'symbol', 'market', 'secType', 'currency'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'orders'
                ]
            },
            begin: {
                usage: '<dateTime>',
                description: "Include summary of position changes since this dateTime"
            }
        }
    }]);
}

module.exports = function(settings) {
    if (settings.help) return helpSettings();
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).ib
    )), v => !v);
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const ib = new IB({lib_dir, ...config('broker.ib'), ...settings});
    const fetch = new Fetch(settings);
    return _.extend(function(options) {
        if (options.help) return helpOptions();
        switch(options.action) {
            case 'balances': return listBalances(markets, ib, fetch, settings, options);
            case 'positions': return listPositions(markets, ib, fetch, settings, options);
            case 'orders': return listOrders(markets, ib, settings, options);
            default: expect(options).to.have.property('action').to.be.oneOf([
                'balances', 'positions', 'orders'
            ]);
        }
    }, {
        open() {
            return ib.open();
        },
        close() {
            return Promise.all([
                fetch.close(),
                ib.close()
            ]);
        }
    });
};

async function listBalances(markets, ib, fetch, settings, options) {
    const ib_tz = (settings||{}).tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const accounts = await listAccounts(ib, (settings||{}).account);
    const now = moment().tz(ib_tz);
    const begin = options.begin && moment(options.begin).tz(ib_tz).format('YYYYMMDD HH:mm:ss');
    const balances = await Promise.all(accounts.map(async(acctNumber) => {
        const previously = begin ? await ib.reqAccountHistory(acctNumber, begin) : [];
        const currently = await ib.reqAccountUpdate(acctNumber);
        const history = !previously.length || _.last(previously).time != currently.time ?
            previously.concat(currently) : previously;
        return [].concat(...history.map(summary => {
            const asof = summary.time ? parseTime(summary.time, ib_tz) : now;
            expect(summary).to.have.property('Currency').that.is.an('array');
            return summary.Currency.filter(currency => currency != 'BASE').map(currency => {
                return {
                    asof: asof.isValid() ? asof.format() : now.format(),
                    acctNumber, currency,
                    rate: summary.ExchangeRate[currency],
                    net: summary.NetLiquidationByCurrency[currency],
                    settled: summary.CashBalance[currency],
                    accrued: Big(summary.AccruedCash[currency]||0)
                        .add(summary.AccruedDividend[currency]||0)
                        .add(summary.FuturesPNL[currency]||0).toString(),
                    realized: summary.RealizedPnL[currency],
                    unrealized: summary.UnrealizedPnL[currency],
                    margin: summary.MaintMarginReq[currency]
                };
            });
        }));
    }));
    return [].concat(...balances);
}

async function listPositions(markets, ib, fetch, settings, options) {
    const ib_tz = (settings||{}).tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const account = (settings||{}).account;
    const positions = account && account != 'All' ? await ib.reqPositionsMulti(account) : await ib.reqPositions();
    if (!positions) throw Error(`No IB account ${account} exists`)
    const historical = {};
    const changes = await Promise.all(Object.keys(positions).sort().map(account => {
        return listAccountPositions(markets, ib, fetch, account, positions[account], historical, ib_tz, options);
    }));
    return _.sortBy([].concat(...changes), 'asof');
}

async function listOrders(markets, ib, settings, options) {
    const ib_tz = (settings||{}).tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const account = (settings||{}).account;
    const accounts = await listAccounts(ib, account);
    const open_orders = await ib.reqOpenOrders();
    const completed_orders = options.begin ? await ib.reqCompletedOrders({
        acctCode: accounts.length == 1 ? _.first(accounts) : null,
        time: options.begin ? moment.tz(options.begin, ib_tz).format('YYYYMMDD HH:mm:ss') : null
    }) : [];
    const orders = open_orders.concat(completed_orders);
    return orders.filter(order => {
        if (!account || account == 'All') return true;
        else if (order.faGroup == account || order.faProfile == account) return true;
        else if (~accounts.indexOf(order.account)) return true;
        else return false;
    }).reduce(async(promise, order) => {
        const result = await promise;
        const contract = await ib.reqContract(order.conId);
        const parent = order.parentId && orders.find(p => order.parentId == p.orderId);
        const bag = contract.secType == 'BAG';
        const working = ~open_orders.indexOf(order);
        const status = order.status == 'ApiPending' ? 'pending' :
            order.status == 'PendingSubmit' ? 'pending' :
            order.status == 'PendingCancel' ? 'pending' :
            order.status == 'PreSubmitted' ? 'pending' :
            order.status == 'Submitted' ? 'working' :
            order.status == 'ApiCancelled' ? 'working' :
            order.status == 'Filled' ? 'filled' : 'cancelled';
        result.push({
            asof: parseTime(order.time, ib_tz).format(),
            action: order.action,
            quant: working ? order.remaining : order.totalQuantity,
            type: order.orderType,
            limit: order.lmtPrice == Number.MAX_VALUE ? null : order.lmtPrice,
            offset: order.auxPrice == Number.MAX_VALUE ? null : order.auxPrice,
            tif: order.tif,
            status: status,
            order_ref: order.orderRef || order.permId,
            parent_ref: parent ? parent.orderRef || parent.permId : null,
            group_ref: order.ocaGroup,
            bag_ref: bag ? order.orderRef || order.permId : null,
            account: order.faGroup || order.faProfile || order.account,
            symbol: bag ? null : asSymbol(contract),
            market: bag ? null : await asMarket(markets, ib, contract),
            secType: contract.secType,
            currency: contract.currency
        });
        if (!bag) return result;
        else return contract.comboLegs.reduce(async(promise, leg, i) => {
            await promise;
            const contract = await ib.reqContract(leg.conId);
            result.push({
                action: leg.action,
                quant: Big(order.remaining).times(leg.ratio).toString(),
                type: null,
                limit: ((order.orderComboLegs||[])[i]||{}).price || null,
                offset: null,
                tif: null,
                order_ref: null,
                parent_ref: null,
                group_ref: null,
                bag_ref: order.orderRef || order.permId,
                account: order.faGroup || order.faProfile || order.account,
                symbol: asSymbol(contract),
                market: await asMarket(markets, ib, contract),
                secType: contract.secType,
                currency: contract.currency
            });
            return result;
        }, Promise.resolve(result));
    }, Promise.resolve([]));
}

async function listAccounts(ib, account) {
    const managed_accts = await ib.reqManagedAccts();
    if (!account || 'All' == account) return managed_accts;
    else if (~managed_accts.indexOf(account)) return [account];
    const aliases = await ib.requestAliases();
    const alias = aliases.filter(a => account == a.alias);
    if (alias.length) return alias.map(a => a.account);
    const groups = await ib.requestGroups();
    const group = groups.find(g => account == g.name);
    if (group) return group.ListOfAccts;
    const profiles = await ib.requestProfiles();
    const profile = profiles.find(p => account == p.name);
    if (profile) return profile.ListOfAllocations.map(a => a.acct);
    return [account]; // maybe a model?
}

async function listAccountPositions(markets, ib, fetch, account, positions, historical, ib_tz, options) {
    const executions = await ib.reqExecutions({
        acctCode: account,
        time: options.begin ? moment.tz(options.begin, ib_tz).format('YYYYMMDD HH:mm:ss') : null
    });
    const conIds = _.union(Object.keys(positions).map(i => parseInt(i)), collectConIds(executions));
    const listChanges = listContractPositions.bind(this, markets, ib, fetch);
    const changes = await Promise.all(conIds.sort().map(async(conId) => {
        const con_pos = positions[conId];
        const con_exe = executions.filter(exe => exe.conId == conId).map(exe => ({
            asof: parseTime(exe.time, ib_tz).format(),
            ...exe
        }));
        return listChanges(conId, con_pos, con_exe, historical, ib_tz, options);
    }));
    return [].concat(...changes).map(trade => Object.assign({
        asof: trade.asof,
        acctNumber: account
    }, trade));
}

async function listContractPositions(markets, ib, fetch, conId, pos, executions, historical, ib_tz, options) {
    const contract = await ib.reqContract(conId);
    if (contract.secType == 'BAG') return [];
    const symbol = asSymbol(contract);
    const market = await asMarket(markets, ib, contract);
    const now = moment().format();
    const asof = moment(options.begin || options.now);
    const earliest = moment(asof).subtract(5, 'days').startOf('day');
    const key = `${conId} ${earliest.format()}`;
    const promise = historical[key] = historical[key] ||
        loadHistoricalData(fetch, symbol, market, earliest, {...options, ...markets[market]});
    const bars = await promise;
    if (!bars.length) return [];
    const multiplier = contract.multiplier || 1;
    const ending_position = pos ? pos.position : 0;
    const newer_details = executions.filter(exe => {
        return exe.asof > _.last(bars).ending;
    });
    const latest_trade = changePosition(multiplier, _.last(bars), newer_details, _.last(bars), ending_position);
    const changes = [];
    const starting_position = bars.reduceRight((position, bar, i, bars) => {
        const details = executions.filter(exe => {
            return exe.asof <= bar.ending &&
                (i == 0 || bars[i-1].ending < exe.asof);
        });
        changes[i] = changePosition(multiplier, bars[i-1] || bar, details, bar, position);
        if (changes[i].action == 'LONG' && !changes[i].quant)
            return position;
        else if (changes[i].action == 'SHORT' && !changes[i].quant)
            return position;
        else if (!changes[i].action && !changes[i].quant)
            return position;
        else if (changes[i].action.charAt(0) == 'B')
            return position - changes[i].quant;
        else if (changes[i].action.charAt(0) == 'S')
            return position + changes[i].quant;
        else
            throw Error(`Invalid trade action ${changes[i].action}`);
    }, ending_position - latest_trade.quant);
    if (latest_trade.quant) {
        changes.push(latest_trade);
    }
    const positions = changes.filter(trade => trade.action)
      .map(trade => Object.assign({
        asof: trade.asof,
        symbol, market,
        currency: contract.currency,
        secType: contract.secType
    }, trade, {asof: trade.asof < now ? trade.asof : now}));
    const asof_format = options.begin && asof.format();
    if (options.begin) return positions.filter(position => asof_format <= position.asof);
    else if (!positions.length || !_.last(positions).position) return [];
    else return [_.last(positions)];
}

function changePosition(multiplier, prev_bar, details, bar, position) {
    const adj = Big(bar.close).div(bar.adj_close);
    const dividend = +Big(prev_bar.close).minus(Big(prev_bar.adj_close).times(adj)).toFixed(8);
    const ending_value = position * bar.close * multiplier;
    const quant = details.reduce((shares, exe) => shares + +exe.shares, 0);
    const shares = details.reduce((shares, exe) => shares + +exe.shares * (exe.side == 'SLD' ? -1 : 1), 0);
    const starting_position = position - shares;
    const starting_value = Big(starting_position).times(prev_bar.close).times(multiplier);
    const net_dividend = Big(starting_position).times(dividend).times(multiplier);
    const purchase = details.filter(exe => exe.side == 'BOT')
        .reduce((net, exe) => net.add(Big(exe.price).times(exe.shares).times(multiplier)), Big(0));
    const sold = details.filter(exe => exe.side == 'SLD')
        .reduce((net, exe) => net.add(Big(exe.price).times(exe.shares).times(multiplier)), Big(0));
    const commission = details.reduce((net, exe) => net.add(exe.commission || 0), Big(0));
    const net_change = Big(ending_value).minus(starting_value)
        .add(sold).minus(purchase).add(net_dividend).minus(commission);
    const action = position == 0 && quant == 0 ? '' :
        position > 0 && quant == 0 ? 'LONG' :
        position < 0 && quant == 0 ? 'SHORT' :
        starting_position >= 0 && position >= 0 && shares >= 0 ? 'BTO' :
        starting_position >= 0 && position >= 0 && shares <= 0 ? 'STC' :
        starting_position <= 0 && position <= 0 && shares <= 0 ? 'STO' :
        starting_position <= 0 && position <= 0 && shares >= 0 ? 'BTC' :
        shares > 0 ? 'BOT' : shares < 0 ? 'SLD' : '';
    return {
        asof: bar.ending,
        traded_at: details.reduce((at, exe) => at < exe.asof ? exe.asof : at, '') || null,
        price: bar.close,
        traded_price: shares ? +Big(purchase).add(sold).div(Big(quant).abs()).div(multiplier) : null,
        change: +Big(bar.close).minus(Big(prev_bar.adj_close).times(bar.close).div(bar.adj_close)),
        dividend,
        action,
        quant: quant ? Math.abs(shares) : null,
        position,
        net_change: +Big(net_change).toFixed(2),
        commission: +commission
    };
}

function collectConIds(executions) {
    return executions.reduce((conIds, execution) => {
        const idx = _.sortedIndex(conIds, execution.conId);
        conIds.splice(idx, 0, execution.conId);
        return conIds;
    }, []);
}

function loadHistoricalData(fetch, symbol, market, begin, options) {
    const tz = (moment.defaultZone||{}).name;
    return fetch(_.defaults({interval:'day', begin, symbol, market, tz}, options));
}

function convertTime(market, tz) {
    const mtz2tz = time => moment.tz('2010-03-01T' + time, market.market_tz).tz(tz).format('HH:mm:ss');
    return {
        afterHoursClosesAt: mtz2tz(market.trading_hours.substring(market.trading_hours.length - 8)),
        marketClosesAt: mtz2tz(market.liquid_hours.substring(market.liquid_hours.length - 8)),
        marketOpensAt: mtz2tz(market.liquid_hours.substring(0, 8)),
        premarketOpensAt: mtz2tz(market.trading_hours.substring(0, 8))
    };
}

function asSymbol(contract) {
    if (contract.secType == 'FUT') return fromFutSymbol(contract.localSymbol);
    else if (contract.secType == 'CASH') return contract.symbol;
    else if (contract.secType == 'OPT') return contract.localSymbol;
    else return ~contract.localSymbol.indexOf(' ') ? contract.localSymbol.replace(' ', '.') : contract.localSymbol;
}

function fromFutSymbol(symbol) {
    let m, n;
    if (m = symbol.match(/^(\w*)([A-Z])(\d)$/)) {
        const [, root, month, y] = m;
        const now = moment();
        const decade = y >= (now.year() - 2) % 10 ?
            (now.year() - 2).toString().substring(2, 3) :
            (now.year() + 8).toString().substring(2, 3);
        return `${root}${month}${decade}${y}`;
    } else if (n = symbol.match(/^(\w*) +([A-Z]+) (\d\d)$/)) {
        const codes = {JAN: 'F', FEB: 'G', MAR: 'H', APR: 'J', MAY: 'K', JUN: 'M', JUL: 'N', AUG: 'Q', SEP: 'U', OCT: 'V', NOV: 'X', DEC: 'Z'};
        const [, root, month, year] = n;
        return `${root}${codes[month]}${year}`;
    } else {
        return symbol;
    }
}

async function asMarket(markets, ib, contract) {
    const market = [contract.primaryExchange, contract.exchange].concat(Object.keys(markets)).find(name => {
        if (!markets[name]) return false;
        const currency = markets[name].currency;
        if (currency && currency != contract.currency) return false;
        const secType = markets[name].secType;
        if (secType && secType != contract.secType) return false;
        const primaryExch = markets[name].primaryExch;
        if (primaryExch && primaryExch != contract.primaryExch && primaryExch != contract.exchange) return false;
        const exchange = markets[name].exchange;
        if (!exchange || exchange == 'SMART' || exchange == 'IDEALPRO') return true;
        if (exchange != contract.exchange && primaryExch != contract.exchange) return false;
        return true;
    });
    if (market) return market;
    const details = ib ? await ib.reqContractDetails(contract): [];
    if (details.length) return asMarket(markets, null, details[0].summary);
    else throw Error(`Could not determine market for ${util.inspect(contract, {breakLength:Infinity})}`);
}

function parseTime(time, ib_tz) {
    const time_str = time.replace(/^(\d\d\d\d)(\d\d)(\d\d)(\s)?\s*/, '$1-$2-$3$4');
    return moment.tz(time_str, ib_tz).tz((moment.defaultZone||{}).name || moment.tz.guess());
}
