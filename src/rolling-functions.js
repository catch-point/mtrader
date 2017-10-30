// rolling-functions.js
/*
 *  Copyright (c) 2017 James Leigh, Some Rights Reserved
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

/**
 * These functions operate of an array of securities at the corresponding points in time.
 */
module.exports = function(name, args, options) {
    if (functions[name])
        return functions[name].apply(this, [options].concat(args));
};

module.exports.has = function(name) {
    return !!functions[name];
};

var functions = module.exports.functions = {
    PREC: _.extend((options, columnName, defaultValue) => {
        return positions => {
            var name = columnName(positions);
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
    COUNTPREC: _.extend((options, numberOfIntervals, columnName, criteria) => {
        var name = columnName && columnName();
        var condition = name && parseCriteria(name, criteria, options);
        return positions => {
            var num = numberOfIntervals ? numberOfIntervals(positions) : 0;
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            if (!name) return bars.length -1;
            var values = _.pluck(_.initial(bars).filter(condition), name);
            return values.filter(val => val === 0 || val).length;
        };
    }, {
        args: "[numberOfIntervals, [columnName, [criteria]]]",
        description: "Counts the number of retained values that preceed this value"
    }),
    SUMPREC: _.extend((options, numberOfIntervals, columnName, criteria) => {
        var name = columnName();
        var condition = parseCriteria(name, criteria, options);
        return positions => {
            var num = numberOfIntervals(positions);
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars).filter(condition), name);
            return values.filter(_.isFinite).reduce((a, b) => a + b, 0);
        };
    }, {
        args: "numberOfIntervals, columnName, [criteria]",
        description: "Returns the sum of all numeric values that preceed this"
    }),
    MAXPREC: _.extend((options, numberOfIntervals, columnName, criteria) => {
        var name = columnName();
        var condition = parseCriteria(name, criteria, options);
        return positions => {
            var num = numberOfIntervals(positions);
            var len = positions.length -1;
            var bars = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.values(positions).filter(ctx => _.isObject(ctx));
            }), true);
            var values = _.pluck(_.initial(bars).filter(condition), name);
            return values.filter(_.isFinite).reduce((a, b) => Math.max(a, b), 0);
        };
    }, {
        args: "numberOfIntervals, columnName, [criteria]",
        description: "Returns the maximum of all numeric values that preceed this"
    }),
    PREV: _.extend((options, columnName, defaultValue) => {
        return positions => {
            var name = columnName(positions);
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
    COUNTPREV: _.extend((options, numberOfValues, columnName, criteria) => {
        var name = columnName && columnName();
        var condition = name && parseCriteria(name, criteria, options);
        return positions => {
            if (positions.length < 2) return 0;
            var num = numberOfValues ? numberOfValues(positions) : 0;
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            if (!name) return bars.length -1;
            var values = _.pluck(previous.filter(condition), name);
            return _.filter(values, val => val === 0 || val).length;
        };
    }, {
        args: "[numberOfValues, [columnName, [criteria]]]",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    SUMPREV: _.extend((options, numberOfValues, columnName, criteria) => {
        var name = columnName();
        var condition = parseCriteria(name, criteria, options);
        return positions => {
            if (positions.length < 2) return 0;
            var num = numberOfValues(positions);
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            var values = _.pluck(previous.filter(condition), name);
            return values.reduce((a, b) => (a || 0) + (b || 0), 0);
        };
    }, {
        args: "numberOfValues, columnName, [criteria]",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    MAXPREV: _.extend((options, numberOfValues, columnName, criteria) => {
        var name = columnName();
        var condition = parseCriteria(name, criteria, options);
        return positions => {
            if (positions.length < 2) return 0;
            var num = numberOfValues(positions);
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var previous = _.pluck(positions.slice(Math.max(len - num, 0), len), key);
            var values = _.pluck(previous.filter(condition), name);
            return values.filter(_.isFinite).reduce((a, b) => Math.max(a, b), 0);
        };
    }, {
        args: "numberOfValues, columnName, [criteria]",
        description: "Returns the maximum of columnName values from the previous numberOfValues retained"
    })
};

function parseCriteria(columnName, criteria, options) {
    if (!criteria)
        return _.constant(true);
    if (_.isFunction(criteria))
        return parseCriteria(columnName, criteria(), options);
    if (!_.isString(criteria))
        return parseCriteria(columnName, criteria.toString(), options);
    if (_.contains(['<', '>', '=', '!'], criteria.charAt(0)))
        return parseCriteria(columnName, columnName + criteria, options);
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
