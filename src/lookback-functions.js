// lookback-functions.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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
const statkit = require("statkit");
const periods = require('./periods.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(name, args, options) {
    expect(options).to.be.like({
        open_time: /\d\d:\d\d(:00)?/,
        liquid_hours: /\d\d:\d\d(:00)? - \d\d:\d\d(:00)?/,
        trading_hours: /\d\d:\d\d(:00)? - \d\d:\d\d(:00)?/,
        security_tz: tz => moment.tz.zone(tz),
        tz: tz => moment.tz.zone(tz)
    });
    if (!functions[name]) return;
    const intervals = periods.sort(_.uniq(_.flatten(_.compact(_.pluck(args, 'intervals')), true)));
    if (intervals.length > 1)
        throw Error("The function " + name + " can only be used with a single interval, not " + intervals.join(' and '));
    if (intervals.length < 1)
        throw Error("The function " + name + " must be used with fields");
    const interval = intervals.length == 1 ? _.first(intervals) : undefined;
    const wargs = args.map(fn => {
        if (_.has(fn, 'warmUpLength')) return fn;
        else return _.extend(fn, {warmUpLength: 0});
    });
    const fn = functions[name].apply(this, [_.defaults({
        interval: interval
    }, options)].concat(wargs));
    const len = _.max([fn.warmUpLength].concat(_.pluck(wargs, 'warmUpLength')));
    const n = len +1;
    return _.extend(bars => {
        if (bars.length <= n) return fn(bars);
        else return fn(bars.slice(bars.length - n));
    }, {
        intervals: intervals,
        warmUpLength: len,
        sideEffect: fn.sideEffect || _.some(args, arg => arg.sideEffect)
    });
};

module.exports.has = function(name) {
    return !!functions[name];
};

const functions = module.exports.functions = {
    /* Offset value N periods ago */
    OFFSET(opts, n_periods, calc) {
        const n = asPositiveInteger(n_periods, "OFFSET");
        return _.extend(bars => {
            return calc(bars.slice(0, bars.length - n));
        }, {
            warmUpLength: n + calc.warmUpLength
        });
    },
    /* Highest historic Maximum */
    HIGHEST(opts, n_periods, calc) {
        const n = asPositiveInteger(n_periods, "HIGHEST");
        return _.extend(bars => {
            const maximum = _.max(getValues(n, calc, bars));
            if (_.isFinite(maximum)) return maximum;
            else return undefined;
        }, {
            warmUpLength: n + calc.warmUpLength - 1
        });
    },
    /* Lowest historic Minimum */
    LOWEST(opts, num, calc) {
        const n = asPositiveInteger(num, "LOWEST");
        return _.extend(bars => {
            const minimum = _.min(getValues(n, calc, bars));
            if (_.isFinite(minimum)) return minimum;
            else return undefined;
        }, {
            warmUpLength: n + calc.warmUpLength - 1
        });
    },
    DIRECTION: _.extend((opts, n_periods, calc) => {
        const n = asPositiveInteger(n_periods, "DIRECTION");
        return _.extend(bars => {
            const values = getValues(n, calc, bars);
            const currently = _.last(values);
            for (let i=values.length -2; i>=0; i--) {
                if (values[i] < currently) return 1;
                else if (values[i] > currently) return -1;
            }
            return 0;
        }, {
            warmUpLength: n + calc.warmUpLength
        });
    }, {
        description: "If the prior different value was higher then the current value then return 1, if the prior different value was lower then the current value then return -1, if all prior values within numberOfPeriods was the same then return 0.",
        args: "numberOfPeriods, expression"
    }),
    /* Age Of High */
    AOH(opts, num, high) {
        const n = asPositiveInteger(num, "AOH");
        return _.extend(bars => {
            const highs = getValues(n, high, bars);
            const highest = _.max(highs);
            return bars.length - highs.indexOf(highest) -1;
        }, {
            warmUpLength: n -1
        });
    },
    /* Simple Moveing Average */
    SMA(opts, num, calc) {
        const n = asPositiveInteger(num, "SMA");
        return _.extend(bars => {
            const values = getValues(n, calc, bars);
            return sum(values) / values.length;
        }, {
            warmUpLength: n + calc.warmUpLength -1
        });
    },
    /* Exponential Moveing Average */
    EMA(opts, num, calc) {
        const n = asPositiveInteger(num, "EMA");
        return _.extend(bars => {
            const values = getValues(n * 10, calc, bars);
            if (n == 1) return _.last(values);
            const a = 2 / (n + 1);
            const firstN = values.slice(0, n);
            const sma = _.reduce(firstN, function(memo, value, index){
                return memo + value;
            }, 0) / firstN.length;
            return _.reduce(values.slice(n), function(memo, value, index){
                return a * value + (1 - a) * memo;
            }, sma);
        }, {
            warmUpLength: n > 1 ? n * 10 + calc.warmUpLength - 1 : calc.warmUpLength
        });
    },
    PF(opts, num, calc) {
        const n = asPositiveInteger(num, "PF");
        return _.extend(bars => {
            const prices = getValues(n+1, calc, bars);
            const changes = prices.map((price, i, prices) => {
                if (i === 0) return 0;
                const prior = prices[i-1];
                return price - prior;
            });
            let profit = 0;
            let loss = 0;
            changes.forEach(change => {
                if (change > 0) {
                    profit += change;
                } else {
                    loss += change;
                }
            });
            if (!loss) return null;
            else return profit / -loss;
        }, {
            warmUpLength: n + calc.warmUpLength
        });
    },
    LRS: _.extend((opts, n, expression) => {
        const len = asPositiveInteger(n, "LRS");
        return _.extend(bars => {
            const values = getValues(len, expression, bars);
            const n = values.length;
            const sx = values.reduce((s, y, x) => s + x, 0);
            const sy = values.reduce((s, y, x) => s + y, 0);
            const sxx = values.reduce((s, y, x) => s + x * x, 0);
            const sxy = values.reduce((s, y, x) => s + x * y, 0);
            const det = sxx*n - sx*sx;
            const a = (sxy*n - sy*sx)/det;
            const sma = sy/n;
            return a*100/sma;
        }, {
            warmUpLength: len * 10 + expression.warmUpLength - 1
        });
    }, {
        description: "Linear Regression Slope as a percentage"
    }),
    R2: _.extend((opts, n, expression) => {
        const len = asPositiveInteger(n, "R2");
        return _.extend(bars => {
            const values = getValues(len, expression, bars);
            const n = values.length;
            const sx = values.reduce((s, y, x) => s + x, 0);
            const sy = values.reduce((s, y, x) => s + y, 0);
            const sxx = values.reduce((s, y, x) => s + x * x, 0);
            const sxy = values.reduce((s, y, x) => s + x * y, 0);
            const det = sxx*n - sx*sx;
            const a = (sxy*n - sy*sx)/det;
            const b = (sy*sxx - sx*sxy)/det;
            const sma = sy/n;
            const see = values.reduce((s, y, x) => s + Math.pow(a*x+b - y, 2), 0);
            const smm = values.reduce((s, y, x) => s + Math.pow(sma - y, 2), 0);
            return 100 - see*100/smm;
        }, {
            warmUpLength: len * 10 + expression.warmUpLength - 1
        });
    }, {
        description: "R-squared as a percentage"
    }),
    /* Standard Deviation */
    STDEV(opts, num, calc) {
        const n = asPositiveInteger(num, "STDEV");
        return _.extend(bars => {
            const prices = getValues(n, calc, bars);
            const avg = sum(prices) / prices.length;
            const sd = Math.sqrt(sum(prices.map(function(num){
                const diff = num - avg;
                return diff * diff;
            })) / Math.max(prices.length,1));
            return sd || 1;
        }, {
            warmUpLength: n - 1 + calc.warmUpLength
        });
    },
    /* Relative Strength Index */
    RSI(opts, num, calc) {
        const n = asPositiveInteger(num, "RSI");
        return _.extend(bars => {
            const values = getValues(n +250, calc, bars);
            const gains = values.map(function(value, i, values){
                const change = value - values[i-1];
                if (change > 0) return change;
                return 0;
            }).slice(1);
            const losses = values.map(function(value, i, values){
                const change = value - values[i-1];
                if (change < 0) return change;
                return 0;
            }).slice(1);
            const firstGains = gains.slice(0, n);
            const firstLosses = losses.slice(0, n);
            const gain = gains.slice(n).reduce(function(smoothed, gain){
                return (smoothed * (n-1) + gain) / n;
            }, sum(firstGains) / firstGains.length);
            const loss = losses.slice(n).reduce(function(smoothed, loss){
                return (smoothed * (n-1) + loss) / n;
            }, sum(firstLosses) / firstLosses.length);
            if (loss === 0) return 100;
            return 100 - (100 / (1 - (gain / loss)));
        }, {
            warmUpLength: n +250 + calc.warmUpLength
        });
    },
    /* Prior value N days ago */
    PRIOR: _.extend((opts, days, field) => {
        const d = asPositiveInteger(days, "PRIOR");
        const dayLength = getDayLength(opts);
        const n = Math.ceil((d + 1) * dayLength);
        return _.extend(bars => {
            const day = periods(_.defaults({interval:'day'}, opts));
            const ending = day.dec(_.last(bars).ending, d);
            if (!ending.isValid()) return null;
            const end_time = opts.liquid_hours.substring(opts.liquid_hours.indexOf(' - ') + 3);
            const date = moment(ending).tz(opts.security_tz).format('YYYY-MM-DD');
            const prior = moment.tz(`${date}T${end_time}`, opts.security_tz).tz(opts.tz).format(opts.ending_format);
            let end = _.sortedIndex(bars, {ending: prior}, 'ending');
            if (bars[end] && bars[end].ending == prior) end++;
            const start = Math.max(end - field.warmUpLength -1, 0);
            return field(bars.slice(start, end));
        }, {
            fields: ['ending'],
            warmUpLength: n + field.warmUpLength
        });
    }, {
        description: "Include only data upto N days ago (As of N days ago)"
    }),
    /* Since N days ago */
    SINCE: _.extend((opts, days, calc) => {
        const d = asPositiveInteger(days, "SINCE");
        const dayLength = getDayLength(opts);
        const n = Math.ceil((d + 1) * dayLength);
        return _.extend(bars => {
            if (_.isEmpty(bars)) return calc(bars);
            const ending = moment.tz(_.last(bars).ending, opts.tz);
            const day = periods(_.defaults({interval:'day'}, opts));
            const since = day.floor(day.dec(ending, d)).format(opts.ending_format);
            let start = _.sortedIndex(bars, {ending: since}, 'ending');
            if (bars[start] && bars[start].ending == since) start++;
            if (start >= bars.length) return calc([]);
            const end = Math.min(start + calc.warmUpLength +1, bars.length);
            return calc(bars.slice(start, end));
        }, {
            fields: ['ending'],
            warmUpLength: n + calc.warmUpLength - 1
        });
    }, {
        description: "Anchor data to the start of day, N days ago"
    }),
    /* Past N days */
    PAST: _.extend((opts, days, calc) => {
        const d = asPositiveInteger(days, "PAST");
        const dayLength = getDayLength(opts);
        const n = Math.ceil((d + 1) * dayLength);
        return _.extend(bars => {
            if (_.isEmpty(bars)) return calc(bars);
            const ending = moment.tz(_.last(bars).ending, opts.tz);
            const days = ending.day() <= 1 ? d + 2 : d;
            const since = ending.subtract(days, 'days').format(opts.ending_format);
            let start = _.sortedIndex(bars, {ending: since}, 'ending');
            if (bars[start] && bars[start].ending == since) start++;
            if (start >= bars.length) return calc([]);
            const end = Math.min(start + calc.warmUpLength +1, bars.length);
            return calc(bars.slice(start, end));
        }, {
            fields: ['ending'],
            warmUpLength: n + calc.warmUpLength - 1
        });
    }, {
        description: "Anchor data to N × 24hours ago"
    }),
    /* Normal Market Hour Session */
    SESSION(opts, calc) {
        const dayLength = getDayLength(opts);
        const n = Math.ceil(dayLength);
        return _.extend(bars => {
            if (_.isEmpty(bars))
                return calc(bars);
            const start = "2000-01-01T".length;
            const end_time = opts.liquid_hours.substring(opts.liquid_hours.indexOf(' - ') + 3);
            const first = moment.tz(_.first(bars).ending, opts.security_tz).format('YYYY-MM-DD');
            const last = moment.tz(_.last(bars).ending, opts.security_tz).format('YYYY-MM-DD');
            const opens = moment.tz(`${first}T${opts.open_time}`, opts.security_tz).tz(opts.tz);
            const closes = moment.tz(`${last}T${end_time}`, opts.security_tz).tz(opts.tz);
            const ohms = opens.hour() *60 *60 + opens.minute() *60 + opens.seconds();
            const chms = closes.hour() *60 *60 + closes.minute() *60 + closes.seconds();
            if (ohms == chms)
                return calc(bars); // 24 hour market
            if (opens.isDST() == closes.isDST() && closes.diff(opens, 'months') < 2) {
                // Use string comparison for faster filter
                const after = opens.format(opts.ending_format).substring(start);
                const before = closes.format(opts.ending_format).substring(start);
                return calc(bars.filter(after < before ? function(bar) {
                    const time = bar.ending.substring(start);
                    return after < time && time <= before;
                } : function(bar) {
                    const time = bar.ending.substring(start);
                    return after < time || time <= before;
                }));
            } else {
                return calc(bars.filter(function(bar){
                    const ending = moment.tz(bar.ending, opts.tz);
                    const hms = ending.hour() *60 *60 + ending.minute() *60 + ending.seconds();
                    return ohms < hms && hms <= chms;
                }));
            }
        }, {
            fields: ['ending'],
            warmUpLength: n + calc.warmUpLength - 1
        });
    },
    /* use only this Time Of Day */
    TOD(opts, calc) {
        const dayLength = getDayLength(opts);
        return _.extend(bars => {
            if (_.isEmpty(bars))
                return calc(bars);
            const start = "2000-01-01T".length;
            let step = Math.round(dayLength/2);
            let last = bars.length -1;
            const filtered = [_.last(bars)];
            let suffix = _.last(bars).ending.substring(start);
            while (filtered.length <= calc.warmUpLength) {
                if (last >= step && bars[last - step].ending.substring(start) == suffix) {
                    filtered.push(bars[last - step]);
                    last -= step;
                } else {
                    let idx, formatted;
                    const iter = moment.tz(bars[last].ending, opts.tz);
                    do {
                        iter.subtract(1, 'day');
                        formatted = iter.format(opts.ending_format);
                        idx = _.sortedIndex(bars, {ending: formatted}, 'ending');
                    } while (bars[idx].ending != formatted && formatted > bars[0].ending);
                    if (bars[idx].ending != formatted) break;
                    filtered.push(bars[idx]);
                    suffix = formatted.substring(start);
                    step = last - idx;
                    last = idx;
                }
            }
            return calc(filtered.reverse());
        }, {
            fields: ['ending'],
            warmUpLength: (calc.warmUpLength +1) * dayLength
        });
    },
    VAR(opts, chance, duration, calc) {
        const pct = asPositiveInteger(chance, "VAR")/100;
        const n = asPositiveInteger(duration, "VAR");
        return _.extend(bars => {
            const prices = getValues(n+1, calc, bars);
            const change = _.rest(prices).map((price, i) => {
                return (price - prices[i]) / prices[i];
            });
            if (!change.length) return 0;
            const avg = sum(change) / change.length;
            const stdev = statkit.std(change);
            const cumulative = statkit.norminv(pct);
            const risk = cumulative * stdev + avg;
            if (cumulative <= 0) {
                return -risk;
            } else {
                return risk;
            }
        }, {
            warmUpLength: n + calc.warmUpLength
        });
    },
    CVAR(opts, chance, duration, calc) {
        const pct = asPositiveInteger(chance, "CVAR")/100;
        const n = asPositiveInteger(duration, "CVAR");
        return _.extend(bars => {
            const prices = getValues(n+1, calc, bars);
            const change = _.rest(prices).map((price, i) => {
                return (price - prices[i]) / prices[i];
            });
            if (!change.length) return 0;
            const avg = sum(change) / change.length;
            const stdev = statkit.std(change);
            const cumulative = statkit.norminv(pct);
            const risk = cumulative * stdev + avg;
            if (cumulative <= 0) {
                const shortfall = change.filter(chg => chg < risk);
                if (!shortfall.length) return -risk;
                else return -sum(shortfall) / shortfall.length;
            } else {
                const overshot = change.filter(chg => chg > risk);
                if (!overshot.length) return risk;
                else return sum(overshot) / overshot.length;
            }
        }, {
            warmUpLength: n + calc.warmUpLength
        });
    }
};

_.forEach(functions, fn => {
    fn.args = fn.args || fn.toString().match(/^[^(]*\(\s*opt\w*\s*,?\s*([^)]*)\)/)[1];
});

function asPositiveInteger(calc, msg) {
    try {
        const n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg + " not " + n);
}

function getDayLength(opts) {
    const open_time = opts.trading_hours.substring(0, opts.trading_hours.indexOf(' - '));
    const end_time = opts.trading_hours.substring(opts.trading_hours.indexOf(' - ') + 3);
    if (open_time == end_time)
        return 24 * 60 * 60 * 1000 / periods(opts).millis;
    const opens = moment.tz(`2010-03-01T${open_time}`, opts.security_tz);
    const closes = moment.tz(`2010-03-01T${end_time}`, opts.security_tz);
    if (!opens.isValid() || !closes.isValid())
        throw Error("Invalid trading_hours: " + opts.trading_hours);
    if (closes.isBefore(opens)) closes.add(1, 'days');
    if (closes.diff(opens) == 24 * 60 * 60 * 1000)
        return 24 * 60 * 60 * 1000 / periods(opts).millis;
    return Math.max(periods(opts).diff(closes, opens) * 2, 1); // extra for after hours activity
}

function getValues(size, calc, bars) {
    if (!bars) return [];
    const n = calc.warmUpLength +1;
    const m = Math.min(size, bars.length);
    const values = new Array(m);
    const start = bars.length - m;
    for (let i=start; i<bars.length; i++) {
        values[i - start] = +calc(bars.slice(Math.max(i - n + 1, 0), i + 1));
    }
    return values;
}

function sum(values) {
    return _.reduce(values, function(memo, value){
        return memo + (+value || 0);
    }, 0);
}
