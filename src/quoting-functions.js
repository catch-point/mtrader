// quoting-functions.js
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
const statkit = require("statkit");
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const expect = require('chai').expect;

/**
 * These functions operate of an array of securities at the same point in time.
 */
module.exports = function(expr, name, args, quote, dataset, options) {
    expect(options).to.have.property('indexCol').that.is.a('string');
    expect(options).to.have.property('symbolCol').that.is.a('string');
    expect(options).to.have.property('marketCol').that.is.a('string');
    expect(options).to.have.property('temporalCol').that.is.a('string');
    if (functions[name])
        return functions[name].apply(this, [quote, dataset, options, expr].concat(args));
};

module.exports.has = function(name) {
    return !!functions[name];
};

const functions = module.exports.functions = {
    MAXCORREL: _.extend((quote, dataset, options, expr, duration, expression, criteria) => {
        const n = asPositiveInteger(duration, "MAXCORREL");
        const arg = Parser({
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
        const filtered = dataset.filter(data => !_.isEmpty(data));
        if (filtered.length < 2) return positions => 0;
        const condition = parseCriteria(arg, criteria, options);
        const optionset = filtered.map(data => {
            const first = _.first(data);
            const last = _.last(data);
            return _.defaults({
                index: first[options.indexCol],
                symbol: first[options.symbolCol],
                market: first[options.marketCol],
                variables: {},
                columns: {
                    [options.temporalCol]: 'DATETIME(ending)',
                    [arg]: arg
                },
                pad_begin: n,
                begin: first[options.temporalCol],
                end: last[options.temporalCol],
                pad_end: 0,
                criteria: null
            }, options);
        });
        return Promise.all(optionset.map(options => quote(options))).then(dataset => {
            return dataset.reduce((hash, data, i) => {
                hash[optionset[i].index] = data;
                return hash;
            }, {});
        }).then(dataset => {
            return historic => {
                const positions = _.last(historic);
                if (_.size(positions) < 2) return 0;
                const matrix = _.keys(_.pick(positions, _.isObject)).map((symbol, i, keys) => {
                    if (i < keys.length -1 && !condition(positions[symbol])) return null;
                    const data = dataset[symbol];
                    if (!data) throw Error("Could not find dataset: " + symbol);
                    let end = _.sortedIndex(data, positions, options.temporalCol);
                    if (data[end] && data[end][options.temporalCol] == positions[options.temporalCol]) end++;
                    return _.pluck(data.slice(Math.max(end - n, 0), end), arg);
                });
                const last = matrix.pop();
                const correlations = _.compact(matrix).map(m => {
                    return statkit.corr(m, last);
                });
                if (!correlations.length) return 0;
                else return _.max(correlations);
            };
        });
    }, {
        args: "duration, expression, [criteria]",
        description: "Maximum correlation coefficient among other securities"
    })
};

function asPositiveInteger(calc, msg) {
    try {
        const n = calc();
        if (n > 0 && _.isFinite(n) && Math.round(n) == n) return n;
    } catch (e) {}
    throw Error("Expected a literal positive interger in " + msg + " not " + n);
}

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
