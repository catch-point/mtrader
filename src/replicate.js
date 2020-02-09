// replicate.js
/*
 *  Copyright (c) 2018-2019 James Leigh, Some Rights Reserved
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
const fs = require('graceful-fs');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const Big = require('big.js');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const version = require('./version.js');
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const logger = require('./logger.js');
const formatDate = new require('./mtrader-date.js')();
const expect = require('chai').expect;
const Lookup = require('./lookup.js');

/**
 * Aligns working orders on a broker with the last order row from a collect result.
 * The desired position is dervied from the sum of action and quant columns. The
 * order attributes (order_type, limit, offset, stop, tif) of the last row are
 * used to construct an adjustment order (if necessary). Additional order
 * attributes in the last row, with a common prefix, are used to submit working
 * orders, iff no adjustment order was necessary, otherwise working orders are
 * cancelled. The column stoploss is short hand to create a working
 * STP GTC order to close current position and is not cancelled during an
 * adjustment order. All working and stoploss orders are OCA.
 */
module.exports = function(broker, fetch, collect, settings) {
    let promiseHelp, brokerHelp;
    const lookup = new Lookup(fetch);
    return _.extend(async function(options) {
        if (!brokerHelp) brokerHelp = broker({info:'help'});
        if (!promiseHelp) promiseHelp = helpInfo(brokerHelp, collect({info:'help'}));
        if (options.info=='help') return promiseHelp;
        else if (options.info=='version') return [{version:version.toString()}];
        const help = await promiseHelp;
        const broker_watch = wrapBroker(broker, await brokerHelp, settings);
        const opts = _.defaults({
            now: moment(options.now).valueOf()
        }, _.pick(options, _.keys(_.first(help).options)));
        return replicate(broker_watch, collect, lookup, opts);
    }, {
        close() {
            return lookup.close();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function helpInfo(broker, collect) {
    return Promise.all([collect, broker]).then(_.flatten)
      .then(list => list.reduce((help, delegate) => {
        return _.extend(help, {options: _.extend({}, delegate.options, help.options)});
    }, {
        name: 'replicate',
        usage: 'replicate(options)',
        description: "Changes workers orders to align with orders in result",
        properties: ['action', 'quant', 'order_type', 'limit', 'stop', 'tif', 'symbol', 'market', 'currency', 'security_type', 'multiplier', 'order_ref', 'attach_ref'],
        options: {
            markets: {
                usage: '[<market>]',
                description: "Array of markets of positions that should be closed if no desired position exists"
            },
            currency: {
                usage: '<currency>',
                description: "The currency used in parameters, such as 'initial_deposit'"
            },
            quant_threshold: {
                usage: '<integer>',
                description: "Minimum quantity of shares/contracts that must change to generate an adjustment order"
            },
            quant_threshold_percent: {
                usage: '<decimal>',
                description: "Minimum quantity, relative to current position, that must change to generate an adjustment order"
            },
            default_order_type: {
                usage: '<order_type>',
                description: "Default order type to close unexpected positions, defaults to MKT"
            },
            default_multiplier: {
                usage: '<number>',
                description: "Default value multiplier defaults to 1"
            },
            minTick: {
                usage: '<decimal>',
                description: "The default minimun increment passed to broker"
            },
            extended_hours: {
                usage: 'true',
                values: ['true'],
                description: "If set, Allows orders to also trigger or fill outside of regular trading hours."
            },
            working_duration: {
                usage: '<duration>,..',
                description: "Offset of now to begin by these comma separated durations or to values"
            },
            allocation_pct: {
                usage: '<number>',
                description: "Percentage 0-100 of the balance that should be allocated to this strategy"
            },
            allocation_peak_pct: {
                usage: '<number>',
                description: "Percentage 0-100 of the maximum balance in the past 12 months to allocate"
            },
            allocation_min: {
                usage: '<number>',
                description: "Minimum amount that should be allocated to this strategy"
            },
            allocation_max: {
                usage: '<number>',
                description: "Maximum amount that should be allocated to this strategy"
            },
            dry_run: {
                usage: 'true',
                description: "If working orders should not be changed, only reported"
            },
            force: {
                usage: 'true',
                description: "If live positions, that have been changed more recently, should also be adjusted"
            },
            working_orders_only: {
                usage: 'true',
                description: "Don't try to align positions sizes, only submit working orders"
            },
            exclude_working_orders: {
                usage: 'true',
                description: "Only update positions sizes, don't submit/update working orders"
            }
        }
    })).then(help => [help]);
}

/**
 * Wait for pending orders to become working orders, if broker supports it
 */
function wrapBroker(broker, brokerHelp, settings) {
    if (!brokerHelp.some(info => ~(((info.options||{}).action||{}).values||[]).indexOf('watch')))
        return broker; // broker does not support order watching
    const timeout = settings.timeout || 1000;
    return _.extendOwn(async(options) => {
        if (options.action != 'BUY' && options.action != 'SELL')
            return broker(options);
        const orders = await broker(options);
        if (!orders.some(ord => ord.status == 'pending')) return orders;
        else return Promise.all(orders.map(ord => {
            if (ord.status != 'pending' || !ord.order_ref) return ord;
            else return broker({..._.omit(options, 'quant'), ..._.omit(ord, 'quant'), action: 'watch', timeout});
        }));
    }, broker);
}

/**
 * Aligns the working orders on the given broker with the order rows from the collect result
 */
async function replicate(broker, collect, lookup, options) {
    const check = interrupt();
    const begin = options.begin || options.working_duration && formatDate(moment.defaultFormat, {
        duration: options.working_duration,
        negative_duration: true,
        now: options.now
    }) || options.now;
    const desired = await getDesiredPositions(broker, collect, lookup, begin, options);
    const working_refs = _.reduce(desired, (refs, pos) => _.union(refs, Object.keys(pos.working), Object.keys(pos.realized.working||{})), []);
    const [broker_balances, broker_positions, broker_orders] = await Promise.all([
        broker({action: 'balances', now: options.now}),
        broker({action: 'positions', now: options.now}),
        broker({action: 'orders', now: options.now})
    ]);
    const actual = getActualPositions(broker_positions, broker_orders, working_refs, begin, options);
    logger.debug("replicate actual", ...Object.keys(actual));
    const portfolio = _.uniq(Object.keys(desired).concat(getPortfolio(options.markets, options))).sort();
    logger.trace("replicate portfolio", ...portfolio);
    const margin_acct = !broker_balances.every(bal => bal.margin == null);
    _.forEach(actual, (w, contract) => {
        if (!desired[contract] && +w.position && !~portfolio.indexOf(contract) &&
                (!options.markets || ~options.markets.indexOf(w.market)) &&
                (w.currency == options.currency || margin_acct)) {
            logger.warn("Unknown position", options.label || '', w.position, w.symbol, w.market);
        }
    });
    const replicateContract = replicateContracts(desired, begin, options);
    const order_changes = portfolio.reduce((order_changes, contract) => {
        const [, symbol, market] = contract.match(/^(.+)\W(\w+)$/);
        return order_changes.concat(replicateContract(actual[`${symbol}.${market}`] || {symbol, market}));
    }, []);
    await check();
    logger.trace("replicate", options.label || '', "submit orders", ...order_changes);
    const updated_orders = updateComboOrders(broker_orders, actual, replicateContract, order_changes, options);
    const pending_orders = combineOrders(broker_orders, updated_orders, options);
    return submitOrders(broker, pending_orders, options);
}

/**
 * Collects the options results and converts the orders into positions
 */
async function getDesiredPositions(broker, collect, lookup, begin, options) {
    const desired_parameters = await getDesiredParameters(broker, begin, options);
    const parameters = {
        ...desired_parameters,
        ...(options.parameters || {})
    };
    logger.debug("replicate", options.label || '', begin, "parameters", parameters);
    const orders = await collect(merge(options, {begin, parameters}));
    const normalized_orders = await Promise.all(orders.map(row => normalize(lookup, row, options)));
    const grouped = _.groupBy(normalized_orders, ord => `${ord.symbol}.${ord.market}`);
    return _.object(Object.keys(grouped), await Promise.all(Object.values(grouped).map(async(orders) => {
        const last_row = _.last(orders.filter(ord => ord.status != 'pending' || +ord.quant)) || _.last(orders);
        const realized_orders = orders.filter(ord => ord.status != 'pending');
        const realized_row = _.last(realized_orders) || last_row;
        const pending = getDesiredPosition(lookup, getPositionSize(orders), last_row, options);
        const realized = realized_row != last_row ?
            getDesiredPosition(lookup, getPositionSize(realized_orders), realized_row, options) : {};
        return {
            ...pending,
            realized
        };
    })));
}

function getPositionSize(orders, options) {
    return orders.reduce((position, row) => {
        switch(row.action ? row.action.charAt(0) : '') {
            case 'B': return position + + (row.quant || 0);
            case 'S': return position - (row.quant || 0);
            default: return position;
        }
    }, 0);
}

function getDesiredPosition(lookup, position, order, options) {
    const common = _.pick(order, 'symbol', 'market', 'currency', 'security_type', 'multiplier', 'minTick');
    const attach_ref = ref(`${order.symbol}.${options.label}`);
    const order_prefix = `${order.order_type || options.default_order_type || (order.limit ? 'LMT' : 'MKT')}.`;
    const adjustment = {
        ..._.pick(order, 'action', 'order_type', 'limit', 'offset', 'stop', 'tif', 'order_ref', 'attach_ref', 'traded_at', 'traded_price'),
        order_ref: order.order_ref || ref(`${order_prefix}${attach_ref}`),
        ...common
    };
    const stoploss = order.stoploss ? {
        action: +position < 0 ? 'BUY' : 'SELL',
        quant: Math.abs(position).toString(),
        order_type: 'STP',
        stop: order.stoploss.toString(),
        order_ref: `stoploss.${attach_ref}`,
        tif: 'GTC',
        ...common
    } : undefined;
    const prefixes = Object.keys(order)
        .filter(col => col.indexOf('action') > 0 && col.indexOf('action') == col.length - 'action'.length)
        .map(col => col.replace('action', ''))
        .filter(prefix => prefix != 'stoploss.' && prefix != order_prefix);
    const order_attributes = ['action', 'quant', 'order_type', 'limit', 'offset', 'stop', 'tif', 'order_ref', 'attach_ref'];
    const working = _.indexBy(prefixes.map(prefix => {
        const working_order = _.omit(_.object(
            order_attributes,
            order_attributes.map(attr => `${prefix}${attr}`).map(attr => order[attr])
        ), _.isUndefined);
        return {
            ...working_order,
            order_type: working_order.order_type || options.default_order_type ||
                (+working_order.limit ? 'LMT' : +working_order.stop ? 'STP' : 'MKT'),
            order_ref: ref(`${prefix}${attach_ref}`),
            tif: working_order.tif || 'DAY',
            ...working_order,
            ...common
        };
    }).filter(ord => +ord.quant && ~['BUY', 'SELL'].indexOf(ord.action)), ord => ord.order_ref);
    return {
        position,
        attach_ref,
        asof: order.traded_at || order.posted_at,
        adjustment,
        stoploss,
        working,
        ...common
    };
}

function ref(long_ref) {
    return long_ref.replace(/[^\w.\+\-]+/g,'');
}

async function getDesiredParameters(broker, begin, options) {
    const [current_balances, past_positions] = await Promise.all([
        broker({action: 'balances', now: options.now}),
        broker({action: 'positions', begin, now: options.now})
    ]);
    const first_traded_at = getFirstTradedAt(past_positions, begin, options);
    const initial_balances = await broker({action: 'balances', asof: first_traded_at, now: options.now});
    const peak_balances = options.allocation_peak_pct ? await broker({
        action: 'balances',
        begin: moment(first_traded_at).subtract(1,'year').format(),
        now: options.now
    }) : initial_balances;
    const peak_initial_balances = peak_balances.filter(bal => !moment(bal.asof).isAfter(first_traded_at));
    const initial_deposit = getAllocation(peak_initial_balances, initial_balances, options);
    const net_allocation = getAllocation(peak_balances, current_balances, options);
    const net_deposit = getNetDeposit(peak_balances, current_balances, past_positions, options);
    const settled_cash = getSettledCash(current_balances, options);
    const accrued_cash = getAccruedCash(current_balances, options);
    const total_cash = getTotalCash(current_balances, options);
    return { initial_deposit, net_deposit, net_allocation, settled_cash, accrued_cash, total_cash };
}

/**
 * Normalize the order row
 */
async function normalize(lookup, row, options) {
    const security_type = row.security_type || row.typeofsymbol == 'future' && 'FUT';
    const contract = !security_type ? await lookup(_.pick(row, 'symbol', 'market')) : {};
    const posted_at = row.posted_at || row.asof || row.posted_time_unix &&
            moment(row.posted_time_unix, 'X').format() || null;
    const traded_at = row.traded_at || row.parkUntilSecs &&
            moment(row.parkUntilSecs, 'X').format() || null;
    const a = row.action ? row.action.charAt(0) : '';
    const order = {
        action: a == 'B' ? 'BUY' : a == 'S' ? 'SELL' : row.action,
        quant: row.quant,
        symbol: row.symbol,
        market: row.market || contract.market,
        currency: row.currency || contract.currency || options.currency,
        security_type: security_type || contract.security_type || 'STK',
        multiplier: row.multiplier || contract.multiplier || options.default_multiplier,
        minTick: row.minTick || options.minTick,
        order_type: row.order_type || options.default_order_type ||
            (+row.limit ? 'LMT' : +row.stop ? 'STP' : 'MKT'),
        limit: row.limit,
        offset: row.offset,
        stop: row.stop,
        tif: row.tif || row.duration || 'DAY',
        status: traded_at && moment(traded_at).isAfter(options.now) ? 'pending' :
            posted_at && moment(posted_at).isAfter(options.now) ? 'pending' : null,
        posted_at: posted_at,
        traded_at: traded_at,
        traded_price: row.traded_price
    };
    return _.defaults(_.mapObject(_.omit(order, v => v == null), v => v.toString()), row);
}

function getFirstTradedAt(positions, begin, options) {
    const portfolio = getPortfolio(options.markets, options).reduce((hash, item) => {
        const [, symbol, market] = item.match(/^(.+)\W(\w+)$/);
        (hash[symbol] = hash[symbol] || []).push(market);
        return hash;
    }, {});
    const relevant = _.isEmpty(portfolio) ? positions :
        positions.filter(pos => ~(portfolio[pos.symbol]||[]).indexOf(pos.market));
    if (!relevant.length) return options.asof;
    const initial_positions = _.flatten(_.values(_.groupBy(relevant, pos => {
        return `${pos.symbol}.${pos.market}`;
    })).map(positions => {
        return positions.reduce((earliest, pos) => {
            if (!earliest.length) return earliest.concat(pos);
            else if (pos.asof == earliest[0].asof) return earliest.concat(pos);
            else if (pos.asof < earliest[0].asof) return [pos];
            else return earliest;
        }, []);
    }));
    // check if there was an open initial position
    if (initial_positions.some(pos => pos.position != pos.quant)) return begin;
    const eod = initial_positions.reduce((earliest, pos) => {
        if (!earliest || pos.traded_at < earliest.traded_at) return pos;
        else return earliest;
    }, null).asof;
    return moment(eod).subtract(1, 'days').format();
}

function getAllocation(peak_balances, balances, options) {
    const initial_balance = getBalance(balances, options);
    const peak_balance = !options.allocation_peak_pct ? initial_balance :
        getPeakBalance(peak_balances, options);
    const alloc_pct = options.allocation_pct || 100;
    const alloc_peak_pct = options.allocation_peak_pct || alloc_pct;
    return Math.min(
        Math.max(
            Math.min(
                initial_balance.times(alloc_pct).div(100),
                peak_balance.times(alloc_peak_pct).div(100)
            ),
            options.allocation_min||0
        ),
        options.allocation_max||Infinity
    );
}

function getNetDeposit(peak_balances, balances, positions, options) {
    const portfolio = getPortfolio(options.markets, options).reduce((hash, item) => {
        const [, symbol, market] = item.match(/^(.+)\W(\w+)$/);
        (hash[symbol] = hash[symbol] || []).push(market);
        return hash;
    }, {});
    const relevant = _.isEmpty(portfolio) ? positions :
        positions.filter(pos => ~(portfolio[pos.symbol]||[]).indexOf(pos.market));
    const mtm = relevant.map(pos => Big(pos.mtm||0)).reduce((a,b) => a.add(b), Big(0));
    const balance = getAllocation(peak_balances, balances, options);
    return Math.min(Math.max(
        +Big(balance).minus(mtm),
        options.allocation_min||0), options.allocation_max||Infinity);
}

function getBalance(balances, options) {
    const cash_acct = balances.every(bal => bal.margin == null);
    const local_balances = balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    const local_balance_net = local_balances.reduce((net, bal) => net.add(bal.net), Big(0));
    const local_rate = local_balances.length ? _.last(local_balances).rate : 1;
    return cash_acct ? Big(local_balance_net) : balances.map(bal => {
        return Big(bal.net).times(bal.rate).div(local_rate);
    }).reduce((a,b) => a.add(b), Big(0));
}

function getPeakBalance(balances, options) {
    const group_by_date = balances.reduce((group, bal) => {
        const last = group.last = group[bal.asof] = group[bal.asof] || group.last;
        const found_idx = last.findIndex(_.matcher(_.pick(bal, 'acctNumber', 'currency')));
        if (found_idx >= 0) last.splice(found_idx, 1);
        last.push(bal); // preserve the original order of balances
        return group;
    }, {last:[]});
    return _.max(Object.values(group_by_date).map(balances => getBalance(balances, options)));
}

function getSettledCash(current_balances, options) {
    const local_balances = current_balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    return +local_balances.map(bal => Big(bal.settled||0)).reduce((a,b) => a.add(b), Big(0));
}

function getAccruedCash(current_balances, options) {
    const local_balances = current_balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    return +local_balances.map(bal => Big(bal.accrued||0)).reduce((a,b) => a.add(b), Big(0));
}

function getTotalCash(balances, options) {
    const cash_acct = balances.every(bal => bal.margin == null);
    const local_balances = balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    const local_cash = local_balances.reduce((total, bal) => {
        return total.add(bal.settled||0).add(bal.accrued||0);
    }, Big(0));
    const local_rate = local_balances.length ? local_balances[0].rate : 1;
    const total_cash = cash_acct ? Big(local_cash) : balances.map(bal => {
        return Big(bal.settled||0).add(bal.accrued||0).times(bal.rate).div(local_rate);
    }).reduce((a,b) => a.add(b), Big(0));
    return total_cash.toString();
}

/**
 * Retrieves the open positions and working orders from broker
 */
function getActualPositions(broker_positions, broker_orders, working_refs, begin, options) {
    const all_positions = _.groupBy(broker_positions, pos => `${pos.symbol}.${pos.market}`);
    const positions = _.mapObject(all_positions, positions => positions.reduce((net, pos) => {
        return {...net, position: +net.position + +pos.position};
    }));
    const inline_orders = inlineComboOrders(broker_orders, options);
    const working_orders = _.groupBy(inline_orders, ord => `${ord.symbol}.${ord.market}`);
    const assets = _.union(Object.keys(positions), Object.keys(working_orders));
    return _.object(assets, assets.map(asset => {
        const position = positions[asset] ? positions[asset].position : 0;
        const other = sortOrders((working_orders[asset]||[]).filter(ord => !~working_refs.indexOf(ord.order_ref)));
        const adjustment = _.first(other.filter(ord => ord.order_type != 'STP'));
        const stoploss = _.first(other.filter(ord => ord.order_type == 'STP'));
        const asof = _.last(_.sortBy((working_orders[asset]||[])
            .map(ord => ord.traded_at || ord.posted_at))) || begin;
        const traded_at = _.last(_.sortBy((working_orders[asset]||[]).concat(positions[asset]||[])
            .map(ord => ord.traded_at)));
        const working = (working_orders[asset]||[]).filter(ord => ord != adjustment && ord != stoploss);
        const attach_ref = _.first(_.difference((working_orders[asset]||[]).map(ord => ord.attach_ref), (working_orders[asset]||[]).map(ord => ord.order_ref)));
        return {
            position,
            attach_ref,
            asof,
            traded_at,
            adjustment,
            stoploss,
            working: _.indexBy(working, ord => ord.order_ref),
            ..._.pick(_.first(working_orders[asset]) || positions[asset], 'symbol', 'market', 'currency', 'security_type', 'multiplier', 'minTick')
        };
    }));
}

function getPortfolio(markets, options, portfolio = []) {
    return [].concat(options.portfolio||[]).reduce((portfolio,item) => {
        if (item && typeof item == 'object')
            return getPortfolio(markets, item, portfolio);
        else if (typeof item == 'string' && !markets)
            return ~portfolio.indexOf(item) ? portfolio : portfolio.concat(item);
        const [, symbol, market] = (item||'').toString().match(/^(.+)\W(\w+)$/) || [];
        if (!market) throw Error(`Unknown contract syntax ${item} in portfolio ${portfolio}`);
        else if (~markets.indexOf(market) && !~portfolio.indexOf(item))
            return portfolio.concat(item);
        else
            return portfolio;
    }, portfolio);
}

/**
 * Converts quant_threshold_percent into quant_threshold relative to open position size
 */
function getQuantThreshold(actual, options) {
    if (!options.quant_threshold_percent) return options.quant_threshold || 1;
    const opened = actual.position;
    const threshold = opened * options.quant_threshold_percent /100;
    if (!Math.floor(threshold)) return options.quant_threshold || 1;
    else if (!options.quant_threshold) return Math.ceil(threshold);
    else return Math.ceil(Math.min(threshold, options.quant_threshold, 1));
}

/**
 * Array of orders to update the working positions to the desired positions
 */
function updateActual(desired, actual, options) {
    const quant_threshold = getQuantThreshold(actual, options);
    const desired_adjustment = desired.position - actual.position >= quant_threshold ? {
        action: 'BUY',
        quant: (desired.position - actual.position).toString(),
        ...(((desired.adjustment||{action:'n/a'}).action||'BUY') == 'BUY' ? {
            ...desired.adjustment,
            action: 'BUY'
        } : {
            order_type: options.default_order_type || 'MKT', tif: 'DAY',
            ..._.pick(desired, 'symbol', 'market', 'currency', 'security_type', 'multiplier', 'minTick')
        })
    } : actual.position - desired.position >= quant_threshold ? {
        action: 'SELL',
        quant: (actual.position - desired.position).toString(),
        ...(((desired.adjustment||{action:'n/a'}).action||'SELL') == 'SELL' ? {
            ...desired.adjustment,
            action: 'SELL'
        } : {
            order_type: options.default_order_type || 'MKT', tif: 'DAY',
            ..._.pick(desired, 'symbol', 'market', 'currency', 'security_type', 'multiplier', 'minTick')
        })
    } : null;
    const adjustments = orderReplacements(actual.adjustment, desired_adjustment, 0, options)
        .filter(ord => ord.action == 'cancel' || !options.working_orders_only);
    const adjusting_order = !adjustments.length ? actual.adjustment :
        _.first(adjustments.filter(ord => ord.action != 'cancel'));
    const adjust_position = !adjusting_order ? 0 :
        adjusting_order.action == 'BUY' ? +adjusting_order.quant :
        adjusting_order.action == 'SELL' ? -adjusting_order.quant : 0;
    const target_position = actual.position + + adjust_position;
    const pos_offset = target_position - desired.position;
    const stoplosses = orderReplacements(actual.stoploss, desired.stoploss, pos_offset, options);
    const working_refs = _.union(Object.keys(desired.working), Object.keys(actual.working));
    const working = working_refs.reduce((orders, ref) => {
        return orders.concat(orderReplacements(actual.working[ref], desired.working[ref], pos_offset, options));
    }, stoplosses);
    const cancelled = adjustments.concat(working).filter(ord => ord.action == 'cancel');
    const oca_orders = groupIntoOCAOrder(working.filter(ord => ord.action != 'cancel'));
    const adjustment_order = _.first(adjustments.filter(ord => ord.action != 'cancel'));
    const realized_offset = actual.position - desired.realized.position;
    const transition_stoploss = adjustment_order && desired.realized.stoploss ?
        orderReplacements(actual.stoploss, desired.realized.stoploss, realized_offset, options) : [];
    const transition_refs = _.union(Object.keys(desired.realized.working||{}), Object.keys(actual.working));
    const transition = adjustment_order ? transition_refs.reduce((orders, ref) => {
        const drw = (desired.realized.working||{})[ref];
        return orders.concat(orderReplacements(actual.working[ref], drw, realized_offset, options));
    }, transition_stoploss) : [];
    if (!options.force && !actual.adjustment && actual.traded_at &&
            moment(desired.asof).isBefore(actual.traded_at)) {
        // working position has since been traded (stoploss?) since the last desired signal was produced
        logger.warn(`Working ${desired.attach_ref} position has since been changed ${actual.traded_at}`, options.label || '');
        logger.debug("replicate", "actual", actual);
        return cancelled;
    } else if (options.exclude_working_orders) {
        return adjustments;
    } else if (adjustment_order && (desired.realized.stoploss || !_.isEmpty(desired.realized.working))) {
        // keep existing transition orders (i.e. stoploss), and don't submit new working orders
        return groupIntoOCAOrder(transition.concat(adjustments));
    } else if (adjustment_order && oca_orders.length) {
        // submit new orders attached as child orders to the adjustment order
        return cancelled.concat({...adjustment_order, attached:oca_orders});
    } else if (adjustment_order) {
        return cancelled.concat(adjustment_order);
    } else if (oca_orders.length) {
        return cancelled.concat(oca_orders);
    } else {
        return cancelled;
    }
}

function groupIntoOCAOrder(orders, attach_ref) {
    const cancelled = orders.filter(ord => ord.action == 'cancel');
    const oca_orders = orders
        .filter(ord => ord.action != 'cancel' && (!ord.attach_ref || ord.attach_ref == attach_ref));
    const leg_orders = orders
        .filter(ord => ord.action != 'cancel' && (ord.attach_ref && ord.attach_ref != attach_ref));
    const oca_order = _.isEmpty(oca_orders) ? null : oca_orders.length == 1 ? _.first(oca_orders) : {
        action: 'OCA',
        order_ref: attach_ref,
        attached: oca_orders,
        ..._.pick(_.first(oca_orders), 'symbol', 'market', 'currency', 'security_type', 'multiplier', 'minTick')
    };
    return _.compact(cancelled.concat(leg_orders, oca_order));
}

function orderReplacements(working_order, desired_order, pos_offset, options) {
    const cancel_order = !working_order ? null :
        !desired_order && working_order || desired_order.action != working_order.action ||
            desired_order.order_type != working_order.order_type ?
        {...working_order, action: 'cancel'} : null;
    const quant = desired_order && (desired_order.action == 'BUY' ? +desired_order.quant - pos_offset :
        +desired_order.quant + + pos_offset).toString();
    const order = desired_order && +quant > 0 ? { ...desired_order, quant } : null;
    const replacement_order = !order ? null :
        !working_order || cancel_order ? order :
        !sameSignal(working_order, order) ? {
            ...working_order,
            ...order,
            order_ref: working_order.order_ref,
            attach_ref: working_order.attach_ref
        } : null;
    return _.compact([cancel_order, replacement_order]);
}

/**
 * Checks if the two orders appear to be the same
 */
function sameSignal(a, b, threshold) {
    if (!a || !b) return false;
    else if (!isMatch(b, _.pick(a, 'action', 'order_type', 'tif'))) return false;
    else if (Math.abs(a.quant - b.quant) > (threshold || 0)) return false;
    else if (a.limit && b.limit && a.limit != b.limit || !+a.limit != !+b.limit) return false;
    else if (a.offset && b.offset && a.offset != b.offset || !+a.offset != !+b.offset) return false;
    else if (a.stop && b.stop && a.stop != b.stop || !+a.stop != !+b.stop) return false;
    else return true;
}

function isMatch(object, attrs) {
    var keys = _.keys(attrs), length = keys.length;
    if (object == null) return !length;
    var obj = Object(object);
    for (var i = 0; i < length; i++) {
        var key = keys[i];
        if (!(key in obj) || attrs[key] != obj[key] && +attrs[key] != +obj[key]) return false;
    }
    return true;
}

/**
 * Sorts the orders such that orders with order_ref appears before orders with the same attach_ref 
 */
function sortOrders(orders) {
    if (orders.length < 2) return orders;
    const order_refs = _.indexBy(orders.filter(ord => ord.order_ref), 'order_ref');
    const target_orders = orders.filter(ord => !order_refs[ord.attach_ref] || ord.order_ref == ord.attach_ref);
    const working = [].concat(target_orders.filter(isStopOrder), target_orders.filter(ord => !isStopOrder(ord)));
    if (!working.length) throw Error(`Could not sort array ${JSON.stringify(orders)}`);
    return working.concat(sortOrders(_.difference(orders, working)));
}

function isStopOrder(order) {
    return ~(order.order_type||'').indexOf('STP');
}

function replicateContracts(desired, begin, options) {
    const asof = _.reduce(desired, (asof, d) => {
        if (asof.isBefore(d.asof)) return moment(d.asof);
        else return asof;
    }, moment(begin)).format();
    logger.debug("replicate desired", asof || '', ...Object.keys(desired));
    return actual => {
        const contract = `${actual.symbol}.${actual.market}`;
        const no_position = {
            position:0, asof: begin,
            ..._.pick(desired[contract] || actual,
                'symbol', 'market', 'currency', 'security_type', 'multiplier', 'minTick'
            ),
            working: {},
            realized: {}
        };
        const d = desired[contract] || {...no_position, asof};
        const a = {...no_position, ...actual};
        const update = updateActual(d, a, options);
        if (_.isEmpty(update)) return [];
        logger.debug("replicate", "actual", a);
        logger.debug("replicate", "desired", desired[contract] || Object.keys(desired));
        logger.debug("replicate", "change", update);
        return update;
    };
}

function inlineComboOrders(orders, options) {
    const inline_legs = orders.map(leg => {
        if (leg.order_type != 'LEG') return leg;
        const combo = orders.find(combo => combo.order_ref == leg.attach_ref);
        return {
            ...leg,
            ..._.pick(combo, 'order_type', 'limit', 'offset', 'stop', 'tif', 'status'),
            action: combo.action == 'BUY' ? leg.action : leg.action == 'BUY' ? 'SELL' : 'BUY',
            quant: Big(combo.quant).times(leg.quant).toString(),
            order_ref: leg.order_ref || `${combo.order_ref}.${leg.symbol}.${leg.market}`
        };
    });
    return inline_legs.filter(ord => {
        if (!ord.symbol || !ord.market) return false;
        return ord.status == 'pending' || ord.status == 'working';
    });
}

function updateComboOrders(broker_orders, actual, replicateContract, order_changes, options) {
    const changed_combo_orders = broker_orders
        .filter(combo => broker_orders.some(leg => leg.order_type == 'LEG' && leg.attach_ref == combo.order_ref))
        .filter(combo => order_changes.some(ord => ord.attach_ref == combo.order_ref));
    const cancel_combo_orders = changed_combo_orders.filter(combo => {
        if (!order_changes.some(ord => ord.attach_ref == combo.order_ref)) return false;
        const legs = broker_orders.filter(leg => leg.order_type == 'LEG' && leg.attach_ref == combo.order_ref);
        const updated_legs = order_changes.filter(ord => ord.action != 'cancel' && ord.attach_ref == combo.order_ref);
        return legs.length != updated_legs.length;
    }).map(combo => ({...combo, action: 'cancel'}));
    const cancel_combo_order_refs = cancel_combo_orders.map(combo => combo.order_ref);
    const obsolete_legs = cancel_combo_orders.reduce((obsolete_legs, combo) => {
        return obsolete_legs.concat(broker_orders
            .filter(leg => leg.order_type == 'LEG' && leg.attach_ref == combo.order_ref)
            .filter(leg => !order_changes.some(upd => upd.symbol == leg.symbol && upd.market == leg.market && upd.attach_ref == leg.attach_ref)));
    }, []).map(leg => `${leg.symbol}.${leg.market}`);
    const updated_legs = obsolete_legs.reduce((updated_legs, contract) => {
        if (!actual[contract]) logger.error("No actual position or orders for cancelling combo with", contract);
        if (!actual[contract]) return updated_legs;
        const adjustment = actual[contract].adjustment;
        return updated_legs.concat(replicateContract({
            ...actual[contract],
            adjustment: !~cancel_combo_order_refs.indexOf((adjustment||{}).attach_ref) ? adjustment : null,
            working: _.omit(actual[contract].working, cancel_combo_order_refs)
        }));
    }, []);
    return order_changes
        // these contracts were updated
        .filter(ord => !~obsolete_legs.indexOf(`${ord.symbol}.${ord.market}`))
        // these legs are cancelled via cancel_combo_orders
        .filter(ord => ord.action != 'cancel' || !~cancel_combo_order_refs.indexOf(ord.attach_ref))
        .concat(cancel_combo_orders, updated_legs);
}

function combineOrders(broker_orders, orders, options) {
    return reduceComboPairs(orders, (combined_orders, legs) => {
        const quant = Math.min.apply(Math, legs.map(leg => leg.quant)).toString();
        const remaining = legs.filter(leg => leg.quant != quant)
            .map(leg => ({...leg, quant: (leg.quant - quant).toString()}));
        const existing_order = broker_orders.find(ord => {
            return ord.order_type != 'LEG' && ord.order_ref == _.first(legs).attach_ref;
        });
        const traded_price = +legs.reduce((net, leg) => {
            return net.add(Big(leg.traded_price || leg.limit || 0).times(leg.action == 'BUY' ? 1 : -1));
        }, Big(0));
        if (existing_order) logger.trace("existing_order", traded_price, existing_order);
        const action = existing_order ? existing_order.action :
            traded_price < 0 ? 'SELL' : traded_price > 0 ? 'BUY' : _.first(legs).action;
        const limit = +legs.reduce((net, leg) => {
            return net.add(Big(leg.limit || 0).times(leg.action == action ? 1 : -1));
        }, Big(0));
        const stop = +legs.reduce((net, leg) => {
            return net.add(Big(leg.stop || 0).times(leg.action == action ? 1 : -1));
        }, Big(0));
        const leg_symbols = _.sortBy(legs, leg =>
                (leg.traded_price || leg.limit || 1) * (leg.action == action ? 1 : -1))
            .reverse().map(leg => `${leg.action == action ? '+' : '-'}${leg.symbol}`).join('').substring(1);
        const first_leg = legs.find(leg => leg.order_ref) || {order_ref: '', symbol: ''};
        const order_ref = (existing_order||{}).order_ref ||
            first_leg.order_ref.replace(ref(first_leg.symbol), ref(leg_symbols));
        return combined_orders.concat(remaining, {
            action,
            quant,
            order_type: _.first(legs).order_type,
            tif: _.first(legs).tif,
            limit, stop,
            offset: _.first(legs).offset,
            order_ref,
            attached: legs.map(leg => ({
                ..._.omit(leg, 'order_type', 'limit', 'offset', 'stop', 'tif'),
                action: action == 'SELL' && leg.action == 'BUY' ? 'SELL' :
                    action == 'SELL' && leg.action == 'SELL' ? 'BUY' : leg.action,
                quant: '1',
                order_type: 'LEG'
            }))
        });
    }, []);
}

function reduceComboPairs(orders, cb, initial) {
    const matrix = orders.map((a,i) => orders.map((b,j) => ({
        a, b,
        score: i != j ? comboFitScore(a, b) : 0
    })));
    let result = initial;
    while (true) {
        const pair = matrix.reduce((best, array, i) => array.reduce((best, pair, j) =>
            best.score < pair.score ? {...pair, i, j} : best, best), {score:0});
        if (!pair.score)
            return result.concat(matrix.map(array => array[0].a));
        matrix.forEach(array => {
            array.splice(Math.max(pair.i, pair.j), 1);
            array.splice(Math.min(pair.i, pair.j), 1);
        });
        matrix.splice(Math.max(pair.i, pair.j), 1);
        matrix.splice(Math.min(pair.i, pair.j), 1);
        result = cb(result, [pair.a, pair.b]);
    }
}

function comboFitScore(a, b) {
    if (!_.isMatch(a, _.pick(b, 'market', 'security_type', 'currency', 'multiplier', 'order_type', 'tif'))) {
        return 0; // different markets
    } else if (_.difference([a.action, b.action], ['BUY', 'SELL']).length) {
        return 0; // cancelling order
    } else if (a.order_type != b.order_type) {
        return 0; // different order types
    } else if (a.offset != b.offset) {
        return 0; // SNAP STK or SNAP PRIM
    } else if (a.security_type == 'OPT') {
        if (a.symbol.length != 21 || b.symbol.length != 21) return 0;
        if (a.symbol.substring(0, 6) != b.symbol.substring(0, 6)) return 0;
        const [, a_expiry, a_right, a_strike] = a.symbol.match(/\S{1,6} *(\d{6})([CP])(\d{8})/);
        const [, b_expiry, b_right, b_strike] = b.symbol.match(/\S{1,6} *(\d{6})([CP])(\d{8})/);
        // combo action defaults to change first leg to BUY, so higher price first
        if (!firstLegHasHigherPrice(a_expiry, a_right, a_strike, b_expiry, b_right, b_strike)) return 0;
        const right_score = a_right == b_right && a.action != b.action ? 1e15 : 1e15 - 1e14;
        const expiry_score = 1e14 - Math.abs(a_expiry - b_expiry) * 1e8;
        const strike_score = 1e8 - Math.abs(a_strike - b_strike);
        return expiry_score + right_score + strike_score;
    } else {
        return 0;
    }
}

function firstLegHasHigherPrice(a_expiry, a_right, a_strike, b_expiry, b_right, b_strike) {
    if (a_right == b_right) {
        if (a_expiry == b_expiry) {
            if (a_right == 'C')
                return a_strike < b_strike; // BUY ITM CALL and SELL OTM CALL
            else if (a_right == 'P')
                return a_strike > b_strike; // BUY ITM PUT and SELL OTM PUT
            else
                throw Error(`Invalid right: ${a_right}`);
        } else {
            return a_expiry > b_expiry; // BUY far and SELL near
        }
    } else {
        return a_right == 'P' && b_right == 'C'; // BUY PUT and SELL CALL
    }
}

async function submitOrders(broker, orders, options) {
    const grouped_orders = _.groupBy(orders.filter(ord => ord.symbol), ord => `${ord.symbol}.${ord.market}`);
    const all_orders = _.values(grouped_orders).concat(orders.filter(ord => !ord.symbol).map(ord => [ord]));
    const submitted = await Promise.all(all_orders.map(async(orders) => {
        if (options.dry_run) return {posted: orders, orders};
        else return orders.reduce(async(promise, order) => {
            const submitted = await promise;
            logger.trace("replicate submit", order);
            const submit = await broker({...options, ...order});
            return submitted.concat(submit);
        }, []).then(posted => ({posted, orders}), error => {
            logger.debug(error);
            logOrders(logger.debug, orders);
            return {error, orders};
        });
    }));
    const posted = [].concat(..._.compact(submitted.map(item => item.posted)));
    const posted_orders = logOrders(logger.info, posted);
    const errors = _.values(_.groupBy(submitted.filter(item => !item.posted), item => item.error.message));
    if (errors.length) {
        const message = errors.map(group => {
            const orders = [].concat(...group.map(item => item.orders));
            const first_message = _.first(group).error.message;
            const msg = first_message.replace(/^(Error:\s+)+/g, '').replace(/[\r\n]+\s[\S\s]*/,'');
            const messages = [msg];
            logOrders((...args) => messages.push(`\t${args.join(' ')}`), orders);
            return messages.join('\n');
        }).join('\n\n');
        throw Error(message);
    }
    return posted_orders;
}

function logOrders(log, orders) {
    const posted_orders = sortAttachedOrders(orders);
    const order_stack = [];
    posted_orders.forEach((ord,i,orders) => {
        while (ord.attach_ref != _.last(order_stack) && order_stack.length) order_stack.pop();
        const prefix = order_stack.map(ref => ord.attach_ref == ref ? '  \\_ ' :
            orders.some((ord,o) => ord.attach_ref == ref && o > i) ? '  |  ' : '     ').join('');
        log(prefix + ord.action,
            ord.quant, ord.symbol||'Combo', ord.market||'', ord.order_type,
            ord.limit || ord.stop || '', ord.tif||'', ord.order_ref||'', ord.status||'not submitted');
        if (!_.isEmpty(ord.attached)) {
            logOrders((...args) => log(prefix + '  \\_ ' + args[0], ..._.rest(args)), ord.attached);
        }
        if (ord.order_ref) order_stack.push(ord.order_ref);
    });
    return posted_orders;
}

function sortAttachedOrders(orders) {
    const top = orders.filter(ord => {
        return !ord.attach_ref || ord.attach_ref == ord.order_ref ||
            !orders.some(parent => parent.order_ref == ord.attach_ref);
    });
    let sorted = top;
    while (sorted.length < orders.length) {
        _.difference(orders, sorted).reduceRight((sorted, ord) => {
            const idx = sorted.findIndex(parent => parent.order_ref == ord.attach_ref);
            if (idx < 0) return sorted;
            sorted.splice(idx + 1, 0, ord);
            return sorted;
        }, sorted);
    }
    return sorted;
}
