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
                    return p + (i + 1) * bar.volume;
                if (bar.close < prior.close)
                    return p - (i + 1) * bar.volume;
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
            var volume = reducePriceVolumeWeight(adj_bars, prices, function(volume, price, weight){
                var i = _.sortedIndex(prices, price);
                volume[i] = weight + (volume[i] || 0);
                return volume;
            }, new Array(prices.length));
            var total = sum(volume);
            var below = 0;
            for (var i=0; i<volume.length && below * 100 / total < p; i++) {
                below += volume[i];
            }
            return prices[i-1];
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
            if (target > _.last(prices)) return 100;
            var total = 0;
            var below = reducePriceVolumeWeight(adj_bars, prices, function(below, price, weight){
                total += weight;
                if (price < target) return below + weight;
                else return below;
            }, 0);
            return below *100 / total;
        }, {
            warmUpLength: n -1
        });
    },
    /* Time Price Opportunity Count percentage */
    TPOC(n) {
        return _.extend(bars => {
            var adj_bars = adj(bars);
            var tpos = getTPOCount(adj_bars);
            var target = _.last(adj_bars).close;
            var bottom = 0, top = tpos.length-1;
            while (tpos[bottom].count <= 1 && bottom < top) bottom++;
            while (tpos[top].count <= 1 && top > bottom) top--;
            if (bottom >= top) {
                bottom = 0;
                top = tpos.length-1;
            }
            var step = 0.01;
            var above = _.range(target+step, tpos[top].price+step, step).reduce(function(above, price){
                return above + tpoCount(tpos, decimal(price));
            }, 0);
            var below = _.range(target-step, tpos[bottom].price-step, -step).reduce(function(below, price){
                return below + tpoCount(tpos, decimal(price));
            }, 0);
            var value = tpoCount(tpos, target);
            var total = value + above + below;
            return (value + below) / total * 100;
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
    },
    /* Point Of Control */
    POC(n) {
        return _.extend(bars => {
            return getPointOfControl(getTPOCount(adj(bars)));
        }, {
            warmUpLength: n -1
        });
    }
};

function getPrices(bars) {
    return bars.reduce(function(prices, bar){
        return [
            bar.high, bar.low, bar.open, bar.close
        ].reduce(function(prices, price){
            var i = _.sortedIndex(prices, price);
            if (prices[i] != price) prices.splice(i, 0, price);
            return prices;
        }, prices);
    }, []);
}

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
            open: bar.open*scale,
            high: bar.high*scale,
            low: bar.low*scale,
            close: bar.close*scale
        }, bar);
    });
}

function reducePriceVolumeWeight(bars, prices, fn, memo) {
    var total = Math.max(sum(_.pluck(bars, 'volume')), 1);
    return bars.reduce(function(memo, bar){
        var low = _.sortedIndex(prices, bar.low);
        var high = _.sortedIndex(prices, bar.high);
        var range = prices.slice(low, high+1);
        var r = bar.volume / range.length / total;
        return range.reduce(function(memo, price){
            return fn(memo, price, r);
        }, memo);
    }, memo);
}

function tpoCount(tpos, price) {
    var i = _.sortedIndex(tpos, {price: price}, 'price');
    if (i == tpos.length) return 0;
    var tpo = tpos[i];
    return tpo.price == price ? tpo.count : tpo.lower;
}

function getPointOfControl(tpos) {
    var most = _.max(tpos, 'count').count;
    var min = tpos.length-1;
    var max = 0;
    tpos.forEach(function(w, i){
        if (w.count == most) {
            if (i < min) {
                min = i;
            }
            if (i > max) {
                max = i;
            }
        }
    });
    if (min == max) return tpos[min].price;
    var target = decimal((tpos[min].price + tpos[max].price) / 2);
    var poc = _.range(min+1, max+1).reduce(function(price, i) {
        if (Math.abs(tpos[i].price - target) < Math.abs(price - target))
            return tpos[i].price;
        return price;
    }, tpos[min].price);
    return Math.round(poc * 100) / 100;
}

function getTPOCount(bars) {
    var prices = bars.reduce(function(prices, bar){
        var l = _.sortedIndex(prices, bar.low);
        if (bar.low != prices[l]) prices.splice(l, 0, bar.low);
        var h = _.sortedIndex(prices, bar.high);
        if (bar.high != prices[h]) prices.splice(h, 0, bar.high);
        return prices;
    }, []);
    var tpos = bars.reduce(function(tpos, bar){
        var low = _.sortedIndex(prices, bar.low);
        var high = _.sortedIndex(prices, bar.high);
        for (var i=low; i<=high && i<tpos.length; i++) {
            tpos[i].count++;
            if (i>low) tpos[i].lower++;
        }
        return tpos;
    }, prices.map(function(price){
        return {price: price, count: 0, lower: 0};
    }));
    var median = prices[Math.floor(prices.length/2)];
    var bottom = 0, top = tpos.length-1;
    while (tpos[bottom].price < 0) bottom++;
    while (tpos[top].price > median * 100) top--;
    if (tpos[bottom]) tpos[bottom].lower = 0;
    if (bottom >= top) return tpos;
    else return tpos.slice(bottom, top+1);
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
