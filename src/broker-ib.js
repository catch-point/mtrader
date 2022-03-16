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
const d3 = require('d3-format');
const Big = require('big.js');
const merge = require('./merge.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const IB = require('./ib-gateway.js');
const Fetch = require('./fetch.js');
const expect = require('chai').expect;

module.exports = async function(settings = {}, mock_ib_client = null) {
    if (settings.info=='help') return helpSettings();
    if (settings.info=='version') return [{version}];
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).ib
    )), v => !v);
    if (settings.local_accounts) expect(settings.account).to.be.oneOf(settings.local_accounts);
    const ib = mock_ib_client && mock_ib_client.open ? mock_ib_client : await IB(settings);
    const fetch = new Fetch(merge(config('fetch'), settings.fetch));
    const root_ref = ((Date.now() * process.pid) % 8589869056).toString(16);
    return _.extend(async function(options) {
        if (options.info=='help') return helpOptions();
        if (options.info=='version') return [{version}];
        if (options.info) return [];
        expect(settings).to.have.property('account').that.is.ok;
        switch(options.action) {
            case 'balances': return listBalances(markets, ib, fetch, settings, options);
            case 'positions': return listPositions(markets, ib, fetch, settings, options);
            case 'orders': return listOrders(markets, ib, settings, options);
            case 'cancel': return cancelOrder(markets, ib, settings, options);
            case 'watch': return watchOrder(markets, ib, settings, options);
            case 'OCA': return oneCancelsAllOrders(root_ref, markets, ib, fetch, settings, options);
            case 'BUY':
            case 'SELL': return submitOrder(root_ref, markets, ib, fetch, settings, options);
            default: expect(options).to.have.property('action').to.be.oneOf([
                'balances', 'positions', 'orders', 'cancel', 'OCA', 'BUY', 'SELL'
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

/**
 * Array of one Object with description of module, including supported options
 */
function helpSettings() {
    return [{
        name: 'broker',
        usage: 'broker(settings)',
        description: "Information needed to identify the broker account",
        options: {
            account: {
                usage: '<string>',
                description: "IB account and/or model"
            },
            transmit: {
                usage: 'true|false',
                description: "If the system should transmit orders automatically for execution, otherwise wait for manual transmition via TWS user interface"
            },
            local_accounts: {
                usage: '[<stirng>,...]',
                description: "An array of accounts that can be used with this broker"
            }
        }
    }];
}

/**
 * Array of one Object with description of module, including supported options
 */
function helpOptions() {
    const order_properties = {
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
        tif: {
            usage: '<time-in-forced>',
            values: ['GTC', 'DAY', 'IOC']
        },
        extended_hours: {
            usage: 'true',
            values: ['true'],
            description: "If set, Allows orders to also trigger or fill outside of regular trading hours."
        },
        condition: {
            usage: 'symbol=<sym>;market=<mkt>;isMore=<true|false>;price=<number>;type=Price',
            description: "TWS API OrderCondition objects with symbol/market instead of conId"
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
            usage: '[{order},...]',
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
        },
        minTick: {
            usage: '<decimal>',
            description: "The minimum increment at the current price level (used by SNAP STK)"
        }
    };
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
            now: {
                usage: '<dateTime>',
                description: "Overrides the system clock"
            },
            asof: {
                usage: '<dateTime>',
                description: "Currency balances at a particular point in time (if available)"
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
            'asof', 'acctNumber', 'action', 'quant', 'position', 'traded_at', 'traded_price', 'price',
            'sales', 'purchases', 'dividend', 'commission', 'mtm', 'value',
            'symbol', 'market', 'currency', 'security_type', 'multiplier',
            'trading_class', 'under_symbol', 'under_market',
            'name', 'industry', 'category', 'subcategory'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'positions'
                ]
            },
            now: {
                usage: '<dateTime>',
                description: "Overrides the system clock"
            },
            asof: {
                usage: '<dateTime>',
                description: "Positions at a particular point in time (if available)"
            },
            begin: {
                usage: '<dateTime>',
                description: "Include historic balances since given dateTime, but before given asof"
            }
        }
    }, {
        name: 'orders',
        usage: 'broker(options)',
        description: "List a summary of open orders",
        properties: [
            'posted_at', 'asof', 'traded_at', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset',
            'traded_price', 'tif', 'extended_hours', 'status',
            'order_ref', 'attach_ref', 'acctNumber',
            'symbol', 'market', 'currency', 'security_type', 'multiplier',
            'condition'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'orders'
                ]
            },
            now: {
                usage: '<dateTime>',
                description: "Overrides the system clock"
            },
            asof: {
                usage: '<dateTime>',
                description: "Open orders at a particular point in time (if available)"
            },
            begin: {
                usage: '<dateTime>',
                description: "Include historic balances since given dateTime, but before given asof"
            }
        }
    }, {
        name: 'submit',
        usage: 'broker(options)',
        description: "Transmit order for trading",
        properties: [
            'posted_at', 'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset',
            'tif', 'extended_hours', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'security_type', 'currency', 'multiplier',
            'condition'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['BUY', 'SELL', 'OCA']
            },
            ...order_properties
        }
    }, {
        name: 'cancel',
        usage: 'broker(options)',
        description: "Cancels a working order",
        properties: [
            'posted_at', 'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset',
            'tif', 'extended_hours', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'security_type', 'currency', 'multiplier',
            'condition'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['cancel']
            },
            ...order_properties
        }
    }, {
        name: 'watch',
        usage: 'broker(options)',
        description: "Waits until a working order has changed from the given properties or a timeout",
        properties: [
            'posted_at', 'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset',
            'tif', 'extended_hours', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'security_type', 'currency', 'multiplier',
            'condition'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['watch']
            },
            timeout: {
                usage: '<milliseconds>',
                description: "Number of milliseconds to wait for a working order to change"
            },
            status: {
                usage: 'pending|working',
                values: ['pending', 'working'],
                description: "Stop watching order when order state is different from given"
            },
            ..._.pick(order_properties, 'order_ref', 'quant', 'limit', 'stop', 'offset', 'tif')
        }
    }]);
}

async function listBalances(markets, ib, fetch, settings, options) {
    const ib_tz = settings.tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const accounts = await listAccounts(ib, settings.account);
    const now = moment().tz(ib_tz);
    const asof = moment(options.asof || options.now).tz(ib_tz);
    const begin = options.begin ? moment(options.begin).tz(ib_tz) :
        moment(asof).subtract(5,'days');
    const begin_format = begin.format('YYYYMMDD HH:mm:ss');
    const asof_format = asof.format('YYYYMMDD HH:mm:ss');
    const balances = await Promise.all(accounts.map(async(acctNumber) => {
        const previously = begin ? await ib.reqAccountHistory(acctNumber, begin_format) : [];
        const currently = await ib.reqAccountUpdate(acctNumber);
        const data = !previously.length || _.last(previously).time < currently.time ?
            previously.concat(currently) : previously;
        const historic = data.filter((summary,i) => i === 0 || summary.time <= asof_format);
        const latest = _.last(historic);
        const range = options.begin ? historic.filter(summary => {
            if (summary.time == latest.time) return true;
            else return begin_format < summary.time;
        }) : latest ? [latest] : [];
        return [].concat(...range.map(summary => {
            const time = summary.time ? parseTime(summary.time, ib_tz) : now;
            expect(summary).to.have.property('Currency').that.is.an('array');
            return _.uniq(summary.Currency).filter(currency => currency != 'BASE').map(currency => {
                return {
                    asof: time.isValid() ? time.format() : now.format(),
                    acctNumber, currency,
                    rate: summary.ExchangeRate[currency],
                    net: summary.NetLiquidationByCurrency[currency],
                    settled: Big(summary.CashBalance[currency])
                        .minus((summary.FuturesPNL||{})[currency]||0).toString(),
                    accrued: Big((summary.AccruedCash||{})[currency]||0)
                        .add((summary.AccruedDividend||{})[currency]||0)
                        .add((summary.FuturesPNL||{})[currency]||0).toString(),
                    realized: summary.RealizedPnL[currency],
                    unrealized: summary.UnrealizedPnL[currency],
                    margin: (summary.TotalCashValue||{})[currency] != (summary.BuyingPower||{})[currency] ?
                        (summary.MaintMarginReq||{})[currency] : null
                };
            });
        }));
    }));
    return [].concat(...balances);
}

async function listPositions(markets, ib, fetch, settings, options) {
    const ib_tz = settings.tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const account = settings.account;
    const positions = account && account != 'All' ? await ib.reqPositionsMulti(account) : await ib.reqPositions();
    if (!positions) logger.warn(`IB account ${account} does not exist or has no positions`);
    if (!positions) return [];
    const historical = {};
    const changes = await Promise.all(Object.keys(positions).sort().map(account => {
        return listAccountPositions(markets, ib, fetch, account, positions[account], historical, ib_tz, options);
    }));
    const sorted = _.sortBy([].concat(...changes), 'asof');
    if (options.begin) return sorted;
    else return sorted.filter((p,i,a) => p.position || p.asof == _.last(a).asof);
}

async function listOrders(markets, ib, settings, options) {
    const ib_tz = settings.tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const account = settings.account;
    const accounts = await listAccounts(ib, account);
    const open_orders = await ib.reqOpenOrders();
    const begin = moment(options.begin || options.asof).tz(ib_tz).format('YYYYMMDD HH:mm:ss');
    const asof = options.asof && moment(options.asof).tz(ib_tz).format('YYYYMMDD HH:mm:ss');
    const completed_orders = options.begin || options.asof ? await ib.reqCompletedOrders({
        acctCode: accounts.length == 1 ? _.first(accounts) : null,
        time: asof
    }) : [];
    const orders = open_orders.concat(completed_orders.filter(o => begin < o.asof && asof <= o.asof));
    return orders.filter(order => {
        if (asof < order.posted_time) return false;
        else if (order.secType == 'BAG' && !order.comboLegsDescrip) return false; // completed
        else if (!account || account == 'All') return true;
        else if (order.faGroup == account || order.faProfile == account) return true;
        else if (~accounts.indexOf(order.account)) return true;
        else return false;
    }).reduce(async(promise, order) => {
        const result = await promise;
        const ord = await ibToOrder(markets, ib, settings, order, options);
        const parent = order.parentId && orders.find(p => order.parentId == p.orderId);
        const bag = order.secType == 'BAG';
        const working = ~open_orders.indexOf(order);
        result.push({...ord,
            quant: working ? order.remaining : order.totalQuantity,
            attach_ref: bag ? order.orderRef || order.permId :
                parent ? parent.orderRef|| parent.permId : order.ocaGroup,
            symbol: bag ? null : await asSymbol(markets, ib, order),
            market: bag ? null : await asMarket(markets, ib, order)
        });
        if (!bag) return result;
        else if (!order.comboLegs) throw Error(`Missing comboLegs on BAG order ${util.inspect(order)}`);
        else return order.comboLegs.reduce(async(promise, leg, i) => {
            const result = await promise;
            result.push({
                action: leg.action,
                quant: Big(order.remaining).div(ord.quant).div(leg.ratio).toString(),
                order_type: 'LEG',
                limit: ((order.orderComboLegs||[])[i]||{}).price || null,
                stop: null,
                offset: null,
                tif: null,
                extended_hours: null,
                order_ref: null,
                attach_ref: ord.order_ref,
                account: ord.account,
                symbol: await asSymbol(markets, ib, leg),
                market: await asMarket(markets, ib, leg),
                currency: leg.currency,
                security_type: leg.secType,
                multiplier: leg.multiplier
            });
            return result;
        }, Promise.resolve(result));
    }, Promise.resolve([]));
}

async function cancelOrder(markets, ib, settings, options) {
    expect(options).to.have.property('order_ref').that.is.ok;
    const ib_order = await orderByRef(ib, options.order_ref);
    if (!ib_order) throw Error(`Unknown order_ref ${options.order_ref}`);
    const cancelled_order = await ib.cancelOrder(ib_order.orderId);
    const order = await ibToOrder(markets, ib, settings, {
        ...ib_order,
        ...cancelled_order
    }, options);
    return [order];
}

async function watchOrder(markets, ib, settings, options) {
    expect(options).to.have.property('order_ref').that.is.ok;
    const started_at = Date.now();
    const matches = _.matcher(_.pick(options, 'order_ref', 'status', 'quant', 'limit', 'stop', 'offset', 'tif'));
    const ib_order = await orderByRef(ib, options.order_ref);
    if (!ib_order) throw Error(`Unknown order_ref ${options.order_ref}`);
    const original_order = await ibToOrder(markets, ib, settings, ib_order, options);
    if (!matches(original_order)) return [original_order]; // already changed
    let timeout = options.timeout || settings.timeout || 600000;
    const end_at = started_at + timeout;
    let orderId = ib_order.orderId;
    while(orderId) {
        const changed_order = await ib.watchOrder(orderId, timeout);
        const replace_by = await orderByRef(ib, options.order_ref);
        const order = await ibToOrder(markets, ib, settings, replace_by || changed_order, options);
        if (!matches(order)) return [order];
        timeout = end_at - Date.now();
        if (timeout <= 0) return [order];
        orderId = replace_by ? replace_by.orderId : changed_order.orderId;
    }
}

async function oneCancelsAllOrders(root_ref, markets, ib, fetch, settings, options) {
    expect(options).to.have.property('attached').that.is.an('array');
    const order_ref = orderRef(root_ref, await ib.reqId(), options);
    return await options.attached.reduce(async(promise, order, i, orders) => {
        const posted_orders = await submitOrder(root_ref, markets, ib, fetch, settings, {
            extended_hours: options.extended_hours, ...order
        }, null, order_ref);
        return (await promise).concat(posted_orders.map(ord => ({...ord, attach_ref: order_ref})));
    }, []);
}

async function submitOrder(root_ref, markets, ib, fetch, settings, options, parentId, ocaGroup) {
    const attach_order = options.attach_ref ? await orderByRef(ib, options.attach_ref) : null;
    const oca_group = ocaGroup || (options.attach_ref && !attach_order ? options.attach_ref : null);
    const replacing_order = await orderByRef(ib, options.order_ref);
    const replacing_id = replacing_order && !~replacing_order.status.indexOf('Cancel') &&
            !~replacing_order.status.indexOf('Untransmitted') ?
        replacing_order.orderId : null; // not PendingCancel nor ApiCancelled nor Cancelled nor Untransmitted
    const reqId = replacing_id ? async(fn) => fn(replacing_id).catch(err => {
        logger.warn("Could not replace order: ", err);
        return ib.reqId(fn);
    }) : ib.reqId;
    const contract = await toContract(markets, ib, options);
    const ib_order = await orderToIbOrder(markets, ib, fetch, settings, contract, options, options);
    const attached = flattenOCA(options.attached);
    const transmit = 'transmit' in markets[options.market || (attached[0]||{}).market] ?
        markets[options.market || (attached[0]||{}).market].transmit && settings.transmit || false :
        settings.transmit || false;
    const existing_orders = await Promise.all(attached.map(ord => orderByRef(ib, ord.order_ref)));
    const new_orders = attached.filter((ord, i) => !existing_orders[i]);
    const legs = attached.filter(ord => ord.order_type == 'LEG');
    const last_new_order = existing_orders.reduce((last, ord, i) => !existing_orders[i] ? i : last, 0);
    const posted_order = await reqId(async(order_id) => {
        const order_ref = orderRef(root_ref, order_id, options);
        const combo_prices = contract.exchange == 'SMART' && legs.length && legs.every(leg => leg.limit);
        const submit_order = {
            ..._.omit(ib_order, combo_prices ? ['lmtPrice'] : []),
            orderId: order_id, orderRef: order_ref,
            orderType: ib_order.orderType == 'MKT' && legs.every(ord => ord.limit) ? 'LMT' : ib_order.orderType,
            transmit: (contract.secType == 'BAG' || _.isEmpty(new_orders)) && transmit,
            parentId: parentId || (attach_order ? attach_order.orderId : null),
            ocaGroup: oca_group, ocaType: oca_group ? 1 : 0,
            orderComboLegs: combo_prices ? legs.map(leg => ({price: leg.limit})) : [],
            smartComboRoutingParams: contract.secType == 'BAG' && contract.exchange == 'SMART' ?
                [{tag:'NonGuaranteed',value:'1'}] : []
        };
        return await ib.placeOrder(order_id, contract, submit_order);
    });
    const order_id = posted_order.orderId;
    const order_ref = orderRef(root_ref, order_id, options);
    const parent_order = await ibToOrder(markets, ib, settings, posted_order, options);
    return attached.reduce(async(promise, attach, i, attached) => {
        const child_orders = attach.order_type == 'LEG' ? [{
            ..._.omit(parent_order, 'limit', 'stop', 'offset', 'traded_price', 'order_ref'),
            ..._.pick(attach, 'symbol', 'market', 'currency', 'multiplier', 'action', 'quant', 'order_type', 'limit', 'stop', 'offset'),
            attach_ref: parent_order.order_ref
        }] : await submitOrder(root_ref, markets, ib, fetch, {
            ...settings,
            transmit: last_new_order <= i && transmit
        }, {extended_hours: options.extended_hours, ...attach}, order_id);
        return (await promise).concat(child_orders.map(ord => ({...ord, attach_ref: order_ref})));
    }, [parent_order]);
}

function flattenOCA(orders) {
    if (!orders) return [];
    else return orders.reduce((list, order) => {
        if (order.action != 'OCA') return list.concat(order);
        else return list.concat(flattenOCA(order.attached));
    }, []);
}

function orderRef(root_ref, order_id, options) {
    if (options.order_ref) return options.order_ref;
    const idx = (options.order_type||'').indexOf(' (IBALGO)');
    const label = ~idx && options.order_type.substring(0, idx) || options.order_type || options.action || '';
    return `${label.replace(/\W+/g,'')}.${root_ref}.${order_id}`;
}

async function orderByRef(ib, order_ref) {
    if (!order_ref) return null;
    const recent_ib_orders = await ib.reqRecentOrders();
    const recent_ib_order = recent_ib_orders.filter(ord => {
        return ord.orderRef == order_ref || ord.permId == order_ref || ord.orderId == order_ref;
    }).reduce((latest, order) => latest && latest.order_id >= order.order_id ? latest : order, null);
    if (recent_ib_order) return recent_ib_order;
    else if (recent_ib_orders.some(ord => ord.ocaGroup == order_ref)) return null;
    const open_ib_orders = await ib.reqOpenOrders();
    const ib_order = open_ib_orders.find(ord => {
        return ord.orderRef == order_ref || ord.permId == order_ref || ord.orderId == order_ref;
    });
    if (ib_order) return ib_order;
    else return null;
}

async function orderToIbOrder(markets, ib, fetch, settings, contract, order, options) {
    expect(order).to.have.property('action').that.is.oneOf(['BUY', 'SELL']);
    expect(order).to.have.property('quant').that.is.ok;
    expect(order).to.have.property('order_type').that.is.ok;
    if (order.tip)
        expect(order).to.have.property('tif').that.is.oneOf(['DAY', 'GTC', 'IOC', 'OPG', 'FOK', 'DTC']);
    const ibalgo = order.order_type.indexOf(' (IBALGO)');
    const conditions = await buildOrderConditions(markets, ib, order.condition);
    const conditionsIgnoreRth = !!(order.condition && order.condition.match(/conditionsIgnoreRth=true/));
    if (~ibalgo) {
        const algoParams = order.order_type.substring(ibalgo + ' (IBALGO)'.length).split(';')
            .filter(a=>a.length).map(pair => _.object(['tag', 'value'], pair.trim().split('=', 2)));
        return {
            action: order.action,
            totalQuantity: order.quant,
            orderType: order.limit ? 'LMT' : 'MKT',
            algoStrategy: order.order_type.substring(0, ibalgo),
            algoParams,
            lmtPrice: order.limit,
            auxPrice: order.stop || order.offset,
            tif: order.tif,
            outsideRth: !!order.extended_hours,
            orderRef: order.order_ref,
            conditions, conditionsIgnoreRth,
            ...await ibAccountOrderProperties(ib, settings)
        };
    } else if (order.order_type == 'SNAP STK') {
        return {
            action: order.action,
            totalQuantity: order.quant,
            orderType: 'LMT',
            lmtPrice: await snapStockLimit(markets, ib, fetch, contract, order, options),
            tif: order.tif,
            outsideRth: !!order.extended_hours,
            orderRef: order.order_ref,
            conditions, conditionsIgnoreRth,
            ...await ibAccountOrderProperties(ib, settings)
        };
    } else {
        return {
            action: order.action,
            totalQuantity: order.quant,
            orderType: order.order_type,
            lmtPrice: order.limit,
            auxPrice: order.stop || order.offset,
            tif: order.tif,
            outsideRth: !!order.extended_hours,
            orderRef: order.order_ref,
            conditions, conditionsIgnoreRth,
            ...await ibAccountOrderProperties(ib, settings)
        };
    }
}

async function snapStockLimit(markets, ib, fetch, contract, order, options) {
    const now = moment(options.now);
    if (_.isEmpty(order.attached)) {
        expect(contract.secType).to.be.oneOf(['FUT', 'OPT','FOP']);
        const detail = _.first(await ib.reqContractDetails(contract));
        const under_contract = await ib.reqContract(detail.underConid);
        const right = detail.contract.right;
        expect(right).is.oneOf(['C', 'P']);
        const minTick = Math.max(order.minTick||0, detail.minTick||0.000001);
        const [bar, under_bar] = await Promise.all([
            reqMktData(markets, ib, fetch, contract, now, options),
            reqMktData(markets, ib, fetch, under_contract, now, options)
        ]);
        if (!bar || !(bar.midpoint || bar.last || bar.close))
            throw Error(`Can only submit SNAP STK ${order.order_ref} orders while market is open`);
        const net_offset = order.action == 'BUY' && right == 'C' ||
            order.action == 'SELL' && right == 'P' ?
            Big(order.offset||0).times(-1) : Big(order.offset||0);
        const price = await snapStockPrice(ib, contract, bar, under_bar, order.limit, net_offset);
        return +Big(price).div(minTick).round(0, order.action == 'BUY' ? 0 : 3).times(minTick);
    } else {
        order.attached.forEach(leg => {
            expect(leg).to.have.property('symbol').that.is.a('string');
            expect(leg).to.have.property('action').that.is.oneOf(['BUY', 'SELL']);
            expect(leg).to.have.property('order_type').that.eql('LEG');
            expect(leg).to.have.property('security_type').that.is.oneOf(['FUT', 'OPT','FOP']);
        });
        const [detail, contracts] = await Promise.all([
            toContract(markets, ib, _.first(order.attached)).then(contract => {
                return ib.reqContractDetails(contract).then(_.first);
            }),
            Promise.all(order.attached.map(async(leg) => {
                return toContractWithId(markets, ib, leg);
            }))
        ]);
        const under_contract = await ib.reqContract(detail.underConid);
        const detail_minTick = detail.minTick||0.000001;
        const leg_minTick = order.attached.reduce((minTick, leg) => {
            return Math.min(minTick, leg.minTick||detail_minTick);
        }, Infinity);
        const minTick = Math.max(detail_minTick, leg_minTick, order.minTick||0);
        const right = detail.contract.right;
        contracts.forEach(contract => {
            expect(contract.secType).to.be.oneOf(['FUT', 'OPT','FOP']);
            expect(contract.right).is.oneOf(['C', 'P']);
            expect(contract.right).to.eql(right);
        });
        const [bars, under_bar] = await Promise.all([
            Promise.all(contracts.map(async(contract) => {
                return reqMktData(markets, ib, fetch, contract, now, options);
            })),
            reqMktData(markets, ib, fetch, under_contract, now, options)
        ]);
        if (bars.some(bar => !bar.midpoint && !bar.last && !bar.close))
            throw Error("Can only submit SNAP STK orders while market is active");
        const net_mid_price = netPrice(order.attached, bars.map(bar => bar.midpoint || bar.last || bar.close));
        const net_offset = order.action == 'BUY' && right == 'C' && +net_mid_price >= 0 ||
            order.action == 'SELL' && right == 'P' && +net_mid_price >= 0 ?
            Big(order.offset||0).times(-1) : Big(order.offset||0);
        const prices = await Promise.all(order.attached.map(async(leg, i) => {
            return snapStockPrice(ib, contracts[i], bars[i], under_bar, order.limit, net_offset);
        }));
        const price = netPrice(order.attached, prices);
        if (order.action == 'BUY') {
            const buy_limit = +Big(price).div(minTick).round(0, 0).times(minTick);
            if (buy_limit) return buy_limit;
        }
        const sell_limit = +Big(price).div(minTick).round(0, 3).times(minTick);
        if (sell_limit) return sell_limit;
        else return +Big(price).div(minTick).round(0, 0).times(minTick);
    }
}

async function reqMktData(markets, client, fetch, contract, now, options) {
    const hours = _.first(await fetch({
        ...options,
        interval: 'contract',
        symbol: await asSymbol(markets, client, contract),
        market: await asMarket(markets, client, contract)
    }));
    if (isWithinMarketHours(markets, client, hours, now, options)) {
        const bar = await client.reqMktData(contract);
        if (bar && bar.last_timestamp) {
            if (isWithinLiquidHours(markets, client, hours, bar.last_timestamp, options)) {
                if (bar.bid && bar.ask) return {...bar, midpoint: +Big(bar.bid).add(bar.ask).div(2)};
                else return bar; // use bar.last
            }
        }
        if (bar && bar.close) // bar is pre-market or after-hours
            return _.omit(bar, 'last', 'bid', 'ask', 'bid_option', 'ask_option');
    }
    const last = await client.reqHistoricalData(contract, '', '1 D', '30 mins', 'MIDPOINT', 1, 1).catch(err => []);
    if (last.length) return last[last.length-1];
    else return {};
}

function isWithinMarketHours(markets, client, hours, now, options) {
    const open_time = hours.trading_hours.substring(0, 8);
    const close_time = hours.trading_hours.substring(hours.trading_hours.length - 8);
    if (open_time == close_time) return true; // last must be within trading_hours
    const last_moment = moment.tz(now, hours.security_tz);
    const opens_at = moment.tz(`${last_moment.format('YYYY-MM-DD')}T${open_time}`, hours.security_tz);
    const closes_at = moment.tz(`${last_moment.format('YYYY-MM-DD')}T${close_time}`, hours.security_tz);
    if (opens_at.isBefore(closes_at)) {
        if (!opens_at.isAfter(last_moment) && !last_moment.isAfter(closes_at)) return true;
    } else { // trading_hours cross midnight
        if (!opens_at.isAfter(last_moment) || !last_moment.isAfter(closes_at)) return true;
    }
    return false;
}

function isWithinLiquidHours(markets, client, hours, timestamp, options) {
    const open_time = hours.liquid_hours.substring(0, 8);
    const close_time = hours.liquid_hours.substring(hours.liquid_hours.length - 8);
    if (open_time == close_time) return true; // last must be within liquid_hours
    const last_moment = moment.tz(timestamp, 'X', hours.security_tz);
    const opens_at = moment.tz(`${last_moment.format('YYYY-MM-DD')}T${open_time}`, hours.security_tz);
    const closes_at = moment.tz(`${last_moment.format('YYYY-MM-DD')}T${close_time}`, hours.security_tz);
    if (opens_at.isBefore(closes_at)) {
        if (!opens_at.isAfter(last_moment) && !last_moment.isAfter(closes_at)) return true;
    } else { // liquid_hours cross midnight
        if (!opens_at.isAfter(last_moment) || !last_moment.isAfter(closes_at)) return true;
    }
    return false;
}

async function snapStockPrice(ib, contract, bar, under_bar, limit, net_offset) {
    const opt_price = bar.midpoint || bar.last || bar.close;
    if (!+net_offset && !+limit) return opt_price;
    else if (contract.secType != 'OPT' && contract.secType != 'FOP')
        return +limit || +Big(opt_price).add(net_offset);
    const model_option = bar.midpoint && bar.model_option &&
        bar.model_option.undPrice != Number.MAX_VALUE && bar.model_option.undPrice ?
        bar.model_option : {};
    const model_price = model_option.optPrice || opt_price;
    const asset_price = model_option.undPrice || under_bar.midpoint || under_bar.last || under_bar.close;
    if (!+asset_price)
        throw Error(`Can only submit SNAP STK orders while market is active ${util.inspect(under_bar)}`);
    const asset_limit = +limit || +Big(asset_price).add(net_offset);
    const iv = model_option.iv ||
        bar.ask_option && bar.bid_option && +Big(bar.ask_option.iv).add(bar.bid_option.iv).div(2) ||
        (await ib.calculateImpliedVolatility(contract, model_price, asset_price)).iv;
    if (!iv || iv == Number.MAX_VALUE || iv == Number.MAX_VALUE/2)
        throw Error(`No implied volatility for ${contract.localSymbol} ${util.inspect(model_option||bar)}`);
    const option = await ib.calculateOptionPrice(contract, iv, asset_limit);
    logger.log("calculated option price model", option.optPrice, +limit || +net_offset, opt_price, iv, model_option || bar);
    return +Big(option.optPrice).minus(model_price).add(opt_price);
}

function netPrice(legs, leg_prices) {
    return +leg_prices.reduce((net, leg_price, i) => {
        const leg = legs[i];
        const buy = leg.action == 'BUY' ? 1 : -1;
        return net.add(Big(leg_price).times(leg.quant).times(buy));
    }, Big(0));
}

const order_condition_properties = [
    'changePercent', 'price', 'triggerMethod', 'volume',
    'percent', 'time', 'isMore',
    'exchange', 'symbol', 'secType', 'type'
];

async function buildOrderConditions(markets, ib, condition_string) {
    if (!condition_string) return [];
    const disjunctions = condition_string.split('|').map(string => {
        const conjunctions = string.split('&').map(string => {
            return _.mapObject(_.object(string.split(';').map(pair => pair.split('=', 2))), value => {
                if (value == 'true' || value == 'false') return value == 'true';
                else return value;
            })
        });
        return conjunctions.map(ord_cond => ({...ord_cond, conjunctionConnection: true}));
    });
    disjunctions.forEach(conjunctions => _.last(conjunctions).conjunctionConnection = false);
    const conditions = [].concat(...disjunctions);
    return Promise.all(conditions.map(async(ord_cond) => {
        const contract = ord_cond.market ? await toContractWithId(markets, ib, ord_cond) : {};
        const triggerMethod = ord_cond.triggerMethod || 0;
        const exchange = ord_cond.exchange || 'SMART';
        const type = ord_cond.type || (
            ord_cond.price ? 'Price' :
            ord_cond.volume ? 'Volume' :
            ord_cond.time ? 'Time' :
            ord_cond.changePercent ? 'PercentChange' :
            ord_cond.percent ? 'Margin' : 'Execution'
        );
        return {
            ..._.pick(ord_cond, order_condition_properties),
            triggerMethod, exchange, type,
            conId: ord_cond.conId || contract.conid,
            conjunctionConnection: ord_cond.conjunctionConnection
        };
    }));
}

async function formatOrderCondition(markets, ib, order) {
    const conditions = order.conditions;
    const conditionsIgnoreRth = !!order.conditionsIgnoreRth;
    if (_.isEmpty(conditions)) return null;
    const ord_conds = await await Promise.all(conditions.map(async(condition) => {
        if (!condition.conId) return condition;
        const contract = await ib.reqContract(condition.conId);
        return {
            ...condition,
            symbol: await asSymbol(markets, ib, contract),
            market: await asMarket(markets, ib, contract),
            security_type: contract.secType
        };
    }));
    const disjunctions = ord_conds.reduce((disjunctions, condition, c, conditions) => {
        _.last(disjunctions).push(condition);
        if (!condition.conjunctionConnection && c < conditions.length -1) {
            disjunctions.push([]);
        }
        return disjunctions;
    }, [[]]);
    const str = disjunctions.map(conjuctions => {
        return conjuctions.map(condition => {
            const pairs = order_condition_properties.concat('market', 'security_type')
              .reduce((pairs, p) => {
                return p == 'type' || p == 'exchange' && condition[p] == 'SMART' ||
                    p == 'triggerMethod' && !condition[p] ||
                    condition[p] == null ? pairs : pairs.concat([[p, condition[p]]]);
            }, []);
            return pairs.map(pair => pair.join('=')).join(';');
        }).join('&');
    }).join('|');
    if (!conditionsIgnoreRth || !str.length) return str;
    else return `${str};conditionsIgnoreRth=true`;
}

async function ibAccountOrderProperties(ib, settings) {
    const account = settings.account;
    const managed_accts = await ib.reqManagedAccts();
    if (~managed_accts.indexOf(account)) return {account};
    const aliases = await ib.requestAliases();
    const alias = aliases.find(a => account == a.alias);
    if (alias) return {account: alias.account};
    const groups = await ib.requestGroups();
    const group = groups.find(g => account == g.name);
    if (group) return {faGroup: group.name, faMethod: group.defaultMethod};
    const profiles = await ib.requestProfiles();
    const profile = profiles.find(p => account == p.name);
    if (profile) return {faProfile: profile.name};
    return {account: managed_accts[0], modelCode: account}; // maybe a model?
}

async function ibToOrder(markets, ib, settings, order, options) {
    const ib_tz = settings.tz || (moment.defaultZone||{}).name || moment.tz.guess();
    const status = order.status == 'ApiPending' ? 'pending' :
        order.status == 'PendingSubmit' ? 'pending' :
        order.status == 'Inactive' ? 'pending' :
        order.status == 'PendingCancel' ? 'cancelled' :
        order.status == 'PreSubmitted' ? 'working' :
        order.status == 'Submitted' ? 'working' :
        order.status == 'ApiCancelled' ? 'working' :
        order.status == 'Filled' ? 'filled' : 'cancelled';
    return {
        posted_at: order.posted_time ? parseTime(order.posted_time, ib_tz).format() : null,
        asof: order.time ? parseTime(order.time, ib_tz).format() : null,
        traded_at: order.completedTime ? parseTime(order.completedTime, ib_tz).format() : null,
        action: order.action,
        quant: order.totalQuantity,
        order_type: orderTypeFromIB(order),
        limit: order.lmtPrice == Number.MAX_VALUE ? null : order.lmtPrice,
        stop: order.auxPrice == Number.MAX_VALUE ? null : order.auxPrice,
        offset: order.auxPrice == Number.MAX_VALUE || order.orderType == 'STP' ||
            order.orderType == 'STP LMT' ? null : order.auxPrice,
        tif: order.tif,
        extended_hours: order.outsideRth,
        status: status,
        traded_price: +order.avgFillPrice ? order.avgFillPrice : null,
        order_ref: order.orderRef || order.permId || order.orderId,
        attach_ref: options.attach_ref,
        account: order.faGroup || order.faProfile || order.account,
        symbol: await asSymbol(markets, ib, order),
        market: options.market ? options.market :
            order.secType != 'BAG' ? await asMarket(markets, ib, order) : null,
        currency: order.currency,
        security_type: order.secType,
        multiplier: order.multiplier,
        condition: await formatOrderCondition(markets, ib, order)
    };
}

function orderTypeFromIB(order) {
    if (order.orderRef && order.orderRef.indexOf('SNAPSTK') === 0) return 'SNAP STK';
    if (!order.algoStrategy) return order.orderType;
    const algoParams = (order.algoParams||[])
      .filter(tv => !isDefaultAlgoParam(tv.tag, tv.value))
      .map(tv => `${tv.tag}=${tv.value}`).join(';');
    return (`${order.algoStrategy} (IBALGO) ${algoParams}`).trim();
}

function isDefaultAlgoParam(name, value) {
    if (name == 'adaptivePriority')
        return value == 'Normal';
    else
        return false;
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
    const begin_format = options.begin && moment(options.begin).format();
    const asof_format = moment(options.asof).format();
    const begin = options.begin ? moment(options.begin).tz(ib_tz) :
        moment(options.asof).tz(ib_tz).subtract(5,'days');
    const executions = await executionsWithConIds(markets, ib, await ib.reqExecutions({
        acctCode: account,
        time: begin ? begin.format('YYYYMMDD HH:mm:ss') : null
    }));
    // TODO don't assume conIds in executions mean the same in positions
    const conIds = _.union(Object.keys(positions).map(i => parseInt(i)), collectConIds(executions));
    const listChanges = listContractPositions.bind(this, markets, ib, fetch);
    const changes = await Promise.all(conIds.sort().map(async(conid) => {
        const con_pos = positions[conid];
        const con_exe = executions.filter(exe => exe.conid == conid || exe.conId == conid).map(exe => ({
            asof: parseTime(exe.time, ib_tz).format(),
            ...exe
        })).filter(exe => exe.asof <= asof_format);
        const details = con_pos ? await ib.reqContractDetails({conid}) : [];
        const contract = con_pos ? await ib.reqContract(conid) : _.first(con_exe);
        if (contract.secType == 'BAG') return [];
        const detail = _.first(details)||{contract};
        const under_details = !detail.underConid ? [detail] :
            await ib.reqContractDetails({conid:detail.underConid}).catch(async(err) => {
                logger.warn(`${err.message.replace(/\n[\S\s]*$/,'')} ${contract.localSymbol||contract.symbol} underConId ${detail.underConid}`);
                const contract = await ib.reqContract(detail.underConid).catch(err => {
                    return {
                        conid: detail.underConid,
                        symbol: detail.underSymbol || contract.symbol,
                        secType: detail.underSecType
                    };
                });
                return [{contract}];
            });
        const under_detail = _.first(under_details)||detail;
        const under_symbol = await asSymbol(markets, ib, under_detail.contract);
        const under_market = await asMarket(markets, ib, under_detail.contract).catch(err => null);
        const change_list = await listChanges(contract, con_pos, con_exe, historical, ib_tz, options);
        const changes = change_list.map(change => ({
            ...change,
            trading_class: ((_.first(details)||{}).contract||{}).tradingClass,
            under_symbol, under_market, name: under_detail.longName,
            ..._.pick(under_detail, ['industry', 'category', 'subcategory'])
        }));
        if (options.begin) return changes.filter((p,i,a) => {
            return begin_format < p.asof || i == a.length-1 && p.position;
        });
        else if (!changes.length) return [];
        else return [_.last(changes)];
    }));
    return [].concat(...changes).map(trade => Object.assign({
        asof: trade.asof,
        acctNumber: account
    }, trade));
}

async function listContractPositions(markets, ib, fetch, contract, pos, executions, historical, ib_tz, options) {
    const symbol = await asSymbol(markets, ib, contract);
    const market = await asMarket(markets, ib, contract);
    const now = moment().format();
    const earliest = moment(options.begin || options.asof || options.now)
        .subtract(5, 'days').startOf('day').format();
    const key = `${contract.conid || contract.conId} ${earliest}`;
    const promise = historical[key] = historical[key] ||
        loadHistoricalData(fetch, symbol, market, earliest, options);
    const bars = await promise.catch(err => {
        logger.warn(`Could not load ${symbol} prices`, err);
        return [];
    });
    if (!bars.length && !(pos && +pos.position)) return [];
    else if (!bars.length) return [{
        asof: now,
        action: +pos.position > 0 ? 'LONG' : 'SHORT',
        position: pos.position,
        symbol, market,
        currency: contract.currency,
        security_type: contract.secType,
        multiplier: contract.multiplier
    }];
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
        if (!changes[i].quant)
            return position;
        else if (changes[i].action.charAt(0) == 'B')
            return position - changes[i].quant;
        else if (changes[i].action.charAt(0) == 'S')
            return +position + +changes[i].quant;
        else
            throw Error(`Invalid trade action ${changes[i].action}`);
    }, ending_position - latest_trade.quant * (latest_trade.action.charAt(0) == 'S' ? -1 : 1));
    if (newer_details.length) {
        changes.push({...latest_trade, asof: latest_trade.traded_at});
    }
    return changes.filter(trade => trade.action)
      .map(trade => Object.assign({
        asof: trade.asof,
        sales: contract.secType == 'FUT' ? 0 : trade.sales,
        purchases: contract.secType == 'FUT' ? 0 : trade.purchases,
        symbol, market,
        currency: contract.currency,
        security_type: contract.secType,
        multiplier: contract.multiplier
    }, trade, {asof: trade.asof < now ? trade.asof : now}));
}

function changePosition(multiplier, prev_bar, details, bar, position) {
    const adj = Big(bar.close).div(+bar.adj_close || +bar.close || 1);
    const dividend = !prev_bar.adj_close ? 0 :
        +Big(prev_bar.close).minus(Big(prev_bar.adj_close).times(adj)).toFixed(8);
    const ending_value = Big(position).times(bar.close).times(multiplier);
    const quant = details.reduce((shares, exe) => shares + +exe.shares, 0);
    const shares = details.reduce((shares, exe) => shares + +exe.shares * (exe.side == 'SLD' ? -1 : 1), 0);
    const starting_position = position - shares;
    const starting_value = Big(starting_position).times(prev_bar.close).times(multiplier);
    const net_dividend = Big(starting_position).times(dividend).times(multiplier);
    const purchase = details.filter(exe => exe.side == 'BOT')
        .reduce((net, exe) => net.add(Big(exe.price||0).times(exe.shares||0).times(multiplier)), Big(0));
    const sold = details.filter(exe => exe.side == 'SLD')
        .reduce((net, exe) => net.add(Big(exe.price||0).times(exe.shares||0).times(multiplier)), Big(0));
    const commission = details.reduce((net, exe) => net.add(exe.commission || 0), Big(0));
    const mtm = Big(ending_value).minus(starting_value)
        .add(sold).minus(purchase).add(net_dividend).minus(commission);
    const action = position == 0 && quant == 0 ? '' :
        position > 0 && shares == 0 ? 'LONG' :
        position < 0 && shares == 0 ? 'SHORT' :
        starting_position >= 0 && position >= 0 && shares > 0 ? 'BTO' :
        starting_position >= 0 && position >= 0 && shares < 0 ? 'STC' :
        starting_position <= 0 && position <= 0 && shares < 0 ? 'STO' :
        starting_position <= 0 && position <= 0 && shares > 0 ? 'BTC' :
        shares > 0 ? 'BOT' : shares < 0 ? 'SLD' : 'DAY';
    return {
        asof: bar.ending,
        action, quant: quant ? Math.abs(shares) : null, position,
        traded_at: details.reduce((at, exe) => at < exe.asof ? exe.asof : at, '') || null,
        traded_price: shares ? +Big(purchase).add(sold).div(Big(quant).abs()).div(multiplier) : null,
        price: bar.close,
        sales: sold.toFixed(2),
        purchases: purchase.toFixed(2),
        dividend: net_dividend.toFixed(2),
        commission: commission.toFixed(2),
        mtm: +Big(mtm).toFixed(2),
        value: ending_value.toFixed(2)
    };
}

async function executionsWithConIds(markets, ib, executions) {
    return Promise.all(executions.map(async(execution) => {
        if (execution.secType == 'BAG') return execution;
        if (execution.conid) return execution;
        if (execution.conId) return {...execution, conid:execution.conId};
        const market = await asMarket(markets, ib, execution);
        const contract = await toContractWithId(markets, ib, {
                symbol: await asSymbol(markets, ib, execution),
                market: market,
                security_type: execution.secType,
                multiplier: execution.multiplier
            }).catch(err => {});
        if (contract) return {...execution, ...contract};
        else return execution;
    }));
}

function collectConIds(executions) {
    return executions.reduce((conIds, execution) => {
        if (execution.secType == 'BAG') return conIds;
        const conid = execution.conid || execution.conId;
        if (!conid) return conIds;
        const idx = _.sortedIndex(conIds, conid);
        conIds.splice(idx, 0, conid);
        return conIds;
    }, []);
}

async function loadHistoricalData(fetch, symbol, market, begin, options) {
    const tz = (moment.defaultZone||{}).name;
    const asof = moment(options.asof || options.now).format();
    const bars = await fetch(_.defaults({interval:'day', begin, end: asof, symbol, market, tz}, options));
    return bars.filter(bar => bar.ending <= asof);
}

async function asSymbol(markets, ib, contract) {
    if (contract.secType == 'FUT') return fromFutSymbol(contract.localSymbol);
    else if (contract.secType == 'FOP') return fromFopSymbol(markets, ib, contract);
    else if (contract.secType == 'CASH') return contract.symbol;
    else if (contract.secType == 'OPT') return contract.localSymbol;
    else if (!contract.localSymbol) return contract.symbol;
    else return ~contract.localSymbol.indexOf(' ') ? contract.localSymbol.replace(' ', '.') : contract.localSymbol;
}

function fromFutSymbol(symbol) {
    let m, n;
    if (m = symbol.match(/^(\w*)([A-Z])(\d)$/)) {
        const [, underlying, month, y] = m;
        const now = moment();
        const decade = y >= (now.year() - 5) % 10 ?
            (now.year() - 5).toString().substring(2, 3) :
            (now.year() + 5).toString().substring(2, 3);
        return `${underlying}${month}${decade}${y}`;
    } else if (n = symbol.match(/^(\w*) +([A-Z]+) (\d\d)$/)) {
        const codes = {JAN: 'F', FEB: 'G', MAR: 'H', APR: 'J', MAY: 'K', JUN: 'M',
            JUL: 'N', AUG: 'Q', SEP: 'U', OCT: 'V', NOV: 'X', DEC: 'Z'};
        const [, underlying, month, year] = n;
        return `${underlying}${codes[month]}${year}`;
    } else {
        return symbol;
    }
}

async function fromFopSymbol(markets, ib, contract) {
    const symbol = contract.localSymbol;
    const market = markets[await asMarket(markets, ib, contract)];
    const m = symbol.match(/^([CP]) (\w*) +([A-Z]+) (\d\d) +(\d+)$/);
    let n;
    if (m) {
        const codes = {JAN: 'F', FEB: 'G', MAR: 'H', APR: 'J', MAY: 'K', JUN: 'M',
            JUL: 'N', AUG: 'Q', SEP: 'U', OCT: 'V', NOV: 'X', DEC: 'Z'};
        const [, right, tradingClass, month, year, strike] = m;
        const underlying = ((market||{}).tradingClasses||{})[contract.symbol] && contract.symbol || tradingClass;
        return `${underlying}${codes[month]}${year} ${right}${strike}`;
    } else if (n = symbol.match(/^(\w*)([A-Z])(\d) ([CP])(\d+)$/)) {
        const [, tradingClass, month, y, right, strike] = n;
        const underlying = ((market||{}).tradingClasses||{})[contract.symbol] && contract.symbol || tradingClass;
        const now = moment();
        const decade = y >= (now.year() - 5) % 10 ?
            (now.year() - 5).toString().substring(2, 3) :
            (now.year() + 5).toString().substring(2, 3);
        return `${underlying}${month}${decade}${y} ${right}${strike}`;
    } else {
        return symbol;
    }
}

async function toContract(markets, ib, options) {
    const has_legs = !_.isEmpty(options.attached) && options.attached.some(ord => ord.order_type == 'LEG');
    if (options.symbol && !has_legs) {
        expect(options).to.have.property('symbol').that.is.ok;
        expect(options).to.have.property('market').that.is.oneOf(_.keys(markets));
        const market = markets[options.market];
        return _.omit({
            conid: options.conid || options.conId,
            localSymbol: toLocalSymbol(market, options.symbol),
            secType: options.security_type || market.secType,
            primaryExch: market.primaryExch || _.first(market.primaryExchs),
            exchange: market.exchange || _.first(market.exchanges),
            currency: market.currency,
            includeExpired: market.secType == 'FUT' || !!~(market.secTypes||[]).indexOf('FUT'),
            multiplier: options.multiplier
        }, v => !v);
    } else if (ib != null && options.attached && options.attached.length) {
        const contracts = await Promise.all(options.attached.map(async(attach) => {
            return toContractWithId(markets, ib, {...options, attached: [], ...attach});
        }));
        const currencies = _.uniq(contracts.map(leg => leg.currency));
        if (currencies.length > 1) throw Error(`Cannot mix ${currencies.join(' and ')} in the same Combo order`);
        const exchanges = _.uniq(contracts.map(leg => leg.exchange));
        return {
            secType: 'BAG',
            symbol: _.first(_.uniq(contracts.map(leg => leg.symbol))),
            currency: _.first(currencies),
            exchange: exchanges.length < 2 ? _.first(exchanges) : 'SMART',
            comboLegs: options.attached.map((leg, i) => {
                const contract = contracts[i];
                return {
                    action: leg.action,
                    ratio: leg.quant,
                    conid: contract.conid,
                    exchange: contract.exchange
                };
            })
        };
    } else {
        expect(options).to.have.property('symbol').that.is.ok;
        expect(options).to.have.property('attached').that.is.an('array');
        throw Error(`Could not create contract from ${util.inspect(contract, {breakLength:Infinity})}`);
    }
}

async function toContractWithId(markets, ib, options) {
    const contract = await toContract(markets, null, options);
    if (contract.conid) return contract;
    const details = await ib.reqContractDetails(contract).catch(err => {
        if (options.symbol) throw Error(`${err.message} for ${options.symbol}`);
        else throw Error(`${err.message} from ${util.inspect(contract, {breakLength:Infinity})}`);
    });
    if (details.length) return _.first(details).contract;
    else throw Error(`Could not determin contract from ${util.inspect(contract, {breakLength:Infinity})}`);
}

function toLocalSymbol(market, symbol) {
    if ((market.secType == 'FOP' || ~(market.secTypes||[]).indexOf('FOP')) && symbol.match(/ [CP]/))
        return toFopSymbol(market, symbol);
    else if (market.secType == 'FUT' || ~(market.secTypes||[]).indexOf('FUT'))
        return toFutSymbol(market, symbol);
    else if (market.secType == 'CASH' || ~(market.secTypes||[]).indexOf('CASH'))
        return toCashSymbol(market, symbol);
    else if (market.secType == 'OPT' || ~(market.secTypes||[]).indexOf('OPT'))
        return symbol;
    else if (market.secType || (market.secTypes||[]).length)
        return symbol;
    else if (symbol.match(/^(.*)([A-Z])(\d)(\d)$/))
        return toFutSymbol(market, symbol);
    else
        return symbol;
}

function toFutSymbol(market, symbol) {
    if ((market||{}).month_abbreviation) {
        const abbreviations = {F: 'JAN', G: 'FEB', H: 'MAR', J: 'APR', K: 'MAY', M: 'JUN', N: 'JUL', Q: 'AUG', U: 'SEP', V: 'OCT', X: 'NOV', Z: 'DEC'};
        const m = symbol.match(/^(\w*)([A-Z])(\d)(\d)$/);
        if (!m) return symbol;
        const [, underlying, code, decade, year] = m;
        const space = '    '.substring(underlying.length);
        return `${underlying}${space} ${abbreviations[code]} ${decade}${year}`;
    } else {
        const m = symbol.match(/^(.*)([A-Z])(\d)(\d)$/);
        if (!m) return symbol;
        const [, underlying, code, decade, year] = m;
        return `${underlying}${code}${year}`;
    }
}

function toFopSymbol(market, symbol) {
    if ((market||{}).month_abbreviation) {
        const abbreviations = {F: 'JAN', G: 'FEB', H: 'MAR', J: 'APR', K: 'MAY', M: 'JUN', N: 'JUL', Q: 'AUG', U: 'SEP', V: 'OCT', X: 'NOV', Z: 'DEC'};
        const m = symbol.match(/^(\w*)([A-Z])(\d)(\d) ([CP])(\d+)$/);
        if (!m) return symbol;
        const [, underlying, code, decade, year, right, strike] = m;
        const tradingClass = ((market||{}).tradingClasses||{})[underlying] || underlying;
        const space = '    '.substring(tradingClass.length);
        const k = d3.format('6')(strike);
        return `${right} ${tradingClass}${space} ${abbreviations[code]} ${decade}${year} ${k}`;
    } else {
        const m = symbol.match(/^(.*)([A-Z])(\d)(\d) ([CP])(\d+)$/);
        if (!m) return symbol;
        const [, underlying, code, decade, year, right, strike] = m;
        const tradingClass = ((market||{}).tradingClasses||{})[underlying] || underlying;
        return `${tradingClass}${code}${year} ${right}${strike}`;
    }
}

function toCashSymbol(market, symbol) {
    return `${symbol}.${market.currency}`;
}

async function asMarket(markets, ib, contract) {
    const market = [contract.primaryExchange, contract.exchange]
      .filter(market => market && market != 'SMART')
      .concat(Object.keys(markets))
      .find(name => inMarket(contract, markets[name]));
    if (market) return market;
    const details = ib ? await ib.reqContractDetails(
        contract.conid || contract.conId ? {conid: contract.conid || contract.conId} :
        _.pick(contract, 'currency', 'exchange', 'lastTradeDateOrContractMonth', 'localSymbol', 'multiplier', 'primaryExch', 'right', 'secId', 'secIdType', 'secType', 'strike', 'symbol', 'tradingClass'))
      .catch(err => []): [];
    return details.reduce(async(promise, detail) => {
        const prior = await promise.catch(err => err);
        if (!(prior instanceof Error)) return prior;
        else return asMarket(markets, null, {...detail, ...detail.contract}).catch(err => Promise.reject(prior));
    }, Promise.reject(Error(`Could not determine market for ${util.inspect(contract, {breakLength:Infinity})}`)));
}

function inMarket(contract, market) {
    if (!market) return false;
    if (market.currency && market.currency != contract.currency) return false;
    if (market.secType && market.secType != contract.secType) return false;
    if (market.secTypes && !~market.secTypes.indexOf(contract.secType)) return false;
    if (market.tradingClasses && ~_.values(market.tradingClasses).indexOf(contract.tradingClass)) return true;
    const exchanges = [].concat(market.primaryExch, market.primaryExchs, market.exchange, market.exchanges);
    const unique = _.compact(exchanges).filter(ex => ex != 'SMART' && ex != 'IDEALPRO');
    const secondaryTo = market.secondaryToExchs || [];
    const validExchanges = contract.validExchanges ? _.compact(contract.validExchanges.split(',')) : [];
    if (~secondaryTo.indexOf(contract.primaryExch) || ~secondaryTo.indexOf(contract.exchange)) return false;
    else if (_.intersection(secondaryTo, validExchanges).length) return false;
    else if (~unique.indexOf(contract.primaryExch) || ~unique.indexOf(contract.exchange)) return true;
    else if (_.intersection(unique, validExchanges).length) return true;
    else return !unique.length;
}

function parseTime(time, ib_tz) {
    const time_str = time.replace(/^(\d\d\d\d)(\d\d)(\d\d)(\s)?\s*/, '$1-$2-$3$4');
    return moment.tz(time_str, ib_tz).tz((moment.defaultZone||{}).name || moment.tz.guess());
}
