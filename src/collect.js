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
const Parser = require('./parser.js');
const periods = require('./periods.js');
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
module.exports = function(quote, collectFn) {
    var temporal = 'DATETIME(ending)';
    var collections = _.object(config.list(), []);
    var self;
    return self = _.extend(function(options) {
        expect(options).to.have.property('portfolio');
        expect(options).to.have.property('columns').that.is.an('object');
        var collect = collectFn || self;
        var portfolio = getPortfolio(options.portfolio, collections, options);
        var colParser = createColumnParser(options);
        var columns = parseNeededColumns(options);
        var columnNames = _.object(_.keys(options.columns), _.keys(columns));
        var formatColumns = _.flatten(colParser.parse(_.values(columns)), true);
        var criteriaColumns = _.flatten(colParser.parseCriteriaList(_.flatten(_.compact([
            options.retain, options.filter, options.precedence, options.order
        ]), true)), true);
        var allColumns = _.uniq(_.flatten(_.compact([
            'symbol',
            'exchange',
            'ending',
            temporal,
            formatColumns,
            criteriaColumns
        ]), true));
        var criteria = getQuoteCriteria(options.retain, getVariables(options));
        return Promise.all(portfolio.map(opts => {
            var pad_begin = (options.pad_begin || 0) + (options.pad_leading || 0);
            if (opts.portfolio) {
                // inline opts.columns
                var used = getUsedColumns(opts);
                var normalizer = createNormalizeParser(opts.columns);
                var columns = normalizer.parse(allColumns);
                var filter = [opts.filter, normalizer.parse(criteria)];
                return collect(_.defaults({
                    columns: _.extend(_.object(allColumns, columns), _.pick(opts.columns, used)),
                    filter: _.flatten(_.compact(filter), true),
                    pad_begin: pad_begin,
                    order: _.flatten(_.compact([temporal, opts.order]), true)
                }, opts));
            } else {
                return quote(_.defaults({
                    columns: _.object(allColumns, allColumns),
                    retain: criteria,
                    pad_begin: pad_begin
                }, opts));
            }
        })).then(dataset => {
            var parser = createParser(temporal, quote, dataset, allColumns, options);
            return collectDataset(dataset, temporal, parser, columns, criteriaColumns, options);
        }).then(collection => {
            var begin = moment(options.begin || moment(options.now).endOf('day')).toISOString();
            var start = _.sortedIndex(collection, {[temporal]: begin}, temporal) - (options.pad_begin || 0);
            if (start <= 0) return collection;
            else return collection.slice(start);
        }).then(collection => collection.reduce((result, points) => {
            var filter = getOrderBy(options.filter, columns, options);
            var objects = _.values(points).filter(_.isObject)
                .filter(point => !filter.find(criteria => criteria.by && !point[criteria.by]));
            if (!_.isEmpty(objects)) result.push.apply(result, objects);
            return result;
        }, [])).then(result => {
            var order = getOrderBy(options.order, columns, options);
            return sortBy(result, order);
        }).then(result => {
            return result.map(o => _.object(_.keys(columnNames), _.values(columnNames).map(key => o[key])))
        });
    }, {
        close() {}
    });
};

/**
 * Parses a comma separated list into symbol/exchange pairs.
 */
function getPortfolio(portfolio, collections, options) {
    var opts = _.omit(options, [
        'portfolio', 'columns', 'variables', 'retain', 'filter', 'precedence', 'order', 'pad_leading'
    ]);
    var array = _.isArray(portfolio) ? portfolio : portfolio.split(/\s*,\s*/);
    return array.map(symbolExchange => {
        if (_.contains(options.upstream, symbolExchange))
            throw Error("Cycle profile detected: " + options.upstream + " -> " + symbolExchange);
        var m = symbolExchange.match(/^(\S+)\W(\w+)$/);
        if (!m || !collections[symbolExchange] && _.has(collections, symbolExchange)) {
            var cfg = config.read(symbolExchange);
            if (cfg) collections[symbolExchange] = cfg;
        }
        if (collections[symbolExchange]) return _.defaults({
            upstream: _.flatten(_.compact([options.upstream, symbolExchange]), true)
        }, collections[symbolExchange], opts);
        if (!m) throw Error("Unexpected symbol.exchange: " + symbolExchange);
        return _.defaults({
            symbol: m[1],
            exchange: m[2]
        }, opts);
    });
}

/**
 * Creates a parser that normalizes the column expressions
 */
function createColumnParser(options) {
    return Parser({
        substitutions: getVariables(options),
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
 * Changes column names to avoid variable name conflicts and add variables used
 * in rolling functions to the end of the array.
 */
function parseNeededColumns(options) {
    if (_.isEmpty(options.columns)) return options.columns;
    var conflicts = _.intersection(_.keys(options.columns), _.keys(options.variables));
    var masked = _.object(conflicts, conflicts.map(name => Parser().parse(options.columns[name])));
    var columns = _.reduce(options.columns, (columns, value, key) => {
        columns[masked[key] || key] = value;
        return columns;
    }, {});
    var normalizer = createNormalizeParser(getVariables(options), true);
    var filterOrderColumns = normalizer.parseCriteriaList(_.flatten(_.compact([
        options.filter, options.order
    ]), true));
    return _.defaults(getRollingVariables(options).reduce((columns, name) => {
        if (_.has(options.variables, name)) {
            columns[name] = options.variables[name];
        }
        return columns;
    }, columns), _.object(filterOrderColumns, filterOrderColumns));
}

/**
 * Returns the variable names used by rolling functions
 */
function getRollingVariables(options) {
    var parser = Parser({
        substitutions: getVariables(options),
        constant(value) {
            return value;
        },
        variable(name) {
            return [];
        },
        expression(expr, name, args) {
            if (rolling.has(name)) return args;
            else return _.flatten(args.filter(_.isArray), true);
        }
    });
    return _.uniq(_.flatten(parser.parse(_.flatten(_.compact([
        _.values(options.variables), _.values(options.columns),
        options.retain, options.filter, options.precedence
    ]), true)), true).filter(name => {
        return _.has(options.variables, name) || _.has(options.columns, name);
    }));
}

/**
 * Normalizes the expressions and substitutes variables
 */
function createNormalizeParser(variables, recursive) {
    // if not recursive, strip out variables that looks like fields
    var vars = recursive ? variables : getVariables({columns: variables});
    var nestedParser = recursive ? null : createNormalizeParser(vars, true);
    return Parser({
        substitutions: vars,
        variable(name) {
            if (nestedParser && variables[name])
                return nestedParser.parse(variables[name]);
            else return name;
        },
        expression(expr, name, args) {
            if (name == 'DESC' || name == 'ASC') return _.first(args);
            else return expr;
        }
    });
}

/**
 * Returns the retain expression that should be delegated to quote.
 * Removing the expressions with rolling functions.
 */
function getQuoteCriteria(expr, variables) {
    if (!expr) return [];
    return _.compact(Parser({
        substitutions: variables,
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
            else return null;
        }
    }).parseCriteriaList(expr));
}

/**
 * Returns an array of variable names used by at least one of variables/retain/precedence/filter/order
 */
function getUsedColumns(options) {
    var exprs = _.flatten(_.compact([
        _.values(options.variables),
        options.retain, options.precedence, options.filter, options.order
    ]), true);
    return _.uniq(_.flatten(Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            return [name];
        },
        expression(expr, name, args) {
            return _.uniq(_.flatten(args, true));
        }
    }).parse(exprs), true));
}

/**
 * Creates an expression parser that recognizes the rolling/quote functions.
 */
function createParser(temporal, quote, dataset, cached, options) {
    var external = _.memoize((expr, name, args) => {
        return quoting(expr, name, args, temporal, quote, dataset, options);
    });
    return Parser({
        substitutions: getVariables(options),
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
 * Returns map of variables and columns, excluding columns that look like fields
 */
function getVariables(options) {
    return _.defaults({}, options.variables, _.omit(options.columns, (expr, name) => {
        // exclude column names that looks like fields
        if (name.indexOf('.') < 1) return false;
        var interval = name.substring(0, name.indexOf('.'));
        return _.contains(periods.values, interval);
    }));
}

/**
 * Combines the quote.js results into a single array containing retained securities.
 */
function collectDataset(dataset, temporal, parser, columns, cached, options) {
    var pcolumns = promiseColumns(parser, columns);
    var pretain = promiseFilter(parser, options.retain);
    var precedence = getOrderBy(options.precedence, cached, options);
    return pcolumns.then(columns => pretain.then(retain => {
        return reduceInterval(dataset, temporal, (result, points) => {
            var positions = sortBy(points, precedence);
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
 * Returns array after sorting it inplace
 * @param order an array [{by: prop, desc: false}]
 */
function sortBy(array, order) {
    if (_.isEmpty(order)) return array;
    else return array.sort((left, right) => {
        return order.reduce((r, o) => {
            var a = left[o.by];
            var b = right[o.by];
            if (r != 0 || a === b) {
                return r;
            } else if (!o.desc) {
                if (a > b || a === void 0) return 1;
                if (a < b || b === void 0) return -1;
            } else {
                if (a < b || a === void 0) return 1;
                if (a > b || b === void 0) return -1;
            }
        }, 0);
    });
}

/**
 * @returns a map of functions that can compute the column values for a given row.
 */
function promiseColumns(parser, columns) {
    var map = parser.parse(columns);
    return Promise.all(_.values(map)).then(values => _.object(_.keys(map), values));
}

/**
 * Returns a function that can determine if the security should be retained
 */
function promiseFilter(parser, expr) {
    if (!expr) return Promise.resolve(null);
    return Promise.resolve(parser.parse(_.flatten([expr],true).join(' AND ')));
}

/**
 * Create a function and direction that securities should be sorted with.
 */
function getOrderBy(expr, cached, options) {
    if (!expr) return [];
    else return Parser({
        substitutions: getVariables(options),
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
            else return {};
        }
    }).parseCriteriaList(expr);
}

/**
 * Takes the quote.js results as an array and matches the results by temporal date calling cb.
 */
function reduceInterval(dataset, temporal, cb, memo) {
    var check = interrupt();
    while (dataset.some(list => list.length)) {
        check();
        var ending = _.first(_.compact(_.pluck(dataset.map(list => _.first(list)), temporal)).sort());
        var points = _.compact(dataset.map(list => {
            if (list.length && _.first(list)[temporal] == ending) return list.shift();
        }));
        memo = cb(memo, points);
    }
    return memo;
}
