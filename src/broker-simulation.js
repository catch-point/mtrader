// broker-simulation.js
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
const merge = require('./merge.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const storage = require('./storage.js');
const Fetch = require('./fetch.js');
const Lookup = require('./lookup.js');
const expect = require('chai').expect;

const majors = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

let sequence_counter = (Date.now() * process.pid) % 8589869056;
function nextval() {
    return (++sequence_counter).toString(16);
}

module.exports = function(settings, quote) {
    if (settings.info=='help') return helpSettings();
    if (settings.info=='version') return [{version}];
    expect(settings).to.have.property('simulation').that.is.ok;
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).simulation
    )), v => !v);
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const store = storage(lib_dir);
    const fetch = new Fetch(merge(config('fetch'), settings.fetch));
    const lookup = new Lookup(fetch);
    let advance_lock = Promise.resolve();
    return _.extend(async(options) => {
        if (options.info=='help') return helpOptions();
        if (options.info=='version') return [{version}];
        if (options.info) return [];
        return store.open(settings.simulation, async(err, db) => {
            if (err) throw err;
            const barsFor_fn = barsFor.bind(this, markets, quote);
            if (options.action != 'reset') advance_lock = advance_lock
                .then(() => advance(barsFor_fn, settings.commissions, db, options));
            await advance_lock;
            return dispatch(barsFor_fn, db, lookup, options);
        });
    }, {
        close() {
            return Promise.all([
                lookup.close(),
                fetch.close(),
                store.close()
            ]);
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function helpSettings() {
    return [{
        name: 'broker',
        usage: 'broker(settings)',
        description: "Information needed to identify the broker account",
        options: {
            simulation: {
                usage: '<string>',
                description: "The stored simulation instance to use"
            }
        }
    }];
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
            'asof', 'currency', 'rate', 'net', 'settled'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['balances']
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time of the balances to return"
            },
            begin: {
                usage: '<dateTime>',
                description: "Include historic balances since given dateTime, but before given asof"
            }
        }
    }, {
        name: 'positions',
        usage: 'broker(options)',
        description: "List a summary of recent trades and their effect on the account position",
        properties: [
            'asof', 'action', 'quant', 'position', 'traded_at', 'traded_price', 'price',
            'sales', 'purchases', 'dividend', 'commission', 'mtm', 'value',
            'symbol', 'market', 'currency', 'security_type', 'multiplier'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['positions']
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time of the positions to return"
            },
            begin: {
                usage: '<dateTime>',
                description: "Include historic positions since given dateTime, but before given asof"
            }
        }
    }, {
        name: 'orders',
        usage: 'broker(options)',
        description: "List a summary of open orders",
        properties: [
            'posted_at', 'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset', 'traded_price', 'tif', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'security_type', 'currency', 'multiplier',
            'condition'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['orders']
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time of workings orders to return"
            },
            begin: {
                usage: '<dateTime>',
                description: "Include historic orders since given dateTime, but before given asof"
            }
        }
    }, {
        name: 'transfer',
        usage: 'broker(options)',
        description: "Add the quant to the current balance",
        properties: [
            'asof', 'action', 'quant', 'currency'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['deposit', 'withdraw']
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time to advance the clock to before transfering funds"
            }
        }
    }, {
        name: 'reset',
        usage: 'broker(options)',
        description: "Resets the store, earasing all the history",
        properties: [],
        options: {
            action: {
                usage: '<string>',
                values: ['reset']
            }
        }
    }, {
        name: 'submit',
        usage: 'broker(options)',
        description: "Transmit order for trading",
        properties: [
            'posted_at', 'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset', 'tif', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'security_type', 'currency', 'multiplier',
            'condition'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['BUY', 'SELL', 'OCA', 'cancel']
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time to advance the clock to before submitting the order"
            },
            quant: {
                usage: '<positive-integer>',
                description: "The number of shares or contracts to buy or sell"
            },
            order_type: {
                usage: '<order-type>',
                values: ['MKT', 'MIT', 'MOO', 'MOC', 'LMT', 'LOO', 'LOC', 'STP']
            },
            limit: {
                usage: '<limit-price>',
                descirption: "The limit price for orders of type LMT"
            },
            stop: {
                usage: '<aux-price>',
                description: "Stop limit price for STP orders"
            },
            offset: {
                usage: '<price-offset>',
                description: "Pegged and snap order offset"
            },
            condition: {},
            tif: {
                usage: '<time-in-forced>',
                values: ['GTC', 'DAY', 'IOC']
            },
            order_ref: {
                usage: '<string>',
                description: "The order identifier that is unique among working orders"
            },
            attach_ref: {
                usage: '<string>',
                description: "The order_ref of the parent order that must be filled before this order or a common identifier for orders in the same one-cancels-all (OCA) group."
            },
            attached: {
                usage: '[...orders]',
                description: "Submit attached parent/child orders together or OCA group of orders"
            },
            symbol: {
                usage: '<string>',
                description: "The symbol of the contract to be traded, omit for OCA and bag orders"
            },
            market: {
                usage: '<string>',
                description: "The market of the contract (might also be the name of the exchange)"
            },
            security_type: {
                values: ['STK', 'FUT', 'OPT']
            },
            currency: {
                usage: '<string>',
                values: ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY']
            },
            multiplier: {
                usage: '<number>',
                description: "The value of a single unit of change in price"
            }
        }
    }]);
}

async function advance(barsFor, commissions, db, options) {
    const now = moment(options.asof || options.now);
    if (!now.isValid()) throw Error(`Invalid asof option ${options.asof || options.now}`);
    const asof = now.format();
    const yesterday = await lastTime(db, options);
    if (!yesterday || yesterday >= asof) return false;
    const orders = await listOrders(db, {});
    const positions = await listPositions(db, {});
    const balances = await listBalances(db, {});
    const all_legs = orders.filter(ord => ord.order_type == 'LEG');
    const pending = [].concat(...await Promise.all(orders.map(async(order) => {
        const legs = all_legs.filter(ord => ord.attach_ref == order.order_ref);
        if (order.order_type == 'LEG') return [];
        else if (order.status != 'working') return [order].concat(legs);
        else return fillOrder(barsFor, order, legs, options);
    })));
    const combos = _.uniq(all_legs.map(ord => ord.attach_ref));
    const filled = pending.filter(ord => ord.status == 'filled' && !~combos.indexOf(ord.order_ref));
    const complete = pending.map(order => {
        if (order.status == 'pending' && order.attach_ref) {
          const parent = filled.find(parent => parent.order_ref == order.attach_ref);
          if (parent) return {...order, status: 'working', asof: parent.asof};
        }
        return order;
    });
    const grouped_filled = _.groupBy(filled, w => `${w.symbol}.${w.market}`);
    const indexed_positions = _.indexBy(positions, w => `${w.symbol}.${w.market}`);
    const symbol_markets = _.union(Object.keys(grouped_filled), Object.keys(indexed_positions));
    const advanced_positions = [].concat(...await Promise.all(symbol_markets.map(async(sm) => {
        const filled = grouped_filled[sm] || [];
        const position = indexed_positions[sm] ||
            _.pick(filled[0], 'symbol', 'market', 'currency', 'security_type', 'multiplier');
        const symbol = position.symbol || _.first(filled).symbol;
        const market = position.market || _.first(filled).market;
        const since = position.asof || _.first(orders).asof;
        const bars = await barsFor(symbol, market, since, options);
        const positions = [];
        const ending_position = bars.reduce((position, bar) => {
            const orders = filled.filter(o => (!position.asof || position.asof < o.asof) && o.asof <= bar.asof);
            const ending_position = advancePosition(commissions, position, orders, bar);
            if (ending_position.action) positions.push(ending_position);
            return ending_position;
        }, position);
        return positions;
    })));
    if (orders.length) await replaceWorkingOrders(db, orders, complete);
    if (advanced_positions.length) await appendPositions(db, advanced_positions);
    await updateBalance(barsFor, db, advanced_positions, options);
}

async function dispatch(barsFor_fn, db, lookup, options) {
    expect(options).to.have.property('action');
    switch(options.action) {
        case 'reset': return reset(db, options);
        case 'deposit': return deposit(barsFor_fn, db, options);
        case 'withdraw': return withdraw(barsFor_fn, db, options);
        case 'balances': return listBalances(db, options);
        case 'positions': return listPositions(db, options);
        case 'orders': return listOrders(db, options);
        case 'cancel': return cancelOrder(db, options);
        case 'OCA': return oneCancelsAllOrders(db, lookup, options);
        case 'BUY':
        case 'SELL': return submitOrder(db, lookup, options);
        default: expect(options).to.have.property('action').to.be.oneOf([
            'deposit', 'withdraw',
            'balances', 'positions', 'orders',
            'BUY', 'SELL', 'cancel'
        ]);
    }
}

async function lastTime(db, options) {
    const coll = await db.collection('balances');
    const last_month = _.last(coll.listNames());
    if (!last_month) return null;
    return _.last(coll.tailOf(last_month)).asof;
}

async function listBalances(db, options) {
    const asof = moment(options.asof || options.now).format();
    const begin = moment(options.begin || asof).format();
    return reduceMonths(await db.collection('balances'), options, (result, data) => {
        const latest = _.last(data.filter(balance => balance.asof <= asof))
        if (!latest) return result;
        return data.filter(b => begin < b.asof && b.asof <= asof || b.asof == latest.asof);
    }, []);
}

async function listPositions(db, options) {
    const asof = moment(options.asof || options.now).format();
    const begin = moment(options.begin || asof).format();
    const historic = await reduceMonths(await db.collection('positions'), options, (result, data) => {
        return result.concat(data.filter(p => p.asof <= asof));
    }, []);
    const positions = _.values(_.indexBy(historic, position => `${position.symbol}.${position.market}`));
    return historic.filter(p => begin < p.asof && p.asof <= asof || ~positions.indexOf(p));
}

async function listOrders(db, options) {
    const asof = moment(options.asof || options.now).format();
    const begin = moment(options.begin || asof).format();
    return reduceMonths(await db.collection('orders'), options, (result, data) => {
        return result.concat(data.filter(o => {
            if (asof < o.posted_at) return false;
            return begin < o.asof || asof <= o.asof || o.status == 'working' || o.status == 'pending';
        }));
    }, []);
}

async function reset(db, options) {
    return Promise.all(['balances', 'orders', 'positions'].map(async(name) => {
        const coll = await db.collection(name);
        return coll.listNames().map(block => {
            return coll.remove(block);
        });
    }));
}

async function deposit(barsFor, db, options) {
    expect(options).to.have.property('currency').that.is.ok;
    expect(options).to.have.property('quant').that.is.ok;
    const currency = options.currency;
    const now = moment(options.asof || options.now);
    const asof = now.format();
    const month = now.format('YYYYMM');
    const coll = await db.collection('balances');
    const last = _.last(coll.listNames());
    const months = _.uniq(_.compact([last, month]));
    return coll.lockWith(months, async() => {
        const m = _.first(months);
        const data = coll.exists(m) ? await coll.readFrom(m) : [];
        const balances = data.filter(b => b.currency == options.currency);
        const balance = _.last(balances) || {
            asof, currency, rate: 0, net: 0, settled: 0
        };
        const latest = data.filter(b => b.asof == balance.asof && b.currency != currency);
        const adjustment = {...balance,
            net: Big(balance.net).add(options.quant).toString(),
            settled: Big(balance.settled).add(options.settled_quant || options.quant).toString()
        };
        const set = _.sortBy(latest.concat(adjustment), b => majors.indexOf(b.currency));
        const quote = (latest.find(b => b.rate == 1) || adjustment).currency;
        const result = await Promise.all(set.map(async(b) => {
            if (b.asof == asof && b.rate) return b;
            const week = moment(now).subtract(1,'weeks').format();
            const rate = await rateOf(barsFor, b.currency, quote, {...options, begin: week});
            return {...b, asof, rate};
        }));
        if (months.length > 1) {
            await coll.writeTo(result, month);
        } else if (balance.asof == asof) {
            const without = data.filter(balance => balance.asof != asof);
            await coll.writeTo(without.concat(result), month);
        } else {
            const appended = [].concat(data, result);
            await coll.writeTo(appended, month);
        }
        return result;
    });
}

async function withdraw(barsFor, db, options) {
    return deposit(barsFor, db, {...options, quant: Big(options.quant).times(-1).toString()});
}

async function cancelOrder(db, options) {
    expect(options).to.have.property('order_ref').that.is.ok;
    const now = moment(options.asof || options.now);
    const orders = await db.collection('orders');
    const recent_month = _.last(orders.listNames());
    if (!recent_month) throw Error(`No orders, not even ${options.order_ref}, exist`);
    return orders.lockWith([recent_month], async() => {
        const data = await orders.readFrom(recent_month);
        const completed = data.filter(o => o.status != 'working' && o.status != 'pending');
        const working = data.filter(o => o.status == 'working' || o.status == 'pending');
        const order = _.pick(options, [
            'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset', 'tif', 'status',
            'order_ref', 'attach_ref',
            'symbol', 'market', 'security_type', 'currency', 'multiplier',
            'condition'
        ]);
        const cancelling = working.find(sameOrder(order));
        if (!cancelling) {
            const too_late = completed.find(sameOrder(order));
            if (too_late) return [too_late];
            else throw Error(`Order ${options.order_ref} does not exist`);
        }
        const target_order = cancelling.order_type == 'LEG' &&
            working.every(ord => ord == cancelling || ord.attach_ref != cancelling.attach_ref) ?
            working.find(ord => ord.order_ref == cancelling.attach_ref) : cancelling;
        const cancelling_orders = [target_order].concat(findAttachedOrders(target_order.order_ref, working));
        const cancelled_orders = cancelling_orders.map(ord => ({
            ...ord, asof: now.format(), status: 'cancelled'
        }));
        const replacement = completed.concat(
            working.filter(order => !~cancelling_orders.indexOf(order)),
            cancelled_orders
        );
        await orders.replaceWith(replacement, recent_month);
        return cancelled_orders;
    });
}

function findAttachedOrders(order_ref, orders) {
    if (!order_ref) return [];
    return [].concat(...orders.filter(ord => ord.attach_ref == order_ref)
      .map(ord => [ord].concat(findAttachedOrders(ord.order_ref, orders))));
}

async function oneCancelsAllOrders(db, lookup, options) {
    const now = moment(options.asof || options.now);
    const coll = await db.collection('orders');
    const current_month = now.format('YYYYMM');
    const recent_month = _.last(coll.listNames()) || current_month;
    return coll.lockWith(_.uniq([recent_month, current_month]), async() => {
        if (recent_month != current_month && coll.exists(recent_month)) {
            const data = await coll.readFrom(recent_month);
            const completed = data.filter(o => o.status != 'working' && o.status != 'pending');
            const working = data.filter(o => o.status == 'working' || o.status == 'pending');
            await coll.replaceWith(completed, recent_month);
            await coll.writeTo(working, current_month);
        }
        const order_ref = options.order_ref || nextval();
        return (options.attached||[]).reduce(async(promise, attached_order) => {
            const result = await promise;
            const attached = await appendOrders(lookup, coll, current_month, current_month, {
                ..._.omit(options, 'action', 'attached'),
                attach_ref: order_ref,
                ...attached_order
            });
            return result.concat(attached);
        }, []);
    });
}

async function submitOrder(db, lookup, options) {
    const now = moment(options.asof || options.now);
    const coll = await db.collection('orders');
    const current_month = now.format('YYYYMM');
    const recent_month = _.last(coll.listNames()) || current_month;
    return coll.lockWith(_.uniq([recent_month, current_month]), () => {
        return appendOrders(lookup, coll, recent_month, current_month, options);
    });
}

async function appendOrders(lookup, coll, recent_month, current_month, options) {
    if (options.order_type != 'LEG') {
        expect(options).to.have.property('tif').that.is.oneOf(['GTC', 'DAY', 'IOC']);
        expect(options).to.have.property('order_type').that.is.oneOf(['MKT', 'MIT', 'MOO', 'MOC', 'LMT', 'LOO', 'LOC', 'STP']);
    } else if (!_.isEmpty(options.attached)) {
        expect(options).not.to.have.property('attached');
    }
    const contract = options.symbol && (!options.market || !options.security_type || !options.currency) ?
        await lookup(_.pick(options, 'symbol', 'market')) : {};
    if (_.isEmpty(options.attached) || options.attached.every(leg => leg.order_type != 'LEG')) {
        expect(options).to.have.property('symbol').that.is.a('string');
        expect(options.market || contract.market).to.be.a('string');
        expect(options.currency || contract.currency).to.be.a('string');
        expect(options.security_type || contract.security_type).to.be.oneOf(['STK', 'FUT', 'OPT']);
    }
    const now = moment(options.asof || options.now);
    const data = coll.exists(recent_month) ?
        await coll.readFrom(recent_month) : [];
    const completed = data.filter(o => o.status != 'working' && o.status != 'pending');
    if (recent_month != current_month) await coll.replaceWith(completed, recent_month);
    const current_completed = recent_month == current_month ? completed : [];
    const working = data.filter(o => o.status == 'working' || o.status == 'pending');
    const order = _.extend(_.pick(options, [
        'action', 'quant', 'order_type', 'limit', 'stop', 'offset', 'tif',
        'order_ref', 'attach_ref',
        'symbol', 'market', 'security_type', 'currency', 'multiplier',
        'condition'
    ]), {
        multiplier: options.multiplier || 1
    }, _.pick(contract, 'symbol', 'market', 'currency', 'security_type', 'multiplier'));
    const order_ref = options.order_type != 'LEG' ? order.order_ref || nextval() : null;
    const modifying = order.order_ref && working.find(sameOrder(order));
    const status = order.attach_ref && working.some(ord => ord.order_ref == order.attach_ref) ?
        'pending' : 'working';
    const submitted = {posted_at: now.format(), asof: now.format(), ...order, order_ref, status};
    const replacement = current_completed.concat(
        working.filter(order => order != modifying),
        submitted
    );
    await coll.replaceWith(replacement, current_month);
    return (options.attached||[]).reduce(async(promise, attached_order) => {
        const result = await promise;
        const attached = await appendOrders(lookup, coll, current_month, current_month, {
            ..._.omit(options, 'action', 'quant', 'order_type', 'limit', 'stop', 'offset', 'tif', 'order_ref', 'condition'),
            attached: [],
            ...attached_order,
            attach_ref: order_ref
        });
        return result.concat(attached);
    }, [submitted]);
}

async function fillOrder(barsFor, order, legs, options) {
    if (_.isEmpty(legs) || legs.every(ord => ord.order_type != 'LEG'))
        return [await fillSingleOrder(barsFor, order, options)];
    expect(order).to.have.property('order_type').that.is.oneOf(['MKT', 'MOO', 'MOC', 'LOO', 'LOC']);
    const filled_legs = await Promise.all(legs.map(async(leg) => {
        return fillSingleOrder(barsFor, {
            ...leg,
            action: order.action == 'BUY' ? leg.action : leg.action == 'BUY' ? order.action : 'BUY',
            quant: order.quant == 1 ? leg.quant : order.quant * leg.quant,
            order_type: order.order_type == 'LOO' ? 'MOO' : order.order_type == 'LOC' ? 'MOC' : order.order_type,
            tif: order.tif,
            status: order.status
        }, options);
    }));
    const asof = _.last(_.sortBy(filled_legs.map(leg => leg.asof)));
    if (filled_legs.some(leg => leg.status == 'cancelled'))
        return [{...order, asof, status: 'cancelled'}]
          .concat(legs.map(leg => ({...leg, status: 'cancelled'})));
    if (filled_legs.some(leg => leg.status != 'filled'))
        return [{...order, asof}].concat(legs);
    const traded_price = filled_legs.reduce((gross_price, leg) => {
        const value = Big(leg.traded_price||1).times(leg.quant);
        if (leg.action == 'BUY') return gross_price.add(value);
        else return gross_price.minus(value);
    }, Big(0)).div(order.quant).toString();
    if (order.order_type == 'LOO' || order.order_type == 'LOC') {
        if (order.action == 'BUY' && +order.limit < +traded_price ||
                order.action == 'SELL' && +traded_price < +order.limit) {
            if (order.tif == 'GTC') return [order];
        }
    }
    return [{...order, asof, status: 'filled', traded_price}].concat(legs.map((leg, i) => {
        return {...leg, ..._.pick(filled_legs[i], 'asof', 'status', 'traded_price')};
    }));
}

async function fillSingleOrder(barsFor, order, options) {
    expect(order).to.have.property('symbol').that.is.ok;
    expect(order).to.have.property('market').that.is.ok;
    expect(order).to.have.property('tif').that.is.oneOf(['GTC', 'DAY', 'IOC']);
    expect(order).to.have.property('order_type').that.is.oneOf(['MKT', 'MIT', 'MOO', 'MOC', 'LMT', 'LOO', 'LOC', 'STP']);
    const all_bars = await barsFor(order.symbol, order.market, order.asof, options);
    if (!all_bars.length) return order;
    const mkt_price = all_bars[0].open;
    const bars = order.tif == 'GTC' ? all_bars : order.tif == 'DAY' ? all_bars.slice(0, 1) :
        order.tif == 'IOC' ? [{...all_bars[0], high: mkt_price, low: mkt_price, close: mkt_price}] : all_bars;
    switch (order.order_type) {
        case 'MKT': // TODO slippage?
        case 'MOO': return {...order, asof: _.first(bars).asof, status: 'filled', traded_price: _.first(bars).open};
        case 'MOC': return {...order, asof: _.first(bars).asof, status: 'filled', traded_price: _.first(bars).close};
        case 'MIT':
        case 'STP': {
            const bar = bars.find(bar => bar.low <= order.stop && order.stop <= bar.high);
            if (!bar && order.tif == 'GTC') return order;
            else if (!bar) return {...order, asof: all_bars[0].asof, status: 'cancelled'};
            else return {...order, asof: bar.asof, status: 'filled', traded_price: order.stop};
        }
        case 'LOO': {
            const bar = order.action == 'BUY' ? bars.find(bar => bar.open <= order.limit) :
                order.action == 'SELL' ? bars.find(bar => order.limit <= bar.open) : null;
            if (!bar) return {...order, asof: all_bars[0].asof, status: 'cancelled'};
            else return {...order, asof: bar.asof, status: 'filled', traded_price: bar.open};
        }
        case 'LOC': {
            const bar = order.action == 'BUY' ? bars.find(bar => bar.close <= order.limit) :
                order.action == 'SELL' ? bars.find(bar => order.limit <= bar.close) : null;
            if (!bar) return {...order, asof: all_bars[0].asof, status: 'cancelled'};
            else return {...order, asof: bar.asof, status: 'filled', traded_price: bar.close};
        }
        case 'LMT': {
            const bar = bars.find(bar => bar.low <= order.limit && order.limit <= bar.high);
            if (!bar && order.tif == 'GTC') return order;
            else if (!bar) return {...order, asof: all_bars[0].asof, status: 'cancelled'};
            else return {...order, asof: bar.asof, status: 'filled', traded_price: order.limit};
        }
        default: throw Error(`Unsupported order type ${order.order_type}`);
    }
}

async function rateOf(barsFor, base, quote, options) {
    expect(base).to.be.oneOf(majors);
    expect(quote).to.be.oneOf(majors);
    const b = majors.indexOf(base);
    const q = majors.indexOf(quote);
    const since = moment(options.asof || options.now).subtract(1,'weeks').format();
    if (b == q) return '1';
    const bar = b < q ? _.last(await barsFor(base, quote, since, options)) :
        _.last(await barsFor(quote, base, since, options));
    if (!bar) return '1';
    else return b < q ? bar.close : Big(1).div(bar.close).toString();
}

async function barsFor(markets, quote, symbol, market, since, options) {
    const result = await quote({
        ...options,
        symbol, market,
        columns: {
            asof: 'ending',
            open: 'day.open',
            high: 'day.high',
            low: 'day.low',
            close: 'day.close',
            dividend: 'OFFSET(1,day.close) - OFFSET(1,day.adj_close) * day.close/day.adj_close'
        },
        begin: since,
        end: moment(options.asof || options.now).format()
    });
    return result.filter(bar => bar.asof > since);
}

async function replaceWorkingOrders(db, working, complete) {
    const now = moment(_.first(complete).asof);
    const orders = await db.collection('orders');
    const current_month = now.format('YYYYMM');
    const recent_month = _.last(orders.listNames()) || current_month;
    return orders.lockWith(_.uniq([recent_month, current_month]), async() => {
        const data = orders.exists(recent_month) ?
            await orders.readFrom(recent_month) : [];
        const completed = data.filter(o => o.status != 'working' && o.status != 'pending');
        if (recent_month != current_month) await orders.replaceWith(completed, recent_month);
        const current_completed = recent_month == current_month ? completed : [];
        const replacement = current_completed.concat(complete);
        await orders.replaceWith(replacement, current_month);
    });
}

async function appendPositions(db, positions) {
    const group = _.groupBy(positions, p => moment(p.asof).format('YYYYMM'));
    const coll = await db.collection('positions');
    return coll.lockWith(Object.keys(group), () => Promise.all(_.map(group, async(positions, key) => {
        if (coll.exists(key)) {
            const data = await coll.readFrom(key);
            const replacement = data.concat(positions);
            await coll.replaceWith(replacement, key);
        } else {
            await coll.writeTo(positions, key);
        }
    })));
}

async function updateBalance(barsFor, db, positions, options) {
    const group = _.groupBy(positions, p => p.asof);
    await _.reduce(group, async(promise, positions, asof) => {
        await promise;
        await Promise.all(_.map(_.groupBy(positions, 'currency'), async(positions, currency) => {
            const mtm = positions.reduce((mtm, position) => {
                return mtm.add(position.mtm);
            }, Big(0));
            const proceeds = positions.reduce((proceeds, p) => {
                return p.security_type == 'FUT' ? proceeds.add(p.mtm) :
                    proceeds.add(p.sales).minus(p.purchases).add(p.dividend).minus(p.commission);
            }, Big(0));
            await deposit(barsFor, db, {...options,
                currency, asof,
                quant: mtm.toFixed(2),
                settled_quant: proceeds.toFixed(2)
            });
        }));
    }, Promise.resolve());
}

function reduceMonths(coll, options, fn, initial) {
    // TODO consider options.begin
    const asof = moment(options.asof || options.now);
    const max_month = asof.format('YYYYMM');
    const all_months = coll.listNames();
    const filtered = all_months.filter(month => month <= max_month);
    if (_.isEmpty(filtered)) return initial;
    const months = filtered.slice(Math.max(filtered.length-2,0));
    return coll.lockWith(months, async() => {
        return months.reduce(async(promise, month) => {
            const data = await coll.readFrom(month);
            return fn(await promise, data, month, coll);
        }, initial);
    });
}

function advancePosition(commissions, position, orders, bar) {
    const multiplier = position.multiplier || 1;
    const bot = orders.filter(order => order.action == 'BUY');
    const sld = orders.filter(order => order.action == 'SELL');
    const total_quant = orders.reduce((q, o) => q + o.quant, 0);
    const net_quant = bot.reduce((q, o) => q + o.quant, 0) - sld.reduce((q, o) => q + o.quant, 0);
    const total = orders.reduce((n, o) => Big(n).add(Big(o.traded_price).times(o.quant).times(multiplier)), Big(0));
    const traded_price = +total_quant ? Big(total).div(total_quant).div(multiplier).toString() : null;
    const starting_pos = position.position || 0;
    const ending_pos = +Big(starting_pos).add(net_quant);
    const ending_value = Big(ending_pos).times(bar.close).times(multiplier);
    const purchase = bot.reduce((net, o) => net.add(Big(o.traded_price).times(o.quant).times(multiplier)), Big(0));
    const sold = sld.reduce((net, o) => net.add(Big(o.traded_price).times(o.quant).times(multiplier)), Big(0));
    const net_dividend = Big(bar.dividend||0).times(starting_pos).times(multiplier);
    const com = findCommission(commissions, position);
    const commission = orders.reduce((c,o) => {
        return c.add(Math.max(Big(com.per_quant||0).times(o.quant), com.minimum || 0));
    }, Big(0));
    const mtm = Big(ending_value).minus(position.value || 0)
        .add(sold).minus(purchase).add(net_dividend).minus(commission).toFixed(2);
    const action = ending_pos == 0 && total_quant == 0 ? '' :
        ending_pos > 0 && net_quant == 0 ? 'LONG' :
        ending_pos < 0 && net_quant == 0 ? 'SHORT' :
        starting_pos >= 0 && ending_pos >= 0 && net_quant > 0 ? 'BTO' :
        starting_pos >= 0 && ending_pos >= 0 && net_quant < 0 ? 'STC' :
        starting_pos <= 0 && ending_pos <= 0 && net_quant < 0 ? 'STO' :
        starting_pos <= 0 && ending_pos <= 0 && net_quant > 0 ? 'BTC' :
        net_quant > 0 ? 'BOT' : net_quant < 0 ? 'SLD' : 'DAY';
    return {
        asof: bar.asof,
        action, quant: Math.abs(net_quant), position: ending_pos,
        traded_at: orders.reduce((at, o) => at < o.asof ? o.asof : at, '') || null,
        traded_price, price: bar.close,
        sales: position.security_type == 'FUT' ? 0 : sold.toFixed(2),
        purchases: position.security_type == 'FUT' ? 0 : purchase.toFixed(2),
        dividend: net_dividend.toFixed(2), commission: commission.toFixed(2),
        mtm, value: ending_value.toFixed(2),
        ..._.pick(position, 'symbol', 'market', 'currency', 'security_type', 'multiplier')
    };
}

function findCommission(commissions, contract) {
    return commissions.find(com => _.isMatch(contract, _.omit(com, 'per_quant', 'minimum')));
}

function sameOrder(options) {
    const identifying = ['symbol', 'market', 'order_type', 'order_ref', 'attach_ref'];
    return order => {
        return sameAction(order.action, options.action) && _.isMatch(order, _.pick(options, identifying));
    };
}

function sameAction(a, b) {
    if (b == 'SELL' || b == 'BUY') return a == b;
    else if (b == 'cancel') return true;
    else expect(b).to.be.oneOf(['SELL', 'BUY', 'cancel']);
}
