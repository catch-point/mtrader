// common-functions.js
/* 
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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

module.exports = {
    /* The number of workdays (Mon-Fri) since 1970-01-01 */
    WORKDAY(opts, ending) {
        return context => {
            var start = moment(ending(context)).tz(opts.tz);
            if (!start.isValid()) throw Error("Invalid date: " + ending(context));
            var noon = moment(start).millisecond(0).second(0).minute(0).hour(12);
            var zero = moment.tz('1970-01-01', opts.tz).startOf('isoWeek');
            var weeks = start.diff(zero, 'weeks');
            var days = start.isoWeekday() - 1;
            if (days > 4) return weeks * 5 + 5;
            var hours = (start.valueOf() - noon.valueOf()) /1000 /60 /60 +12;
            return weeks*5 + days + hours/24;
        };
    },
    /* Y-MM-DD date format */
    DATE(opts, ending) {
        return context => {
            var date = moment(ending(context)).tz(opts.tz);
            if (!date.isValid()) throw Error("Invalid date: " + ending(context));
            return date.format('Y-MM-DD');
        };
    },
    /* HH:mm:ss time 24hr format */
    TIME(opts, ending) {
        return context => {
            var date = moment(ending(context)).tz(opts.tz);
            if (!date.isValid()) throw Error("Invalid date: " + ending(context));
            return date.format('HH:mm:ss');
        };
    },
    /* Date of Month (1-31) */
    DAY(opts, ending) {
        return context => {
            var date = moment(ending(context)).tz(opts.tz);
            if (!date.isValid()) throw Error("Invalid date: " + ending(context));
            return date.date();
        };
    },
    /* Month of Year (1-12) */
    MONTH(opts, ending) {
        return context => {
            var date = moment(ending(context)).tz(opts.tz);
            if (!date.isValid()) throw Error("Invalid date: " + ending(context));
            return date.month() + 1;
        };
    },
    /* Year */
    YEAR(opts, ending) {
        return context => {
            var date = moment(ending(context)).tz(opts.tz);
            if (!date.isValid()) throw Error("Invalid date: " + ending(context));
            return date.year();
        };
    },
    /* Hour of day (0-23.999999722) */
    HOUR(opts, ending) {
        return context => {
            // pivot around noon as leap seconds/hours occur at night
            var start = moment(ending(context)).tz(opts.tz);
            if (!start.isValid()) throw Error("Invalid date: " + ending(context));
            var noon = moment(start).millisecond(0).second(0).minute(0).hour(12);
            return (start.valueOf() - noon.valueOf()) /1000 /60 /60 +12;
        };
    },
    /* Absolute value */
    ABS(opts, calc) {
        return context => {
            return Math.abs(calc(context));
        };
    },
    CEIL(opts, calc) {
        return context => {
            return Math.ceil(calc(context));
        };
    },
    FLOOR(opts, calc) {
        return context => {
            return Math.floor(calc(context));
        };
    },
    TRUNC(opts, calc) {
        return context => {
            return Math.trunc(calc(context));
        };
    },
    RANDOM(opts) {
        return context => {
            return Math.random();
        };
    },
    MAX(opts) {
        var numbers = _.rest(arguments);
        return context => {
            return _.max(numbers.map(num => num(context)));
        };
    },
    MIN(opts, calc) {
        var numbers = _.rest(arguments);
        return context => {
            return _.min(numbers.map(num => num(context)));
        };
    },
    /* Returns the sign of a number. Returns 1 if the number is positive, -1 if negative and 0 if zero. */
    SIGN(opts, calc) {
        return context => {
            var value = calc(context);
            if (value > 0) return 1;
            if (value < 0) return -1;
            else return value;
        };
    },
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
        return context => {
            return lhs(context) <= rhs(context) ? 1 : 0;
        };
    },
    /* Greater than or Equal to */
    NOT_LESS_THAN(opts, lhs, rhs) {
        return context => {
            return lhs(context) >= rhs(context) ? 1 : 0;
        };
    },
    /* Less than */
    LESS_THAN(opts, lhs, rhs) {
        return context => {
            return lhs(context) < rhs(context) ? 1 : 0;
        };
    },
    /* Greater than */
    GREATER_THAN(opts, lhs, rhs) {
        return context => {
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
        var conditions = _.rest(arguments);
        return context => {
            return conditions.every(fn => fn(context)) ? 1 : 0;
        };
    },
    /* OR */
    OR(opts) {
        var conditions = _.rest(arguments);
        return context => {
            return conditions.some(fn => fn(context)) ? 1 : 0;
        };
    },
    /* XOR */
    XOR(opts) {
        var conditions = _.rest(arguments);
        return context => {
            return conditions.filter(fn => fn(context)).length %2;
        };
    },
    /* If then else */
    IF(opts, ifCondition, thenValue, elseValue) {
        var conditions = _.filter(_.rest(arguments), (val, i) => (i +1) %2);
        var values = _.filter(_.rest(arguments), (val, i) => i %2);
        var elseValue = conditions.length > values.length ? conditions.pop() : () => 0;
        return context => {
            var i = conditions.findIndex((fn, i) => fn(context));
            if (i < 0) return elseValue(context);
            else return values[i](context);
        };
    },
    /* Negative */
    NEGATIVE(opts, num) {
        return context => {
            return num(context) * -1;
        };
    },
    /* Addition */
    ADD(opts, n, d) {
        return context => {
            return n(context) + d(context);
        };
    },
    /* Subtraction */
    SUBTRACT(opts, n, d) {
        return context => {
            return n(context) - d(context);
        };
    },
    /* Multiplication */
    PRODUCT(opts) {
        var numbers = _.rest(arguments);
        return context => numbers.reduce((product, num) => {
            return product * num(context);
        }, 1);
    },
    /* Divide */
    DIVIDE(opts, n, d) {
        return context => {
            return n(context) / d(context);
        };
    },
    /* Modulus */
    MOD(opts, number, divisor) {
        return context => {
            return number(context) % divisor(context);
        };
    },
    /* Percent change ratio */
    CHANGE(opts, target, reference, denominator) {
        var den = denominator ? denominator : reference;
        return context => {
            var numerator = target(context) - reference(context);
            return numerator * 100 / den(context);
        };
    }
};
