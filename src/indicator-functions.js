// indicator-functions.js
/*
 *  Copyright (c) 2014-2017 James Leigh, Some Rights Reserved
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

const _ = require('underscore');
const moment = require('moment-timezone');

module.exports = function(name, args) {
    if (name.indexOf('.') <= 0) return;
    var interval = name.substring(0, name.indexOf('.'));
    var lname = name.substring(name.indexOf('.')+1);
    if (!functions[lname]) return;
    var largs = args.map(fn => {
        try {
            return fn();
        } catch(e) {
            throw Error("The function " + lname + " can only be used with numbers (not fields)");
        }
    });
    var fn = functions[lname].apply(this, largs);
    var n = fn.warmUpLength +1;
    return _.extend(bars => {
        var data = bars.length > n ? bars.slice(bars.length - n) : bars;
        return fn(_.pluck(data, interval));
    }, {
        intervals: [interval],
        warmUpLength: fn.warmUpLength
    });
};

var functions = module.exports.functions = {
    /* Weighted On Blanance Volume */
    OBV(n) {
        return _.extend(bars => {
            var numerator = adj(bars).reduce(function(p, bar, i, bars){
                if (i === 0) return 0;
                var prior = bars[i - 1];
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
            var ranges = adj(bars).map(function(bar,i,bars) {
                var previous = bars[i-1];
                if (!previous) return bar.high - bar.low;
                return Math.max(
                    bar.high - bar.low,
                    Math.abs(bar.high - previous.close),
                    Math.abs(bar.low - previous.close)
                );
            });
            var first = ranges.slice(0,n);
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
            var up = function(bar) {
                var a = bar.high <= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                var ep = Math.max(this.ep, bar.high);
                var stop = this.stop + a * (ep - this.stop);
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
            var down = function(bar) {
                var a = bar.low >= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                var ep = Math.min(bar.low, this.ep);
                var stop = this.stop - a * (this.stop - ep);
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
            var down = function(bar) {
                var a = bar.low >= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                var ep = Math.min(bar.low, this.ep);
                var stop = this.stop - a * (this.stop - ep);
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
            var up = function(bar) {
                var a = bar.high <= this.ep ? this.af :
                    Math.min(this.af + factor, limit);
                var ep = Math.max(this.ep, bar.high);
                var stop = this.stop + a * (ep - this.stop);
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
    POPV(n, p) {
        return _.extend(bars => {
            var adj_bars = adj(bars);
            var prices = getPrices(adj_bars);
            if (p <= 0) return _.first(prices);
            if (!(p < 100)) return _.last(prices);
            var volume = getPriceVolume(adj_bars, prices);
            var total = volume.reduce((a, b) => a + b);
            var target = p * total /100;
            var below = 0;
            for (var i=0; below + volume[i] < target; i++) {
                below += volume[i];
            }
            return prices[target - below < volume[i] /2 ? i -1 : i];
        }, {
            warmUpLength: n -1
        });
    },
    /* Percent of trade Volume below close Oscillator */
    POVO(n) {
        return _.extend(bars => {
            if (_.isEmpty(bars)) return;
            var adj_bars = adj(bars);
            var target = _.last(adj_bars).close;
            var prices = getPrices(adj_bars);
            if (target <= _.first(prices)) return 0;
            if (target >= _.last(prices)) return 100;
            var volume = getPriceVolume(adj_bars, prices);
            var below = volume.slice(0, _.sortedIndex(prices, target)+1);
            var total = volume.reduce((a, b) => a + b);
            return below.reduce((a, b) => a + b) *100 / total;
        }, {
            warmUpLength: n -1
        });
    },
    /* Rotation Factor */
    ROF(n) {
        return _.extend(bars => {
            var adj_bars = adj(bars);
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
    var last = _.last(bars);
    if (!_.has(last, 'adj_close')) return bars;
    var norm = last.close / last.adj_close;
    return bars.map(bar => {
        var scale = bar.adj_close/bar.close * norm;
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
    var prices = bars.reduce(function(prices, bar){
        return [
            bar.high, bar.low, bar.open, bar.close
        ].reduce(function(prices, price){
            if (!(price > 0)) return prices;
            var i = _.sortedIndex(prices, price);
            if (prices[i] != price) prices.splice(i, 0, price);
            return prices;
        }, prices);
    }, new Array(bars.length * 4));
    var median = prices[Math.floor(prices.length/2)];
    while (_.last(prices) > median * 100) prices.pop();
    return prices;
}

function reducePriceVolume(bars, prices, fn, memo) {
    return bars.reduce((memo, bar) => {
        var oc = _.sortBy([bar.open || bar.close, bar.close]);
        var low = bar.low || oc[0];
        var high = bar.high || oc[1];
        var l = _.sortedIndex(prices, low);
        var h = _.sortedIndex(prices, high)
        var range = l == h ? 1 : high - low + oc[1] - oc[0];
        var unit = (bar.volume || 1) / range;
        return prices.slice(l, h+1).reduce((memo, price, i, prices) => {
            // prices between open/close are counted twice
            var count = price > oc[0] && price <= oc[1] ? 2 : 1;
            var weight = i == 0 && price < high ? 0 : i == 0 ? 1 :
                (price - prices[i-1]) * count * unit;
            return fn(memo, price, weight);
        }, memo);
    }, memo);
}

function getPriceVolume(bars, prices) {
    return reducePriceVolume(bars, prices, (volume, price, weight) => {
        var i = _.sortedIndex(prices, price);
        volume[i] = (volume[i] || 0) + weight;
        return volume;
    }, new Array(prices.length));
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
        var n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg);
}
