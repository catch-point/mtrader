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
'use strict';

const _ = require('underscore');
const Big = require('big.js');
const statkit = require("statkit");
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const logger = require('./logger.js');

/**
 * These functions operate of an array of securities at the corresponding points in time.
 */
module.exports = function(expr, name, args, options) {
    if (functions[name]) {
        const columnName = Parser({
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

module.exports.getVariables = function(expr, options) {
    const variables = [];
    const parser = Parser({
        constant(value) {
            return _.constant(value);
        },
        variable(name) {
            variables.push(name);
            return _.constant(0);
        },
        expression(expr, name, args) {
            if (module.exports.has(name)) {
                let columnName;
                args.forEach(arg => {
                    const value = arg && arg();
                    if (!_.isString(value)) return;
                    if (!columnName) columnName = value;
                    const compare = _.contains(['<', '>', '='], value.charAt(0));
                    const rel = compare || value.indexOf('!=') === 0;
                    const expr = rel ? columnName + value : value;
                    parser.parse(expr);
                });
                return _.constant(0);
            } else if (common.has(name)) {
                return common(name, args, options);
            } else {
                return _.constant(0);
            }
        }
    });
    try {
        const parsed = parser.parse(expr);
    } catch(e) {
        logger.debug(expr, e);
    }
    return variables;
};

const functions = module.exports.functions = {
    PREC: _.extend((options, name, columnExpr, defaultValue) => {
        return positions => {
            const keys = _.keys(_.pick(_.last(positions), _.isObject));
            const previously = positions[positions.length -2];
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
            const num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            const len = positions.length -1;
            const bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            if (!name) return bars.length -1;
            const condition = name && parseCriteria(name, criteria, positions, options);
            const values = _.pluck(_.initial(bars).filter(condition), name);
            return values.filter(val => val === 0 || val).length;
        };
    }, {
        args: "[columnName, [numberOfIntervals, [criteria]]]",
        description: "Counts the number of retained values that preceed this value"
    }),
    SUMPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            const num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            const len = positions.length -1;
            const bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const condition = parseCriteria(name, criteria, positions, options);
            const values = _.pluck(_.initial(bars).filter(condition), name);
            return +values.filter(_.isFinite).reduce((a, b) => a.add(b), Big(0));
        };
    }, {
        args: "columnName, [numberOfIntervals, [criteria]]",
        description: "Returns the sum of all numeric values that preceed this"
    }),
    MAXPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            const num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            const len = positions.length -1;
            const bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const condition = parseCriteria(name, criteria, positions, options);
            const values = _.pluck(_.initial(bars).filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.max(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfIntervals, [criteria]]",
        description: "Returns the maximum of all numeric values that preceed this"
    }),
    MINPREC: _.extend((options, name, columnExpr, numberOfIntervals, criteria) => {
        return positions => {
            const num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            const len = positions.length -1;
            const bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const condition = parseCriteria(name, criteria, positions, options);
            const values = _.pluck(_.initial(bars).filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.min(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfIntervals, [criteria]]",
        description: "Returns the minimum of all numeric values that preceed this"
    }),
    LOOKUP: _.extend((options, name, columnExpr, criteria) => {
        return positions => {
            const condition = parseCriteria(name, criteria, positions, options);
            for (let p=positions.length-1; p>=0; p--) {
                const bars = _.values(positions[p]).filter(ctx => _.isObject(ctx));
                for (let b = bars.length-1; b>=0; b--) {
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
            const key = _.last(_.keys(_.last(positions)));
            for (let i=positions.length-2; i>=0; i--) {
                const previously = positions[i];
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
            const num = numberOfValues ? numberOfValues(positions) : 0;
            const key = _.last(_.keys(_.last(positions)));
            const len = positions.length -1;
            const previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            if (!name) return bars.length -1;
            const condition = name && parseCriteria(name, criteria, positions, options);
            const values = _.pluck(previous.filter(condition), name);
            return _.filter(values, val => val === 0 || val).length;
        };
    }, {
        args: "[columnName, [numberOfValues, [criteria]]]",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    SUMPREV: _.extend((options, name, columnExpr, numberOfValues, criteria) => {
        return positions => {
            if (positions.length < 2) return 0;
            const num = numberOfValues ? numberOfValues(positions) : 0;
            const key = _.last(_.keys(_.last(positions)));
            const len = positions.length -1;
            const previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            const condition = parseCriteria(name, criteria, positions, options);
            const values = _.pluck(previous.filter(condition), name);
            return +values.filter(_.isFinite).reduce((a, b) => a.add(b), Big(0));
        };
    }, {
        args: "columnName, [numberOfValues, [criteria]]",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    MAXPREV: _.extend((options, name, columnExpr, numberOfValues, criteria) => {
        return positions => {
            if (positions.length < 2) return null;
            const num = numberOfValues ? numberOfValues(positions) : 0;
            const key = _.last(_.keys(_.last(positions)));
            const len = positions.length -1;
            const condition = parseCriteria(name, criteria, positions, options);
            const previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            const values = _.pluck(previous.filter(condition), name).filter(_.isFinite);
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
            const num = numberOfValues ? numberOfValues(positions) : 0;
            const key = _.last(_.keys(_.last(positions)));
            const len = positions.length -1;
            const condition = parseCriteria(name, criteria, positions, options);
            const previous = _.pluck(positions.slice(Math.max(+Big(len||0).minus(num||0), 0), len), key);
            const values = _.pluck(previous.filter(condition), name).filter(_.isFinite);
            if (values.length) return values.reduce((a, b) => Math.min(a, b));
            else return null;
        };
    }, {
        args: "columnName, [numberOfValues, [criteria]]",
        description: "Returns the minimum of columnName values from the previous numberOfValues retained"
    }),
    COUNTTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            const bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            if (!name) return bars.length;
            const values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return values.filter(val => val === 0 || val).length;
        };
    }, {
        args: "[column]",
        description: "Counts the number of retained values"
    }),
    SUMTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            const bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return +values.filter(_.isFinite).reduce((a, b) => a.add(b), Big(0));
        };
    }, {
        args: "column",
        description: "Returns the sum of all numeric values"
    }),
    MINTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            const bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return _.first(_.sortBy(values));
        };
    }, {
        args: "column",
        description: "Returns the minimum of all numeric values"
    }),
    MAXTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            const bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            return _.last(_.sortBy(values));
        };
    }, {
        args: "column",
        description: "Returns the maximum of all numeric values"
    }),
    MEDIANTOTAL: _.extend((options, name, columnExpr) => {
        return positions => {
            const bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            const sorted = _.sortBy(values);
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
            const bars = _.flatten(positions.map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            const values = _.pluck(_.initial(bars), name);
            values.push(columnExpr(positions));
            const avg = values.reduce((a,b)=>a.add(b),Big(0)).div(values.length);
            const sd = values.map(function(num){
                const diff = Big(num).minus(avg);
                return diff.times(diff);
            }).reduce((a,b)=>a.add(b),Big(0)).div(Math.max(values.length,1)).sqrt();
            return +sd || 1;
        };
    }, {
        args: "column",
        description: "Estimates the standard deviation based on all numeric values"
    })
};

function parseCriteria(columnName, criteria, positions, options) {
    if (!criteria)
        return parseCriteria(columnName, `${columnName} OR ${columnName}=0`, positions, options);
    if (_.isFunction(criteria))
        return parseCriteria(columnName, criteria(positions), positions, options);
    if (!_.isString(criteria) && criteria instanceof Big) // number
        return context => +context[columnName] == +criteria;
    if (!_.isString(criteria)) // not a string, must be a value
        return context => context[columnName] == criteria;
    if (_.contains(['<', '>', '='], criteria.charAt(0)) || criteria.indexOf('!=') === 0)
        return parseCriteria(columnName, columnName + criteria, positions, options);
    try {
        let expression = false;
        const parsed = Parser({
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
