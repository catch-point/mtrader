// rolling-functions.js
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

const _ = require('underscore');
const statkit = require("statkit");
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const logger = require('./logger.js');

/**
 * These functions operate of an array of securities at the corresponding points in time.
 */
module.exports = function(expr, name, args, options) {
    if (functions[name]) {
        var columnName = Parser({
            constant(value) {
                return value;
            },
            variable(name) {
                return name;
            },
            expression(expr, name, args) {
                return args[0] || '';
            }
        }).parse(expr);
        return functions[name].apply(this, [options, columnName].concat(args));
    }
};

module.exports.has = function(name) {
    return !!functions[name];
};

module.exports.getVariables = function(expr) {
    var variables = [];
    var parser = Parser({
        constant(value) {
            return _.constant(value);
        },
        variable(name) {
            variables.push(name);
            return null;
        },
        expression(expr, name, args) {
            if (module.exports.has(name)) {
                var columnName;
                args.forEach(arg => {
                    var value = arg && arg();
                    if (!_.isString(value)) return;
                    if (!columnName) columnName = value;
                    var compare = _.contains(['<', '>', '='], value.charAt(0));
                    var rel = compare || value.indexOf('!=') === 0;
                    var expr = rel ? columnName + value : value;
                    parser.parse(expr);
                });
                return null;
            } else if (args.some(_.isNull)) {
                return null;
            } else {
                return common(name, args, options);
            }
        }
    });
    try {
        var parsed = parser.parse(expr);
    } catch(e) {
        logger.debug(expr, e);
    }
    return variables;
};

var functions = module.exports.functions = {
    PREC: _.extend((options, name, columnExpr, defaultValue) => {
        return positions => {
            var keys = _.keys(_.pick(_.last(positions), _.isObject));
            var previously = positions[positions.length -2];
            if (keys.length > 1)
                return _.last(positions)[keys[keys.length-2]][name];
            else if (previously)
                return previously[_.last(_.keys(_.pick(previously, _.isObject)))][name];
            else if (defaultValue)
                return defaultValue(positions);
            else
                return null;
        };
    }, {
        args: "columnName, defaultValue",
        description: "Returns the value of columnName from the preceeding retained value"
    }),
    COUNTPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            var num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            if (!name) return bars.length -1;
            var condition = name && parseCriteria(name, criteria, positions, options);
            var values = _.pluck(_.initial(bars).filter(condition), name);
            return values.filter(val => val === 0 || val).length;
        };
    }, {
        args: "[columnName, [numberOfIntervals, [criteria]]]",
        description: "Counts the number of retained values that preceed this value"
    }),
    SUMPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            var num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var condition = parseCriteria(name, criteria, positions, options);
            var values = _.pluck(_.initial(bars).filter(condition), name);
            return values.filter(_.isFinite).reduce((a, b) => a + b, 0);
        };
    }, {
        args: "columnName, [numberOfIntervals, [criteria]]",
        description: "Returns the sum of all numeric values that preceed this"
    }),
    MAXPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            var num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var condition = parseCriteria(name, criteria, positions, options);
            var values = _.pluck(_.initial(bars).filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.max(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfIntervals, [criteria]]",
        description: "Returns the maximum of all numeric values that preceed this"
    }),
    MINPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            var num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var condition = parseCriteria(name, criteria, positions, options);
            var values = _.pluck(_.initial(bars).filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.min(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfIntervals, [criteria]]",
        description: "Returns the minimum of all numeric values that preceed this"
    }),
    LOOKUP: _.extend((options, name, columnExpr, criteria) => {
        return positions => {
            var condition = parseCriteria(name, criteria, positions, options);
            for (var p=positions.length-1; p>=0; p--) {
                var bars = _.values(positions[p]).filter(ctx => _.isObject(ctx));
                for (var b = bars.length-1; b>=0; b--) {
                    if (condition(bars[b])) return bars[b][name];
                }
            }
            return null;
        };
    }, {
        args: "columnName, criteria",
        description: "Returns the value of columnName of a row that matches criteria"
    }),
    PREV: _.extend((options, name, columnExpr, defaultValue) => {
        return positions => {
            var key = _.last(_.keys(_.last(positions)));
            for (var i=positions.length-2; i>=0; i--) {
                var previously = positions[i];
                if (_.has(previously, key)) return previously[key][name];
            }
            if (defaultValue) return defaultValue(positions);
            else return null;
        };
    }, {
        args: "columnName, defaultValue",
        description: "Returns the value of columnName from the previous retained value for this security"
    }),
    COUNTPREV: _.extend((options, name, columnExpr, numberOfValues, criteria) => {
        return positions => {
            if (positions.length < 2) return 0;
            var num = numberOfValues ? numberOfValues(positions) : 0;
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            if (!name) return bars.length -1;
            var condition = name && parseCriteria(name, criteria, positions, options);
            var values = _.pluck(previous.filter(condition), name);
            return _.filter(values, val => val === 0 || val).length;
        };
    }, {
        args: "[columnName, [numberOfValues, [criteria]]]",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    SUMPREV: _.extend((options, name, columnExpr, numberOfValues, criteria) => {
        return positions => {
            if (positions.length < 2) return 0;
            var num = numberOfValues ? numberOfValues(positions) : 0;
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            var condition = parseCriteria(name, criteria, positions, options);
            var values = _.pluck(previous.filter(condition), name);
            return values.reduce((a, b) => (a || 0) + (b || 0), 0);
        };
    }, {
        args: "columnName, [numberOfValues, [criteria]]",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    MAXPREV: _.extend((options, name, columnExpr, numberOfValues, criteria) => {
        return positions => {
            if (positions.length < 2) return null;
            var num = numberOfValues ? numberOfValues(positions) : 0;
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var condition = parseCriteria(name, criteria, positions, options);
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            var values = _.pluck(previous.filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.max(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfValues, [criteria]]",
        description: "Returns the maximum of columnName values from the previous numberOfValues retained"
    }),
    MINPREV: _.extend((options, name, columnExpr, numberOfValues, criteria) => {
        return positions => {
            if (positions.length < 2) return null;
            var num = numberOfValues ? numberOfValues(positions) : 0;
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var condition = parseCriteria(name, criteria, positions, options);
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            var values = _.pluck(previous.filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.min(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfValues, [criteria]]",
        description: "Returns the minimum of columnName values from the previous numberOfValues retained"
    }),
    COUNTTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            var bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            if (!name) return bars.length;
            var values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return values.filter(val => val === 0 || val).length;
        };
    }, {
        args: "[column]",
        description: "Counts the number of retained values"
    }),
    SUMTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            var bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return values.filter(_.isFinite).reduce((a, b) => a + b, 0);
        };
    }, {
        args: "column",
        description: "Returns the sum of all numeric values"
    }),
    MINTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            var bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return _.first(_.sortBy(values));
        };
    }, {
        args: "column",
        description: "Returns the minimum of all numeric values"
    }),
    MAXTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            var bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return _.last(_.sortBy(values));
        };
    }, {
        args: "column",
        description: "Returns the maximum of all numeric values"
    }),
    MEDIANTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            var bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            var sorted = _.sortBy(values);
            if (sorted.length == 1) return sorted[0];
            else if (sorted.length % 2 == 1) return sorted[(sorted.length-1) / 2];
            else return (sorted[sorted.length/2-1] + sorted[sorted.length/2])/2;
        };
    }, {
        args: "column",
        description: "Returns the median of a set of numbers. In a set containing an uneven number of values, the median will be the number in the middle of the set and in a set containing an even number of values, it will be the mean of the two values in the middle of the set."
    }),
    STDEVTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            var bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            var avg = values.reduce((a,b)=>a+b,0) / values.length;
            var sd = Math.sqrt(values.map(function(num){
                var diff = num - avg;
                return diff * diff;
            }).reduce((a,b)=>a+b,0) / Math.max(values.length,1));
            return sd || 1;
        };
    }, {
        args: "column",
        description: "Estimates the standard deviation based on all numeric values"
    })
};

function parseCriteria(columnName, criteria, positions, options) {
    if (!criteria)
        return _.constant(true);
    if (_.isFunction(criteria))
        return parseCriteria(columnName, criteria(positions), positions, options);
    if (!_.isString(criteria)) // not a string, must be a value
        return context => context[columnName] == criteria;
    if (_.contains(['<', '>', '='], criteria.charAt(0)) || criteria.indexOf('!=') === 0)
        return parseCriteria(columnName, columnName + criteria, positions, options);
    try {
        var expression = false;
        var parsed = Parser({
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
