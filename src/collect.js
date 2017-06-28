// collect.js
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
const moment = require('moment-timezone');
const List = require('./list.js');
const Parser = require('./parser.js');
const interrupt = require('./interrupt.js');
const common = require('./common-functions.js');
const rolling = require('./rolling-functions.js');
const quoting = require('./quoting-functions.js');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

/**
 * Delegates most computations to quote.js and add some functions that can compare
 * securities and read previous retained values.
 * @returns a function that returns array of row objects based on given options.
 */
module.exports = function(quote) {
    var temporal = 'DATETIME(ending)';
    return _.extend(function(options) {
        expect(options).to.have.property('portfolio');
        expect(options).to.have.property('columns');
        var portfolio = getPortfolio(options.portfolio);
        var columnNames = getColumnNames(options.columns, options);
        var formatColumns = getNeededColumns(_.flatten([
            options.columns, options.variables || []
        ]).join(','), options);
        var retainColumns = getNeededColumns(options.retain, options);
        var precedenceColumns = getNeededColumns(options.precedence, options);
        var allColumns = _.uniq(_.compact(_.flatten([
            'symbol',
            'exchange',
            'ending',
            temporal,
            formatColumns,
            retainColumns,
            precedenceColumns
        ])));
        var criteria = getQuoteCriteria(options.retain, false, options).join(' AND ');
        return Promise.all(portfolio.map(security => {
            return quote(_.defaults({
                variables: '',
                columns: allColumns,
                retain: criteria,
                criteria: getQuoteCriteria(options.criteria, true, options).join(' AND '),
                pad_leading: 0,
                pad_begin: (options.pad_begin || 0) + (options.pad_leading || 0)
            }, security, options));
        })).then(dataset => {
            var parser = createParser(temporal, quote, dataset, allColumns, options);
            return collectDataset(dataset, temporal, parser, options);
        }).then(collection => {
            var begin = moment(options.begin || moment(options.now).endOf('day')).toISOString();
            var start = _.sortedIndex(collection, {[temporal]: begin}, temporal) - (options.pad_begin || 0);
            if (start <= 0) return collection;
            else return collection.slice(start);
        }).then(collection => collection.reduce((result, points) => {
            var objects = _.values(points).filter(_.isObject).map(o => _.pick(o, columnNames));
            result.push.apply(result, objects);
            return result;
        }, []));
    }, {
        close() {}
    });
};

/**
 * Parses a comma separated list into symbol/exchange pairs.
 */
function getPortfolio(portfolio) {
    var array = _.isArray(portfolio) ? portfolio : portfolio.split(/\s*,\s*/);
    return array.map(symbolExchange => {
        var m = symbolExchange.match(/^(\S+)\W(\w+)$/);
        if (!m) throw Error("Unexpected symbol/exchange: " + symbolExchange);
        return {
            symbol: m[1],
            exchange: m[2]
        };
    });
}

/**
 * Returns the column names used
 */
function getColumnNames(columns, options) {
    var columns = _.flatten([columns || 'symbol']).join(',');
    var parser = createColumnParser(options);
    return _.keys(parser.parseColumnsMap(columns));
}

/**
 * Returns the expressions that should be delegated to quote.js
 */
function getNeededColumns(expr, options) {
    if (!expr) return [];
    var parser = createColumnParser(options);
    return _.uniq(_.flatten(_.values(parser.parseColumnsMap(expr)), true));
}

/**
 * Creates a parser that normalizes the column expressions
 */
function createColumnParser(options) {
    return Parser({
        substitutions: _.flatten([options.columns, options.variables || []]).join(','),
        constant(value) {
            return null;
        },
        variable(name) {
            return name;
        },
        expression(expr, name, args) {
            var order = name == 'DESC' || name == 'ASC';
            var fn = rolling.has(name);
            var roll = _.some(args, _.isArray);
            if (quoting.has(name)) return [];
            else if (!order && !fn && !roll) return expr;
            else return _.flatten(_.compact(args), true);
        }
    });
}

/**
 * Returns the retain expression that should be delegated to quote.js
 */
function getQuoteCriteria(expr, isCriteria, options) {
    if (!expr) return [];
    return _.compact(Parser({
        substitutions: _.flatten([options.columns, options.variables || []]).join(','),
        constant(value) {
            return _.isString(value) ? JSON.stringify(value) : value;
        },
        variable(name) {
            return name;
        },
        expression(expr, name, args) {
            var order = name == 'DESC' || name == 'ASC';
            var fn = rolling.has(name);
            var roll = _.some(args, _.isNull);
            if (!quoting.has(name) && !order && !fn && !roll) return expr;
            else if (isCriteria) throw Error("Cannot include " + name + " function in criteria");
            else return null;
        }
    }).parseCriteriaList(expr));
}

/**
 * Creates an expression parser that recognizes the rolling/quote functions.
 */
function createParser(temporal, quote, dataset, cached, options) {
    var external = _.memoize((expr, name, args) => {
        return quoting(expr, name, args, temporal, quote, dataset, options);
    });
    return Parser({
        substitutions: _.flatten([options.columns, options.variables || []]).join(','),
        constant(value) {
            return positions => value;
        },
        variable(name) {
            // [{"USD.CAD": {"close": 1.00}}]
            return _.compose(_.property(name), _.last, _.values, _.last);
        },
        expression(expr, name, args) {
            if (_.contains(cached, expr)) return _.compose(_.property(expr), _.last, _.values, _.last);
            return Promise.all(args).then(args => {
                var fn = common(name, args, options) ||
                    rolling(name, args, options) ||
                    external(expr, name, args);
                if (fn) return fn;
                else return () => {
                    throw Error("Only common and rolling functions can be used here: " + expr);
                };
            });
        }
    });
}

/**
 * Combines the quote.js results into a single array containing retained securities.
 */
function collectDataset(dataset, temporal, parser, options) {
    var precedenceColumns = getNeededColumns(options.precedence, options);
    var precedence = getPrecedence(options.precedence, precedenceColumns, options);
    return promiseColumns(parser, options)
      .then(columns => promiseRetain(parser, options)
      .then(retain => {
        return reduceInterval(dataset, temporal, (result, points) => {
            var positions = precedence.reduceRight((points, o) => {
                var positions = o.by ? _.sortBy(points, o.by) : points;
                if (o.desc) positions.reverse();
                return positions;
            }, points);
            var row = result.length;
            result[row] = positions.reduce((retained, point) => {
                var key = point.symbol + '.' + point.exchange;
                var pending = _.extend({}, retained, {
                    [key]: point
                });
                result[row] = pending;
                if (retain && !retain(result)) return retained;
                else return _.extend(pending, {
                    [key]: _.mapObject(columns, column => column(result))
                });
            }, {[temporal]: points[0][temporal]});
            return result;
        }, []);
    }));
}

/**
 * Create a function and direction that securities should be sorted with.
 */
function getPrecedence(expr, cached, options) {
    if (!expr) return [];
    else return _.values(Parser({
        substitutions: _.flatten([options.columns, options.variables || []]).join(','),
        constant(value) {
            return {};
        },
        variable(name) {
            return {by: name};
        },
        expression(expr, name, args) {
            if (name == 'DESC') return {desc: true, by: _.first(args).by};
            else if (name == 'ASC') return {desc: false, by:  _.first(args).by};
            else if (_.contains(cached, expr)) return {by: expr};
            else if (!rolling.has(name) && !quoting.has(name)) return {};
            else throw Error("Aggregate functions cannot be used here: " + expr);
        }
    }).parseColumnsMap(expr));
}

/**
 * @returns a map of functions that can compute the column values for a given row.
 */
function promiseColumns(parser, options) {
    var columns = _.flatten([
        options.variables || [],
        options.columns || 'symbol'
    ]).join(',');
    var map = parser.parseColumnsMap(columns);
    return Promise.all(_.values(map)).then(values => _.object(_.keys(map), values));
}

/**
 * Returns a function that can determine if the security should be retained
 */
function promiseRetain(parser, options) {
    var expr = options.retain;
    if (!expr) return Promise.resolve(_.constant(true));
    return Promise.resolve(parser.parse(expr));
}

/**
 * Takes the quote.js results as an array and matches the results by temporal date calling cb.
 */
function reduceInterval(data, temporal, cb, memo) {
    var check = interrupt();
    var lists = data.map(ar => List.from(ar));
    while (lists.some(list => list.length)) {
        check();
        var ending = _.first(_.compact(_.pluck(lists.map(list => list.first()), temporal)).sort());
        var points = _.compact(lists.map(list => {
            if (list.length && list.first()[temporal] == ending) return list.shift();
        }));
        memo = cb(memo, points);
    }
    return memo;
}
