// indicator-functions.js
/*
 *  Copyright (c) 2014-2018 James Leigh, Some Rights Reserved
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

module.exports = function(name, args) {
    if (name.indexOf('.') <= 0) return;
    const interval = name.substring(0, name.indexOf('.'));
    const lname = name.substring(name.indexOf('.')+1);
    if (!functions[lname]) return;
    const largs = args.map(fn => {
        try {
            return fn();
        } catch(e) {
            throw Error("The function " + lname + " can only be used with numbers (not fields)");
        }
    });
    const fn = functions[lname].apply(this, largs);
    const n = fn.warmUpLength +1;
    return _.extend(bars => {
        const data = bars.length > n ? bars.slice(bars.length - n) : bars;
        return fn(_.pluck(data, interval));
    }, {
        intervals: [interval],
        warmUpLength: fn.warmUpLength
    });
};

const functions = module.exports.functions = {
    /* Weighted On Blanance Volume */
    OBV(n) {
        return _.extend(bars => {
            if (n <= 0) return null;
            const numerator = adj(bars).reduce(function(p, bar, i, bars){
                if (i === 0) return Big(0);
                const prior = bars[i - 1];
                if (bar.close > prior.close)
                    return p.add(Big(i + 1).times(bar.volume || 1));
                if (bar.close < prior.close)
                    return p.minus(Big(i + 1).times(bar.volume || 1));
                return p;
            }, Big(0));
            return z(numerator.div(bars.length).div(bars.length - 1).times(2));
        }, {
            warmUpLength: n * 10
        });
    },
    /* Average True Range */
    ATR(n) {
        return _.extend(bars => {
            if (n <= 0) return null;
            const ranges = adj(bars).map(function(bar,i,bars) {
                const previous = bars[i-1];
                if (!+bar.high && !+bar.low) return 0;
                if (!previous || !+previous.close) return Big(bar.high).minus(bar.low);
                return Math.max(
                    Big(bar.high).minus(bar.low),
                    Big(bar.high).minus(previous.close),
                    Big(previous.close).minus(bar.low)
                );
            });
            const first = ranges.slice(0,n);
            return z(ranges.slice(n).reduce(function(atr, range){
                return (atr.times(n-1).add(range)).div(n);
            }, sum(first).div(first.length)));
        }, {
            warmUpLength: n + 250
        });
    },
    /* Parabolic SAR */
    PSAR(factor, limit, n) {
        if (!_.isNumber(factor) || factor <= 0)
            throw Error("Must be a positive number: " + factor);
        if (!_.isNumber(limit) || limit <= 0)
            throw Error("Must be a positive number: " + limit);
        return _.extend(bars => {
            const up = function(bar) {
                const a = +bar.high <= +this.ep ? this.af :
                    Math.min(Big(this.af).add(factor), limit);
                const ep = Math.max(this.ep, bar.high);
                const stop = Big(this.stop).add(Big(a).times(Big(ep).minus(this.stop)));
                return +bar.low >= +stop ? {
                    trend: up,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: down,
                    stop: Big(ep).minus(Big(factor).times(Big(ep).minus(bar.low))),
                    ep: bar.low,
                    af: factor
                };
            };
            const down = function(bar) {
                const a = +bar.low >= +this.ep ? this.af :
                    Math.min(Big(this.af).add(factor), limit);
                const ep = Math.min(bar.low, this.ep);
                const stop = Big(this.stop).minus(Big(a).times(Big(this.stop).minus(ep)));
                return +bar.high <= +stop ? {
                    trend: down,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: up,
                    stop: Big(ep).add(Big(factor).times(Big(bar.high).minus(ep))),
                    ep: bar.high,
                    af: factor
                };
            };
            return z(adj(bars).reduce(function(sar, bar) {
                return sar.trend(bar);
            }, {
                trend: down,
                stop: bars[0].high,
                ep: bars[0].low,
                af: factor
            }).stop);
        }, {
            warmUpLength: n -1
        });
    },
    /* Stop And Buy */
    SAB(factor, limit, n) {
        if (!_.isNumber(factor) || factor <= 0)
            throw Error("Must be a positive number: " + factor);
        if (!_.isNumber(limit) || limit <= 0)
            throw Error("Must be a positive number: " + limit);
        return _.extend(bars => {
            const down = function(bar) {
                const a = +bar.low >= +this.ep ? this.af :
                    Math.min(Big(this.af).add(factor), limit);
                const ep = Math.min(bar.low, this.ep);
                const stop = Big(this.stop).minus(Big(a).times(Big(this.stop).minus(ep)));
                return +bar.high <= +stop ? {
                    trend: down,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: down,
                    stop: Big(bar.high).minus(Big(factor).times(Big(bar.high).minus(bar.low))),
                    ep: bar.low,
                    af: factor
                };
            };
            return z(adj(bars).reduce(function(sar, bar) {
                return sar.trend(bar);
            }, {
                trend: down,
                stop: bars[0].high,
                ep: bars[0].low,
                af: factor
            }).stop);
        }, {
            warmUpLength: n -1
        });
    },
    /* Stop And Sell */
    SAS(factor, limit, n) {
        if (!_.isNumber(factor) || factor <= 0)
            throw Error("Must be a positive number: " + factor);
        if (!_.isNumber(limit) || limit <= 0)
            throw Error("Must be a positive number: " + limit);
        return _.extend(bars => {
            const up = function(bar) {
                const a = +bar.high <= +this.ep ? this.af :
                    Math.min(Big(this.af).add(factor), limit);
                const ep = Math.max(this.ep, bar.high);
                const stop = Big(this.stop).add(Big(a).times(Big(ep).minus(this.stop)));
                return +bar.low >= +stop ? {
                    trend: up,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: up,
                    stop: Big(bar.low).add(Big(factor).times(Big(bar.high).minus(bar.low))),
                    ep: bar.high,
                    af: factor
                };
            };
            return z(adj(bars).reduce(function(sar, bar) {
                return sar.trend(bar);
            }, {
                trend: up,
                stop: bars[0].low,
                ep: bars[0].high,
                af: factor
            }).stop);
        }, {
            warmUpLength: n -1
        });
    },
    /* Price of Percent of Volume */
    POPV: _.extend((n, p) => {
        return _.extend(bars => {
            const adj_bars = adj(bars);
            const prices = getPrices(adj_bars);
            if (p <= 0) return _.first(prices);
            if (!(p < 100)) return _.last(prices);
            const volume = getPriceVolume(adj_bars, prices);
            if (!volume.length) return null;
            const total_volume = volume.reduce((total_volume, volume) => {
                const pre = total_volume.length ? total_volume[total_volume.length-1] : 0;
                total_volume.push(pre + volume);
                return total_volume;
            }, []);
            const total = total_volume[total_volume.length-1];
            const target = +Big(p).times(total).div(100);
            const i = _.sortedIndex(total_volume, target);
            if (total_volume[i] <= target || i === 0) return prices[i];
            const delta_volume = Big(total_volume[i]).minus(total_volume[i-1]);
            const ratio = (Big(target).minus(total_volume[i-1])).div(delta_volume);
            return z(Big(prices[i-1]).add(Big(prices[i]).minus(prices[i-1]).times(ratio)));
        }, {
            warmUpLength: n -1
        });
    }, {
        description: "Estimated Price with the given Percent of Volume traded below it",
        args: "numberOfPeriods, percentOfVolumeBelowPrice"
    }),
    /* Percent of trade Volume below close Oscillator */
    POVO: _.extend((n, o) => {
        return _.extend(bars => {
            if (_.isEmpty(bars)) return null;
            const adj_bars = adj(bars);
            const target = _.last(adj_bars).close;
            const prices = getPrices(adj_bars);
            if (target <= _.first(prices)) return 0;
            if (target >= _.last(prices)) return 100;
            const inc_bars = o ? adj_bars.slice(0, adj_bars.length-o) : adj_bars;
            const volume = getPriceVolume(inc_bars, prices);
            if (!volume.length) return null;
            const below = volume.slice(0, _.sortedIndex(prices, target)+1);
            const total = volume.reduce((a, b) => a + b);
            if (!total) return null;
            return z(Big(below.reduce((a, b) => a + b)).times(100).div(total));
        }, {
            warmUpLength: (o || 0) + n -1
        });
    }, {
        description: "Percent of trade Volume below current bar close Oscillator",
        args: "numberOfPeriodsToInclude, [offsetNumberOfPeriods]"
    }),
    /* Rotation Factor */
    ROF(n) {
        return _.extend(bars => {
            const adj_bars = adj(bars);
            return z(adj_bars.reduce(function(factor, bar, i, adj_bars) {
                if (i < 1) return factor;
                else if (+adj_bars[i-1].low < +bar.low)
                    return factor.add(1);
                else return factor.minus(1);
            }, adj_bars.reduce(function(factor, bar, i, adj_bars) {
                if (i < 1) return factor;
                else if (+adj_bars[i-1].high < +bar.high)
                    return factor.add(1);
                else return factor.minus(1);
            }, Big(0))));
        }, {
            warmUpLength: n -1
        });
    }
};

/**
 * Adjust open/high/low/close to the last bar
 */
function adj(bars) {
    const last = _.last(bars);
    if (!last || !last.adj_close) return bars;
    const norm = +last.adj_close ? Big(last.close).div(last.adj_close || last.close) : 1;
    return bars.map(bar => {
        const scale = +bar.close ? Big(bar.adj_close || bar.close).div(bar.close).times(norm) : norm;
        if (Big(scale).minus(1).abs().lt(0.0000001)) return bar;
        else return _.defaults({
            open: +Big(bar.open||0).times(scale),
            high: +Big(bar.high||0).times(scale),
            low: +Big(bar.low||0).times(scale),
            close: +Big(bar.close||0).times(scale)
        }, bar);
    });
}

function getPrices(bars) {
    const prices = bars.reduce(function(prices, bar){
        return [
            +bar.high, +bar.low, +bar.open, +bar.close
        ].reduce(function(prices, price){
            if (!(price > 0)) return prices;
            const i = _.sortedIndex(prices, price);
            if (prices[i] != price) prices.splice(i, 0, price);
            return prices;
        }, prices);
    }, []);
    const crazy = prices[Math.floor(prices.length/2)] * 100;
    while (_.last(prices) > crazy) prices.pop(); // crazy high price
    return prices;
}

function reducePriceVolume(bars, prices, fn, memo) {
    return bars.reduce((memo, bar) => {
        const oc = _.sortBy([+bar.open || +bar.close, +bar.close]);
        const low = +bar.low || oc[0];
        const high = +bar.high || oc[1];
        const l = _.sortedIndex(prices, low);
        const h = _.sortedIndex(prices, high)
        const range = l == h ? 1 : high - low + oc[1] - oc[0];
        const unit = (+bar.volume || 1) / range;
        return prices.slice(l, h+1).reduce((memo, price, i, prices) => {
            // prices between open/close are counted twice
            const count = price > oc[0] && price <= oc[1] ? 2 : 1;
            const weight = i == 0 && price < high ? 0 : i == 0 ? 1 :
                (price - prices[i-1]) * count * unit;
            return fn(memo, price, weight);
        }, memo);
    }, memo);
}

function getPriceVolume(bars, prices) {
    return reducePriceVolume(bars, prices, (volume, price, weight) => {
        const i = _.sortedIndex(prices, price);
        volume[i] = volume[i] + weight;
        return volume;
    }, prices.map(_.constant(0)));
}

function sum(values) {
    return values.reduce(function(memo, value){
        return memo.add(value || 0);
    }, Big(0));
}

function asPositiveInteger(calc, msg) {
    try {
        const n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg);
}

function z(big) {
    if (!big) return big;
    else if (typeof big == 'number') return big;
    else if (!(big instanceof Big)) return big;
    else return +big; // non-zero number
}
