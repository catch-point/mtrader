// adjustment-functions.js
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
const moment = require('moment-timezone');
const Big = require('big.js');
const cache = require('./memoize-cache.js');
const Adjustments = require('./adjustments.js');
const logger = require('./logger.js');
const config = require('./config.js');
const IB = require('./ib-gateway.js');
const expect = require('chai').expect;

/**
 * These functions operate of an array of securities at the corresponding points in time.
 */
module.exports = function(settings) {
    const ib = settings.ib ? new IB(settings.ib) : null;
    const markets = _.omit(_.mapObject(config('markets'), market => Object.assign(
        _.pick(market, v => !_.isObject(v)), (market.datasources||{}).ib
    )), v => !v);
    const cache_keys = ['symbol', 'market', 'security_type', 'currency', 'now', 'offline', 'tz'];
    const nxd = ib ? cache(
        nextDividend.bind(this, markets, ib),
        options => JSON.stringify(_.pick(options, cache_keys)),
        10
    ) : () => null;
    const adjustments = cache(
        new Adjustments(settings),
        options => JSON.stringify(_.pick(options, cache_keys.concat('begin', 'end'))),
        10
    );
    return Object.assign(function(expr, name, args, options) {
        if (functions[name]) {
            return functions[name].apply(this, [nxd, adjustments, options].concat(args));
        }
    }, {
        close() {
            return Promise.all([
                adjustments.close(),
                ib && ib.close()
            ]);
        }
    });
};

module.exports.has = function(name) {
    return !!functions[name];
};

const functions = module.exports.functions = {
    SPLIT: _.extend(async(nxd, adjustments, options, symbol_fn, market_fn, refdate_fn, exdate_fn) => {
        const [symbol, market] = [symbol_fn(), market_fn()];
        const begin = options.begin || refdate_fn();
        const tz = options.tz || (moment.defaultZone||{}).name || moment.tz.guess();
        const data = await adjustments({...options, symbol, market, begin, tz});
        return points => {
            const exdate = moment.tz((exdate_fn||refdate_fn)(points), options.tz);
            const ref = exdate_fn ? moment.tz(refdate_fn(points), options.tz) : moment(exdate).subtract(1,'days');
            let start = _.sortedIndex(data, {exdate: ref.format("Y-MM-DD")}, 'exdate');
            let end = _.sortedIndex(data, {exdate: exdate.format("Y-MM-DD")}, 'exdate');
            if (data[start] && data[start].exdate == ref.format("Y-MM-DD")) start++;
            if (data[end] && data[end].exdate == exdate.format("Y-MM-DD")) end++;
            if (start <= end) {
                return +data.slice(start, end).reduce((split, datum) => split.times(datum.split||1), Big(1));
            } else {
                return +data.slice(end, start).reduce((split, datum) => split.div(datum.split||1), Big(1));
            }
        };
    }, {
        args: "symbol, market, [reference-date,] exdate",
        description: "Ratio of shares on reference date for every share on exdate (X-to-1 split)"
    }),
    DIVIDEND: _.extend(async(nxd, adjustments, options, symbol_fn, market_fn, refdate_fn, exdate_fn, rate_fn) => {
        const [symbol, market] = [symbol_fn(), market_fn()];
        const begin = options.begin || refdate_fn();
        const tz = options.tz || (moment.defaultZone||{}).name || moment.tz.guess();
        const adj_data = await adjustments({...options, symbol, market, begin, tz});
        const next_dividend = await nxd({...options, symbol, market});
        const data = next_dividend && next_dividend.exdate != (_.last(adj_data)||{}).exdate ?
            adj_data.concat(next_dividend) : adj_data;
        return points => {
            const rate = rate_fn ? rate_fn(points) : 0;
            const exdate = moment.tz((exdate_fn||refdate_fn)(points), options.tz);
            const ref = exdate_fn ? moment.tz(refdate_fn(points), options.tz) : moment(exdate).subtract(1,'days');
            let start = _.sortedIndex(data, {exdate: ref.format("Y-MM-DD")}, 'exdate');
            let end = _.sortedIndex(data, {exdate: exdate.format("Y-MM-DD")}, 'exdate');
            if (data[start] && data[start].exdate == ref.format("Y-MM-DD")) start++;
            if (data[end] && data[end].exdate == exdate.format("Y-MM-DD")) end++;
            if (start <= end) {
                return +data.slice(start, end).reduce((dividend, datum) => {
                    const days_to_dividend = datum.dividend ? -ref.diff(datum.exdate, 'days') : 0;
                    const value = Big(datum.dividend).times(Math.exp(-rate*days_to_dividend/365));
                    return dividend.add(value).div(datum.split||1);
                }, Big(0));
            } else {
                return +data.slice(end, start).reduceRight((dividend, datum) => {
                    const days_to_dividend = datum.dividend ? -ref.diff(datum.exdate, 'days') : 0;
                    const value = Big(datum.dividend).times(Math.exp(-rate*days_to_dividend/365));
                    return dividend.minus(value).times(datum.split||1);
                }, Big(0));
            }
        };
    }, {
        args: "symbol, market, [reference-date,] exdate [, risk-free-rate]",
        description: "Dividend value per share for shareholders who owned the stock on reference date until exdate"
    })
};

async function nextDividend(markets, ib, options) {
    if (options.offline) return;
    const market = markets[options.market] || {};
    await ib.open();
    const bar = await ib.reqMktData({
        localSymbol: options.symbol,
        secType: market.secType || options.security_type,
        exchange: market.exchange || 'SMART',
        currency: market.currency || options.currency
    }, ['ib_dividends']);
    logger.trace("adjustment-functions", options.symbol, bar);
    if ((bar||{}).ib_dividends) {
        const datum = _.object(
            ['past_dividends', 'expected_dividends', 'exdate', 'dividend'],
            bar.ib_dividends.split(',')
        );
        if (datum.exdate) {
            const exdate = moment.tz(datum.exdate, options.tz);
            if (!exdate.isValid())
                logger.error("Invalid date in ib_dividends", options.symbol, bar);
            else return {
                ...datum,
                exdate: exdate.format('Y-MM-DD')
            };
        }
    }
}
