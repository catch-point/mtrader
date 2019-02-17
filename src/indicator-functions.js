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
            const numerator = adj(bars).reduce(function(p, bar, i, bars){
                if (i === 0) return 0;
                const prior = bars[i - 1];
                if (bar.close > prior.close)
                    return p + (i + 1) * (bar.volume || 1);
                if (bar.close < prior.close)
                    return p - (i + 1) * (bar.volume || 1);
                return p;
            }, 0);
            return numerator / (bars.length * (bars.length - 1)) * 2;
        }, {
            warmUpLength: n * 10
        });
    },
    /* Average True Range */
    ATR(n) {
        return _.extend(bars => {
            const ranges = adj(bars).map(function(bar,i,bars) {
                const previous = bars[i-1];
                if (!previous) return bar.high - bar.low;
                return Math.max(
                    bar.high - bar.low,
                    Math.abs(bar.high - previous.close),
                    Math.abs(bar.low - previous.close)
                );
            });
            const first = ranges.slice(0,n);
            return ranges.slice(n).reduce(function(atr, range){
                return (atr * (n-1) + range) / n;
            }, sum(first) / first.length);
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
                const a = bar.high <= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                const ep = Math.max(this.ep, bar.high);
                const stop = this.stop + a * (ep - this.stop);
                return (bar.low >= stop) ? {
                    trend: up,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: down,
                    stop: ep - factor * (ep - bar.low),
                    ep: bar.low,
                    af: factor
                };
            };
            const down = function(bar) {
                const a = bar.low >= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                const ep = Math.min(bar.low, this.ep);
                const stop = this.stop - a * (this.stop - ep);
                return (bar.high <= stop) ? {
                    trend: down,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: up,
                    stop: ep + factor * (bar.high -ep),
                    ep: bar.high,
                    af: factor
                };
            };
            return adj(bars).reduce(function(sar, bar) {
                return sar.trend(bar);
            }, {
                trend: down,
                stop: bars[0].high,
                ep: bars[0].low,
                af: factor
            }).stop;
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
                const a = bar.low >= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                const ep = Math.min(bar.low, this.ep);
                const stop = this.stop - a * (this.stop - ep);
                return (bar.high <= stop) ? {
                    trend: down,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: down,
                    stop: bar.high - factor * (bar.high - bar.low),
                    ep: bar.low,
                    af: factor
                };
            };
            return adj(bars).reduce(function(sar, bar) {
                return sar.trend(bar);
            }, {
                trend: down,
                stop: bars[0].high,
                ep: bars[0].low,
                af: factor
            }).stop;
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
                const a = bar.high <= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                const ep = Math.max(this.ep, bar.high);
                const stop = this.stop + a * (ep - this.stop);
                return (bar.low >= stop) ? {
                    trend: up,
                    stop: stop,
                    ep: ep,
                    af: a
                } : {
                    trend: up,
                    stop: bar.low + factor * (bar.high - bar.low),
                    ep: bar.high,
                    af: factor
                };
            };
            return adj(bars).reduce(function(sar, bar) {
                return sar.trend(bar);
            }, {
                trend: up,
                stop: bars[0].low,
                ep: bars[0].high,
                af: factor
            }).stop;
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
            const target = p * total /100;
            const i = _.sortedIndex(total_volume, target);
            if (total_volume[i] <= target) return prices[i];
            const ratio = (target - total_volume[i-1]) / (total_volume[i] - total_volume[i-1]);
            return prices[i-1] + (prices[i] - prices[i-1]) * ratio;
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
            return below.reduce((a, b) => a + b) *100 / total;
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
            return adj_bars.reduce(function(factor, bar, i, adj_bars) {
                if (i < 1) return factor;
                else if (adj_bars[i-1].low < bar.low)
                    return factor + 1;
                else return factor - 1;
            }, adj_bars.reduce(function(factor, bar, i, adj_bars) {
                if (i < 1) return factor;
                else if (adj_bars[i-1].high < bar.high)
                    return factor + 1;
                else return factor - 1;
            }, 0));
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
    if (!_.has(last, 'adj_close')) return bars;
    const norm = last.close / last.adj_close;
    return bars.map(bar => {
        const scale = bar.adj_close/bar.close * norm;
        if (Math.abs(scale -1) < 0.0000001) return bar;
        else return _.defaults({
            open: decimal(bar.open*scale),
            high: decimal(bar.high*scale),
            low: decimal(bar.low*scale),
            close: decimal(bar.close*scale)
        }, bar);
    });
}

function getPrices(bars) {
    const prices = bars.reduce(function(prices, bar){
        return [
            bar.high, bar.low, bar.open, bar.close
        ].reduce(function(prices, price){
            if (!(price > 0)) return prices;
            const i = _.sortedIndex(prices, price);
            if (prices[i] != price) prices.splice(i, 0, price);
            return prices;
        }, prices);
    }, []);
    const median = prices[Math.floor(prices.length/2)];
    while (_.last(prices) > median * 100) prices.pop();
    return prices;
}

function reducePriceVolume(bars, prices, fn, memo) {
    return bars.reduce((memo, bar) => {
        const oc = _.sortBy([bar.open || bar.close, bar.close]);
        const low = bar.low || oc[0];
        const high = bar.high || oc[1];
        const l = _.sortedIndex(prices, low);
        const h = _.sortedIndex(prices, high)
        const range = l == h ? 1 : high - low + oc[1] - oc[0];
        const unit = (bar.volume || 1) / range;
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

function decimal(float) {
    return Math.round(float * 100000) / 100000;
}

function sum(values) {
    return values.reduce(function(memo, value){
        return memo + (value || 0);
    }, 0);
}

function asPositiveInteger(calc, msg) {
    try {
        const n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg);
}
