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
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const logger = require('./logger.js');
const formatDate = new require('./mtrader-date.js')();
const expect = require('chai').expect;
const version = require('../package.json').version;
const Lookup = require('./lookup.js');

/**
 * Aligns the working orders on a broker with the order rows from the collect result.
 * Assumes all orders, that are not STP orders, will be filled and are
 * conditional upon previous orders with the same contract.
 * Assumes no orders are conditional upon a STP order.
 */
module.exports = function(broker, fetch, collect) {
    let promiseHelp;
    const lookup = new Lookup(fetch);
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(broker, collect);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            const opts = _.defaults({
                now: moment(options.now).valueOf()
            }, _.pick(options, _.keys(_.first(help).options)));
            return replicate(broker, collect, lookup, opts);
        });
    }, {
        close() {
            return lookup.close();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function help(broker, collect) {
    return Promise.all([collect({help: true}), broker({help: true})]).then(_.flatten)
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
                description: "Minimum quantity of shares/contracts that must change to generate a change order"
            },
            quant_threshold_percent: {
                usage: '<decimal>',
                description: "Minimum quantity, relative to current position, that must change to generate a change order"
            },
            default_order_type: {
                usage: '<order_type>',
                description: "Default order type to close unexpected positions, defaults to MKT"
            },
            combo_order_types: {
                usage: '[<order_type>...]',
                description: "Order types that can be combined into combo BAG orders with matching legs"
            },
            default_multiplier: {
                usage: '<number>',
                description: "Default value multiplier defaults to 1"
            },
            working_duration: {
                usage: '<duration>,..',
                description: "Offset of now to begin by these comma separated durations or to values"
            },
            allocation_pct: {
                usage: '<number>',
                description: "Positive number 0-100 of the balance that should be allocated to this strategy"
            },
            allocation_min: {
                usage: '<number>',
                description: "Minimum amount that should be allocated to this strategy"
            },
            allocation_max: {
                usage: '<number>',
                description: "Maximum amount that should be allocated to this strategy"
            }
        }
    })).then(help => [help]);
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
    const [broker_balances, broker_positions, broker_orders] = await Promise.all([
        broker({action: 'balances', now: options.now}),
        broker({action: 'positions', now: options.now}),
        broker({action: 'orders', now: options.now})
    ]);
    const working = getWorkingPositions(broker_positions, broker_orders, begin, options);
    const portfolio = _.uniq(Object.keys(desired).concat(getPortfolio(options.markets, options))).sort();
    logger.trace("replicate portfolio", ...portfolio);
    const margin_acct = !broker_balances.every(bal => bal.margin == null);
    _.forEach(working, (w, contract) => {
        if (!desired[contract] && +w.position && !~portfolio.indexOf(contract) &&
                (w.currency == options.currency || margin_acct)) {
            logger.warn("Unknown position", w.position, w.symbol, w.market);
        }
    });
    const orders = portfolio.reduce((orders, contract) => {
        const [, symbol, market] = contract.match(/^(.+)\W(\w+)$/);
        const d = desired[contract] || { symbol, market, position:0, asof: begin };
        const w = working[contract] || { symbol, market, position:0, asof: begin };
        const quant_threshold = getQuantThreshold(w, options);
        const update = updateWorking(d, w, _.defaults({quant_threshold}, options));
        if (!update.length) return orders;
        logger.debug("replicate", "working", working[contract]);
        logger.debug("replicate", "desired", desired[contract]);
        logger.debug("replicate", "change", update);
        const cancelled = update.filter(ord => ord.action == 'cancel');
        if (update.length == cancelled.length) return orders.concat(cancelled);
        const parent_order = update.filter(ord => ord.action != 'cancel').reduceRight((pending, prior) => {
            if (isStopOrder(prior)) // STP orders are assumed to be OCO orders
                return {
                    action: 'OCA',
                    ..._.pick(prior, 'asof', 'symbol', 'market', 'currency', 'security_type', 'multiplier'),
                    attached:[prior, pending]
                };
            else if (pending.action == 'OCA')
                return {...prior, attached: pending.attached};
            else // assumed to be conditional upon prior orders of the same contract
                return {...prior, attached: [pending]};
        });
        return orders.concat(cancelled, parent_order);
    }, []);
    await check();
    logger.trace("replicate submit orders", ...orders);
    return submitOrders(broker, broker_orders, orders, options);
}

/**
 * Collects the options results and converts the orders into positions
 */
async function getDesiredPositions(broker, collect, lookup, begin, options) {
    const parameters = await getDesiredParameters(broker, begin, options);
    logger.debug("replicate", begin, "parameters", parameters);
    const orders = await collect(merge(options, {begin, parameters}));
    return orders.reduce(async(positions, row) => {
        const security_type = row.security_type || row.typeofsymbol == 'future' && 'FUT';
        const contract = !security_type ? await lookup(_.pick(row, 'symbol', 'market')) : {};
        const posted_at = row.posted_at || row.asof || row.posted_time_unix &&
                moment(row.posted_time_unix, 'X').format() || null;
        const traded_at = row.traded_at || row.parkUntilSecs &&
                moment(row.parkUntilSecs, 'X').format() || null;
        const a = row.action ? row.action.charAt(0) : '';
        const order = c2signal({
            action: a == 'B' ? 'BUY' : a == 'S' ? 'SELL' : row.action,
            quant: row.quant,
            symbol: row.symbol,
            market: row.market || contract.market,
            currency: row.currency || contract.currency || options.currency,
            security_type: security_type || contract.security_type || 'STK',
            multiplier: row.multiplier || contract.multiplier || options.default_multiplier,
            order_type: row.order_type || options.default_order_type ||
                (+row.limit ? 'LMT' : +row.stop ? 'STP' : 'MKT'),
            limit: row.limit,
            offset: row.offset,
            stop: row.stop,
            stoploss: row.stoploss,
            tif: row.tif || row.duration || 'DAY',
            status: traded_at && moment(traded_at).isAfter(options.now) ? 'pending' :
                posted_at && moment(posted_at).isAfter(options.now) ? 'pending' : null,
            posted_at: posted_at,
            traded_at: traded_at,
            traded_price: row.traded_price
        });
        const symbol = order.symbol;
        const market = order.market;
        const key = `${order.symbol}.${order.market}`;
        const hash = await positions;
        const prior = hash[key] ||
            Object.assign(_.pick(order, 'symbol', 'market', 'currency', 'security_type', 'multiplier'), {position: 0, asof: begin});
        return _.defaults({
            [key]: advance(prior, order, options)
        }, hash);
    }, {});
}

async function getDesiredParameters(broker, begin, options) {
    const [current_balances, past_positions] = await Promise.all([
        broker({action: 'balances', now: options.now}),
        broker({action: 'positions', begin, now: options.now})
    ]);
    const first_traded_at = getFirstTradedAt(past_positions, begin, options);
    const initial_balances = await broker({action: 'balances', asof: first_traded_at, now: options.now});
    const initial_deposit = getAllocation(initial_balances, options);
    const net_allocation = getAllocation(current_balances, options);
    const net_deposit = getNetDeposit(current_balances, past_positions, options);
    const settled_cash = getSettledCash(current_balances, options);
    return { initial_deposit, net_deposit, net_allocation, settled_cash, strategy_raw: initial_deposit };
}

function getFirstTradedAt(positions, begin, options) {
    const portfolio = getPortfolio(options.markets, options).reduce((hash, item) => {
        const [, symbol, market] = item.match(/^(.+)\W(\w+)$/);
        (hash[symbol] = hash[symbol] || []).push(market);
        return hash;
    }, {});
    const relevant = positions.filter(pos => ~(portfolio[pos.symbol]||[]).indexOf(pos.market));
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
        if (!earliest || pos.traded_at < eariest.traded_at) return pos;
        else return earliest;
    }, null).asof;
    return moment(eod).subtract(1, 'days').format();
}

function getAllocation(balances, options) {
    const cash_acct = balances.every(bal => bal.margin == null);
    const local_balances = balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    const local_balance_net = local_balances.reduce((net, bal) => net.add(bal.net), Big(0));
    const local_balance_rate = local_balances.length ? local_balances[0].rate : 1;
    const initial_balance = cash_acct ? Big(local_balance_net) : balances.map(bal => {
        return Big(bal.net).times(bal.rate).div(local_balance_rate);
    }).reduce((a,b) => a.add(b), Big(0));
    return Math.min(Math.max(
        initial_balance.times(options.allocation_pct || 100).div(100),
        options.allocation_min||0), options.allocation_max||Infinity);
}

function getNetDeposit(balances, positions, options) {
    const portfolio = getPortfolio(options.markets, options).reduce((hash, item) => {
        const [, symbol, market] = item.match(/^(.+)\W(\w+)$/);
        (hash[symbol] = hash[symbol] || []).push(market);
        return hash;
    }, {});
    const relevant = positions.filter(pos => ~(portfolio[pos.symbol]||[]).indexOf(pos.market));
    const mtm = relevant.map(pos => Big(pos.mtm)).reduce((a,b) => a.add(b), Big(0));
    const balance = getAllocation(balances, options);
    return +Big(balance).minus(mtm);
}

function getSettledCash(current_balances, options) {
    const local_balances = current_balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    return +local_balances.map(bal => Big(bal.settled||0)).reduce((a,b) => a.add(b), Big(0));
}

/**
 * Retrieves the open positions and working orders from broker
 */
function getWorkingPositions(broker_positions, broker_orders, begin, options) {
    const all_positions = _.groupBy(broker_positions, pos => `${pos.symbol}.${pos.market}`);
    const positions = _.mapObject(all_positions, positions => positions.reduce((net, pos) => {
        return {...net, position: +net.position + +pos.position};
    }));
    const inline_legs = broker_orders.map(leg => {
        if (leg.order_type != 'LEG') return leg;
        const combo = broker_orders.find(combo => combo.order_ref == leg.attach_ref);
        return {
            ...leg,
            ..._.pick(combo, 'order_type', 'limit', 'offset', 'stop', 'tif', 'status'),
            action: combo.action == 'BUY' ? leg.action : leg.action == 'BUY' ? 'SELL' : 'BUY',
            quant: Big(combo.quant).times(leg.quant).toString(),
            order_ref: leg.order_ref || combo.order_ref
        };
    });
    const working = _.groupBy(inline_legs.filter(ord => {
        if (!ord.symbol || !ord.market) return false;
        return ord.status == 'pending' || ord.status == 'working';
    }), ord => `${ord.symbol}.${ord.market}`);
    return _.reduce(working, (positions, orders, contract) => sortOrders(orders)
      .reduce((positions, order) => {
        const symbol = order.symbol;
        const market = order.market;
        const prior = positions[contract] ||
            Object.assign(_.pick(order, 'symbol', 'market', 'currency', 'security_type', 'multiplier'), {position: 0, asof: begin});
        return _.defaults({
            [contract]: advance(prior, order, options)
        }, positions);
    }, positions), positions);
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

async function submitOrders(broker, broker_orders, orders, options) {
    const potential_combos = options.combo_order_types ?
        orders.filter(ord => ~options.combo_order_types.indexOf(ord.order_type) && ord.security_type == 'OPT') : [];
    const grouped = _.groupBy(potential_combos, ord => {
        return [
            ord.symbol.substring(0, 13), ord.market,
            ord.security_type, ord.currency, ord.multiplier,
            ord.order_type, ord.limit, ord.offset, ord.stop, ord.tif
        ].join(' ');
    });
    const order_legs = _.values(grouped).filter(legs => legs.length > 1);
    const combo_orders = order_legs.map(legs => {
        const quant = greatestCommonFactor(_.uniq(legs.map(leg => Math.abs(leg.quant))));
        const existing_order = broker_orders.find(ord => {
            return ord.order_type != 'LEG' && ord.order_ref == _.first(legs).attach_ref;
        });
        const traded_price = +legs.reduce((net, leg) => {
            return net.add(Big(leg.traded_price || 1).times(leg.action == 'BUY' ? 1 : -1).times(leg.quant));
        }, Big(0)).div(quant);
        if (existing_order) logger.trace("existing_order", traded_price, existing_order);
        const action = existing_order ? existing_order.action : traded_price < 0 ? 'SELL' : 'BUY';
        return {
            action,
            quant,
            ..._.pick(_.first(legs), 'order_ref', 'order_type', 'limit', 'offset', 'stop', 'tif'),
            attached: legs.map(leg => ({
                ..._.omit(leg, 'order_type', 'limit', 'offset', 'stop', 'tif'),
                action: action == 'SELL' && leg.action == 'BUY' ? 'SELL' :
                    action == 'SELL' && leg.action == 'SELL' ? 'BUY' : leg.action,
                quant: Big(leg.quant).div(quant).toString(),
                order_type: 'LEG'
            }))
        };
    });
    const pending_orders = _.difference(orders, _.flatten(order_legs));
    const grouped_orders = _.groupBy(pending_orders, ord => `${ord.symbol}.${ord.market}`);
    const all_orders = _.values(grouped_orders).concat(combo_orders.map(ord => [ord]));
    const submitted = await Promise.all(all_orders.map(async(orders) => {
        return orders.reduce(async(promise, order) => {
            const submitted = await promise;
            logger.trace("replicate submit", order);
            const submit = await broker({...options, ...order});
            return submitted.concat(submit);
        }, []).catch(err => {
            logOrders(logger.error, orders);
            return err;
        });
    }));
    const errors = submitted.filter(posted => !_.isArray(posted));
    if (errors.length > 1) errors.forEach((err, i) => {
        logger.error("Could not submit order", orders[i], err);
    });
    if (errors.length) throw _.last(errors);
    return logOrders(logger.info, [].concat(...submitted));
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

function greatestCommonFactor(numbers) {
    if (numbers.length == 1) return _.first(numbers);
    return _.range(Math.min(...numbers), 0, -1).find(dem => {
        return numbers.every(number => number/dem == Math.floor(number/dem));
    });
}

/**
 * Converts quant_threshold_percent into quant_threshold relative to open position size
 */
function getQuantThreshold(working, options) {
    if (!options.quant_threshold_percent) return options.quant_threshold || 0;
    if (working.prior) return getQuantThreshold(working.prior, options);
    const opened = working.position;
    const threshold = Math.floor(opened * options.quant_threshold_percent /100);
    if (!threshold) return options.quant_threshold || 0;
    else if (!options.quant_threshold) return threshold;
    else return Math.min(threshold, options.quant_threshold);
}

/**
 * Array of orders to update the working positions to the desired positions
 */
function updateWorking(desired, working, options) {
    const ds = desired.order;
    const ws = working.order;
    const d_opened = Math.abs(desired.position);
    const w_opened = Math.abs(working.position);
    const within = Math.abs(d_opened - w_opened) <= (options.quant_threshold || 0);
    const same_side = desired.position/Math.abs(+desired.position||1) != -1*working.position/Math.abs(+working.position||1);
    const ds_projected = ds && ds.status == 'pending';
    if (ds && (ds.traded_at || ds.posted_at) && !working.prior && working.traded_at &&
            moment(working.traded_at).isAfter(ds.traded_at || ds.posted_at)) {
        if (d_opened != w_opened || !same_side) {
            // working position has since been closed (stoploss?) since the last desired signal was produced
            logger.warn(`Working ${desired.symbol} position has since been changed`);
        }
        return [];
    } else if (!d_opened && !w_opened && !working.prior && !desired.prior) {
        // no open position
        return [];
    } else if (within && !working.prior && same_side && desired.prior && isStopOrder(ds)) {
        // advance working state
        const adj = updateWorking(desired.prior, working, options);
        return appendSignal(adj, _.defaults({
            // adjust stoploss quant if first signal
            quant: _.isEmpty(adj) && d_opened == ds.quant ? w_opened : ds.quant
        }, ds), options);
    } else if (within && !working.prior && same_side) {
        // positions are (nearly) the same
        return [];
    } else if (d_opened == w_opened && working.prior && !desired.prior && same_side) {
        // cancel working signals
        return cancelSignal(desired, working, options);
    } else if (desired.prior && !working.prior) {
        // advance working state
        const adj = updateWorking(desired.prior, working, options);
        if (adj.filter(a=>!isStopOrder(a)).length) return appendSignal(adj, ds, options);
        else return appendSignal(adj, _.defaults({
            // adjust quant if first signal
            action: working.position < desired.position ? 'BUY' : 'SELL',
            quant: Math.abs(desired.position - working.position)
        }, ds), options);
    } else if (working.prior && !desired.prior) {
        // cancel working signal
        expect(ws).to.have.property('order_ref');
        return cancelSignal(desired, working, options);
    } else if (desired.prior && working.prior) {
        if (sameSignal(ds, ws, options.quant_threshold)) {
            // don't change this signal
            return updateWorking(desired.prior, working.prior, options);
        } else if (isStopOrder(ds) && isStopOrder(ws) && sameSignal(ds, ws, options.quant_threshold)) {
            // signals are both stoploss orders and within quant_threshold
            return updateWorking(desired.prior, working.prior, options);
        } else if (isStopOrder(ds) && isStopOrder(ws) && ds_projected && ds.action == ws.action) {
            // signals are both stoploss orders, but the desired stoploss has not come into effect yet
            return updateWorking(desired.prior, working.prior, options);
        } else if (isStopOrder(ds) && ds_projected) {
            // desired signal is stoploss order, but has not come into effect yet
            return updateWorking(desired.prior, working, options);
        } else if (similarSignals(ds, ws) && (
                ws.action == 'BUY' && working.prior.position < desired.position ||
                ws.action == 'SELL' && working.prior.position > desired.position ||
                ws.order_type == 'STP' && working.prior.position == desired.position)) {
            // replace order
            expect(ws).to.have.property('order_ref');
            const adj = updateWorking(desired.prior, working.prior, options);
            if (adj.some(ord => ord.action == 'cancel' && ord.order_ref == ws.attach_ref))
                return appendSignal(adj, ds, options); // parent order is cancelled
            else if (working.prior.position < desired.position && ws.action == 'BUY' ||
                    working.prior.position > desired.position && ws.action == 'SELL')
                return appendSignal(adj, _.defaults({
                    // adjust quant if first signal
                    quant: Math.abs(desired.position - working.prior.position),
                    order_ref: ws.order_ref,
                    attach_ref: ws.attach_ref
                }, ds), options);
            else
                return appendSignal(adj, _.defaults({
                    order_ref: ws.order_ref,
                    attach_ref: ws.attach_ref
                }, ds), options);
        } else if (d_opened != w_opened && same_side) {
            return cancelSignal(desired, working, options);
        } else {
            // cancel and submit
            const upon = cancelSignal(desired.prior, working, options);
            const working_state = _.isEmpty(upon) ? working : working.prior;
            const cond = {...ds, attach_ref: _.isEmpty(upon) && !isStopOrder(ws) ? ws.order_ref : ds.attach_ref};
            return appendSignal(upon, cond, options);
        }
    } else {
        const recent_order = ds || desired.last_order ||
            {...desired, order_type: options.default_order_type || 'MKT', tif: 'DAY'};
        return [c2signal({
            ..._.omit(recent_order, 'traded_at', 'posted_at'),
            action: desired.position > working.position ? 'BUY' : 'SELL',
            quant: Math.abs(desired.position - working.position)
        })];
    }
}

/**
 * Checks if the two orders appear to be the same
 */
function sameSignal(a, b, threshold) {
    if (!a || !b) return false;
    else if (!isMatch(b, _.pick(a, 'action', 'order_type', 'tif'))) return false;
    else if (Math.abs(a.quant - b.quant) > (threshold || 0)) return false;
    else if (a.limit && b.limit && a.limit != b.limit) return false;
    else if (a.offset && b.offset && a.offset != b.offset) return false;
    else if (a.stop && b.stop && a.stop != b.stop) return false;
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
 * Cancels the latest working order iff it would not be re-submitted
 */
function cancelSignal(desired, working, options) {
    const ws = working.order;
    expect(ws).to.have.property('order_ref');
    const adj = updateWorking(desired, working.prior, options);
    // check if cancelling order is the same of submitting order
    const same = _.find(adj, a => sameSignal(a, ws));
    const similar = _.find(adj, a => !a.order_ref && similarSignals(a, ws));
    if (same)
        return _.without(adj, same);
    else if (similar)
        return adj.map(a => a == similar ? _.extend({order_ref: ws.order_ref, attach_ref: ws.attach_ref}, a) : a);
    else if (isStopOrder(ws) && adj.some(a => moment(a.traded_at || a.posted_at).isAfter(options.now)))
        return adj; // don't cancel stoploss order until replacements orders come into effect
    else
        return [{...ws, action: 'cancel'}].concat(adj);
}

/**
 * Adds ds to the upon array
 */
function appendSignal(upon, ds, options) {
    const reversed = upon.find(ord => isReverse(ord, ds, options));
    const replaced = upon.find(ord => ord.action != 'cancel' &&
        ord.action != ds.action && sameOrderType(ord, ds, options) && +ord.quant < +ds.quant);
    const reduced = upon.find(ord => ord.action != 'cancel' &&
        ord.action != ds.action && sameOrderType(ord, ds, options) && +ord.quant > +ds.quant);
    const increased = upon.find(ord => ord.action != 'cancel' &&
        ord.action == ds.action && sameOrderType(ord, ds, options));
    if (reversed)
        return _.without(upon, reversed);
    else if (replaced)
        return _.without(upon, replaced).concat({
            ...ds, quant: ds.quant - replaced.quant
        });
    else if (reduced)
        return _.without(upon, reduced).concat({
            ...reduced, quant: reduced.quant - ds.quant
        });
    else if (increased)
        return _.without(upon, increased).concat({
            ...ds, quant: +increased.quant + +ds.quant
        });
    else
        return upon.concat(ds);
}

/**
 * If two orders have the same order order_type, but may different on quant
 */
function similarSignals(a, b) {
    if (!a || !b) return false;
    return a.action == b.action && a.order_type == b.order_type;
}

/**
 * If the open and close orders have the same quant, but opposite actions
 */
function isReverse(a, b, options) {
    if (!a || !b) return false;
    const threshold = options.quant_threshold;
    return a.action != 'cancel' && b.action != 'cancel' &&
        a.action != b.action && sameOrderType(a, b, options) &&
        Math.abs(a.quant - b.quant) <= (threshold || 0);
}

function sameOrderType(a, b, options) {
    return a.order_type == b.order_type ||
        isStopOrder(a) == isStopOrder(b) && a.order_type == (options.default_order_type || 'MKT');
}

/**
 * Position after applying the given signal
 */
function advance(pos, order, options) {
    const position = updateStoploss(pos, order, options);
    // record most recent order order_type/limit/stop/offset for use with adjustements
    return {...position, last_order: order};
}

function updateStoploss(pos, order, options) {
    if (order.quant === 0 && (order.traded_at || order.posted_at) &&
            moment(order.traded_at || order.posted_at).isAfter(options.now)) {
        return pos; // don't update order adjustement limits if in the future
    } else if (order.stoploss) {
        const base = !+order.quant && pos.prior && ~pos.order.order_type.indexOf('STP') ? pos.prior : pos;
        const prior = advance(base, _.omit(order, 'stoploss'), options);
        const stp_order = _.omit(_.extend(_.pick(c2signal(order), 'symbol', 'market', 'currency', 'security_type', 'multipler', 'traded_at', 'posted_at', 'status'), {
            action: prior.position > 0 ? 'SELL' : 'BUY',
            quant: Math.abs(prior.position),
            tif: 'GTC',
            order_type: 'STP',
            stop: order.stoploss,
        }), _.isUndefined);
        return _.defaults({order: stp_order, prior}, prior);
    } else if (isStopOrder(order)) {
        expect(order).to.have.property('stop').that.is.ok;
        const prior = pos.prior && isStopOrder(pos.order) ? pos.prior : pos;
        return _.defaults({order: c2signal(order), prior}, pos);
    } else {
        return updatePosition(pos, order, options);
    }
}

/**
 * Position after applying the given order
 */
function updatePosition(pos, order, options) {
    if (+order.quant > 0) {
        return changePosition(pos, order, options);
    } else {
        return updateParkUntilSecs(pos, order, options);
    }
}

/**
 * Position after applying the given order traded_at date and limit
 */
function updateParkUntilSecs(pos, order, options) {
    if ((order.traded_at || order.posted_at) && pos.order) {
        const ord = _.defaults(_.pick(order, 'traded_at', 'posted_at', 'status'), pos.order);
        const updated = _.defaults({order: ord}, pos);
        return updateLimit(updated, order, options);
    } else {
        return updateLimit(pos, order, options);
    }
}

/**
 * Position after applying the given order limit
 */
function updateLimit(pos, order, options) {
    if (pos.order) {
        return _.defaults({order: _.defaults(_.pick(order, 'order_type', 'limit', 'stop', 'offset'), pos.order)}, pos);
    } else {
        return pos;
    }
}

/**
 * Position after applying the given order to change the position size
 */
function changePosition(pos, order, options) {
    expect(order).has.property('quant').that.is.above(0);
    expect(order).to.have.property('action').that.is.oneOf(['BUY', 'SELL']);
    const prior = order.status == 'working' || order.status == 'pending' ||
        !order.traded_at && !order.posted_at ||
        moment(order.traded_at || order.posted_at).isAfter(options.now) ? {prior: pos} : {};
    return _.extend(prior, changePositionSize(pos, order, options));
}

/**
 * Position after changing the position size
 */
function changePositionSize(pos, order, options) {
    expect(order).has.property('quant').that.is.above(0);
    if (order.action == 'BUY') {
        return {
            asof: order.traded_at || order.posted_at,
            symbol: order.symbol,
            market: order.market,
            currency: order.currency,
            security_type: order.security_type,
            multiplier: order.multiplier,
            position: +pos.position + +order.quant,
            order: c2signal(order)
        };
    } else if (order.action == 'SELL') {
        return {
            asof: order.traded_at || order.posted_at,
            symbol: order.symbol,
            market: order.market,
            currency: order.currency,
            security_type: order.security_type,
            multiplier: order.multiplier,
            position: +pos.position - +order.quant,
            order: c2signal(order)
        };
    } else {
        throw Error("Unknown order action: " + JSON.stringify(order));
    }
}

/**
 * Returns the order (identity function)
 */
function c2signal(order) {
    return _.mapObject(_.omit(order, v => v == null), v => v.toString());
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
    expect(order).to.have.property('order_type').that.is.ok;
    return ~order.order_type.indexOf('STP');
}
