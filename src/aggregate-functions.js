// aggregate-functions.js
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

/**
 * These functions operate of an array of securities at the same point in time.
 */
module.exports = function(name, args, quote, dataset, options) {
    if (functions[name])
        return functions[name].apply(this, [quote, dataset, options].concat(args));
};

var functions = module.exports.functions = {
    COUNT: _.extend((quote, dataset, options, expression) => {
        return positions => {
            return positions.map(position => expression([position])).filter(val => val != null).length;
        };
    }, {
        args: "expression",
        description: "Counts the number of positions that evaluate expression to a value"
    }),
    SUM: _.extend((quote, dataset, options, expression) => {
        return positions => {
            return positions.map(position => expression([position]))
                .filter(_.isFinite).reduce((a, b) => a + b);
        };
    }, {
        args: "expression",
        description: "Returns the sum of all numeric values"
    }),
    MAXCORREL: _.extend((quote, dataset, options, duration, expression) => {
        var n = asPositiveInteger(duration, "MAXCORREL");
        if (!_.has(expression, 'expression')) throw Error("Cannot nest aggregate functions in MAXCORREL");
        var expr = expression.expression;
        var filtered = dataset.filter(data => !_.isEmpty(data));
        if (filtered.length < 2) return positions => 0;
        var optionset = filtered.map(data => {
            var first = _.first(data);
            var last = _.last(data);
            return _.defaults({
                symbol: first.symbol,
                exchange: first.exchange,
                columns: 'ending,' + expr,
                pad_begin: n,
                begin: first.ending,
                end: last.ending,
                pad_end: 0,
                criteria: null
            }, options);
        });
        return Promise.all(optionset.map(options => quote(options))).then(dataset => {
            return positions => {
                if (positions.length < 2) return 0;
                var matrix = positions.map(position => {
                    var i =_.findIndex(optionset, _.matcher(_.pick(position, 'symbol', 'exchange')));
                    if (i < 0) return [];
                    var data = dataset[i];
                    var end = _.sortedIndex(data, position, 'ending');
                    if (data[end] && data[end].ending == position.ending) end++;
                    return _.pluck(data.slice(Math.max(end - n, 0), end), expr);
                });
                var correlations = _.initial(positions).map((position, i) => {
                    return statkit.corr(matrix[i], _.last(matrix));
                });
                return _.max(correlations);
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
