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
const IB = require('./ib-gateway.js');
const expect = require('chai').expect;

/**
 * These functions operate of an array of securities at the corresponding points in time.
 */
module.exports = function(settings) {
    const ib = settings.ib ? new IB(settings.ib) : null;
    const pvd = ib ? cache(
        presentValueOfDividends.bind(this, ib),
        options => JSON.stringify(_.pick(options, 'symbol', 'market', 'now', 'offline')),
        10
    ) : () => 0;
    const adjustments = cache(
        new Adjustments(),
        options => JSON.stringify(_.pick(options, 'symbol', 'market', 'begin', 'end', 'tz', 'now', 'offline')),
        10
    );
    return Object.assign(function(expr, name, args, options) {
        if (functions[name]) {
            return functions[name].apply(this, [pvd, adjustments, options].concat(args));
        }
    }, {
        close() {
            return Promise.all([
                adjustments.close(),
                ib.close()
            ]);
        }
    });
};

module.exports.has = function(name) {
    return !!functions[name];
};

const functions = module.exports.functions = {
    SPLIT: _.extend(async(pvd, adjustments, options, symbol_fn, market_fn, refdate_fn, exdate_fn, opt_mkt_fn) => {
        const [symbol, market] = [symbol_fn(), market_fn()];
        const data = await adjustments({...options, symbol, market});
        const expiry = opt_mkt_fn ? parseExpiry(exdate_fn(), options) : null;
        return points => {
            const exdate = expiry || moment.tz((exdate_fn||refdate_fn)(points), options.tz);
            const ref = exdate_fn ? moment.tz(refdate_fn(points), options.tz) : moment(exdate).subtract(1,'days');
            let start = _.sortedIndex(data, {exdate: ref.format("Y-MM-DD")}, 'exdate');
            let end = _.sortedIndex(data, {exdate: exdate.format("Y-MM-DD")}, 'exdate');
            if (data[start] && data[start].exdate == ref.format("Y-MM-DD")) start++;
            if (data[end] && data[end].exdate == exdate.format("Y-MM-DD")) end++;
            if (start <= end) {
                return +data.slice(start, end).reduce((split, datum) => split.times(datum.split), Big(1));
            } else {
                return +data.slice(end, start).reduce((split, datum) => split.div(datum.split), Big(1));
            }
        };
    }, {
        args: "symbol, market, [reference-date,] (exdate | option_symbol, option_market)",
        description: "Ratio of shares on reference date for every share on exdate (X-to-1 split)"
    }),
    DIVIDEND: _.extend(async(pvd, adjustments, options, symbol_fn, market_fn, refdate_fn, rate_fn, exdate_fn, opt_mkt_fn) => {
        const [symbol, market] = [symbol_fn(), market_fn()];
        const data = await adjustments({...options, symbol, market});
        const expiry = opt_mkt_fn ? parseExpiry(exdate_fn(), options) : null;
        let pvDividend = expiry && !expiry.isBefore(options.now) ?
            pvd({...options, symbol: exdate_fn()}) : 0;
        return points => {
            const rate = rate_fn ? rate_fn(points) : 0;
            const exdate = expiry || moment.tz((exdate_fn||refdate_fn)(points), options.tz);
            const ref = exdate_fn ? moment.tz(refdate_fn(points), options.tz) : moment(exdate).subtract(1,'days');
            let start = _.sortedIndex(data, {exdate: ref.format("Y-MM-DD")}, 'exdate');
            let end = _.sortedIndex(data, {exdate: exdate.format("Y-MM-DD")}, 'exdate');
            if (data[start] && data[start].exdate == ref.format("Y-MM-DD")) start++;
            if (data[end] && data[end].exdate == exdate.format("Y-MM-DD")) end++;
            if (start <= end) {
                return +data.slice(start, end).reduce((dividend, datum) => {
                    const days_to_dividend = datum.dividend ? -ref.diff(datum.exdate, 'days') : 0;
                    const value = Big(datum.dividend).times(Math.exp(-rate*days_to_dividend/365));
                    return dividend.add(value).div(datum.split);
                }, Big(0)).add(pvDividend);
            } else {
                return +data.slice(end, start).reduceRight((dividend, datum) => {
                    const days_to_dividend = datum.dividend ? -ref.diff(datum.exdate, 'days') : 0;
                    const value = Big(datum.dividend).times(Math.exp(-rate*days_to_dividend/365));
                    return dividend.minus(value).times(datum.split);
                }, Big(0)).minus(pvDividend);
            }
        };
    }, {
        args: "symbol, market, [reference-date, risk-free-rate,] (exdate | option_symbol, option_market)",
        description: "Dividend value per share for shareholders who owned the stock on reference date until exdate"
    })
};

async function presentValueOfDividends(ib, options) {
    if (options.offline) return 0;
    await ib.open();
    const bar = await ib.reqMktData({
        localSymbol: options.symbol,
        secType: options.security_type,
        exchange: 'SMART',
        currency: options.currency
    });
    if (((bar||{}).model_option||{}).pvDividend) {
        return bar.mode_option.pvDividend;
    } else {
        return 0;
    }
}

function parseExpiry(symbol, options) {
    if (symbol.length != 21) return null;
    expect(symbol).to.be.like(/^(\w(?:\w| )*)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
    const underlying = symbol.substring(0, 6);
    const year = symbol.substring(6, 8);
    const month = symbol.substring(8, 10);
    const day = symbol.substring(10, 12);
    return moment.tz(`20${year}-${month}-${day}`, options.tz);
}
