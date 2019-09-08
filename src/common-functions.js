// common-functions.js
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
const Big = require('big.js');
const statkit = require("statkit");
const bs = require('black-scholes');
const iv = require('implied-volatility');
const d3 = require('d3-format');
const periods = require('./periods.js');
const expect = require('chai').expect;

module.exports = function(name, args, options) {
    if (!functions[name]) return;
    const intervals = periods.sort(_.uniq(_.flatten(_.compact(_.pluck(args, 'intervals')), true)));
    const fn = functions[name].apply(this, [options || {}].concat(args));
    const len = Math.max.apply(Math, [0].concat(_.compact(_.pluck(args, 'warmUpLength'))));
    return _.extend(bars => fn(bars), {
        intervals: intervals,
        warmUpLength: len,
        sideEffect: functions[name].sideEffect || _.some(args, arg => arg.sideEffect)
    });
};

module.exports.has = function(name) {
    return !!functions[name];
};

const functions = module.exports.functions = {
    NOW: _.extend((opts, tz) => {
        const now = moment(opts.now).format();
        return context => {
            if (!tz || tz == now.tz()) return now;
            else return moment.tz(now, tz(context)).format();
        };
    }, {
        description: "The local date and time at the point the function was executed",
        seeAlso: ['DATE', 'TIME'],
        sideEffect: true
    }),
    BEGIN: _.extend((opts, tz) => {
        const begin = moment(opts.begin).format();
        return context => {
            if (!tz || tz == begin.tz()) return begin;
            else return moment.tz(begin, tz(context)).format();
        };
    }, {
        description: "The local date and time collecting began",
        seeAlso: ['NOW', 'END'],
        sideEffect: true
    }),
    END: _.extend((opts, tz) => {
        const end = moment(opts.end || opts.now).format();
        return context => {
            if (!tz || tz == end.tz()) return end;
            else return moment.tz(end, tz(context)).format();
        };
    }, {
        description: "The local date and time collecting will end",
        seeAlso: ['NOW', 'BEGIN'],
        sideEffect: true
    }),
    /* Add d workdays to the date */
    WORKDAY: _.extend((opts, ending, days, tz) => {
        return context => {
            const start = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!start.isValid()) return null;
            const d = Math.min(start.isoWeekday()-1,4) + days(context);
            const wk = Math.floor(d /5);
            const wd = d - wk *5 +1;
            return start.add(wk, 'weeks').isoWeekday(wd).format();
        };
    }, {
        description: "The date before or after a specified number of workdays (Mon-Fri)"
    }),
    EDATE: _.extend((opts, start_date, duration, tz) => {
        return context => {
            const date = tz ? moment.tz(start_date(context), tz(context)) : moment(start_date(context));
            const dur = duration(context);
            const d = _.isFinite(dur) ? moment.duration(+dur, 'months') : moment.duration(dur);
            return date.add(d).format();
        };
    }, {
        description: "Returns a date that is the indicated duration or number of months before or after a specified date (the start_date)"
    }),
    TEXT: _.extend((opts, value, format, tz) => {
        const pattern = format && format();
        const d3_format = _.once(() => pattern && d3.format(pattern));
        return context => {
            const val = value(context);
            if (!pattern && !val && val!=0) return '';
            else if (!pattern) return val.toString();
            else if (_.isFinite(val)) return d3_format()(+val);
            else return (tz ? moment.tz(val, tz(context)) : moment(val)).format(pattern);
        };
    }, {
        description: "Converts numbers and dates to text in the given format"
    }),
    LEFT: _.extend((opts, text, number) => {
        return context => {
            const str = text(context);
            if (str == null) return null;
            const n = number(context) || 0;
            return str.toString().substring(0, n);
        };
    }, {
        description: "Returns the first character or characters of a text"
    }),
    RIGHT: _.extend((opts, text, number) => {
        return context => {
            const str = text(context);
            if (str == null) return null;
            const n = number(context) || 0;
            const len = str.toString().length;
            return str.toString().substring(Math.max(len - n, 0), len);
        };
    }, {
        description: "Returns the last character or characters of a text"
    }),
    LEN: _.extend((opts, text) => {
        return context => {
            const str_text = text(context);
            if (str_text == null) return null;
            return str_text.toString().length;
        };
    }, {
        description: "Calculates length of a text string"
    }),
    CONCAT: _.extend(function(opts, text1, text2) {
        const texts = _.rest(arguments);
        return context => {
            return texts.map(f => f(context)).filter(v => v != null).join('');
        };
    }, {
        description: "Combines several text strings into one string."
    }),
    REPLACE: _.extend((opts, text, position, length, new_text) => {
        return context => {
            const str_text = text(context);
            if (str_text == null) return null;
            const str = str_text.toString();
            const p = position(context) || 1;
            const len = length(context) || 0;
            const rp = new_text && new_text(context) || '';
            return str.substring(0, p-1) + rp + str.substring(Math.min(p-1 + len, str.length));
        };
    }, {
        description: "Replaces characters within a text string with a different text string"
    }),
    SEARCH: _.extend((opts, find_text, text, position) => {
        return context => {
            const str_text = text(context);
            if (str_text == null) return null;
            const str = str_text.toString().toLowerCase();
            const needle = (find_text(context) || '').toString().toLowerCase();
            const p = position && position(context) || 1;
            return str.indexOf(needle, p-1) +1 || null;
        };
    }, {
        description: "Looks for one text value within another (not case-sensitive)"
    }),
    /* The number of days since 1899-12-31 */
    DATEVALUE: _.extend((opts, ending, tz) => {
        return context => {
            const start = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!start.isValid()) return null;
            const zero = moment('1899-12-31');
            return start.diff(zero, 'days');
        };
    }, {
        description: "The number of days since 1899-12-31"
    }),
    /* The fraction of day */
    TIMEVALUE: _.extend((opts, ending, tz) => {
        return context => {
            const start = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!start.isValid()) return null;
            const noon = moment(start).millisecond(0).second(0).minute(0).hour(12);
            const hours = (start.valueOf() - noon.valueOf()) /1000 /60 /60 +12;
            return hours/24;
        };
    }, {
        description: "Fractional day part between 0 and 1"
    }),
    /* Converts dateTime to simplified extended ISO format (ISO 8601) format in UTC */
    DATETIME: _.extend((opts, ending) => {
        return context => {
            const date = moment(ending(context));
            if (!date.isValid()) return null;
            return date.toISOString();
        };
    }, {
        description: "Simplified extended ISO format (ISO 8601) format in UTC",
        seeAlso: ['DATE', 'TIME']
    }),
    /* Y-MM-DD date format */
    DATE: _.extend((opts, ending, month, day, tz) => {
        return context => {
            const date_str = month ? `${month(context)}/${day(context)}/${ending(context)}` : ending(context);
            const date = month ?
                tz ? moment.tz(date_str, 'M/D/Y', tz(context)) : moment(date_str, 'M/D/Y') :
                tz ? moment.tz(date_str, tz(context)) : moment(date_str);
            if (!date.isValid()) return null;
            return date.format('Y-MM-DD');
        };
    }, {
        description: "Y-MM-DD date format",
        seeAlso: ['YEAR', 'MONTH', 'DAY', 'TIME']
    }),
    /* HH:mm:ss time 24hr format */
    TIME: _.extend((opts, ending, tz) => {
        return context => {
            const date = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!date.isValid()) return null;
            return date.format('HH:mm:ss');
        };
    }, {
        description: "HH:mm:ss time 24hr format",
        seeAlso: ['DATE']
    }),
    /* Date of Month as a number (1-31) */
    DAY: _.extend((opts, ending, tz) => {
        return context => {
            const date = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!date.isValid()) return null;
            return date.date();
        };
    }, {
        description: "Date of Month as a number (1-31)",
        seeAlso: ['YEAR', 'MONTH', 'DATE', 'TIME']
    }),
    /* Week of Year as a number (1-52) */
    WEEKNUM: _.extend((opts, ending, mode, tz) => {
        return context => {
            const date = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!date.isValid()) return null;
            if (!mode || mode(context) == 1) return date.week();
            else return date.isoWeek();
        };
    }, {
        description: "Date of Month as a number (1-52)",
        seeAlso: ['YEAR', 'MONTH', 'DATE', 'TIME']
    }),
    WEEKDAY: _.extend((opts, ending, tz) => {
        return context => {
            const date = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!date.isValid()) return null;
            return date.day()+1;
        };
    }, {
        description: "Day of week (Sun-Sat) as a number (1-7)",
        seeAlso: ['YEAR', 'MONTH', 'DATE', 'TIME']
    }),
    /* Month of Year as a number (1-12) */
    MONTH: _.extend((opts, ending, tz) => {
        return context => {
            const date = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!date.isValid()) return null;
            return date.month() + 1;
        };
    }, {
        description: "Month of Year as a number (1-12)",
        seeAlso: ['YEAR', 'MONTH', 'DAY', 'DATE', 'TIME']
    }),
    /* Year */
    YEAR(opts, ending, tz) {
        return context => {
            const date = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!date.isValid()) return null;
            return date.year();
        };
    },
    /* Hour of day (0-23.999999722) */
    HOUR: _.extend((opts, ending, tz) => {
        return context => {
            // pivot around noon as leap seconds/hours occur at night
            const start = tz ? moment.tz(ending(context), tz(context)) : moment(ending(context));
            if (!start.isValid()) return null;
            const noon = moment(start).millisecond(0).second(0).minute(0).hour(12);
            return (start.valueOf() - noon.valueOf()) /1000 /60 /60 +12;
        };
    }, {
        description: "Hour of day (0-23.999999722)"
    }),
    DAYS: _.extend((opts, to, from, tz) => {
        return context => {
            const a = tz ? moment.tz(to(context), tz(context)) : moment(to(context));
            const b = tz ? moment.tz(from(context), tz(context)) : moment(from(context));
            if (!a.isValid() || !b.isValid()) return null;
            return a.diff(b, 'days');
        };
    }, {
        description: "Calculates the number of days between two dates"
    }),
    NETWORKDAYS: _.extend((opts, from, to, tz) => {
        return context => {
            let a = tz ? moment.tz(to(context), tz(context)) : moment(to(context));
            let b = tz ? moment.tz(from(context), tz(context)) : moment(from(context));
            let swap = false;
            if (!a.isValid() || !b.isValid()) return null;
            if (a.isBefore(b)) {
                swap = true;
                [a, b] = [b, a];
            }
            const years = _.range(b.isoWeekYear(), a.isoWeekYear());
            const weeks = years.reduce((wk, year) => {
                const date = tz ? moment.tz(year + '-02-01', tz(context)) : moment(year + '-02-01');
                return wk + date.isoWeeksInYear();
            }, 0);
            const wk = weeks + a.isoWeek() - b.isoWeek();
            const days = wk * 5 + Math.min(a.isoWeekday()+1,6) - Math.min(b.isoWeekday(), 6);
            if (swap) return -days;
            else return days;
        };
    }, {
        description: "Calculates the number of weekdays between two dates"
    }),
    NUMBERVALUE(opts, text) {
        if (opts.high_precision) return context => {
            const string = text(context);
            if (_.isFinite(string)) return Big(string);
            else return null;
        };
        else return context => {
            const num = parseFloat(text(context));
            if (_.isFinite(num)) return num;
            else return null;
        };
    },
    /* Absolute value */
    ABS(opts, expression) {
        return context => {
            return z(Big(expression(context)||0).abs(), opts);
        };
    },
    CEILING(opts, expression, significance) {
        if (opts.fast_arithmetic) return context => {
            if (!significance) return Math.ceil(expression(context));
            const sig = significance(context);
            if (!sig) return Math.ceil(expression(context));
            return Math.ceil(expression(context)/sig)*sig;
        };
        else return context => {
            if (!significance) return Math.ceil(expression(context)||0);
            const sig = significance(context);
            if (!sig) return Math.ceil(expression(context)||0);
            return z(Big(Math.ceil(Big(expression(context)||0).div(sig))).times(sig), opts);
        };
    },
    ROUND(opts, expression, count) {
        const scale = Math.pow(10, count && count() || 0);
        if (opts.fast_arithmetic) return context => {
            return Math.round(expression(context)*scale)/scale;
        };
        else return context => {
            return z(Big(expression(context)||0).times(scale).round().div(scale), opts);
        };
    },
    FLOOR(opts, expression, significance) {
        if (opts.fast_arithmetic) return context => {
            if (!significance) return Math.floor(expression(context));
            const sig = significance(context);
            if (!sig) return Math.floor(expression(context));
            return Math.floor(expression(context)/sig)*sig;
        };
        else return context => {
            if (!significance) return Math.floor(expression(context)||0);
            const sig = significance(context);
            if (!sig) return Math.floor(expression(context)||0);
            return z(Big(Math.floor(Big(expression(context)||0).div(sig))).times(sig), opts);
        };
    },
    TRUNC(opts, expression) {
        return context => {
            return Math.trunc(expression(context));
        };
    },
    RANDOM(opts) {
        return context => {
            return Math.random();
        };
    },
    MAX(opts, a, b) {
        const numbers = _.rest(arguments);
        if (opts.high_precision) return context => {
            return numbers.map(num => num(context)).reduce((a1, b1) => {
                if (b1 == null) return a1;
                else if (a1 == null) return b1;
                else if ((!a1 || _.isFinite(a1)) && (!b1 || _.isFinite(b1)))
                    return Big(a1||0).cmp(b1||0) > 0 ? a1 : b1;
                else return a1 > b1 ? a1 : b1;
            });
        };
        else if (numbers.length == 2) return context => {
            const a1 = a(context);
            const b1 = b(context);
            return a1 > b1 || b1 == null ? a1 : b1;
        }; else return context => {
            const result = _.max(numbers.map(num => num(context)));
            if (result == -Infinity) return null;
            else return result;
        };
    },
    MIN(opts, a, b) {
        const numbers = _.rest(arguments);
        if (opts.high_precision) return context => {
            return numbers.map(num => num(context)).reduce((a1, b1) => {
                if (b1 == null) return a1;
                else if (a1 == null) return b1;
                else if ((!a1 || _.isFinite(a1)) && (!b1 || _.isFinite(b1)))
                    return Big(a1||0).cmp(b1||0) <= 0 ? a1 : b1;
                else return a1 < b1 ? a1 : b1;
            });
        };
        else if (numbers.length == 2) return context => {
            const a1 = a(context);
            const b1 = b(context);
            return a1 < b1 || b1 == null ? a1 : b1;
        }; else return context => {
            const result = _.min(numbers.map(num => num(context)));
            if (result == Infinity) return null;
            else return result;
        };
    },
    /* Returns the sign of a number. Returns 1 if the number is positive, -1 if negative and 0 if zero. */
    SIGN: _.extend((opts, expression) => {
        return context => {
            const value = expression(context);
            if (value > 0) return 1;
            if (value < 0) return -1;
            else return value;
        };
    }, {
        description: "Returns the sign of a number. Returns 1 if the number is positive, -1 if negative and 0 if zero."
    }),
    /* Equals */
    EQUALS(opts, lhs, rhs) {
        return context => {
            return lhs(context) == rhs(context) ? 1 : 0;
        };
    },
    /* Not Equal to */
    NOT_EQUAL(opts, lhs, rhs) {
        return context => {
            return lhs(context) != rhs(context) ? 1 : 0;
        };
    },
    /* Less than or Equal to */
    NOT_GREATER_THAN(opts, lhs, rhs) {
        if (opts.high_precision) return context => {
            const l = lhs(context);
            const r = rhs(context);
            if ((!l || _.isFinite(l)) && (!r || _.isFinite(r)))
                return Big(l||0).cmp(r||0) <= 0 ? 1 : 0;
            else return l <= r ? 1 : 0;
        };
        else return context => {
            return lhs(context) <= rhs(context) ? 1 : 0;
        };
    },
    /* Greater than or Equal to */
    NOT_LESS_THAN(opts, lhs, rhs) {
        if (opts.high_precision) return context => {
            const l = lhs(context);
            const r = rhs(context);
            if ((!l || _.isFinite(l)) && (!r || _.isFinite(r)))
                return Big(l||0).cmp(r||0) >= 0 ? 1 : 0;
            else return l >= r ? 1 : 0;
        };
        else return context => {
            return lhs(context) >= rhs(context) ? 1 : 0;
        };
    },
    /* Less than */
    LESS_THAN(opts, lhs, rhs) {
        if (opts.high_precision) return context => {
            const l = lhs(context);
            const r = rhs(context);
            if ((!l || _.isFinite(l)) && (!r || _.isFinite(r)))
                return Big(l||0).cmp(r||0) < 0 ? 1 : 0;
            else return l < r ? 1 : 0;
        };
        else return context => {
            return lhs(context) < rhs(context) ? 1 : 0;
        };
    },
    /* Greater than */
    GREATER_THAN(opts, lhs, rhs) {
        if (opts.high_precision) return context => {
            const l = lhs(context);
            const r = rhs(context);
            if ((!l || _.isFinite(l)) && (!r || _.isFinite(r)))
                return Big(l||0).cmp(r||0) > 0 ? 1 : 0;
            else return l > r ? 1 : 0;
        };
        else return context => {
            return lhs(context) > rhs(context) ? 1 : 0;
        };
    },
    /* Not */
    NOT(opts, num) {
        return context => {
            return !num(context) ? 1 : 0;
        };
    },
    /* AND */
    AND(opts) {
        const conditions = _.rest(arguments);
        return context => {
            return conditions.reduce((memo, fn) => memo && fn(context), 1);
        };
    },
    /* OR */
    OR(opts) {
        const conditions = _.rest(arguments);
        return context => {
            return conditions.reduce((memo, fn) => memo || fn(context), null);
        };
    },
    /* XOR */
    XOR(opts) {
        const conditions = _.rest(arguments);
        return context => {
            return conditions.filter(fn => fn(context)).length %2;
        };
    },
    TRUE(opts) {
        return context => 1;
    },
    FALSE(opts) {
        return context => 0;
    },
    NULL(opts) {
        return context => null;
    },
    /* If then else */
    IF(opts, ifCondition, thenValue, elseValue) {
        const conditions = _.filter(_.rest(arguments), (val, i) => (i +1) %2);
        const values = _.filter(_.rest(arguments), (val, i) => i %2);
        const else_value = conditions.length > values.length ? conditions.pop() : () => null;
        return context => {
            const i = conditions.findIndex((fn, i) => fn(context));
            if (i < 0) return else_value(context);
            else return values[i](context);
        };
    },
    /* Negative */
    NEGATIVE(opts, number) {
        return context => {
            return number(context) * -1;
        };
    },
    /* Addition */
    ADD(opts, a, b) {
        if (opts.fast_arithmetic) return context => {
            return +a(context) + +b(context);
        };
        else return context => {
            return z(Big(a(context)||0).add(b(context)||0), opts);
        };
    },
    /* Subtraction */
    SUBTRACT(opts, a, b) {
        if (opts.fast_arithmetic) return context => {
            return a(context) - b(context);
        };
        else return context => {
            return z(Big(a(context)||0).minus(b(context)||0), opts);
        };
    },
    /* Multiplication */
    PRODUCT: _.extend(function(opts, a, b) {
        const numbers = _.rest(arguments);
        if (opts.fast_arithmetic && numbers.length == 2) {
            return context => a(context) * b(context);
        } else if (opts.fast_arithmetic) {
            return context => numbers.reduce((product, num) => {
                return product * num(context);
            }, 1);
        }
        else return context => z(numbers.reduce((product, num) => {
            return product.times(num(context)||0);
        }, Big(1)), opts);
    }, {
        args: "numbers..."
    }),
    /* Divide */
    DIVIDE(opts, n, d) {
        if (opts.fast_arithmetic) return context => {
            return n(context) / d(context);
        };
        else return context => {
            const divisor = d(context);
            if (!+divisor) return null;
            else return z(Big(n(context)||0).div(divisor), opts);
        };
    },
    /* Modulus */
    MOD(opts, number, divisor) {
        if (opts.fast_arithmetic) return context => {
            return number(context) % divisor(context);
        };
        return context => {
            const d = divisor(context);
            if (!+d) return null;
            else return z(Big(number(context)||0).mod(d), opts);
        };
    },
    POWER: _.extend((opts, base, exponent) => {
        return context => {
            const b = base && base(context) || 0;
            const e = exponent && exponent(context) || 0;
            const value = Math.pow(b, e);
            return _.isFinite(value) ? value : null;
        };
    }, {
        description: "Returns a^b, base a raised to the power of exponent b"
    }),
    SQRT: _.extend((opts, number) => {
        return context => {
            const value = Math.sqrt(number(context));
            return _.isFinite(value) ? value : null;
        };
    }, {
        description: "Returns the sequare root of a number"
    }),
    EXP: _.extend((opts, number) => {
        return context => {
            const value = Math.exp(number(context));
            return _.isFinite(value) ? value : null;
        };
    }, {
        description: "Calculates the exponent for basis e"
    }),
    LN: _.extend((opts, number) => {
        return context => {
            const value = Math.log(number(context));
            return _.isFinite(value) ? value : null;
        };
    }, {
        description: "Calculates the natural logarithm of a number"
    }),
    PI: _.extend((opts) => {
        return _.constant(Math.PI);
    }, {
        description: "Returns the ratio of the circumference of a circle to its diameter, approximately 3.14159"
    }),
    NORMSDIST: _.extend((opts, number) => {
        return context => {
            const n = number(context);
            if (!_.isFinite(n)) return null;
            const value = statkit.normcdf(n);
            return _.isFinite(value) ? value : null;
        };
    }, {
        description: "The values of the standard normal cumulative distribution"
    }),
    NORMSINV: _.extend((opts, number) => {
        return context => {
            const n = number(context);
            if (!_.isFinite(n)) return null;
            const value = statkit.norminv(n);
            return _.isFinite(value) ? value : null;
        };
    }, {
        description: "Values of the inverse standard normal distribution"
    }),
    BS: _.extend((opts, asset_price, strike, days, iv, rate, C_or_P) => {
        return context => {
            const s = asset_price && asset_price(context) || 0;
            const k = strike && strike(context) || 0;
            const t = days && days(context)/365 || 0;
            const v = iv && iv(context)/100 || 0;
            const r = rate && rate(context)/100 || 0;
            const cp = C_or_P && (C_or_P(context)||'').toString().charAt(0);
            const callPut = cp == 'P' ? 'put' : cp == 'C' ? 'call' :
                cp.charAt(0).toUpperCase() == 'P' ? 'put' :
                cp.charAt(0).toUpperCase() == 'C' ? 'call': null;
            if (!cp) throw Error(`Must include a right 'C'/'P' value in BS(${[s, k, t, v, r, cp].join(', ')})`);
            return bs.blackScholes(s, k, t, v, r, callPut);
        };
    }, {
        description: "Option pricing using the Black-Scholes formula"
    }),
    BSIV: _.extend((opts, op_cost, asset_price, strike, days, rate, C_or_P) => {
        return context => {
            const c = op_cost && op_cost(context) || 0;
            const s = asset_price && asset_price(context) || 0;
            const k = strike && strike(context) || 0;
            const t = days && days(context)/365 || 0;
            const r = rate && rate(context)/100 || 0;
            const cp = C_or_P && (C_or_P(context)||'').toString().charAt(0);
            const callPut = cp == 'P' ? 'put' : cp == 'C' ? 'call' :
                cp.charAt(0).toUpperCase() == 'P' ? 'put' :
                cp.charAt(0).toUpperCase() == 'C' ? 'call': null;
            if (!cp) throw Error(`Must include a right 'C'/'P' value in BS(${[s, k, t, r, cp].join(', ')})`);
            return iv.getImpliedVolatility(c, s, k, t, r, callPut) * 100;
        };
    }, {
        description: "Determine implied volatility of options based on their prices"
    }),
    /* Percent change ratio */
    CHANGE(opts, target, reference, denominator) {
        if (!target || !reference) throw Error("CHANGE requires two or three arguments");
        const den = denominator || reference;
        if (opts.fast_arithmetic) return bars => {
            const numerator = target(bars) - reference(bars);
            return Math.round(numerator * 10000/ den(bars)) /100;
        };
        else return bars => {
            const d = den(bars);
            if (!+d) return null;
            return z(Big(target(bars)||0).minus(reference(bars)||0).times(100).div(d).round(2), opts);
        };
    }
};

_.forEach(functions, fn => {
    fn.args = fn.args || fn.toString().match(/^[^(]*\(\s*opt\w*\s*,?\s*([^)]*)\)/)[1];
});

function z(big, opts) {
    if (!big) return big;
    else if (typeof big == 'number' && Number.isFinite(big)) return big;
    else if (typeof big == 'number' && Number.MAX_VALUE < big) return Number.MAX_VALUE;
    else if (typeof big == 'number' && big < -Number.MAX_VALUE) return -Number.MAX_VALUE;
    else if (typeof big == 'number') return null;
    else if (!(big instanceof Big)) return big;
    else if (big.c[0] == 0) return +big; // zero
    else if (opts && opts.high_precision) return big; // high precision number
    else if (big.gt(Number.MAX_VALUE)) return Number.MAX_VALUE;
    else if (big.lt(-Number.MAX_VALUE)) return -Number.MAX_VALUE;
    else return +big; // non-zero number
}
