// quoting-functions.js
/*
 *  Copyright (c) 2017-2018 James Leigh, Some Rights Reserved
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
const statkit = require("statkit");
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const expect = require('chai').expect;

/**
 * These functions operate of an array of securities at the same point in time.
 */
module.exports = function(fetch, quote, dataset, options) {
    const cache_keys = ['interval', 'symbol', 'market', 'begin', 'end'];
    const assets = extractAssets(dataset || [], options);
    return _.memoize(function(expr, name, args, options) {
        const fetch_cached = _.memoize(fetch, options => JSON.stringify(_.pick(options, cache_keys)));
        if (dataset.length) {
            expect(options).to.have.property('indexCol').that.is.a('string');
            expect(options).to.have.property('symbolCol').that.is.a('string');
            expect(options).to.have.property('marketCol').that.is.a('string');
            expect(options).to.have.property('temporalCol').that.is.a('string');
        }
        if (functions[name]) {
            return functions[name].apply(this, [fetch_cached, quote, assets, options, expr].concat(args));
        }
    });
};

module.exports.has = function(name) {
    return !!functions[name];
};

const functions = module.exports.functions = {
    MAXCORREL: Object.assign(async(fetch, quote, assets, options, expr, duration, expression, criteria) => {
        const n = asPositiveInteger(duration, "MAXCORREL");
        const arg = (await new Parser({
            constant(value) {
                return [value];
            },
            variable(name) {
                return [name];
            },
            expression(expr, name, args) {
                return [expr].concat(args.map(_.first));
            }
        }).parse(expr))[2];
        if (!arg) throw Error("Unrecongized call to MAXCORREL: " + expr);
        if (_.size(assets) < 2) return positions => 0;
        const condition = await parseCriteria(arg, criteria, options);
        const optionset = assets.map(asset => {
            return _.defaults({
                index: asset.index,
                symbol: asset.symbol,
                market: asset.market,
                variables: {},
                columns: {
                    [options.temporalCol]: 'DATETIME(ending)',
                    [arg]: arg
                },
                pad_begin: n,
                begin: asset.begin,
                end: asset.end,
                pad_end: 0,
                criteria: null
            }, options);
        });
        const qdataset = (await Promise.all(optionset.map(options => quote(options))))
          .reduce((hash, data, i) => {
            hash[optionset[i].index] = data;
            return hash;
        }, {});
        return historic => {
            const positions = _.last(historic);
            if (_.size(positions) < 2) return 0;
            const matrix = _.keys(_.pick(positions, _.isObject)).map((symbol, i, keys) => {
                if (i < keys.length -1 && !condition(positions[symbol])) return null;
                const data = qdataset[symbol];
                if (!data) throw Error(`Could not find dataset ${symbol} in ${Object.keys(qdataset).join(', ')}`);
                let end = _.sortedIndex(data, positions, options.temporalCol);
                if (data[end] && data[end][options.temporalCol] == positions[options.temporalCol]) end++;
                return _.pluck(data.slice(Math.max(end - n, 0), end), arg);
            });
            const last = matrix.pop();
            const correlations = _.compact(matrix).map(m => {
                return statkit.corr(m, last);
            });
            if (!correlations.length) return 0;
            const ret = _.max(correlations);
            if (isFinite(ret)) return ret;
            else return null;
        };
    }, {
        args: "duration, expression, [criteria]",
        description: "Maximum correlation coefficient among other securities"
    }),
    SPLIT: _.extend(async(fetch, quote, assets, options, expr, symbol_fn, market_fn, refdate_fn, exdate_fn) => {
        const tz = options.tz || (moment.defaultZone||{}).name || moment.tz.guess();
        const all_assets = assets.length ? assets : [{
            symbol: symbol_fn(),
            market: market_fn(),
            begin: options.begin || refdate_fn()
        }];
        const unique_assets = Object.values(all_assets.reduce((unique_assets, asset) => {
            const key = `${asset.symbol}.${asset.market}`;
            const entry = unique_assets[key] = unique_assets[key] || {...asset};
            if (asset.begin < entry.begin) entry.begin = asset.begin;
            if (entry.end < asset.end) entry.end = asset.end;
            return unique_assets;
        }, {}));
        const optionset = unique_assets.map(asset => ({
            ...options, ...asset, interval: 'adjustments', tz,
            end: options.now
        }));
        const adjustments = (await Promise.all(optionset.map(options => fetch(options))))
          .reduce((hash, data, i) => {
            hash[`${optionset[i].symbol}.${optionset[i].market}`] = data;
            return hash;
        }, {});
        return points => {
            const [symbol, market] = [symbol_fn(points), market_fn(points)];
            const data = adjustments[`${symbol}.${market}`] || [];
            const exdate = moment.tz((exdate_fn||refdate_fn)(points), options.tz);
            const ref = exdate_fn ? moment.tz(refdate_fn(points), options.tz) : moment(exdate).subtract(1,'days');
            let start = _.sortedIndex(data, {exdate: ref.format("Y-MM-DD")}, 'exdate');
            let stop = _.sortedIndex(data, {exdate: exdate.format("Y-MM-DD")}, 'exdate');
            if (data[start] && data[start].exdate == ref.format("Y-MM-DD")) start++;
            if (data[stop] && data[stop].exdate == exdate.format("Y-MM-DD")) stop++;
            if (start <= stop) {
                return +data.slice(start, stop).reduce((split, datum) => split.times(datum.split||1), Big(1));
            } else {
                return +data.slice(stop, start).reduce((split, datum) => split.div(datum.split||1), Big(1));
            }
        };
    }, {
        args: "symbol, market, [reference-date,] exdate",
        description: "Ratio of shares on reference date for every share on exdate (X-to-1 split)"
    }),
    DIVIDEND: _.extend(async(fetch, quote, assets, options, expr, symbol_fn, market_fn, refdate_fn, exdate_fn, rate_fn) => {
        const tz = options.tz || (moment.defaultZone||{}).name || moment.tz.guess();
        const all_assets = assets.length ? assets : [{
            symbol: symbol_fn(),
            market: market_fn(),
            begin: options.begin || refdate_fn()
        }];
        const unique_assets = Object.values(all_assets.reduce((unique_assets, asset) => {
            const key = `${asset.symbol}.${asset.market}`;
            const entry = unique_assets[key] = unique_assets[key] || {...asset};
            if (asset.begin < entry.begin) entry.begin = asset.begin;
            if (entry.end < asset.end) entry.end = asset.end;
            return unique_assets;
        }, {}));
        const optionset = unique_assets.map(asset => ({
            ...options, ...asset, interval: 'adjustments', tz,
            end: moment.tz(options.now, options.tz).add(40, 'months').startOf('year').add(1,'years').format('Y-MM-DD')
        }));
        const adjustments = (await Promise.all(optionset.map(options => fetch(options))))
          .reduce((hash, data, i) => {
            hash[`${optionset[i].symbol}.${optionset[i].market}`] = data;
            return hash;
        }, {});
        return points => {
            const [symbol, market] = [symbol_fn(points), market_fn(points)];
            const data = adjustments[`${symbol}.${market}`] || [];
            const rate = rate_fn ? rate_fn(points) : 0;
            const exdate = moment.tz((exdate_fn||refdate_fn)(points), options.tz);
            const ref = exdate_fn ? moment.tz(refdate_fn(points), options.tz) : moment(exdate).subtract(1,'days');
            let start = _.sortedIndex(data, {exdate: ref.format("Y-MM-DD")}, 'exdate');
            let stop = _.sortedIndex(data, {exdate: exdate.format("Y-MM-DD")}, 'exdate');
            if (data[start] && data[start].exdate == ref.format("Y-MM-DD")) start++;
            if (data[stop] && data[stop].exdate == exdate.format("Y-MM-DD")) stop++;
            if (start <= stop) {
                return +data.slice(start, stop).reduce((dividend, datum) => {
                    const days_to_dividend = datum.dividend ? -ref.diff(datum.exdate, 'days') : 0;
                    const value = Big(datum.dividend).times(Math.exp(-rate*days_to_dividend/365));
                    return dividend.add(value).div(datum.split||1);
                }, Big(0));
            } else {
                return +data.slice(stop, start).reduceRight((dividend, datum) => {
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

function extractAssets(dataset, options) {
    return Object.values(dataset.reduce((indexed, data) => data.reduce((indexed, datum) => {
        const entry = indexed[datum[options.indexCol]];
        indexed[datum[options.indexCol]] = {
            ...datum,
            begin: entry ? entry.begin : datum[options.temporalCol],
            end: datum[options.temporalCol]
        };
        return indexed;
    }, indexed), {})).map(entry => ({
        index: entry[options.indexCol],
        symbol: entry[options.symbolCol],
        market: entry[options.marketCol],
        begin: entry.begin,
        end: entry.end
    }));
}

function asPositiveInteger(calc, msg) {
    try {
        const n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg + " not " + n);
}

async function parseCriteria(columnName, criteria, options) {
    if (!criteria)
        return _.constant(true);
    if (_.isFunction(criteria))
        return parseCriteria(columnName, criteria(), options);
    if (!_.isString(criteria))
        return parseCriteria(columnName, criteria.toString(), options);
    if (_.contains(['<', '>', '=', '!'], criteria.charAt(0)))
        return parseCriteria(columnName, columnName + criteria, options);
    try {
        let expression = false;
        const parsed = await new Parser({
            constant(value) {
                return _.constant(value);
            },
            variable(name) {
                return context => _.has(context, name) ? context[name] : options[name];
            },
            expression(expr, name, args) {
                expression = true;
                return common(name, args, options);
            }
        }).parse(criteria);
        if (expression) return parsed;
    } catch(e) {} // not an expression, must be a value
    return context => context[columnName] == criteria;
}
