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
const storage = require('./storage.js');
const Collect = require('./mtrader-collect.js');
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
            simulation: {
                usage: '<string>',
                description: "The stored simulation instance to use"
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
    expect(settings).to.have.property('simulation').that.is.ok;
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).simulation
    )), v => !v);
    const lib_dir = config('lib_dir') || path.resolve(config('prefix'), config('default_lib_dir'));
    const store = storage(lib_dir);
    const collect = new Collect(settings);
    return _.extend(function(options) {
        if (options.help) return helpOptions();
        switch(options.action) {
            case 'balances': return listBalances(markets, collect, store, settings, options);
            case 'positions': return listPositions(markets, collect, store, settings, options);
            case 'orders': return listOrders(markets, collect, store, settings, options);
            case 'LONG':
            case 'BUY':
            case 'BTO':
            case 'BTC':
            case 'BOT': return buyOrder(markets, collect, store, settings, options);
            case 'SHORT':
            case 'SELL':
            case 'STC':
            case 'STO':
            case 'SLD': return sellOrder(markets, collect, store, settings, options);
            default: expect(options).to.have.property('action').to.be.oneOf([
                'balances', 'positions', 'orders',
                'LONG', 'BUY', 'BTO', 'BTC', 'BOT',
                'SHORT', 'SELL', 'STC', 'STO', 'SLD'
            ]);
        }
    }, {
        close() {
            return Promise.all([
                collect.close(),
                ib.close()
            ]);
        }
    });
};

function listOrders(markets, collect, store, settings, options) {
    return store.open(settings.simulation, async(err, db) => {
        if (err) throw err;
        const orders = await db.collection('orders');
        const begin = options.begin && moment(options.begin);
        const min_month = begin.format('YYYYMM');
        const months = !begin ? _.max([''].concat(months)) :
            orders.listName().filter(month => min_begin <= month);
        if (_.isEmpty(months)) return [];
        const begin_asof = begin && begin.format();
        return orders.lockWith([].concat(months), async() => {
            return _.flatten(await Promise.all(months.map(async(month) => {
                const data = await orders.readFrom(recent_month);
                if (begin_asof) return data.filter(order => begin_asof <= order.asof);
                else return data.filter(order => order.status == 'working');
            })));
        });
    });
}

function buyOrder(markets, collect, store, settings, options) {
    const now = moment(options.now);
    return store.open(settings.simulation, async(err, db) => {
        if (err) throw err;
        const orders = await db.collection('orders');
        const current_month = now.format('YYYYMM');
        const recent_month = _.max([''].concat(orders.listName())) || current_month;
        return orders.lockWith(_.uniq([recent_month, current_month]), async() => {
            const data = await orders.readFrom(recent_month);
            const completed = data.filter(order => order.status != 'working');
            if (recent_month != current_month) await orders.replaceWith(completed, recent_month);
            const current_completed = recent_month == current_month ? completed : [];
            const working = data.filter(order => order.status == 'working');
            const modifying = working.find(sameOrder(options));
            const replacement = current_completed.concat(
                {...options, asof: now.format(), status: 'pending'},
                working.filter(order => order != modifying),
                {...options, asof: now.format(), status: 'working'}
            );
            await orders.replaceWith(replacement, current_month);
        });
    });
}

function sameOrder(options) {
    const identifying = ['symbol', 'market', 'type', 'order_ref', 'parent_ref', 'group_ref', 'bag_ref'];
    return order => {
        return sameAction(order.action, options.action) && isMatch(options, _.pick(order, identifying));
    };
}

function sameAction(a, b) {
    return a.charAt(0) == b.charAt(0) ||
        a.charAt(0) == 'L' && b.charAt(0) == 'B' ||
        a.charAt(0) == 'B' && b.charAt(0) == 'L';
}
