// broker-collective2.js
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
const moment = require('moment-timezone');
const Big = require('big.js');
const merge = require('./merge.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const Fetch = require('./fetch.js');
const Collective2 = require('./collective2-client.js');
const expect = require('chai').expect;

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
module.exports = function(settings) {
    if (settings.info=='help') return helpSettings();
    if (settings.info=='version') return [{version}];
    expect(settings).to.have.property('systemid').that.is.ok;
    const client = Collective2(settings);
    const fetch = new Fetch(merge(config('fetch'), settings.fetch));
    const markets = _.mapObject(_.pick(config('markets'), market => {
        return (market.datasources||{}).collective2;
    }), market => {
        return Object.assign(_.omit(market, _.isObject), market.datasources.collective2);
    });
    const lookup_fn = _.memoize(lookup.bind(this, fetch, markets), signal => signal.symbol);
    return _.extend(async function(options) {
        if (options && options.info=='help') return helpOptions();
        if (options && options.info=='version') return [{version}];
        if (options && options.info) return [];
        const c2_multipliers = settings.c2_multipliers || {};
        return collective2(c2_multipliers, client, fetch, markets, lookup_fn, options || {});
    }, {
        close() {
            return Promise.all([
                fetch.close(),
                client.close()
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
            systemid: {
                usage: '<integer>',
                description: "The Collective2 system identifier"
            },
            c2_multipliers: {
                usage: '{c2_symbol: <number>}',
                description: "A hash of collective2 symbols to their Value 1 Pt (if not 1)"
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
            'asof', 'currency', 'rate', 'net'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'balances'
                ]
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time of the balances to return"
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
            'asof', 'action', 'quant', 'position', 'traded_at', 'traded_price', 'price',
            'sales', 'purchases', 'dividend', 'commission', 'mtm', 'value',
            'symbol', 'market', 'currency', 'security_type', 'multiplier'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'positions'
                ]
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time of the positions to return"
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
            'posted_at', 'asof', 'action', 'quant', 'order_type', 'limit', 'stop', 'traded_price', 'tif', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'currency', 'security_type', 'multiplier'
        ],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'orders'
                ]
            },
            asof: {
                usage: '<dateTime>',
                description: "The date and time of workings orders to return"
            },
            begin: {
                usage: '<dateTime>',
                description: "Include summary of position changes since this dateTime"
            }
        }
    }, {
        name: 'submit',
        usage: 'broker(options)',
        description: "Transmit order for trading",
        properties: [
            'posted_at', 'asof', 'traded_at', 'action', 'quant', 'order_type', 'limit', 'stop', 'tif', 'status',
            'order_ref', 'attach_ref', 'symbol', 'market', 'currency', 'security_type', 'multiplier'
        ],
        options: {
            action: {
                usage: '<string>',
                values: ['BUY', 'SELL', 'cancel']
            },
            traded_at: {
                usage: '<dateTime>',
                description: "The date and time of the collective2 parkUntil value"
            },
            quant: {
                usage: '<positive-integer>',
                description: "The number of shares or contracts to buy or sell"
            },
            order_type: {
                usage: '<order-type>',
                values: ['MKT', 'LMT', 'STP']
            },
            limit: {
                usage: '<limit-price>',
                descirption: "The limit price for orders of type LMT"
            },
            stop: {
                usage: '<aux-price>',
                description: "Stop limit price for STP orders"
            },
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
                description: "The order_ref of the parent order that must be filled before this order"
            },
            attached: {
                usage: '[...orders]',
                description: "Submit attached parent/child orders together"
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
                values: ['USD']
            },
            multiplier: {
                usage: '<number>',
                description: "The value of a single unit of change in price"
            }
        }
    }]);
}

function collective2(c2_multipliers, collective2, fetch, markets, lookup, options) {
    switch(options.action) {
        case 'balances': return listBalances(collective2, options);
        case 'positions': return listPositions(c2_multipliers, collective2, fetch, lookup, options);
        case 'orders': return listOrders(c2_multipliers, collective2, lookup, options);
        case 'cancel': return cancelOrder(c2_multipliers, collective2, markets, lookup, options);
        case 'OCA': return oneCancelsAllOrders(collective2, markets, options);
        case 'BUY':
        case 'SELL': return submitOrder(collective2, markets, options);
        default: expect(options).to.have.property('action').to.be.oneOf([
            'balances', 'positions', 'orders',
            'cancel', 'OCA', 'BUY', 'SELL'
        ]);
    }
}

async function listBalances(collective2, options) {
    const asof = moment(options.asof || options.now).format();
    const begin = moment(options.begin || asof).format();
    const equity_data = await collective2.retrieveSystemEquity();
    const latest = moment(asof).format('X');
    const earliest = Math.min(
        (_.last(equity_data)||{}).unix_timestamp || Infinity,
        moment(options.begin || options.asof).subtract(5, 'days').startOf('day').format('X')
    );
    const data = equity_data.filter(datum => earliest <= datum.unix_timestamp && datum.unix_timestamp <= latest);
    return data.map(datum => {
        return {
            asof: moment(datum.unix_timestamp, 'X').format(),
            currency: 'USD',
            rate: '1.0',
            net: datum.strategy_raw
        };
    }).filter((b,i,a) => begin < b.asof && b.asof <= asof || b.asof == _.last(a).asof);
}

async function listPositions(c2_multipliers, collective2, fetch, lookup, options) {
    const asof = moment(options.asof || options.now).format();
    const asof_time_unix = moment(asof).format('X');
    const begin = moment(options.begin || asof);
    const earliest = moment(begin).subtract(5, 'days').startOf('day');
    const positions = _.indexBy(await collective2.requestTradesOpen(), s => s.fullSymbol || s.symbol);
    const filter = {
        filter_type: 'time_traded',
        filter_date_time_start: moment(earliest).tz('America/New_York').format('YYYY-MM-DD HH:mm:ss')
    };
    const signals = _.groupBy(await collective2.retrieveSignalsAll(filter), s => s.fullSymbol || s.symbol);
    const symbols = _.union(Object.keys(positions), Object.keys(signals));
    const changes = await Promise.all(symbols.map(async(symbol) => {
        const pos = positions[symbol];
        const contract = await lookup(pos || _.first(signals[symbol]));
        if (!contract) throw Error(`Could not lookup contract ${symbol}`);
        const tz = (moment.defaultZone||{}).name;
        expect(contract).to.have.property('symbol').that.is.a('string');
        const all_bars = await fetch({interval:'day', begin: earliest.format(), end: asof, tz, ...contract});
        const bars = all_bars.filter(bar => bar.ending <= asof);
        if (!bars.length) throw Error(`Could not load daily bars for ${JSON.stringify(contract)}`);
        const trades = (signals[symbol]||[]).filter(signal => {
            return signal.status == 'traded' && signal.traded_time_unix <= asof_time_unix;
        });
        if (_.isEmpty(trades) && (!pos || pos.quant_opened == pos.quant_closed)) return [];
        const multiplier = c2_multipliers[symbol] || contract.multiplier || 1;
        const changes = await listSymbolPositions(contract, multiplier, bars, pos, trades, options);
        const begin_format = options.begin && begin.format();
        if (options.begin) return changes.filter((p,i,a) => begin_format <= p.asof || p.asof == _.last(a).asof);
        else if (!changes.length) return [];
        else return [_.last(changes)];
    }));
    const sorted = _.sortBy([].concat(...changes), 'asof');
    if (options.begin) return sorted;
    else return sorted.filter((p,i,a) => p.position || p.asof == _.last(a).asof);
}

async function listOrders(c2_multipliers, collective2, lookup, options) {
    const now = moment(options.now).format('X');
    const asof = moment(options.asof || options.now).format();
    const begin = moment(options.begin || asof).format();
    const start = options.begin ? moment(options.begin) :
        options.asof ? moment(options.asof).subtract(5, 'days') : null;
    const filter_date_time_start = start && start.tz('America/New_York').format('YYYY-MM-DD HH:mm:ss');
    const signals = filter_date_time_start ?
        [].concat(...await Promise.all(['time_traded', 'time_expired', 'time_canceled'].map(async(filter_type) => {
            return collective2.retrieveSignalsAll({filter_type, filter_date_time_start});
        }))).reduce((unique, signal) => {
            if (unique.some(s => _.isEqual(s, signal))) return unique;
            else return unique.concat(signal);
        }, []) : await collective2.retrieveSignalsWorking();
    const group = _.groupBy(signals, 'symbol');
    const all_changes = await Promise.all(_.map(group, (signals, symbol) => attachSignals(signals))
      .map(async(signals) => {
        const contract = await lookup(_.first(signals));
        if (!contract) throw Error(`Could not lookup contract ${symbol}`);
        const changes = await Promise.all(signals.map(async(signal) => {
            const time = _.max([
                'killedwhen', 'tradedwhen', 'postedwhen', 'createdWhen',
                'posted_time_unix', 'canceled_time_unix', 'traded_time_unix'
            ].map(key => +signal[key] || 0));
            const conditionalUponSignal = signals.find(s => s.signal_id == signal.conditionalupon) || {};
            const parked = signal.parkUntilSecs && +now < +signal.parkUntilSecs;
            const status = parked || !_.isEmpty(conditionalUponSignal) ? 'pending' :
                signal.status == 'working' ? 'working' : signal.status == 'traded' ? 'filled' : 'cancelled';
            return _.omit({
                asof: (time ? moment(time, 'X') : moment(options.now)).format(),
                posted_at: signal.posted_time_unix || signal.postedwhen ?
                    moment(signal.posted_time_unix || signal.postedwhen, 'X').format() : null,
                traded_at: signal.traded_time_unix || signal.tradedwhen ?
                    moment(signal.traded_time_unix || signal.tradedwhen, 'X').format() : null,
                action: signal.action.charAt(0) == 'B' ? 'BUY' :
                    signal.action.charAt(0) == 'S' ? 'SELL' : sign.action,
                quant: signal.quant,
                order_type: +signal.market || +signal.isMarketOrder ? 'MKT' :
                    +signal.isLimitOrder || +signal.limit ? 'LMT' :
                    +signal.isStopOrder || +signal.stop ? 'STP' : null,
                limit: +signal.isLimitOrder ? signal.isLimitOrder : +signal.limit ? signal.limit : null,
                stop: +signal.isStopOrder ? signal.isStopOrder : +signal.stop ? signal.stop : null,
                traded_price: signal.traded_price,
                tif: signal.tif || signal.duration,
                status: status,
                order_ref: signal.localsignal_id || signal.signal_id,
                attach_ref: conditionalUponSignal.localsignal_id || conditionalUponSignal.signal_id,
                symbol: contract.symbol,
                market: contract.market,
                currency: contract.currency,
                security_type: contract.security_type,
                multiplier: c2_multipliers[signal.fullSymbol] || c2_multipliers[signal.symbol] || contract.multiplier || 1
            }, v => v == null);
        }));
        return changes.filter(o => o.asof <= asof);
    }));
    const changes = [].concat(...all_changes);
    return _.sortBy(changes, 'asof').filter((o,i,a) => begin < o.asof && o.asof <= asof ||
        o.asof == _.last(a).asof || o.status == 'pending' || o.status == 'working'
    );
}

async function cancelOrder(c2_multipliers, collective2, markets, lookup, options) {
    expect(options).to.have.property('order_ref').that.is.ok;
    const working = await collective2.retrieveSignalsWorking();
    const order_ref = options.order_ref;
    const signal = working.find(sig => sig.localsignalid == order_ref || sig.signal_id == order_ref);
    if (!signal) throw Error(`Could not find order: ${order_ref}`);
    const resp = Object.assign({}, signal, await collective2.cancelSignal(signal.signal_id));
    const contract = await lookup(signal);
    const time = _.max([
        'killedwhen', 'tradedwhen', 'postedwhen', 'createdWhen',
        'posted_time_unix', 'canceled_time_unix', 'traded_time_unix'
    ].map(key => +resp[key] || +signal[key] || 0));
    return [_.omit({
        asof: time ? moment(time, 'X').format() : moment(options.now).format(),
        posted_at: resp.posted_time_unix || resp.postedwhen ?
            moment(resp.posted_time_unix || resp.postedwhen, 'X').format() : null,
        traded_at: resp.traded_time_unix || resp.tradedwhen ?
            moment(resp.traded_time_unix || resp.tradedwhen, 'X').format() : null,
        action: resp.action.charAt(0) == 'B' ? 'BUY' : 'SELL',
        quant: resp.quant,
        order_type: +signal.market || +signal.isMarketOrder ? 'MKT' :
            +signal.isLimitOrder || +signal.limit ? 'LMT' :
            +signal.isStopOrder || +signal.stop ? 'STP' : null,
        limit: +signal.isLimitOrder ? signal.isLimitOrder : +signal.limit ? signal.limit : null,
        stop: +signal.isStopOrder ? signal.isStopOrder : +signal.stop ? signal.stop : null,
        traded_price: signal.traded_price,
        tif: +resp.day ? 'DAY' : +resp.gtc ? 'GTC' : resp.tif || resp.duration,
        status: resp.tradedwhen ? 'filled' : 'cancelled',
        order_ref: resp.localsignalid || resp.signalid,
        symbol: contract.symbol,
        market: contract.market,
        currency: contract.currency,
        security_type: contract.security_type,
        multiplier: c2_multipliers[signal.fullSymbol] || c2_multipliers[signal.symbol] || contract.multiplier || 1
    }, v => v == null)];
}

async function oneCancelsAllOrders(collective2, markets, options) {
    expect(options).to.have.property('attached').that.is.an('array');
    const positions = await collective2.requestTradesOpen();
    const working = await collective2.retrieveSignalsWorking();
    const signals = [].concat(...options.attached.map(order => c2signal(markets, positions, working, order, options)));
    return _.flatten(await Promise.all(signals.map(async(signal) => {
        const resp = await collective2.submitSignal(signal);
        const child = signalToOrder(working, resp, options);
        if (!resp.conditionalUponSignal) return [child];
        const parent = signalToOrder(working, resp.conditionalUponSignal, options);
        return [parent, {...child, attach_ref: parent.order_ref}];
    })));
}

async function submitOrder(collective2, markets, options) {
    expect(options).to.have.property('symbol').that.is.ok;
    expect(options).to.have.property('market').that.is.ok;
    expect(options).to.have.property('quant').that.is.ok;
    const positions = await collective2.requestTradesOpen();
    const working = await collective2.retrieveSignalsWorking();
    const signals = c2signal(markets, positions, working, options, options);
    return _.flatten(await Promise.all(signals.map(async(signal) => {
        const resp = await collective2.submitSignal(signal);
        const child = signalToOrder(working, resp, options);
        if (!resp.conditionalUponSignal) return [child];
        const parent = signalToOrder(working, resp.conditionalUponSignal, options);
        return [parent, {...child, attach_ref: parent.order_ref}];
    })));
}

function c2signal(markets, positions, working, order, options, conditionalUponSignal) {
    expect(order.order_type).is.oneOf(['STP', 'LMT', 'MKT']);
    const symbol = c2symbol(markets, order.symbol, order.market);
    const pos = positions.find(pos => pos.symbol == symbol || pos.fullSymbol == symbol);
    const action = order.action == 'BUY' ?
        !pos || pos.quant_opened == pos.quant_closed || pos.long_or_short == 'long' ? 'BTO' : 'BTC' :
        !pos || pos.quant_opened == pos.quant_closed || pos.long_or_short == 'short' ? 'STO' : 'STC';
    const quant = action == 'BTC' || action == 'STC' ?
        Math.min(+(pos.quant_opened||0) - +(pos.quant_closed||0), order.quant) : order.quant;
    const replaces = order.order_ref &&
        working.find(sig => sig.localsignalid == order.order_ref || sig.signal_id == order.order_ref);
    const stoploss = order.attached && order.attached.find(ord => ord.order_type == 'STP');
    const traded_at = order.traded_at && moment(order.traded_at);
    const signal = _.omit({
        action: action,
        quant: quant,
        symbol: symbol,
        typeofsymbol: typeofsymbol(order.security_type),
        duration: order.tif,
        stop: order.order_type == 'STP' ? order.stop : null,
        limit: order.order_type == 'LMT' ? order.limit : null,
        market: order.order_type == 'MKT' ? 1 : 0,
        stoploss: +quant == +order.quant ? stoploss && stoploss.stop : null,
        xreplace: replaces && replaces.signal_id,
        parkUntilSecs: traded_at && traded_at.isAfter(options.now) ? traded_at.format('X') : null,
        conditionalUponSignal
    }, v => v == null);
    const submit = !replaces || !sameSignal(signal, replaces);
    const conditional_orders = (order.attached||[]).filter(ord => ord.order_type != 'STP')
        .concat(+quant == +order.quant ? [] : {..._.omit(order, 'order_ref'), quant: (+order.quant - +quant)});
    if (submit && !conditional_orders.length) return [signal];
    else if (!conditional_orders.length) return [];
    if (submit && replaces && conditional_orders.length)
        logger.warn("Collective2 does not permit replacing signals with conditionalupon", conditional_orders);
    if (submit && replaces && conditional_orders.length) return [signal];
    if (submit && conditionalUponSignal)
        logger.warn("Collective2 does not permit double conditionalupon signals", conditional_orders);
    if (submit && conditionalUponSignal) return [signal]; // no double conditionalupon permitted
    const position = +((pos||{}).quant_opened||0) - +((pos||{}).quant_closed||0) +
        (action == 'BTO' || action == 'STO' ? +quant : -quant);
    const long_or_short = action == 'STO' || action == 'BTC' ? 'short' : 'long';
    const new_pos = +position ? [{symbol,long_or_short,quant_opened:position}] : [];
    const conditional_signals = conditional_orders
      .map(ord => c2signal(markets, new_pos, working, ord, options, submit ? signal : undefined));
    return _.flatten(conditional_signals)
      .map(sig => submit ? sig : {...sig, conditionalupon: signal.xreplace});
}

function sameSignal(signal, rep) {
    if (signal.action != rep.action) return false;
    if (signal.quant != rep.quant) return false;
    if (signal.duration == 'GTC' && rep.duration != 'GTC' && rep.tif != 'GTC' && !+rep.gtc) return false;
    if (signal.duration == 'DAY' && rep.duration != 'DAY' && rep.tif != 'DAY' && !+rep.day) return false;
    if (signal.stoploss && +signal.stoploss != +rep.stoploss) return false;
    if (signal.stop && +signal.stop != +rep.stop && +signal.stop != +rep.isStopOrder) return false;
    if (signal.limit && +signal.limit != +rep.limit && +signal.limit != +rep.isLimitOrder) return false;
    else return true;
}

function signalToOrder(working, signal, options) {
    const index = _.indexBy(working, sig => sig.signalid || sig.signal_id);
    const localsignalids = _.mapObject(index, sig => sig.localsignalid);
    const time = _.max([
        'killedwhen', 'tradedwhen', 'postedwhen', 'createdWhen',
        'posted_time_unix', 'canceled_time_unix', 'traded_time_unix'
    ].map(key => +signal[key] || 0));
    return _.omit({
        asof: time ? moment(time, 'X').format() : moment(options.now).format(),
        posted_at: signal.posted_time_unix || signal.postedwhen ?
            moment(signal.posted_time_unix || signal.postedwhen, 'X').format() : null,
        traded_at: signal.traded_time_unix || signal.tradedwhen ?
            moment(signal.traded_time_unix || signal.tradedwhen, 'X').format() : null,
        action: signal.action.charAt(0) == 'B' ? 'BUY' : 'SELL',
        quant: signal.quant,
        order_type: +signal.market ? 'MKT' : +signal.limit ? 'LMT' : 'STP',
        limit: signal.limit,
        stop: signal.stop,
        traded_price: signal.traded_price,
        tif: +signal.day ? 'DAY' : +signal.gtc ? 'GTC' : signal.tif || signal.duration,
        status: signal.postedwhen ? 'working' : signal.tradedwhen ? 'filled' :
            signal.killedwhen ? 'cancelled' : 'pending',
        order_ref: signal.localsignalid || signal.signalid,
        symbol: options.symbol,
        market: options.market,
        currency: options.currency,
        security_type: options.security_type,
        multiplier: options.multiplier,
        attach_ref: localsignalids[signal.conditionalupon] || signal.conditionalupon
    }, v => v == null);
}

function typeofsymbol(security_type) {
    switch(security_type) {
        case 'STK': return 'stock';
        case 'FUT': return 'future';
        case 'OPT': return 'option';
        case 'CASH': return 'forex';
        default: throw Error(`Unsupport security_type: ${security_type}`);
    }
}

function attachSignals(signals) {
    if (signals.length < 2) return signals;
    const group = _.groupBy(signals, s => {
        if (s.action == 'BTO' || s.action == 'STO') return 'open';
        else if (+s.isStopOrder || +s.stoploss || +s.stop) return 'stop';
        else return 'close';
    });
    return signals.map(s => { // open is conditionalupon close
        if (s.action == 'BTO') return {...s,
            conditionalupon: ((group.close||[]).find(o => o.action == 'BTC')||{}).signal_id
        };
        else if (s.action == 'STO') return {...s,
            conditionalupon: ((group.close||[]).find(o => o.action == 'STC')||{}).signal_id
        };
        if (s.action == 'BTC') return {...s,
            conditionalupon: ((group.open||[]).find(o => o.action == 'STO')||{}).signal_id
        };
        else if (s.action == 'STC') return {...s,
            conditionalupon: ((group.open||[]).find(o => o.action == 'BTO')||{}).signal_id
        };
        else throw Error(`Unknown signal action ${s.action}`);
    });
}

let sequence_counter = (Date.now() * process.pid) % 8589869056;
function nextval() {
    return (++sequence_counter).toString(16);
}

async function listSymbolPositions(contract, multiplier, bars, position, trades, options) {
    const changes = [];
    const ending_position = position ? (+position.quant_opened - +position.quant_closed) *
        (position.long_or_short == 'short' ? -1 : 1) : 0;
    const last_markToMarket_time = moment(_.last(bars).ending).format('X');
    const newer_details = trades.filter(trade => {
        return trade.traded_time_unix > last_markToMarket_time;
    });
    const latest_trade = changePosition(multiplier, _.last(bars), newer_details, _.last(bars), ending_position);
    const starting_position = bars.reduceRight((position, bar, b, bars) => {
        const markToMarket_time = moment(bar.ending).format('X');
        const prev_markToMarket_time = moment((bars[b-1]||{}).ending||0).format('X');
        const details = trades.filter(trade => {
            return prev_markToMarket_time < trade.traded_time_unix &&
                trade.traded_time_unix <= markToMarket_time;
        });
        changes[b] = changePosition(multiplier, bars[b-1] || bar, details, bar, position);
        if (!changes[b].quant)
            return position;
        else if (changes[b].action.charAt(0) == 'B')
            return position - changes[b].quant;
        else if (changes[b].action.charAt(0) == 'S')
            return position + changes[b].quant;
        else
            throw Error(`Invalid trade action ${changes[b].action}`);
    }, ending_position - latest_trade.quant * (latest_trade.action.charAt(0) == 'S' ? -1 : 1));
    if (newer_details.length) {
        changes.push({...latest_trade, asof: latest_trade.traded_at});
    }
    return changes.filter(trade => trade.action)
      .map(trade => Object.assign({
        asof: trade.asof,
        sales: contract.security_type == 'FUT' ? 0 : trade.sales,
        purchases: contract.security_type == 'FUT' ? 0 : trade.purchases,
        symbol: contract.symbol,
        market: contract.market,
        currency: contract.currency,
        security_type: contract.security_type,
        multiplier: multiplier
    }, trade));
}

function changePosition(multiplier, prev_bar, details, bar, position) {
    const adj = Big(bar.close).div(bar.adj_close);
    const dividend = +Big(prev_bar.close).minus(Big(prev_bar.adj_close).times(adj)).toFixed(8);
    const ending_value = Big(position).times(bar.close).times(multiplier);
    const quant = details.reduce((shares, trade) => shares + +trade.quant, 0);
    const shares = details.reduce((shares, trade) => shares + +trade.quant * (trade.action.charAt(0) == 'S' ? -1 : 1), 0);
    const starting_position = position - shares;
    const starting_value = Big(starting_position).times(prev_bar.close).times(multiplier);
    const net_dividend = Big(starting_position).times(dividend).times(multiplier);
    const purchase = details.filter(trade => trade.action.charAt(0) == 'B')
        .reduce((net, trade) => net.add(Big(trade.traded_price).times(trade.quant).times(multiplier)), Big(0));
    const sold = details.filter(trade => trade.action.charAt(0) == 'S')
        .reduce((net, trade) => net.add(Big(trade.traded_price).times(trade.quant).times(multiplier)), Big(0));
    const mtm = Big(ending_value).minus(starting_value)
        .add(sold).minus(purchase).add(net_dividend);
    const action = position == 0 && quant == 0 ? '' :
        position > 0 && shares == 0 ? 'LONG' :
        position < 0 && shares == 0 ? 'SHORT' :
        starting_position >= 0 && position >= 0 && shares > 0 ? 'BTO' :
        starting_position >= 0 && position >= 0 && shares < 0 ? 'STC' :
        starting_position <= 0 && position <= 0 && shares < 0 ? 'STO' :
        starting_position <= 0 && position <= 0 && shares > 0 ? 'BTC' :
        shares > 0 ? 'BOT' : shares < 0 ? 'SLD' : 'DAY';
    const traded_time_unix = _.max(details.map(trade => trade.traded_time_unix));
    return {
        asof: bar.ending,
        action, quant: quant ? Math.abs(shares) : null, position,
        traded_at: _.isFinite(traded_time_unix) ? moment(traded_time_unix, 'X').format() : null,
        traded_price: shares ? +Big(purchase).add(sold).div(Big(quant).abs()).div(multiplier) : null,
        price: bar.close,
        sales: sold.toString(),
        purchases: purchase.toFixed(2),
        dividend: net_dividend.toFixed(2),
        // c2 model account does not pay commission
        mtm: +Big(mtm).toFixed(2),
        value: ending_value.toFixed(2)
    };
}

function c2symbol(markets, symbol, market) {
    expect(market).to.be.oneOf(Object.keys(markets));
    const m = markets[market];
    if (!m.c2_map && !m.c2_prefix) return symbol;
    const sym = m.c2_map[symbol];
    if (sym) return sym;
    const prefix = Object.keys(m.c2_map).find(prefix => symbol.indexOf(prefix) === 0);
    if (prefix) return m.c2_map[prefix] + symbol.substring(prefix.length);
    else if (m.c2_prefix) return m.c2_prefix + symbol;
    else return symbol;
}

async function lookup(fetch, markets, signal) {
    const instrument = signal.typeofsymbol || signal.instrument;
    const matches = await Promise.all(_.map(_.pick(markets, m => {
        return m.instrument == instrument;
    }), async(m, market) => {
        const fullSymbol = signal.fullSymbol ||
            (instrument == 'future' ? fromFutureSymbol(signal.symbol) : signal.symbol);
        const sym2sig = Object.entries(m.c2_map || {}).find(([sym, c2s]) => fullSymbol.indexOf(c2s) === 0);
        const symbol = sym2sig ? sym2sig[0] + fullSymbol.substring(sym2sig[1].length) :
            fullSymbol.startsWith(m.c2_prefix) ? fullSymbol.substring(m.c2_prefix.length) :
            fullSymbol;
        expect(symbol).to.be.a('string');
        return await fetch({interval:'lookup', symbol, market})
          .then(matches => matches.filter(match => match.symbol == symbol && match.currency == 'USD'), err => [])
          .then(matches => matches.length ? matches :
            // expired futures cannot be looked up, this might be one of then
            instrument == 'future' ? [{symbol, market, currency: m.currency, security_type: 'FUT', guess: true}] : []);
    }));
    const list = _.flatten(matches);
    if (_.isEmpty(list)) return null;
    const confirmed = list.find(item => item && !item.guess && item.market == signal.market) || list.find(item => item && !item.guess);
    if (confirmed) return confirmed;
    else return _.omit(list.find(item => item && item.market == signal.market) || list.find(item => item), 'guess');
}

function fromFutureSymbol(symbol) {
    const [, root, month, y] = symbol.match(/^(.*)([A-Z])(\d)$/) || [];
    if (!y) return symbol;
    const now = moment();
    const decade = y >= (now.year() - 2) % 10 ?
        (now.year() - 2).toString().substring(2, 3) :
        (now.year() + 8).toString().substring(2, 3);
    return `${root}${month}${decade}${y}`;
}

