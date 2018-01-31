// strategize.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
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
const statkit = require("statkit");
const Alea = require('alea');
const merge = require('./merge.js');
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const rolling = require('./rolling-functions.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

/**
 * Iteratively improves a strategy by adding and substituting signals from given signalsets
 */
module.exports = function(bestsignals) {
    var promiseHelp;
    var prng = new Alea();
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(bestsignals);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.defaults(_.pick(options, _.keys(_.first(help).options)), {
                tz: moment.tz.guess(),
                now: Date.now(),
                variables: {},
                strategy_variable: 'strategy',
                signal_variable: 'signal'
            });
            return strategize(bestsignals, prng, opts);
        });
    }, {
        seed(number) {
            prng = new Alea(number);
        },
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function help(bestsignals) {
    return bestsignals({help: true}).then(_.first).then(help => {
        return [{
            name: 'strategize',
            usage: 'strategize(options)',
            description: "Modifies a strategy looks for improvements to its score",
            properties: ['solution_variable','strategy_variable'].concat(help.properties),
            options: _.extend({}, help.options, {
                strategy_variable: {
                    usage: '<variable name>',
                    description: "The variable name to use when testing various strategies"
                },
                signal_cost: {
                    usage: '<number>',
                    description: "Minimum amount the score must increase by before adding another signal"
                },
                max_changes: {
                    usage: '<number>',
                    description: "The maximum number of changes allowed in a strategy expressions"
                },
                concurrent_strategies: {
                    usage: '<number>',
                    description: "Number of strategies to search for and evaluate at once"
                },
                termination: {
                    usage: 'PT5M',
                    description: "Amount of time spent searching for a solution before the best yet is used"
                },
                directional: {
                    usage: 'true|false',
                    description: "If a signal's direction is significant on its own"
                }
            })
        }];
    });
}

/**
 * Initializes strategy search and formats results
 */
function strategize(bestsignals, prng, options) {
    var scores = {};
    var history = {};
    var parser = createParser(options);
    var terminateAt = options.termination && moment().add(moment.duration(options.termination)).valueOf();
    var bestsignalFn = bestsignal.bind(this, scores, bestsignals, terminateAt, history);
    var evaluateFn = evaluate.bind(this, scores, bestsignals);
    var base = parser(options.variables[options.strategy_variable]);
    var nextSignalFn = nextSignal.bind(this, [], prng, evaluateFn, parser, base);
    var terminateCondition = options.termination ?
        attempts => attempts >= 1000 || Date.now()>terminateAt : attempts => attempts >= 1000;
    return Promise.all(_.range(options.concurrent_strategies || 1).map(() => {
        return search(bestsignalFn, nextSignalFn, terminateCondition, history, options, 0)
    })).then(results => _.last(_.sortBy(results, 'score')))
      .then(best => combine(history, best, options))
      .then(best => {
        var strategy = best.variables[best.strategy_variable];
        logger.info("Strategize", strategy, best.score);
        return best;
    });
}

/**
 * Recursively tests solutions to improve the score, returning the best solution found
 */
function search(bestsignal, nextSignal, terminateCondition, history, options, attempts) {
    return nextSignal(options)
      .then(signal_strategy => bestsignal(signal_strategy, options))
      .then(solution => {
        var merged = history[options.strategy_variable] || options;
        if (solution.revisited || _.has(merged, 'score') &&
                solution.score - (solution.cost || 0) <= merged.score - (merged.cost || 0)) {
            if (!solution.revisited) // keep going
                return search(bestsignal, nextSignal, terminateCondition, history, merged, 0);
            if (!terminateCondition(attempts))
                return search(bestsignal, nextSignal, terminateCondition, history, merged, ++attempts);
            else // stop after too many attempts to find something new
                return merged;
        } else {
            var formatted = formatSolution(solution, merged, history, '_');
            var improved = merge({}, merged, formatted);
            history[formatted.solution_variable] = solution;
            history[options.strategy_variable] = improved;
            var strategy = improved.variables[improved.strategy_variable];
            logger.log("Strategize", strategy, solution.score);
            return search(bestsignal, nextSignal, terminateCondition, history, improved, 0);
        }
    });
}

/**
 * Finds the best signal for the strategy
 */
function bestsignal(scores, bestsignals, terminateAt, history, signal_strategy, options) {
    if (scores[signal_strategy])
        return scores[signal_strategy].then(score => ({score, revisited: true}));
    var optimize_termination = options.optimize_termination || terminateAt &&
        moment.duration(Math.floor((terminateAt - Date.now())/1000)*1000).toISOString() || undefined;
    var promise = bestsignals(_.defaults({
        solution_count: null,
        optimize_termination: optimize_termination,
        variables: _.defaults({
            [options.strategy_variable]: signal_strategy
        }, options.variables)
    }, options)).then(best => {
        var cost = getReferences(signal_strategy).length * options.signal_cost || 0;
        return merge({
            variables:{
                [options.strategy_variable]: signal_strategy
            },
            strategy_variable: options.strategy_variable,
            cost: cost
        }, best);
    });
    scores[signal_strategy] = promise.then(best => best.score);
    return promise;
}

/**
 * Evaluates the score for the given strategy
 */
function evaluate(scores, bestsignals, strategy, options) {
    if (!strategy) return Promise.resolve(null);
    else if (scores[strategy]) return scores[strategy];
    else return scores[strategy] = bestsignals(_.defaults({
        solution_count: null,
        signals: [],
        variables: _.defaults({
            [options.strategy_variable]: strategy
        }, options.variables)
    }, options)).then(best => best.score)
      .catch(e => {logger.debug("evaluate", strategy, options); throw e;});
}

/**
 * Randomly modifies the strategy adding or substituting signals
 */
function nextSignal(queue, prng, evaluate, parser, base, options) {
    if (queue.length) return Promise.resolve(queue.pop());
    var strategy = options.variables[options.strategy_variable];
    var signal_var = options.signal_variable;
    if (!strategy || signal_var == strategy) { // initial signal
        queue.unshift.apply(queue, invert(signal_var).reverse());
        return Promise.resolve(queue.pop());
    }
    var disjunction = parser(strategy);
    var conjunctions = disjunction.conjunctions;
    var extra = !(countChanges(base, disjunction) >= options.max_changes);
    return Promise.resolve(_.has(options, 'score') ? options.score : evaluate(strategy, options))
      .then(baseScore => {
        return Promise.all(conjunctions.map((conj, conjIdx) => {
            var withoutIt = spliceExpr(conjunctions, conjIdx, 1).join(' OR ');
            return evaluate(withoutIt, options);
        })).then(scores => scores.map(score => baseScore - score))
          .then(contributions => {
            var conjIdx = chooseContribution(prng, contributions, extra);
            if (conjIdx >= conjunctions.length) // add signal
                return invert(signal_var).map(signal_var => {
                    return spliceExpr(conjunctions, conjIdx, 0, signal_var).join(' OR ');
                });
            if (contributions.length > 1 && contributions[conjIdx] <= (options.signal_cost || 0))
                return [spliceExpr(conjunctions, conjIdx, 1).join(' OR ')]; // drop signal
            var conjunction = conjunctions[conjIdx];
            if (!extra && _.isEmpty(conjunction.comparisons)) // change signal
                return invert(signal_var).map(signal_var => {
                    return spliceExpr(conjunctions, conjIdx, 1, signal_var).join(' OR ');
                });
            var comparisons = conjunction.comparisons;
            var signal = conjunction.signal;
            return Promise.all(conjunction.comparisons.map((cmp, j) => {
                var and = spliceExpr(comparisons, j, 1).concat(signal.expr).join(' AND ');
                var withoutIt = spliceExpr(conjunctions, conjIdx, 1, and).join(' OR ');
                return evaluate(withoutIt, options);
            })).then(scores => scores.map(score => baseScore - score))
              .then(contributions => { // change comparator
                var cmpIdx = chooseContribution(prng, contributions, true);
                if (!extra && cmpIdx >= comparisons.length) { // change signal
                    return invert(signal_var);
                } else if (contributions.length > 1 && cmpIdx < contributions.length) { // drop comparison
                    return [spliceExpr(comparisons, cmpIdx, 1).concat(signal.expr).join(' AND ')];
                } else {
                    return listComparators(options).map(comparator => {
                        var expr = comparator(signal_var, signal.variable || signal.expr);
                        return spliceExpr(comparisons, cmpIdx, 1, expr).concat(signal.expr).join(' AND ');
                    });
                }
            }).then(conjunctionSet => conjunctionSet.map(conjunction => {
                return spliceExpr(conjunctions, conjIdx, 1, conjunction).join(' OR ');
            }));
        });
    }).then(strategies => {
        if (!(countChanges(base, parser(strategies[0])) > options.max_changes)) {
            queue.unshift.apply(queue, strategies.reverse());
        }
        return queue.length ? queue.pop() : strategy;
    });
}

function countChanges(base, disjunction) {
    var baseSignals = base.conjunctions.map(item => item.signal.expr);
    var disjunctionSignals = disjunction.conjunctions.map(item => item.signal.expr);
    var removed = _.difference(baseSignals, disjunctionSignals).length;
    var added = _.difference(disjunctionSignals, baseSignals).length;
    var modified = base.conjunctions.map(item => {
        var idx = disjunctionSignals.indexOf(item.signal.expr);
        if (idx < 0) return 0;
        var baseComp = _.pluck(item.comparisons, 'expr');
        var disComp = _.pluck(disjunction.conjunctions[idx].comparisons, 'expr');
        return _.difference(baseComp, disComp) + _.difference(disComp, baseComp);
    }).reduce((a,b)=>a+b, 0);
    return removed + added + modified;
}

/**
 * A function that parses a strategy into a disjunction of conjunctions of comparisons
 * {conjunctions:[{comparisons:[{expr}],signal:{expr}}]}
 */
function createParser(options) {
    var comparators = _.uniq(_.pluck(listComparators(options), 'operator').sort(), true);
    var parser = Parser({
        expression(expr, operator, args) {
            if (operator == 'AND') {
                var members = args.reduce((args, arg) => {
                    if (arg.conjunctions) args.push({expr: arg.expr});
                    else if (arg.signal) return args.concat(arg.comparisons, arg.signal);
                    else if (arg.expr) args.push(arg);
                    else args.push({expr: arg});
                    return args;
                }, []);
                return {expr, comparisons: _.initial(members), signal: _.last(members)};
            } else if (operator == 'OR') {
                var members = args.reduce((args, arg) => {
                    if (arg.conjunctions) return args.concat(arg.conjunctions);
                    else if (arg.signal) args.push(arg);
                    else if (arg.expr) args.push({expr: arg.expr, comparisons: [], signal: arg});
                    else args.push({expr: arg, comparisons: [], signal: {expr: arg}});
                    return args;
                }, []);
                return {expr, conjunctions: members};
            } else if (args.length != 2) {
                return {expr};
            } else if (~comparators.indexOf(operator) && ~args.indexOf('0')) {
                var arg = args.find(a => a != '0');
                return {expr, operator, zero: true, variable: arg.expr || arg};
            } else if (~comparators.indexOf(operator)) {
                var variable = args[0].expr || args[0];
                var comparand = args[1].expr || args[1];
                var inverse = args.some(arg => arg.inverse);
                return {expr, operator, inverse, variable, comparand};
            } else if (operator == 'PRODUCT' && ~args.indexOf('-1')) {
                var arg = args.find(a => a != '-1');
                return {expr, inverse: true, variable: arg.expr || arg};
            } else {
                return {expr};
            }
        }
    });
    return strategy => {
        var parsed = strategy ? parser.parse(strategy) : '';
        var conjunctions = strategy ? parsed.conjunctions ? parsed.conjunctions : [
            parsed.signal ? parsed : {
                expr: parsed.expr || parsed,
                comparisons: [],
                signal: parsed.expr ? parsed : {expr: parsed}
            }
        ] : [];
        return {
            expr: parsed.expr || parsed,
            conjunctions: conjunctions
        };
    };
}

/**
 * Randomly returns an index from the given an array of contribution amounts
 */
function chooseContribution(prng, contributions, extra) {
    var t = 1.5;
    if (!contributions.length) return 1;
    var items = contributions.map((contrib, i) => ({
        p: i,
        contrib: contrib
    }));
    var byContrib = _.sortBy(items, 'contrib');
    byContrib.forEach((it, i) => it.w = Math.pow(i + 1, -t));
    var weights = _.sortBy(byContrib, 'p').map(it => it.w);
    if (extra) {
        weights.push(Math.pow(weights.length +2, -t));
    }
    var target = prng() * weights.reduce((a,b) => a + b);
    for (var i=0; i<weights.length; i++) {
        if (target < weights[i]) return i;
        else target -= weights[i];
    }
    throw Error();
}

/**
 * List of possible comparators that can be used
 */
function listComparators(options) {
    var direct = [
        _.extend((a,b)=>`${a}=${b}`,     {operator: 'EQUALS'}),
        _.extend((a,b)=>`${a}=-1*${b}`,  {operator: 'EQUALS'}),
        _.extend((a,b)=>`${a}=0`,        {operator: 'EQUALS'}),
        _.extend((a,b)=>`${a}!=${b}`,    {operator: 'NOT_EQUALS'}),
        _.extend((a,b)=>`${a}!=-1*${b}`, {operator: 'NOT_EQUALS'}),
        _.extend((a,b)=>`${a}!=0`,       {operator: 'NOT_EQUALS'}),
    ];
    if (!options.directional) return direct;
    var relative = [
        _.extend((a,b)=>`${a}<0`,  {operator: 'LESS_THAN'}),
        _.extend((a,b)=>`${a}>0`,  {operator: 'GREATER_THAN'}),
        _.extend((a,b)=>`${a}>=0`, {operator: 'NOT_LESS_THAN'}),
        _.extend((a,b)=>`${a}<=0`, {operator: 'NOT_GREATER_THAN'}),
    ];
    return direct.concat(relative);
}

/**
 * Splices an array of items with expr properties
 */
function spliceExpr(array, start, deleteCount, ...items) {
    var exprs = array.map(item => item.expr);
    exprs.splice.apply(exprs, _.rest(arguments));
    return exprs;
}

/**
 * returns variable with and without the prefix '-1*'
 */
function invert(variable) {
    return [variable, `-1*${variable}`];
}

/**
 * Renames history variables, that are used in the given strategy, to use unique
 * variable names starting from suffix 'A'
 */
function combine(history, best, options) {
    var strategy = best.variables[best.strategy_variable];
    var variables = getReferences(strategy);
    var replacement = {};
    var result = variables.reduce((combined, variable) => {
        var solution = history[variable];
        var formatted = formatSolution(solution, merge({}, options, combined));
        replacement[variable] = formatted.solution_variable;
        return merge({}, combined, _.omit(formatted, 'solution_variable', 'signal_variable'));
    }, {});
    var combined_strategy = Parser({substitutions:replacement}).parse(strategy);
    return merge(result, {
        score: best.score,
        cost: best.cost,
        variables: {
            [result.strategy_variable]: combined_strategy
        }
    });
}

/**
 * Renames solution results to avoid variables already in options
 */
function formatSolution(solution, options, history, suffix) {
    var signal = solution.signal_variable;
    var fixed = _.extend({}, options.parameters, options.variables);
    var values = _.extend({}, solution.variables, solution.parameters);
    var conflicts = _.reduce(values, (conflicts, value, name) => {
        if (fixed[name] != value && _.has(fixed, name))
            conflicts.push(name);
        return conflicts;
    }, _.keys(solution.parameter_values));
    var reuse = _.findKey(_.mapObject(_.pick(history, item => {
        return item.variables[item.signal_variable] == solution.variables[signal];
    }), item => _.pick(item, 'parameters', 'signalset')), _.isEqual.bind(_, _.pick(solution, 'parameters', 'signalset')));
    var id = reuse && reuse.indexOf(solution.variables[signal] + (suffix || '')) === 0 ?
            reuse.substring((solution.variables[signal] + (suffix || '')).length) :
            conflicts.reduce((id, name) => {
        while (_.has(fixed, name + (suffix || '') + id.toString(36).toUpperCase())) id++;
        return id;
    }, 10);
    var references = getReferences(values);
    var local = [signal].concat(references[signal]);
    var overlap = references[signal].filter(name => ~conflicts.indexOf(name) ||
        _.intersection(conflicts, references[name]).length);
    var id = _.isEmpty(overlap) ? '' : (suffix || '') + id.toString(36).toUpperCase();
    var replacement = _.object(overlap, overlap.map(name => name + id));
    var replacer = createReplacer(replacement);
    var rename = (object, value, name) => _.extend(object, {[replacement[name] || name]: value});
    var parser = Parser({substitutions:{
        [signal]: solution.variables[signal]
    }});
    var strategy = parser.parse(solution.variables[solution.strategy_variable]);
    var eval_validity = replacer(_.compact(_.flatten([solution.eval_validity])));
    return {
        score: solution.score,
        cost: solution.cost,
        signal_variable: signal,
        solution_variable: replacement[solution.variables[signal]],
        strategy_variable: solution.strategy_variable,
        variables: replacer(_.defaults({
            [solution.strategy_variable]: strategy
        }, _.omit(_.pick(solution.variables, local), signal))),
        parameters: _.reduce(_.pick(solution.parameters, local), rename, {}),
        parameter_values: _.reduce(_.pick(solution.parameter_values, local), rename, {}),
        eval_validity: _.compact(_.flatten([options.eval_validity, eval_validity]))
    };
}

/**
 * Array of variable names used, iff given variables is a string, else
 * Hash of variable names to array of variable names it depends on
 * @param variables a string expression or map of names to string expressions
 */
function getReferences(variables) {
    var references = Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            if (_.isString(variables) || _.has(variables, name)) return [name];
            else return [];
        },
        expression(expr, name, args) {
            if (rolling.has(name))
                return _.intersection(rolling.getVariables(expr), _.keys(variables));
            else return _.uniq(_.flatten(args, true));
        }
    }).parse(variables);
    if (_.isString(variables)) return references;
    var follow = _.clone(references);
    while (_.reduce(follow, (more, reference, name) => {
        if (!reference.length) return more;
        var followed = _.uniq(_.flatten(reference.map(ref => follow[ref]), true));
        var cont = more || follow[name].length != followed.length ||
            followed.length != _.intersection(follow[name], followed).length;
        follow[name] = followed;
        references[name] = reference.reduce((union, ref) => {
            return _.union(union, references[ref]);
        }, references[name]);
        return cont;
    }, false));
    return references;
}

/**
 * Returns a function that takes an expression and rewrites replacing variables in replacement hash
 */
function createReplacer(replacement) {
    var parser = Parser();
    var map = name => replacement[name] || name;
    var replacer = Parser({
        variable(name) {
            return map(name);
        },
        expression(expr, name, args) {
            if (!rolling.has(name)) return name + '(' + args.join(',') + ')';
            var margs = args.map(arg => {
                if (!_.isString(arg) || '"' != arg.charAt(0)) return arg;
                return JSON.stringify(parser.parse(replacer.parse(JSON.parse(arg))));
            });
            return name + '(' + margs.join(',') + ')';
        }
    });
    return function(expr) {
        var parsed = parser.parse(replacer.parse(expr));
        if (_.isArray(expr)) return parsed;
        return _.object(_.keys(parsed).map(map), _.values(parsed));
    };
}
