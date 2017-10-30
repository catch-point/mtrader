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
    var promiseHelp;
    var collections = _.object(config.list(), []);
    var self;
    return self = _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(quote);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.defaults(_.pick(options, _.first(help).options), {
                indexCol: '$index',
                symbolCol: '$symbol',
                exchangeCol: '$exchange',
                temporalCol: '$temporal',
                variables: {},
                criteria: _.flatten(_.compact([options.criteria, options.retain])),
                tz: moment.tz.guess(),
                now: Date.now()
            });
            return collect(quote, collectFn || self, collections, fields, opts);
        });
    }, {
        close() {}
    });
};

function help(quote) {
    var used = [
        'portfolio', 'columns', 'variables', 'criteria', 'filter',
        'precedence', 'order', 'pad_leading', 'duration', 'upstream'
    ];
    return quote({help: true}).then(_.first).then(help => {
        return [{
            name: 'collect',
            usage: 'collect(options)',
            description: "Evaluates columns using historic security data",
            options: _.union(help.options, used),
            properties: help.properties
        }];
    });
}

function collect(quote, callCollect, collections, fields, options) {
    expect(options).to.have.property('portfolio');
    expect(options).to.have.property('columns').that.is.an('object');
    var illegal = _.intersection(_.keys(options.variables), fields);
    if (illegal.length) expect(options.variables).not.to.have.property(_.first(illegal));
    var portfolio = getPortfolio(options.portfolio, collections, options);
    var optional = _.difference(_.flatten(portfolio.map(opts => _.keys(opts.columns)), true), fields);
    var defaults = _.object(optional, optional.map(v => null));
    var avail = _.union(fields, optional);
    var columns = parseNeededColumns(avail, options);
    var columnNames = _.object(_.keys(options.columns), _.keys(columns));
    var simpleColumns = getSimpleColumns(columns, options);
    var criteria = getSimpleCriteria(columns, options);
    return Promise.all(portfolio.map((opts, idx) => {
        var index = '#' + idx.toString() + (options.columns[options.indexCol] ?
            '.' + JSON.parse(options.columns[options.indexCol]).substring(1) : '');
        var pad_begin = (options.pad_begin || 0) + (options.pad_leading || 0);
        if (opts.portfolio) {
            var used = getUsedColumns(opts);
            var parser = Parser({
                variable(name){
                    return opts.columns && opts.columns[name] || name;
                },
                expression(expr, name, args) {
                    return name + '(' + args.join(',') + ')';
                }
            });
            var columns = parser.parse(simpleColumns);
            var filter = [opts.filter, parser.parse(criteria)];
            var params = _.omit(defaults, _.keys(opts.columns));
            return callCollect(_.defaults({
                columns: _.extend(columns, _.pick(opts.columns, used), {
                    [options.indexCol]: JSON.stringify(index),
                    [options.symbolCol]: 'symbol',
                    [options.exchangeCol]: 'exchange',
                    [options.temporalCol]: 'DATETIME(ending)'
                }),
                filter: _.flatten(_.compact(filter), true),
                pad_begin: pad_begin,
                order: _.flatten(_.compact(['DATETIME(ending)', opts.order]), true),
                parameters: _.defaults({}, options.parameters, opts.parameters, params)
            }, opts));
        } else {
            return quote(_.defaults({
                columns: _.defaults({
                    [options.indexCol]: JSON.stringify(index),
                    [options.symbolCol]: JSON.stringify(opts.symbol),
                    [options.exchangeCol]: JSON.stringify(opts.exchange),
                    [options.temporalCol]: 'DATETIME(ending)'
                }, simpleColumns),
                criteria: criteria,
                pad_begin: pad_begin,
                parameters: _.defaults({}, options.parameters, defaults)
            }, opts));
        }
    })).then(dataset => {
        var parser = createParser(quote, dataset, columns, _.keys(simpleColumns), options);
        return collectDataset(dataset, parser, columns, options);
    }).then(collection => {
        var begin = moment(options.begin || moment(options.now).endOf('day')).toISOString();
        var idx = _.sortedIndex(collection, {[options.temporalCol]: begin}, options.temporalCol);
        var start = idx - (options.pad_begin || 0);
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
        return result.map(o => _.object(_.keys(columnNames), _.values(columnNames).map(key => o[key])));
    });
}

/**
 * Parses a comma separated list into symbol/exchange pairs.
 */
function getPortfolio(portfolio, collections, options) {
    var opts = _.omit(options, [
        'portfolio', 'columns', 'variables', 'criteria', 'filter', 'precedence', 'order', 'pad_leading'
    ]);
    var array = _.isArray(portfolio) ? portfolio :
        _.isObject(portfolio) ? [portfolio] :
        _.isString(portfolio) ? portfolio.split(/\s*,\s*/) :
        expect(portfolio).to.be.a('string');
    return array.map(symbolExchange => {
        if (_.isObject(symbolExchange)) {
            return _.defaults({}, symbolExchange, opts);
        } else {
            if (_.contains(options.upstream, symbolExchange))
                throw Error("Cycle profile detected: " + options.upstream + " -> " + symbolExchange);
            var m = symbolExchange.match(/^(\S+)\W(\w+)$/);
            if (!m || !collections[symbolExchange] && _.has(collections, symbolExchange)) {
                var cfg = config.read(symbolExchange);
                if (cfg) collections[symbolExchange] = cfg;
            }
            if (collections[symbolExchange]) return _.defaults({
                name: symbolExchange,
                upstream: _.flatten(_.compact([options.upstream, symbolExchange]), true)
            }, collections[symbolExchange], opts);
            if (!m) throw Error("Unexpected symbol.exchange: " + symbolExchange);
            return _.defaults({
                symbol: m[1],
                exchange: m[2]
            }, opts);
        }
    });
}

/**
 * Changes column names to avoid variable name conflicts,
 * and add variables that are not substituted, with filter and order expressions
 */
function parseNeededColumns(fields, options) {
    var varnames = getVariables(fields, options);
    var normalizer = createNormalizeParser(varnames, options);
    var columns = _.mapObject(options.columns, expr => normalizer.parse(expr));
    var conflicts = _.intersection(_.keys(_.omit(columns, (v, k) => v==k)),
        _.union(fields, _.keys(options.variables))
    );
    var masked = _.object(conflicts, conflicts.map(name => {
        if (!~conflicts.indexOf(columns[name])) return columns[name];
        var seq = 2;
        while (~conflicts.indexOf(name + seq)) seq++;
        return name + seq;
    }));
    var needed = _.reduce(columns, (needed, value, key) => {
        needed[masked[key] || key] = value;
        return needed;
    }, {});
    var variables = varnames.reduce((needed, name) => {
        if (_.has(options.variables, name)) {
            needed[name] = normalizer.parse(options.variables[name]);
        } else if (!_.has(columns, name)) {
            needed[name] = name; // pass through fields used in rolling functions
        }
        return needed;
    }, {});
    var filterOrder = _.difference(normalizer.parseCriteriaList(_.flatten(_.compact([
        options.filter, options.order
    ]), true)), _.keys(needed), _.keys(variables));
    var neededColumns = _.extend(needed, variables, _.object(filterOrder, filterOrder));
    var references = Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            if (neededColumns[name] && neededColumns[name]!=name) return [name];
            else return [];
        },
        expression(expr, name, args) {
            return _.uniq(_.flatten(args, true));
        }
    }).parse(_.pick(neededColumns, (v, k) => v!=k));
    while (_.reduce(references, (more, reference, name) => {
        if (!reference.length) return more;
        if (_.contains(reference, name)) throw Error("Circular variable reference " + name);
        references[name] = _.uniq(_.flatten(reference.map(ref => references[ref]), true));
        return more || references[name].length;
    }, false));
    return neededColumns;
}

/**
 * Returns columns/variables/fields names that should not normally be inlined.
 * This includes unique columns/variables/fields used in rolling functions,
 * and variables used multiple times in a single expression
 */
function getVariables(fields, options) {
    var parser = Parser({
        constant(value) {
            return _.isString(value) ? value : null;
        },
        variable(name) {
            if (~fields.indexOf(name))
                return {[name]: Infinity}; // must propagate fields through
            else if (options.columns[name] || options.variables[name])
                return {[name]: 1};
            else return {}; // don't include parameters
        },
        expression(expr, name, args) {
            if (rolling.has(name))
                return rolling.getVariables(expr).reduce((o, name) => {
                    return _.extend(o, {[name]: Infinity});
                }, {});
            else return args.reduce((count, arg) => {
                if (!_.isObject(arg)) return count;
                _.each(arg, (value, name) => {
                    count[name] = value + (count[name] || 0);
                });
                return count;
            }, {});
        }
    });
    var exprs = parser.parseCriteriaList(_.flatten(_.compact([
        _.values(options.variables), _.values(options.columns),
        options.criteria, options.filter, options.precedence
    ]), true));
    var multiples = _.uniq(_.flatten(exprs.map(expr => _.keys(expr).filter(name => expr[name] > 1)), true));
    return _.union(_.difference(_.keys(options.columns), fields), multiples);
}

/**
 * Normalizes the expressions and substitutes other variables that aren't given
 */
function createNormalizeParser(variables, options) {
    return Parser({
        substitutions: getSubstitutions(variables, options),
        expression(expr, name, args) {
            if (name == 'DESC' || name == 'ASC') return _.first(args);
            else return expr;
        }
    });
}

/**
 * Returns map of other variables and parameters (not in the given variables array)
 * that can safely be inlined in expressions
 */
function getSubstitutions(variables, options) {
    var params = _.mapObject(_.pick(options.parameters, val => {
        return _.isString(val) || _.isNumber(val);
    }), val => JSON.stringify(val));
    var nulls = _.mapObject(_.pick(options.parameters, _.isNull), val => 'NULL()');
    return _.defaults(_.omit(options.variables, variables), params, nulls);
}

/**
 * Returns expressions that should be delegated to quote.
 * Removing the expressions with rolling functions and variables. However,
 * variables are inlined in the arguments for expressions that used in lookback functions.
 */
function getSimpleColumns(columns, options) {
    var colParser = createColumnParser(columns, options);
    var formatColumns = _.map(columns, expr => colParser.parse(expr).columns).reduce((a,b)=>_.extend(a,b), {});
    var criteriaColumns = _.pluck(colParser.parseCriteriaList(_.flatten(_.compact([
        options.criteria, options.filter, options.precedence, options.order
    ]), true)), 'columns').reduce((a,b)=>_.extend(a,b), {});
    return _.defaults(formatColumns, criteriaColumns);
}

/**
 * Returns a map of expressions, using local variables, to expressions with those
 * variables inlined.
 * Only expressions that are to be evaluated before criteria is processed.
 */
function createColumnParser(columns, options) {
    var inline = createInlineParser(columns, options);
    var parsedColumns = {};
    var parser = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        constant(value) {
            return {complex: false, columns: {}};
        },
        variable(name) {
            if (!columns[name] || columns[name]==name)
                return {complex: false, columns: {[name]: name}};
            parsedColumns[name] = parsedColumns[name] || parser.parse(columns[name]);
            if (parsedColumns[name].complex)
                return {complex: true, columns: {}}; // can't include complex variables
            else return {complex: false, columns: {}}; // parse column later
        },
        expression(expr, name, args) {
            var order = name == 'DESC' || name == 'ASC';
            var complex = _.some(args, arg => arg.complex);
            var nested = {
                complex: true,
                columns: _.pluck(args, 'columns').reduce((a,b)=>_.extend(a,b), {})
            };
            if (quoting.has(name)) return {complex: true, columns: {}};
            else if (order || rolling.has(name) || complex) return nested;
            var inlined = inline.parse(expr);
            if (common.has(name) && inlined.length > 512) return nested;
            else return {complex: false, columns: {[expr]: inlined}}; // lookback
        }
    });
    return parser;
}

/**
 * Returns the criteria expression that should be delegated to quote.
 * Removing the expressions with rolling functions and inlining variables.
 * This differrs from #getSimpleColumns as it does not return parts of complex expressions
 */
function getSimpleCriteria(columns, options) {
    if (_.isEmpty(options.criteria)) return [];
    var inline = createInlineParser(columns, options);
    var parsedColumns = {};
    var parser = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        variable(name) {
            if (!columns[name] || columns[name]==name) return name;
            else return parsedColumns[name] = parsedColumns[name] || parser.parse(columns[name]);
        },
        expression(expr, name, args) {
            var order = name == 'DESC' || name == 'ASC';
            var complex = _.some(args, _.isNull);
            if (quoting.has(name)) return null;
            else if (order || rolling.has(name) || complex) return null;
            else return inline.parse(expr);
        }
    });
    return _.compact(parser.parseCriteriaList(options.criteria));
}

/**
 * Parser that inlines all variables in resulting normalized expressions
 */
function createInlineParser(columns, options) {
    var incols = {};
    var inline = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        variable(name) {
            if (!columns[name] || columns[name]==name) return name;
            else return incols[name] = incols[name] || inline.parse(columns[name]);
        },
        expression(expr, name, args) {
            return name + '(' + args.join(',') + ')';
        }
    });
    return inline;
}

/**
 * Returns an array of variable names used by at least one of variables/criteria/precedence/filter/order
 */
function getUsedColumns(options) {
    var exprs = _.flatten(_.compact([
        _.values(options.variables),
        options.criteria, options.precedence, options.filter, options.order
    ]), true);
    return _.uniq(_.flatten(Parser({
        constant(value) {
            return _.isString(value) ? value : null;
        },
        variable(name) {
            return [name];
        },
        expression(expr, name, args) {
            if (rolling.has(name)) return rolling.getVariables(expr);
            else return _.uniq(_.flatten(args.filter(_.isArray), true));
        }
    }).parseCriteriaList(exprs).filter(_.isArray), true));
}

/**
 * Creates an expression parser that recognizes the rolling/quote functions.
 */
function createParser(quote, dataset, columns, cached, options) {
    var external = _.memoize((expr, name, args) => {
        return quoting(expr, name, args, quote, dataset, options);
    });
    var pCols = {};
    var parser = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        constant(value) {
            return positions => value;
        },
        variable(name) {
            if (columns[name] && name!=columns[name])
                return pCols[name] = pCols[name] || parser.parse(columns[name]);
            // [{"USD.CAD": {"close": 1.00}}]
            else return _.compose(_.property(name), _.last, _.values, _.last);
        },
        expression(expr, name, args) {
            if (_.contains(cached, expr))
                return _.compose(_.property(expr), _.last, _.values, _.last);
            else return Promise.all(args).then(args => {
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
    return parser;
}

/**
 * Combines the quote.js results into a single array containing retained securities.
 */
function collectDataset(dataset, parser, columns, options) {
    var pcolumns = promiseColumns(parser, columns, options);
    var pcriteria = promiseFilter(parser, options.criteria);
    var precedence = getOrderBy(options.precedence, columns, options);
    return pcolumns.then(fcolumns => pcriteria.then(criteria => {
        return reduceInterval(dataset, options.temporalCol, (result, points) => {
            var positions = sortBy(points, precedence);
            var row = result.length;
            result[row] = positions.reduce((retained, point) => {
                var key = point[options.indexCol];
                var pending = _.extend({}, retained, {
                    [key]: point
                });
                result[row] = pending;
                if (criteria && !criteria(result)) return retained;
                else return _.extend(pending, {
                    [key]: _.mapObject(fcolumns, fn => fn(result))
                });
            }, {[options.temporalCol]: points[0][options.temporalCol]});
            if (_.keys(result[row]).length == 1) result.pop();
            return result;
        }, []);
    }));
}

/**
 * @returns a map of functions that can compute the column values for a given row.
 */
function promiseColumns(parser, columns, options) {
    var map = parser.parse(columns);
    return Promise.all(_.values(map))
      .then(values => _.object(_.keys(map), values))
      .then(columns => {
        if (!columns[options.indexCol]) return columns;
        // nested collect pass through these columns as-is
        columns[options.indexCol] = _.compose(_.property(options.indexCol), _.last, _.values, _.last)
        columns[options.symbolCol] = _.compose(_.property(options.symbolCol), _.last, _.values, _.last)
        columns[options.exchangeCol] = _.compose(_.property(options.exchangeCol), _.last, _.values, _.last)
        columns[options.temporalCol] = _.compose(_.property(options.temporalCol), _.last, _.values, _.last)
        return columns;
    });
}

/**
 * Returns a function that can determine if the security should be retained
 */
function promiseFilter(parser, expr) {
    if (_.isEmpty(expr)) return Promise.resolve(null);
    return Promise.resolve(parser.parse(_.flatten([expr],true).join(' AND ')));
}

/**
 * Create a function and direction that securities should be sorted with.
 */
function getOrderBy(expr, columns, options) {
    if (_.isEmpty(expr)) return [];
    return Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        constant(value) {
            return {};
        },
        variable(name) {
            return {by: name};
        },
        expression(expr, name, args) {
            if (name == 'DESC') return {desc: true, by: _.first(args).by};
            else if (name == 'ASC') return {desc: false, by:  _.first(args).by};
            else return {by: expr};
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
        var points = dataset.reduce((result,list) => {
            while (list.length && _.first(list)[temporal] == ending) {
                result.push(list.shift());
            }
            return result;
        }, []);
        memo = cb(memo, points);
    }
    return memo;
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
