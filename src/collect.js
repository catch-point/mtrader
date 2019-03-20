// collect.js
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
const moment = require('moment-timezone');
const Parser = require('./parser.js');
const interrupt = require('./interrupt.js');
const common = require('./common-functions.js');
const rolling = require('./rolling-functions.js');
const quoting = require('./quoting-functions.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

/**
 * Delegates most computations to quote.js and add some functions that can compare
 * securities and read previous retained values.
 * @returns a function that returns array of row objects based on given options.
 */
module.exports = function(quote, collectFn) {
    let promiseHelp, self;
    return self = Object.assign(async function(options) {
        if (!promiseHelp) promiseHelp = help(quote);
        expect(options).to.be.an('object');
        if (options.help) return promiseHelp;
        const keys = _.keys(_.first(await promiseHelp).options);
        const fields = _.first(await promiseHelp).properties;
        const opts = _.defaults(_.pick(options, keys), {
            indexCol: '$index',
            symbolCol: '$symbol',
            marketCol: '$market',
            temporalCol: '$temporal'
        });
        return collect(quote, collectFn || self, fields, opts);
    }, {
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
async function help(quote) {
    const help = _.first(await quote({help: true}));
    return [{
        name: 'collect',
        usage: 'collect(options)',
        description: "Evaluates columns using historic security data",
        properties: help.properties,
        options: _.extend({}, _.omit(help.options, ['symbol','market','pad_begin','pad_end']), {
            portfolio: {
                usage: 'symbol.market,..',
                description: "Sets the set of securities or nested protfolios to collect data on"
            },
            filter: {
                usage: '<expression>',
                description: "An expression (possibly of an rolling function) of each included security bar that must be true to be included in the result. The result of these expressions have no impact on rolling functions, unlike criteria, which is applied earlier."
            },
            precedence: {
                usage: '<expression>',
                description: "The order that securities should be checked for inclusion in the result. A comma separated list of expressions can be provided and each may be wrapped in a DESC function to indicate the order should be reversed."
            },
            order: {
                usage: '<expression>,..',
                description: "The order that the output should be sorted by. A comma separated list of expressions can be provided and each may be wrapped in a DESC function to indicate the order should be reversed."
            },
            pad_leading: {
                usage: '<number of workdays>',
                description: "Number of workdays (Mon-Fri) to processes before the result (as a warm up)"
            },
            reset_every: {
                usage: 'P1Y',
                description: "Sets the duration that collect should run before resetting any preceeding values"
            },
            head: {
                usage: '<number of rows>',
                description: "Limits the rows in the result to the given first few"
            },
            tail: {
                usage: '<number of rows>',
                description: "Include the given last few rows in the result"
            },
            id: {
                description: "Unique alphanumeric identifier among its peers (optional)"
            }
        })
    }];
}

/**
 * Computes column values given expressions and variables in options
 */
async function collect(quote, callCollect, fields, options) {
    const duration = options.reset_every && moment.duration(options.reset_every);
    const begin = moment(options.begin);
    const end = moment(options.end || options.now);
    if (!begin.isValid()) throw Error("Invalid begin date: " + options.begin);
    if (!end.isValid()) throw Error("Invalid end date: " + options.end);
    const segments = [];
    if (!options.reset_every) {
        segments.push(options.begin);
    } else if (duration && duration.asMilliseconds()>0) {
        segments.push(options.begin);
        const start = begin.add(duration);
        const stop = end.subtract(duration.asMilliseconds()*0.05, 'milliseconds');
        while (start.isBefore(stop)) {
            segments.push(start.format());
            start.add(duration);
        }
    } else if (duration && duration.asMilliseconds()<=0) {
        const start = end.add(duration);
        const stop = begin.subtract(duration.asMilliseconds()*0.05, 'milliseconds');
        while (start.isAfter(stop)) {
            segments.unshift(start.format());
            start.add(duration);
        }
        segments.unshift(options.begin);
    } else {
        throw Error("Invalid duration: " + options.reset_every);
    }
    const compacted = compactPortfolio(fields, options.begin, options.end, options);
    if (segments.length < 2) {// only one period
        return collectDuration(quote, callCollect, fields, compacted);
    }
    const optionset = segments.map((segment, i, segments) => {
        if (i === 0) return _.defaults({
            begin: options.begin, end: segments[i+1]
        }, compacted);
        else if (i < segments.length -1) return _.defaults({
            begin: segment, end: segments[i+1]
        }, compacted);
        else return _.defaults({
            begin: segment, end: options.end
        }, compacted);
    }).map(opts => compactPortfolio(fields, opts.begin, opts.end, opts));
    const dataset = await Promise.all(optionset.map(opts => callCollect(opts)))
    return _.flatten(dataset, true);
}

/**
 * Computes column values given expressions and variables in options for a duration
 */
function collectDuration(quote, callCollect, fields, options) {
    expect(options).to.have.property('portfolio');
    expect(options).to.have.property('begin');
    expect(options).to.have.property('columns').that.is.an('object');
    const illegal = _.intersection(_.keys(options.variables), fields);
    if (illegal.length) expect(options.variables).not.to.have.property(_.first(illegal));
    const portfolio = getPortfolio(options.portfolio, options);
    const optional = _.difference(_.uniq(_.flatten(portfolio.map(opts => _.keys(opts.columns)), true)), fields);
    const defaults = _.object(optional, optional.map(v => null));
    const avail = _.union(fields, optional);
    checkCircularVariableReference(fields, options);
    const zipColumns = parseNeededColumns(avail, options);
    const columns = _.object(zipColumns);
    const columnNames = _.object(_.keys(options.columns), zipColumns.map(_.first));
    const simpleColumns = getSimpleColumns(columns, options);
    const criteria = getSimpleCriteria(columns, options);
    return Promise.all(portfolio.map(opts => {
        if (opts.id == null) throw Error(`Missing portfolio ID ${opts.label}`);
        const index = '#' + opts.id.toString() + (options.columns[options.indexCol] ?
            '.' + JSON.parse(options.columns[options.indexCol]).substring(1) : '');
        if (opts.portfolio) {
            if (~_.flatten([opts.portfolio]).indexOf(null)) throw Error(`Portfolio cannot contain null in ${opts.id} ${opts.portfolio}`);
            const parser = Parser({
                variable(name){
                    return opts.columns && opts.columns[name] || name;
                },
                expression(expr, name, args) {
                    return name + '(' + args.join(',') + ')';
                }
            });
            const columns = parser.parse(simpleColumns);
            const filter = [opts.filter, parser.parse(criteria)];
            const nestedColumns = _.flatten(_.flatten([opts.portfolio]).map(p => _.keys(p.columns)));
            const existing_vars = _.union(_.keys(opts.columns), _.keys(opts.variables), nestedColumns);
            const params = _.omit(defaults, existing_vars);
            return callCollect(_.defaults({
                columns: _.extend(columns, {
                    [options.indexCol]: JSON.stringify(index),
                    [options.symbolCol]: 'symbol',
                    [options.marketCol]: 'market',
                    [options.temporalCol]: 'DATETIME(ending)'
                }),
                variables: _.extend(_.omit(getColumnVariables(fields, opts), _.keys(columns)), opts.variables),
                filter: _.flatten(_.compact(filter), true),
                order: _.flatten(_.compact(['DATETIME(ending)', opts.order]), true),
                parameters: _.defaults({}, options.parameters, opts.parameters, params)
            }, opts));
        } else {
            return quote(_.defaults({
                columns: _.defaults({
                    [options.indexCol]: JSON.stringify(index),
                    [options.symbolCol]: JSON.stringify(opts.symbol),
                    [options.marketCol]: JSON.stringify(opts.market),
                    [options.temporalCol]: 'DATETIME(ending)'
                }, simpleColumns),
                criteria: criteria,
                parameters: _.defaults({}, options.parameters, defaults)
            }, opts));
        }
    })).then(dataset => {
        const parser = createParser(quote, dataset, columns, _.keys(simpleColumns), options);
        return collectDataset(dataset, parser, columns, options);
    }).then(collection => {
        const begin = moment(options.begin).toISOString();
        const start = _.sortedIndex(collection, {[options.temporalCol]: begin}, options.temporalCol);
        if (start <= 0) return collection;
        else return collection.slice(start);
    }).then(collection => collection.reduce((result, points) => {
        const filter = getOrderBy(options.filter, columns, options);
        const objects = _.values(points).filter(_.isObject)
            .filter(point => !filter.find(criteria => criteria.by && !criteria.by(point)));
        if (!_.isEmpty(objects)) result.push.apply(result, objects);
        return result;
    }, [])).then(result => {
        const order = getOrderBy(options.order, columns, options);
        return sortBy(result, order);
    }).then(result => {
        if (options.head && options.tail)
            return result.slice(0, options.head).concat(result.slice(-options.tail));
        else if (options.head)
            return result.slice(0, options.head);
        else if (options.tail)
            return result.slice(-options.tail);
        else return result;
    }).then(result => {
        return result.map(o => _.object(_.keys(columnNames), _.values(columnNames).map(key => o[key])));
    });
}

/**
 * Looks for column/variable circular reference and if found throws an Error
 */
function checkCircularVariableReference(fields, options) {
    const variables = _.extend({}, getColumnVariables(fields, options), options.variables);
    const references = getReferences(variables);
    _.each(references, (reference, name) => {
        if (_.contains(reference, name)) {
            const path = _.sortBy(_.keys(references).filter(n => _.contains(references[n], n) && _.contains(references[n], name)));
            throw Error("Circular variable reference " + path.join(',') + ": " + variables[name]);
        }
    });
}

/**
 * Hash of columns that don't conflict with other variables names from
 * variables, parameters, subcollect, and fields
 */
function getColumnVariables(fields, options) {
    const pnames = _.keys(options.parameters);
    const varnames = _.keys(options.variables);
    const portfolio = getPortfolio(options.portfolio, options);
    const inherited = _.uniq(_.flatten(portfolio.map(opts => _.keys(opts.columns)), true));
    return _.omit(options.columns, pnames.concat(varnames, inherited, fields));
}

/**
 * Hash of variable names to array of variable names it depends on
 */
function getReferences(variables, includeRolling) {
    const references = Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            if (_.has(variables, name)) return [name];
            else return [];
        },
        expression(expr, name, args) {
            if (includeRolling && rolling.has(name))
                return rolling.getVariables(expr);
            else return _.uniq(_.flatten(args, true));
        }
    }).parse(_.mapObject(variables, valOrNull));
    const follow = _.clone(references);
    while (_.reduce(follow, (more, reference, name) => {
        if (!reference.length) return more;
        const followed = _.uniq(_.flatten(reference.map(ref => ref == name ? [] : follow[ref]), true));
        const cont = more || follow[name].length != followed.length ||
            followed.length != _.intersection(follow[name], followed).length;
        follow[name] = followed;
        references[name] = reference.reduce((union, ref) => {
            return _.union(union, references[ref]);
        }, references[name]);
        return cont;
    }, false));
    return references;
}

function valOrNull(value) {
    return value == null || value == '' ? 'NULL()' : value;
}

/**
 * Potentially reduces the number of portfolios by filtering on begin/end
 */
function compactPortfolio(fields, begin, end, options) {
    const portfolio = options.portfolio;
    const array = _.isArray(portfolio) ? portfolio :
        _.isObject(portfolio) ? [portfolio] :
        _.isString(portfolio) ? portfolio.split(/\s*,\s*/) :
        expect(portfolio).to.be.a('string');
    const leading = !options.pad_leading ? begin :
        common('WORKDAY', [_.constant(begin), _.constant(-options.pad_leading)])();
    const mbegin = moment(leading);
    const mend = moment(end || options.now);
    const compacted = _.compact(array.map((subcollect, idx) => {
        if (!_.isObject(subcollect)) return subcollect;
        const sbegin = subcollect.begin && moment(subcollect.begin);
        const send = subcollect.end && moment(subcollect.end);
        if (send && !send.isAfter(mbegin) || sbegin && !sbegin.isBefore(mend)) return null;
        const begin = sbegin && mbegin.isBefore(sbegin) ? sbegin.format() : mbegin.format();
        const end = send && mend.isAfter(send) ? send.format() : options.end ? mend.format() : undefined;
        const compact = compactPortfolio(fields, begin, end, subcollect);
        if (compact.id != null) return compact;
        else return _.extend({id: 'c' + idx}, compact);
    }));
    if (array.every((item, i) => item == compacted[i])) return options;
    const before = _.uniq(_.flatten(array.map(subcollect => _.keys(subcollect.columns))));
    const after = _.uniq(_.flatten(compacted.map(subcollect => _.keys(subcollect.columns))));
    const missing = _.difference(before, after, _.keys(options.variables), _.keys(options.parameters), fields);
    const params = _.object(missing, missing.map(v => null));
    return _.defaults({
        portfolio: compacted,
        parameters: _.defaults({}, options.parameters, params)
    }, options);
}

/**
 * Parses a comma separated list into symbol/market pairs.
 */
function getPortfolio(portfolio, options) {
    const opts = _.omit(options, [
        'portfolio', 'columns', 'variables', 'criteria', 'filter', 'precedence', 'order', 'pad_leading', 'tail', 'head', 'begin', 'reset_every'
    ]);
    const array = _.isArray(portfolio) ? portfolio :
        _.isObject(portfolio) ? [portfolio] :
        _.isString(portfolio) ? portfolio.split(/\s*,\s*/) :
        expect(portfolio).to.be.a('string');
    if (_.isEmpty(_.compact(array)) && !options.portfolio) throw Error(`Missing portfolio ${options.label}`);
    else if (_.isEmpty(_.compact(array))) throw Error(`No portfolio matches this time frame ${options.label}`);
    const begin = !options.pad_leading ? options.begin :
        common('WORKDAY', [_.constant(options.begin), _.constant(-options.pad_leading)], options)();
    const mbegin = moment(begin);
    const mend = moment(options.end || options.now);
    return _.compact(array.map(symbolExchange => {
        if (_.isObject(symbolExchange)) return symbolExchange;
        else if (!symbolExchange) return null;
        const m = symbolExchange.match(/^(\S+)\W(\w+)$/);
        if (!m) throw Error("Unexpected symbol.market: " + symbolExchange);
        return {
            label: symbolExchange,
            symbol: m[1],
            market: m[2]
        };
    }).map((subcollect, idx) => {
        const sbegin = subcollect.begin && moment(subcollect.begin);
        const send = subcollect.end && moment(subcollect.end);
        if (send && !send.isAfter(mbegin) || sbegin && sbegin.isAfter(mend))
            throw Error(`Expected ${subcollect.label} to be removed in compactPortfolio`);
        const id = subcollect.id == null ? 'q' + idx : subcollect.id;
        const begin = sbegin && mbegin.isBefore(sbegin) ? sbegin.format() : mbegin.format();
        const end = send && mend.isAfter(send) ? send.format() : options.end ? mend.format() : undefined;
        return _.defaults({id, begin, end}, subcollect, opts);
    }));
}

/**
 * Changes column names to avoid variable name conflicts,
 * and add variables that are not substituted, with filter and order expressions
 */
function parseNeededColumns(fields, options) {
    const varnames = getVariables(fields, options);
    const normalizer = createNormalizeParser(varnames, options);
    const columns = _.mapObject(options.columns, expr => normalizer.parse(expr || 'NULL()'));
    const conflicts = _.intersection(_.keys(_.omit(columns, (v, k) => v==k)),
        _.union(fields, _.keys(options.variables))
    );
    const masked = _.object(conflicts, conflicts.map(name => {
        if (!~conflicts.indexOf(columns[name])) return columns[name];
        let seq = 2;
        while (~conflicts.indexOf(name + seq)) seq++;
        return name + seq;
    }));
    const result = [];
    const needed = _.reduce(options.columns, (needed, expr, key) => {
        const value = columns[key];
        needed[masked[key] || key] = value;
        result.push([masked[key] || key, value]);
        return needed;
    }, {});
    const variables = varnames.reduce((variables, name) => {
        if (_.has(options.variables, name)) {
            variables[name] = normalizer.parse(options.variables[name]);
            result.push([name, variables[name]]);
        } else if (!_.has(needed, name) && !_.has(variables, name) && ~fields.indexOf(name)) {
            variables[name] = name; // pass through fields used in rolling functions
            result.push([name, variables[name]]);
        }
        return variables;
    }, {});
    const filterOrder = normalizer.parseCriteriaList(_.flatten(_.compact([
        options.filter, options.order
    ]), true));
    const isVariablePresent = Parser({
        constant(value) {
            return false;
        },
        variable(name) {
            return true;
        },
        expression(expr, name, args) {
            return args.find(_.identity) || false;
        }
    }).parse;
    const neededFilterOrder = filterOrder.filter(expr => {
        if (needed[expr] || variables[expr]) return false;
        else return isVariablePresent(expr);
    });
    return result.concat(_.zip(neededFilterOrder, neededFilterOrder));
}

/**
 * Returns columns/variables/fields names that should not normally be inlined.
 * This includes unique columns/variables/fields used in rolling functions,
 * and variables used multiple times in a single expression
 */
function getVariables(fields, options) {
    const parser = Parser({
        constant(value) {
            return _.isString(value) ? value : null;
        },
        variable(name) {
            if (~fields.indexOf(name))
                return {[name]: Infinity}; // must propagate fields through
            else if (_.has(options.columns, name) || _.has(options.variables, name))
                return {[name]: 1};
            else return {}; // don't include parameters
        },
        expression(expr, name, args) {
            if (rolling.has(name))
                return rolling.getVariables(expr, options).reduce((o, name) => {
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
    let exprs = parser.parseCriteriaList(_.flatten(_.compact([
        _.compact(_.values(options.columns)),
        options.criteria, options.filter, options.precedence
    ]), true));
    let more_vars = _.uniq(_.flatten(exprs.map(_.keys), true));
    while (more_vars.length) {
        const old_vars = _.uniq(_.flatten(exprs.map(_.keys), true));
        const additional = parser.parseCriteriaList(_.compact(_.values(_.pick(options.variables, more_vars))));
        exprs = exprs.concat(additional);
        const new_vars = _.uniq(_.flatten(additional.map(_.keys), true));
        more_vars = _.difference(new_vars, old_vars);
    }
    const multiples = _.uniq(_.flatten(exprs.map(expr => _.keys(expr).filter(name => expr[name] > 1)), true));
    return _.union(_.keys(getColumnVariables(fields, options)), multiples);
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
    const params = _.mapObject(_.pick(options.parameters, (val,key) => {
        return _.isString(val) || _.isNumber(val) || _.isNull(val);
    }), val => stringify(val));
    return _.mapObject(_.omit(_.defaults(options.variables, params), variables), valOrNull);
}

/**
 * Calls JSON.stringify on strings and numbres, and returns 'NULL()' if null value
 */
function stringify(value) {
    if (_.isObject(value) || _.isArray(value))
        throw Error("Must be a number, string, or null: " + value);
    else if (value == null) return 'NULL()';
    else return JSON.stringify(value);
}

/**
 * Returns expressions that should be delegated to quote.
 * Removing the expressions with rolling functions and variables. However,
 * variables are inlined in the arguments for expressions that used in lookback functions.
 */
function getSimpleColumns(columns, options) {
    const colParser = createColumnParser(columns, options);
    const formatColumns = _.map(columns, expr => colParser.parse(expr).columns).reduce((a,b)=>_.extend(a,b), {});
    const criteriaColumns = _.pluck(colParser.parseCriteriaList(_.flatten(_.compact([
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
    const inline = createInlineParser(columns, options);
    const parsedColumns = {};
    const parser = Parser({
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
            const order = name == 'DESC' || name == 'ASC';
            const complex = _.some(args, arg => arg.complex);
            const nested = {
                complex: true,
                columns: _.pluck(args, 'columns').reduce((a,b)=>_.extend(a,b), {})
            };
            if (quoting.has(name)) return {complex: true, columns: {}};
            else if (order || rolling.has(name) || complex) return nested;
            const inlined = inline(expr);
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
    const inline = createInlineParser(columns, options);
    const parsedColumns = {};
    const parser = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        variable(name) {
            if (!columns[name] || columns[name]==name) return name;
            else return parsedColumns[name] = parsedColumns[name] || parser.parse(columns[name]);
        },
        expression(expr, name, args) {
            const order = name == 'DESC' || name == 'ASC';
            const complex = _.some(args, _.isNull);
            if (quoting.has(name)) return null;
            else if (order || rolling.has(name) || complex) return null;
            else return inline(expr);
        }
    });
    return _.compact(parser.parseCriteriaList(options.criteria));
}

/**
 * Parser that inlines all variables in resulting normalized expressions
 */
function createInlineParser(columns, options) {
    const incols = {};
    const inline = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        constant(value) {
            return _.constant(value);
        },
        variable(name) {
            if (!columns[name] || columns[name]==name) return name;
            else return incols[name] = incols[name] || inline.parse(columns[name]);
        },
        expression(expr, name, args) {
            if (common.has(name) && args.every(_.isFunction))
                return common(name, args, options);
            const values = args.map(arg => _.isFunction(arg) ? stringify(arg()) : arg);
            return name + '(' + values.join(',') + ')';
        }
    });
    const formatter = Parser();
    return function(expr) {
        const parsed = inline.parse(expr);
        return formatter.parse(_.isFunction(parsed) ? stringify(parsed()) : parsed);
    };
}

/**
 * Creates an expression parser that recognizes the rolling/quote functions.
 */
function createParser(quote, dataset, columns, cached, options) {
    const external = _.memoize((expr, name, args) => {
        return quoting(expr, name, args, quote, dataset, options);
    });
    const pCols = {};
    const parser = Parser({
        substitutions: getSubstitutions(_.keys(columns), options),
        constant(value) {
            return positions => value;
        },
        variable(name) {
            if (columns[name] && name!=columns[name])
                return pCols[name] = pCols[name] || parser.parse(columns[name]);
            // [{"USD.CAD": {"close": 1.00}}]
            else return ctx => _.last(_.values(_.last(ctx)))[name];
        },
        expression(expr, name, args) {
            if (_.contains(cached, expr))
                return ctx => _.last(_.values(_.last(ctx)))[expr];
            else return Promise.all(args).then(args => {
                const fn = common(name, args, options) ||
                    rolling(expr, name, args, options) ||
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
    const pcolumns = promiseColumns(parser, columns, options);
    const pcriteria = promiseFilter(parser, options.criteria);
    const precedence = getOrderBy(options.precedence, columns, options);
    return pcolumns.then(fcolumns => pcriteria.then(async(criteria) => {
        return await reduceInterval(dataset, options.temporalCol, (result, points) => {
            const positions = sortBy(points, precedence);
            const row = result.length;
            result[row] = positions.reduce((retained, point) => {
                const key = point[options.indexCol];
                const pending = _.extend({}, retained, {
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
    const map = parser.parse(columns);
    return Promise.all(_.values(map))
      .then(values => _.object(_.keys(map), values))
      .then(columns => {
        const indexCol = options.indexCol;
        const symbolCol = options.symbolCol;
        const marketCol = options.marketCol;
        const temporalCol = options.temporalCol;
        if (!columns[indexCol]) return columns;
        // nested collect pass through these columns as-is
        columns[indexCol] = ctx => _.last(_.values(_.last(ctx)))[indexCol];
        columns[symbolCol] = ctx => _.last(_.values(_.last(ctx)))[symbolCol];
        columns[marketCol] = ctx => _.last(_.values(_.last(ctx)))[marketCol];
        columns[temporalCol] = ctx => _.last(_.values(_.last(ctx)))[temporalCol];
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
            return {by: _.constant(value)};
        },
        variable(name) {
            // column name might not be needed
            return {by: ctx => ctx[name] || ctx[columns[name]]};
        },
        expression(expr, name, args) {
            if (name == 'DESC') return {desc: true, by: _.first(args).by};
            else if (name == 'ASC') return {desc: false, by:  _.first(args).by};
            const fargs = args.map(arg => arg.by);
            const fn = common(name, fargs, options);
            const fail = ctx => {
                throw Error("Only common functions can be used here: " + expr);
            };
            return {by: ctx => _.has(ctx, expr) ? ctx[expr] : fn ? fn(ctx) : fail()};
        }
    }).parseCriteriaList(expr);
}

/**
 * Takes the quote.js results as an array and matches the results by temporal date calling cb.
 */
async function reduceInterval(dataset, temporal, cb, memo) {
    const check = interrupt();
    while (dataset.some(list => list.length)) {
        await check();
        const ending = _.first(_.compact(_.pluck(dataset.map(list => _.first(list)), temporal)).sort());
        const points = dataset.reduce((result,list) => {
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
 * Returns copy of array after stable sorting
 * @param order an array [{by: prop, desc: false}]
 */
function sortBy(array, order) {
    if (_.isEmpty(order)) return array;
    else return _.range(array.length).sort((left, right) => {
        const ret = order.reduce((r, o) => {
            if (r != 0) return r;
            const a = o.by(array[left]);
            const b = o.by(array[right]);
            if (a === b) {
                return 0;
            } else if (!o.desc) {
                if (a > b || a === void 0) return 1;
                if (a < b || b === void 0) return -1;
            } else {
                if (a < b || a === void 0) return 1;
                if (a > b || b === void 0) return -1;
            }
        }, 0);
        return ret || left - right;
    }).map(i => array[i]);
}
