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

const _ = require('underscore');
const moment = require('moment-timezone');
const d3 = require('d3-format');
const periods = require('./periods.js');
const expect = require('chai').expect;

module.exports = function(name, args, options) {
    if (!functions[name]) return;
    expect(options).to.have.property('tz').that.is.a('string');
    var intervals = periods.sort(_.uniq(_.flatten(_.compact(_.pluck(args, 'intervals')), true)));
    var fn = functions[name].apply(this, [options].concat(args));
    var len = Math.max.apply(Math, [0].concat(_.compact(_.pluck(args, 'warmUpLength'))));
    return _.extend(bars => fn(bars), {
        intervals: intervals,
        warmUpLength: len,
        sideEffect: functions[name].sideEffect || _.some(args, arg => arg.sideEffect)
    });
};

module.exports.has = function(name) {
    return !!functions[name];
};

var functions = module.exports.functions = {
    NOW: _.extend((opts, tz) => {
        var now = moment.tz(opts.now, opts.tz).format();
        return context => {
            if (!tz || tz == opts.tz) return now;
            else return moment.tz(opts.now, tz(context)).format();
        };
    }, {
        description: "The local date and time at the point the function was executed",
        seeAlso: ['DATE', 'TIME'],
        sideEffect: true
    }),
    BEGIN: _.extend((opts, tz) => {
        var begin = moment.tz(opts.begin, opts.tz).format();
        return context => {
            if (!tz || tz == opts.tz) return begin;
            else return moment.tz(opts.begin, tz(context)).format();
        };
    }, {
        description: "The local date and time collecting began",
        seeAlso: ['NOW', 'END'],
        sideEffect: true
    }),
    END: _.extend((opts, tz) => {
        var end = moment.tz(opts.end || opts.now, opts.tz).format();
        return context => {
            if (!tz || tz == opts.tz) return end;
            else return moment.tz(opts.end || opts.now, tz(context)).format();
        };
    }, {
        description: "The local date and time collecting will end",
        seeAlso: ['NOW', 'BEGIN'],
        sideEffect: true
    }),
    /* Add d workdays to the date */
    WORKDAY: _.extend((opts, ending, days, tz) => {
        return context => {
            var start = moment.tz(ending(context), tz ? tz(context) : opts.tz);
            if (!start.isValid()) return null;
            var d = Math.min(start.isoWeekday()-1,4) + days(context);
            var wk = Math.floor(d /5);
            var wd = d - wk *5 +1;
            return start.add(wk, 'weeks').isoWeekday(wd).format();
        };
    }, {
        description: "The date before or after a specified number of workdays (Mon-Fri)"
    }),
    EDATE: _.extend((opts, start_date, duration, tz) => {
        return context => {
            var date = moment.tz(start_date(context), tz ? tz(context) : opts.tz);
            var dur = duration(context);
            var d = _.isFinite(dur) ? moment.duration(+dur, 'months') : moment.duration(dur);
            return date.add(d).format();
        };
    }, {
        description: "Returns a date that is the indicated duration or number of months before or after a specified date (the start_date)"
    }),
    TEXT: _.extend((opts, value, format, tz) => {
        return context => {
            var val = value(context);
            if (_.isFinite(val)) return d3.format(format(context))(+val);
            else return moment.tz(val, tz ? tz(context) : opts.tz).format(format(context));
        };
    }, {
        description: "Converts numbers and dates to text in the given format"
    }),
    LEFT: _.extend((opts, text, number) => {
        return context => {
            var str = text(context);
            if (str == null) return null;
            var n = number(context) || 0;
            return str.toString().substring(0, n);
        };
    }, {
        description: "Returns the first character or characters of a text"
    }),
    RIGHT: _.extend((opts, text, number) => {
        return context => {
            var str = text(context);
            if (str == null) return null;
            var n = number(context) || 0;
            var len = str.toString().length;
            return str.toString().substring(Math.max(len - n, 0), len);
        };
    }, {
        description: "Returns the last character or characters of a text"
    }),
    REPLACE: _.extend((opts, text, position, length, new_text) => {
        return context => {
            var str_text = text(context);
            if (str_text == null) return null;
            var str = str_text.toString();
            var p = position(context) || 1;
            var len = length(context) || 0;
            var rp = new_text && new_text(context) || '';
            return str.substring(0, p-1) + rp + str.substring(Math.min(p-1 + len, str.length));
        };
    }, {
        description: "Replaces characters within a text string with a different text string"
    }),
    /* The number of days since 1899-12-31 */
    DATEVALUE: _.extend((opts, ending, tz) => {
        return context => {
            var start = moment.tz(ending(context), tz ? tz(context) : opts.tz);
            if (!start.isValid()) return null;
            var zero = moment.tz('1899-12-31', opts.tz);
            return start.diff(zero, 'days');
        };
    }, {
        description: "The number of days since 1899-12-31"
    }),
    /* The fraction of day */
    TIMEVALUE: _.extend((opts, ending, tz) => {
        return context => {
            var start = moment.tz(ending(context), tz ? tz(context) : opts.tz);
            if (!start.isValid()) return null;
            var noon = moment(start).millisecond(0).second(0).minute(0).hour(12);
            var hours = (start.valueOf() - noon.valueOf()) /1000 /60 /60 +12;
            return hours/24;
        };
    }, {
        description: "The number of workdays (Mon-Fri) since 1970-01-01"
    }),
    /* Converts dateTime to simplified extended ISO format (ISO 8601) format in UTC */
    DATETIME: _.extend((opts, ending) => {
        return context => {
            var date = moment(ending(context));
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
            var date = month ?
                moment.tz(new Date(ending(context), month(context)-1, day(context)).toISOString().substring(0,10), tz ? tz(context) : opts.tz) :
                moment.tz(ending(context), tz ? tz(context) : opts.tz);
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
            var date = moment.tz(ending(context), tz ? tz(context) : opts.tz);
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
            var date = moment.tz(ending(context), tz ? tz(context) : opts.tz);
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
            var date = moment.tz(ending(context), tz ? tz(context) : opts.tz);
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
            var date = moment.tz(ending(context), tz ? tz(context) : opts.tz);
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
            var date = moment.tz(ending(context), tz ? tz(context) : opts.tz);
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
            var date = moment.tz(ending(context), tz ? tz(context) : opts.tz);
            if (!date.isValid()) return null;
            return date.year();
        };
    },
    /* Hour of day (0-23.999999722) */
    HOUR: _.extend((opts, ending, tz) => {
        return context => {
            // pivot around noon as leap seconds/hours occur at night
            var start = moment.tz(ending(context), tz ? tz(context) : opts.tz);
            if (!start.isValid()) return null;
            var noon = moment(start).millisecond(0).second(0).minute(0).hour(12);
            return (start.valueOf() - noon.valueOf()) /1000 /60 /60 +12;
        };
    }, {
        description: "Hour of day (0-23.999999722)"
    }),
    DAYS: _.extend((opts, to, from, tz) => {
        return context => {
            var a = moment.tz(to(context), tz ? tz(context) : opts.tz);
            var b = moment.tz(from(context), tz ? tz(context) : opts.tz);
            if (!a.isValid() || !b.isValid()) return null;
            return a.diff(b, 'days');
        };
    }, {
        description: "Calculates the number of days between two dates"
    }),
    NETWORKDAYS: _.extend((opts, from, to, tzone) => {
        return context => {
            var tz = tzone ? tzone(context) : opts.tz;
            var a = moment.tz(to(context), tz);
            var b = moment.tz(from(context), tz);
            if (!a.isValid() || !b.isValid()) return null;
            if (a.isBefore(b)) {
                var swap = b;
                b = a;
                a = swap;
            }
            var years = _.range(b.isoWeekYear(), a.isoWeekYear());
            var weeks = years.reduce((wk, year) => {
                return wk + moment.tz(year + '-02-01', tz).isoWeeksInYear();
            }, 0);
            var wk = weeks + a.isoWeek() - b.isoWeek();
            var days = wk * 5 + Math.min(a.isoWeekday()+1,6) - Math.min(b.isoWeekday(), 6);
            if (swap) return -days;
            else return days;
        };
    }, {
        description: "Calculates the number of weekdays between two dates"
    }),
    NUMBERVALUE(opts, text) {
        return context => {
            return parseFloat(text(context));
        };
    },
    /* Absolute value */
    ABS(opts, expression) {
        return context => {
            return Math.abs(expression(context));
        };
    },
    CEILING(opts, expression, significance) {
        return context => {
            if (!significance) return Math.ceil(expression(context));
            var sig = significance(context);
            return precision(Math.ceil(expression(context)/sig)*sig);
        };
    },
    ROUND(opts, expression, count) {
        var scale = Math.pow(10, count ? count() : 0);
        return context => {
            return precision(Math.round(expression(context)*scale)/scale);
        };
    },
    FLOOR(opts, expression, significance) {
        return context => {
            if (!significance) return Math.floor(expression(context));
            var sig = significance(context);
            return precision(Math.floor(expression(context)/sig)*sig);
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
        var numbers = _.rest(arguments);
        if (numbers.length == 2) return context => {
            var a1 = a(context);
            var b1 = b(context);
            return a1 > b1 || b1 == null ? a1 : b1;
        }; else return context => {
            return _.max(numbers.map(num => num(context)));
        };
    },
    MIN(opts, a, b) {
        var numbers = _.rest(arguments);
        if (numbers.length == 2) return context => {
            var a1 = a(context);
            var b1 = b(context);
            return a1 < b1 || b1 == null ? a1 : b1;
        }; else return context => {
            return _.min(numbers.map(num => num(context)));
        };
    },
    /* Returns the sign of a number. Returns 1 if the number is positive, -1 if negative and 0 if zero. */
    SIGN: _.extend((opts, expression) => {
        return context => {
            var value = expression(context);
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
            return conditions.reduce((memo, fn) => memo && fn(context), 1);
        };
    },
    /* OR */
    OR(opts) {
        var conditions = _.rest(arguments);
        return context => {
            return conditions.reduce((memo, fn) => memo || fn(context), null);
        };
    },
    /* XOR */
    XOR(opts) {
        var conditions = _.rest(arguments);
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
        var conditions = _.filter(_.rest(arguments), (val, i) => (i +1) %2);
        var values = _.filter(_.rest(arguments), (val, i) => i %2);
        var elseValue = conditions.length > values.length ? conditions.pop() : () => null;
        return context => {
            var i = conditions.findIndex((fn, i) => fn(context));
            if (i < 0) return elseValue(context);
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
        return context => {
            return precision(a(context) + b(context));
        };
    },
    /* Subtraction */
    SUBTRACT(opts, a, b) {
        return context => {
            return precision(a(context) - b(context));
        };
    },
    /* Multiplication */
    PRODUCT: _.extend(function(opts, a, b) {
        if (arguments.length == 3) {
            return context => precision(a(context) * b(context));
        } else {
            var numbers = _.rest(arguments);
            return context => numbers.reduce((product, num) => {
                return precision(product * num(context));
            }, 1);
        }
    }, {
        args: "numbers..."
    }),
    /* Divide */
    DIVIDE(opts, n, d) {
        return context => {
            return precision(n(context) / d(context));
        };
    },
    /* Modulus */
    MOD(opts, number, divisor) {
        return context => {
            return precision(number(context) % divisor(context));
        };
    },
    /* Percent change ratio */
    CHANGE(opts, target, reference, denominator) {
        if (!target || !reference) throw Error("CHANGE requires two or three arguments");
        var den = denominator || reference;
        return bars => {
            var numerator = target(bars) - reference(bars);
            return precision(Math.round(numerator * 10000/ den(bars)) /100);
        };
    }
};

_.forEach(functions, fn => {
    fn.args = fn.args || fn.toString().match(/^[^(]*\(\s*opt\w*\s*,?\s*([^)]*)\)/)[1];
});

function precision(number) {
    if (!_.isNumber(number)) return number;
    var result = Math.round(number * 10000000000) / 10000000000;
    if (isFinite(result)) return result;
    else return null;
}
