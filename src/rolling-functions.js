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

/**
 * These functions operate of an array of securities at the same point in time.
 */
module.exports = function(expr, name, args, temporal, quote, dataset, options) {
    if (functions[name])
        return functions[name].apply(this, [temporal, quote, dataset, options, expr].concat(args));
};

var functions = module.exports.functions = {
    PREC: _.extend((temporal, quote, dataset, options, expr, columnName, defaultValue) => {
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
    COUNTPREC: _.extend((temporal, quote, dataset, options, expr, numberOfIntervals, columnName) => {
        return positions => {
            var name = columnName(positions);
            var num = numberOfIntervals(positions);
            var len = positions.length -1;
            var values = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.pluck(_.values(positions).filter(_.isObject), name);
            }), true);
            return _.filter(_.initial(values), val => val === 0 || val).length;
        };
    }, {
        args: "numberOfIntervals, columnName",
        description: "Counts the number of retained values that preceed this value"
    }),
    SUMPREC: _.extend((temporal, quote, dataset, options, expr, numberOfIntervals, columnName) => {
        return positions => {
            var name = columnName(positions);
            var num = numberOfIntervals(positions);
            var len = positions.length -1;
            var values = _.flatten(positions.slice(Math.max(len - num, 0)).map(positions => {
                return _.pluck(_.values(positions).filter(_.isObject), name);
            }), true);
            return _.initial(values).filter(_.isFinite).reduce((a, b) => a + b, 0);
        };
    }, {
        args: "numberOfIntervals, columnName",
        description: "Returns the sum of all numeric values that preceed this"
    }),
    PREV: _.extend((temporal, quote, dataset, options, expr, columnName, defaultValue) => {
        return positions => {
            var name = columnName(positions);
            var key = _.last(_.keys(_.last(positions)));
            var previously = positions[positions.length -2];
            if (_.has(previously, key)) return previously[key][name];
            else if (defaultValue) return defaultValue(positions);
            else return null;
        };
    }, {
        args: "columnName, defaultValue",
        description: "Returns the value of columnName from the previous retained value for this security"
    }),
    COUNTPREV: _.extend((temporal, quote, dataset, options, expr, numberOfValues, columnName) => {
        return positions => {
            if (positions.length < 2) return 0;
            var name = columnName(positions);
            var num = numberOfValues(positions);
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var values = _.pluck(_.pluck(positions.slice(Math.max(len - num, 0), len), key), name);
            return _.filter(values, val => val === 0 || val).length;
        };
    }, {
        args: "numberOfValues, columnName",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    SUMPREV: _.extend((temporal, quote, dataset, options, expr, numberOfValues, columnName) => {
        return positions => {
            if (positions.length < 2) return 0;
            var name = columnName(positions);
            var num = numberOfValues(positions);
            var key = _.last(_.keys(_.last(positions)));
            var len = positions.length -1;
            var values = _.pluck(_.pluck(positions.slice(Math.max(len - num, 0), len), key), name);
            return values.reduce((a, b) => (a || 0) + (b || 0), 0);
        };
    }, {
        args: "numberOfValues, columnName",
        description: "Returns the sum of columnName values from the previous numberOfValues retained"
    }),
    MAXCORREL: _.extend((temporal, quote, dataset, options, expr, duration, expression) => {
        var n = asPositiveInteger(duration, "MAXCORREL");
        var arg = Parser({
            constant(value) {
                return [value];
            },
            variable(name) {
                return [name];
            },
            expression(expr, name, args) {
                return [expr].concat(args.map(_.first));
            }
        }).parse(expr)[2];
        if (!arg) throw Error("Unrecongized call to MAXCORREL: " + expr);
        var filtered = dataset.filter(data => !_.isEmpty(data));
        if (filtered.length < 2) return positions => 0;
        var optionset = filtered.map(data => {
            var first = _.first(data);
            var last = _.last(data);
            return _.defaults({
                symbol: first.symbol,
                exchange: first.exchange,
                columns: temporal + ',' + arg,
                pad_begin: n,
                begin: first.ending,
                end: last.ending,
                pad_end: 0,
                retain: null
            }, options);
        });
        return Promise.all(optionset.map(options => quote(options))).then(dataset => {
            return dataset.reduce((hash, data, i) => {
                var key = optionset[i].symbol + '.' + optionset[i].exchange;
                hash[key] = data;
                return hash;
            }, {});
        }).then(dataset => {
            return historic => {
                var positions = _.last(historic);
                if (_.size(positions) < 2) return 0;
                var matrix = _.keys(_.pick(positions, _.isObject)).map((symbol, i, keys) => {
                    var position = positions[symbol];
                    var data = dataset[symbol];
                    if (!data) throw Error("Could not find dataset: " + symbol);
                    var end = _.sortedIndex(data, positions, temporal);
                    if (data[end] && data[end][temporal] == positions[temporal]) end++;
                    return _.pluck(data.slice(Math.max(end - n, 0), end), arg);
                });
                var last = matrix.pop();
                var correlations = _.compact(matrix).map(m => {
                    return statkit.corr(m, last);
                });
                if (!correlations.length) return 0;
                else return _.max(correlations);
            };
        });
    }, {
        args: "duration, expression",
        description: "Maximum correlation coefficient among other securities"
    })
};

function asPositiveInteger(calc, msg) {
    try {
        var n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg + " not " + n);
}
