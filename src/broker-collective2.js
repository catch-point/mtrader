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
const logger = require('./logger.js');
const config = require('./config.js');
const Fetch = require('./fetch.js');
const Collective2 = require('./collective2-client.js');
const expect = require('chai').expect;

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
module.exports = function(settings) {
    if (settings.help) return helpSettings();
    settings = {offline: config('offline'), ...config('tls'), ...config('broker.collective2'), ...settings};
    expect(settings).to.have.property('systemid').that.is.ok;
    const client = Collective2(settings);
    const fetch = new Fetch(settings);
    const markets = _.mapObject(_.pick(config('markets'), market => {
        return (market.datasources||{}).collective2;
    }), market => {
        return Object.assign(_.omit(market, _.isObject), market.datasources.collective2);
    });
    const lookup_fn = _.memoize(lookup.bind(this, fetch, markets), signal => signal.symbol);
    return _.extend(function(options) {
        if (options && options.help) return helpOptions();
        const c2_multipliers = settings.c2_multipliers || {};
        return collective2(c2_multipliers, client, fetch, lookup_fn, options || {});
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
    return Promise.resolve([{
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
            'symbol', 'market', 'currency', 'secType', 'multiplier'
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
            'posted_at', 'asof', 'action', 'quant', 'type', 'limit', 'price', 'tif', 'status', 'price',
            'order_ref', 'symbol', 'market', 'currency', 'secType', 'multiplier'
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
        name: 'retrieve',
        usage: 'broker(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ["ok", "signal", "market", "strike", "signalid", "stoploss", "comments", "tif", "day", "systemid", "parkUntilYYYYMMDDHHMM", "symbol", "conditionalupon", "duration", "description", "targetocagroupid", "expiresat", "pointvalue", "isLimitOrder", "parkUntilSecs", "typeofsymbol", "currency", "quant", "limit", "gtc", "stop", "profittarget", "action", "ocaid","signalid", "elapsed_time", "buyPower", "marginUsed", "equity", "updatedLastTimeET", "ok", "modelAccountValue", "cash"],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'requestMarginEquity', 'retrieveSystemEquity',
                    'retrieveSignalsWorking', 'requestTrades'
                ]
            }
        }
    }, {
        name: 'cancelSignal',
        usage: 'broker(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ["ok", "signal", "market", "strike", "signalid", "stoploss", "comments", "tif", "day", "systemid", "parkUntilYYYYMMDDHHMM", "symbol", "conditionalupon", "duration", "description", "targetocagroupid", "expiresat", "pointvalue", "isLimitOrder", "parkUntilSecs", "typeofsymbol", "currency", "quant", "limit", "gtc", "stop", "profittarget", "action", "ocaid","signalid", "elapsed_time", "buyPower", "marginUsed", "equity", "updatedLastTimeET", "ok", "modelAccountValue", "cash"],
        options: {
            action: {
                usage: '<string>',
                values: ['cancelSignal']
            },
            signalid: {
                usage: '<integer>',
                description: "The signal identifier that should be cancelled"
            }
        }
    }, {
        name: 'submitSignal',
        usage: 'broker(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ["ok", "signal", "market", "strike", "signalid", "stoploss", "comments", "tif", "day", "systemid", "parkUntilYYYYMMDDHHMM", "symbol", "conditionalupon", "duration", "description", "targetocagroupid", "expiresat", "pointvalue", "isLimitOrder", "parkUntilSecs", "typeofsymbol", "currency", "quant", "limit", "gtc", "stop", "profittarget", "action", "ocaid","signalid", "elapsed_time", "buyPower", "marginUsed", "equity", "updatedLastTimeET", "ok", "modelAccountValue", "cash"],
        options: {
            action: {
                usage: '<string>',
                values: ['BTO', 'STO', 'BTC', 'STC']
            },
            typeofsymbol: {
                values: ['stock', 'option', 'future', 'forex'],
                description: "instruments like ETFs and mutual funds should be treated as a 'stock' Click here for C2 Symbols Help"
            },
            duration: {
                values: ['DAY', 'GTC']
            },
            stop: {
                usage: '<price>'
            },
            limit: {
                usage: '<price>'
            },
            market: {
                description: "Set to 1 to declare this is a market order. If you do not supply limit or stop parameters, order will be assumed to be a market order."
            },
            profittarget: {
                usage: '<price>',
                description: "Used when submitting an position-entry order. Automatically create a conditional order to close the position at this limit price. When used in conjunction with stoploss, a One-Cancels-All group is created."
            },
            stoploss: {
                usage: '<price>',
                description: "Used when submitting an position-entry order. Automatically create a conditional order to close the position at this stop price. When used in conjunction with profittarget, a One-Cancels-All group is created."
            },
            conditionalupon: {
                usage: '<signalid>',
                description: "Do not allow this order to start 'working' unless the parent order is filled (parent order has signalid = conditionalupon)"
            },
            conditionalUponSignal: {
                description: "Same as conditionalupon, but instead of supplying already-determined signalid, you can provide nested JSON containing entire signal hash"
            },
            xreplace: {
                usage: '<signalid>',
                description: "Cancel the signalid specified, and if the cancel is successful, submit this new order to replace it"
            },
            symbol: {},
            quant: {},
            isLimitOrder: {},
            strike: {},
            status: {},
            name: {},
            isStopOrder: {},
            instrument: {},
            posted_time_unix: {},
            underlying: {},
            isMarketOrder: {},
            tif: {},
            putcall: {},
            expiration: {},
            quant: {},
            signal_id: {},
            posted_time: {},
            signalid: {},
            comments: {},
            day: {},
            systemid: {},
            parkUntilYYYYMMDDHHMM: {},
            targetocagroupid: {},
            decimalprecision: {},
            expiresat: {},
            pointvalue: {},
            parkUntilSecs: {},
            currency: {},
            quant: {},
            gtc: {},
            ocaid: {},
            localsignalid: {},
            symbol_description: {},
            description: {},
            pointvalue: {}
        }
    }]);
}

function collective2(c2_multipliers, collective2, fetch, lookup, options) {
    expect(options).to.have.property('action').to.be.oneOf([
        'balances', 'positions', 'orders',
        'requestMarginEquity', 'retrieveSystemEquity',
        'retrieveSignalsWorking', 'requestTrades',
        'cancelSignal', 'BTO', 'STO', 'BTC', 'STC'
    ]);
    switch(options.action) {
        case 'balances': return listBalances(collective2, options);
        case 'positions': return listPositions(c2_multipliers, collective2, fetch, lookup, options);
        case 'orders': return listOrders(c2_multipliers, collective2, lookup, options);
        case 'requestMarginEquity': return collective2.requestMarginEquity();
        case 'retrieveSystemEquity': return collective2.retrieveSystemEquity();
        case 'retrieveSignalsWorking': return collective2.retrieveSignalsWorking();
        case 'requestTrades': return collective2.requestTrades();
        case 'cancelSignal': return collective2.cancelSignal(options.signalid);
        case 'BTO':
        case 'STO':
        case 'BTC':
        case 'STC': return collective2.submitSignal(options);
        default: throw Error("Unknown action: " + options.action);
    }
}

async function listBalances(collective2, options) {
    const asof = moment(options.asof || options.now).format();
    const begin = moment(options.begin || asof).format();
    const equity_data = await collective2.retrieveSystemEquity();
    const earliest = Math.min(
        (_.last(equity_data)||{}).unix_timestamp || Infinity,
        moment(options.begin || options.asof).subtract(5, 'days').startOf('day').format('X')
    );
    const data = equity_data.filter(datum => datum.unix_timestamp >= earliest);
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
        const changes = await Promise.all(signals.map(async(signal) => {
            const time_unix = _.max([signal.posted_time_unix, signal.canceled_time_unix, signal.traded_time_unix]);
            const status = signal.status == 'working' ? 'working' :
                signal.status == 'traded' ? 'filled' : 'cancelled';
            const conditionalUponSignal = signals.find(s => s.signal_id == signal.conditionalupon) || {};
            return {
                posted_at: moment(signal.posted_time_unix, 'X').format(),
                asof: moment(time_unix, 'X').format(),
                action: signal.action.charAt(0) == 'B' ? 'BUY' :
                    signal.action.charAt(0) == 'S' ? 'SELL' : sign.action,
                quant: signal.quant,
                type: +signal.market || +signal.isMarketOrder ? 'MKT' :
                    +signal.isLimitOrder ? 'LMT' : +signal.isStopOrder ? 'STP' : null,
                limit: +signal.isLimitOrder || null,
                price: +signal.isStopOrder || null,
                tif: signal.tif || signal.duration,
                status: status,
                price: signal.traded_price,
                order_ref: signal.localsignal_id || signal.signal_id,
                attach_ref: conditionalUponSignal.localsignal_id || conditionalUponSignal.signal_id,
                symbol: contract.symbol,
                market: contract.market,
                currency: contract.currency,
                secType: contract.secType,
                multiplier: c2_multipliers[signal.fullSymbol] || c2_multipliers[signal.symbol] || contract.multiplier || 1
            };
        }));
        return changes.filter(o => o.asof <= asof);
    }));
    const changes = [].concat(...all_changes);
    return _.sortBy(changes, 'asof')
      .filter((o,i,a) => begin < o.asof && o.asof <= asof || o.asof == _.last(a).asof || o.status == 'working');
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
    const ending_position = position ? +position.quant_opened - +position.quant_closed : 0;
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
    }, ending_position - latest_trade.quant);
    if (latest_trade.mtm) {
        changes.push({...latest_trade, asof: latest_trade.traded_at});
    }
    return changes.filter(trade => trade.action)
      .map(trade => Object.assign({
        asof: trade.asof,
        sales: contract.secType == 'FUT' ? 0 : trade.sales,
        purchases: contract.secType == 'FUT' ? 0 : trade.purchases,
        symbol: contract.symbol,
        market: contract.market,
        currency: contract.currency,
        secType: contract.secType,
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

async function lookup(fetch, markets, signal) {
    const instrument = signal.typeofsymbol || signal.instrument;
    const matches = await Promise.all(_.map(_.pick(markets, m => {
        return m.instrument == instrument;
    }), async(m, market) => {
        const fullSymbol = signal.fullSymbol || signal.symbol;
        const symbol = _.invert(m.c2_map||{})[fullSymbol] ||
            fullSymbol.startsWith(m.c2_prefix) ? fullSymbol.substring(m.c2_prefix.length) :
            fullSymbol;
        expect(symbol).to.be.a('string');
        return await fetch({interval:'lookup', symbol, market})
          .then(matches => matches.filter(match => match.symbol == symbol && match.currency == 'USD'))
          .then(matches => matches.length ? matches :
            // expired futures cannot be looked up, this might be one of then
            instrument == 'future' ? [{symbol, market, currency: m.currency, secType: 'FUT'}] : [])
          .catch(err => []);
    }));
    return _.first(_.flatten(matches));
}

