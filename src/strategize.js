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
const interrupt = require('./interrupt.js');
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
                leg_variable: chooseVariable('leg', options),
                signal_variable: chooseVariable('signal', options),
                conjunction_cost: 0,
                disjunction_cost: 0
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
                conjunction_cost: {
                    usage: '<number>',
                    description: "Minimum amount the score must increase by before adding 'AND' operator"
                },
                conjunctions_only: {
                    usage: 'true',
                    description: "If more disjunctions are prohibited (no 'OR' operators)"
                },
                disjunction_cost: {
                    usage: '<number>',
                    description: "Minimum amount the score must increase by to add another 'OR' operator"
                },
                disjunctions_only: {
                    usage: 'true',
                    description: "If more conjunctions are prohibited (no 'AND' operators)"
                },
                max_operands: {
                    usage: '<number>',
                    description: "Maximum amount of operands between AND/OR conjunctions/disjunctions"
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
    var now = Date.now();
    var parser = createParser();
    var termAt = options.termination && moment().add(moment.duration(options.termination)).valueOf();
    var strategize = strategizeLegs.bind(this, bestsignals, prng, parser, termAt, now);
    var strategy_var = options.strategy_variable;
    var expr = options.variables[strategy_var] || '';
    var strategy = parser(expr);
    return strategize(options, {[strategy_var]: options})
      .then(signals => combine(signals, options))
      .then(best => {
        var strategy = best.variables[strategy_var];
        logger.info("Strategize", options.label || '\b', strategy, best.score);
        return best;
    });
}

/**
 * Tries to find an similar, but better strategy
 */
function strategizeLegs(bestsignals, prng, parser, termAt, started, options, signals) {
    var check = interrupt(true);
    var scores = {};
    var strategy_var = options.strategy_variable;
    var latest = signals[strategy_var];
    var latest_expr = latest.variables[strategy_var];
    var searchFn = searchLeg.bind(this, bestsignals, prng, parser, termAt);
    var strategy = parser(latest_expr == options.signal_variable ? '' : latest_expr);
    if (!strategy.legs.length)
        return strategizeAll(bestsignals, searchFn, parser, started, options, scores, {signals});
    var isolations = strategy.legs.length > 1 && strategy.legs.map((leg, i) => {
        return spliceExpr(strategy.legs, i, 1).join(' OR ');
    });
    return Promise.resolve(evaluate(bestsignals, scores, strategy.expr, latest))
      .then(latestScore => Promise.all(strategy.legs.map((leg, i) => {
        if (strategy.legs.length == 1) return latestScore;
        var withoutIt = isolations[i];
        return evaluate(bestsignals, scores, withoutIt, latest).then(score => latestScore - score);
    })).then(contribs => {
        if (check()) return msignals;
        var label = options.label || '\b';
        logger.log("Strategize", label, "base", latest.variables[strategy_var], latestScore);
        var cost = getStrategyCost(strategy.expr, options);
        var msignals = merge(signals, {[strategy_var]:{score:latestScore, cost}});
        var full = options.conjunctions_only || options.max_operands &&
            options.max_operands <= countOperands(strategy.expr);
        var idx = chooseContribution(prng, contribs, full ? 0 : 1);
        if (idx < strategy.legs.length)
            logger.trace("Strategize", label, "contrib", strategy.legs[idx].expr, contribs[idx]);
        return strategizeContribs(searchFn.bind(this, 1, {}), msignals, strategy, contribs[idx], idx, options)
          .then(signals => {
            var better = signals[strategy_var];
            var new_expr = better.variables[strategy_var];
            if (!new_expr) {
                logger.warn("Strategize", options.label || '\b', "failed to make sense of", latest_expr);
                return strategizeAll(bestsignals, searchFn, parser, started, options, scores, {signals});
            }
            if (latestScore - cost < better.score - better.cost) return signals;
            else return msignals; // better was not significantly so
        });
    }));
}

/**
 * Recursively tries to find the best strategy, until no more improvements can be made
 */
function strategizeAll(bestsignals, searchLeg, parser, started, options, scores, state) {
    var check = interrupt(true);
    _.defaults(state, {exhausted: [false], scores: []});
    var strategy_var = options.strategy_variable;
    var latest = state.signals[strategy_var];
    var latest_expr = latest.variables[strategy_var];
    var strategy = parser(latest_expr == options.signal_variable ? '' : latest_expr);
    var isolations = strategy.legs.length > 1 && strategy.legs.map((leg, i) => {
        return spliceExpr(strategy.legs, i, 1).join(' OR ');
    });
    var leg_count = Math.max(strategy.legs.length+(options.conjunctions_only?0:1),1);
    return Promise.all(_.range(leg_count).map(idx => {
        if (state.exhausted[idx]) return state;
        var searchLegFn = searchLeg.bind(this, 100, state.scores[idx] = state.scores[idx] || {});
        return Promise.resolve(!strategy.legs.length ? 0 : strategy.legs.length == 1 ? latest.score :
            evaluate(bestsignals, scores, isolations[idx], latest).then(score => latest.score - score))
          .then(contrib => strategizeContribs(searchLegFn, state.signals, strategy, contrib, idx, options))
          .then(signals => {
            var same = _.isEqual(signals, state.signals);
            var new_expr = same ? latest_expr : signals[strategy_var].variables[strategy_var];
            var new_strategy = same ? strategy : parser(new_expr);
            var next_exhausted = same ? state.exhausted.slice(0) : new Array(new_strategy.legs.length+1);
            var next_scores = [];
            if (new_strategy.legs.length >= strategy.legs.length) {
                next_exhausted[idx] = same; // legs was not dropped
                next_scores[idx] = state.scores[idx];
            }
            if (idx < new_strategy.legs.length) {
                var full = options.conjunctions_only || options.max_operands &&
                    options.max_operands <= countOperands(new_expr);
                next_exhausted[new_strategy.legs.length] = full;
            }
            return {signals, exhausted: next_exhausted, scores: next_scores};
        });
    })).then(all => {
        var different = all.filter(se => !_.isEqual(se.signals, state.signals));
        var se = _.last(_.sortBy(different, se => {
            var better = se.signals[strategy_var];
            return better.score - better.cost;
        }));
        if (se) return se;
        return {
            signals: state.signals,
            exhausted: all.map((se, i) => se.exhausted[i]),
            scores: all.map((se, i) => se.scores[i])
        };
    }).then(state => {
        var better = state.signals[strategy_var];
        var new_expr = better.variables[strategy_var];
        if (!new_expr)
            throw Error(`Strategize ${options.label} failed to come up with a strategy`);
        if (_.every(state.exhausted)) return state.signals;
        var elapse = moment.duration(Date.now() - started).humanize();
        logger.log("Strategize", options.label || '\b', new_expr, "after", elapse, better.score);
        return strategizeAll(bestsignals, searchLeg, parser, started, options, scores, state);
    });
}

/**
 * Given a strategy leg contribution tries to find a better strategy for given leg index
 */
function strategizeContribs(searchLeg, signals, strategy, contrib, idx, options) {
    var label = options.label || '\b';
    var strategy_var = options.strategy_variable;
    var latest = signals[strategy_var];
    var empty = !strategy.legs.length;
    if (idx < strategy.legs.length && strategy.legs.length > 1 && contrib <= options.disjunction_cost) {
        // drop under performing leg
        var drop_expr = spliceExpr(strategy.legs, idx, 1).join(' OR ');
        var drop_signals = _.extend({}, signals, {[strategy_var]: merge(latest, {
            score: latest.score - contrib,
            cost: getStrategyCost(drop_expr, options),
            variables:{[strategy_var]: drop_expr}
        })});
        return Promise.resolve(drop_signals);
    } else {
        // replace leg if strategy is empty, idx points to new leg, or leg is only one signal
        var replacing = idx < strategy.legs.length;
        return strategizeLeg(searchLeg, signals, strategy, idx, options)
          .then(leg_signals => {
            var best = leg_signals[strategy_var];
            var new_expr = best.variables[strategy_var];
            var better = empty || best.score - best.cost > latest.score - latest.cost;
            return better ? leg_signals : signals;
        });
    }
}

/**
 * Isolates the strategy leg as a strategy to search for a better solution
 */
function strategizeLeg(searchLeg, signals, strategy, idx, options) {
    var leg_var = options.leg_variable; // move leg into temporary variable
    var strategy_var = options.strategy_variable;
    var latest = signals[strategy_var];
    var empty = !strategy.legs.length;
    var scratch = idx >= strategy.legs.length;
    var used = empty ? [] : getReferences(latest.variables[strategy_var]);
    var operands = idx < strategy.legs.length ? countOperands(strategy.legs[idx].expr) : 0;
    var other_operands = empty ? 0 : countOperands(strategy.expr) - operands;
    var opts = merge(latest, {
        strategy_variable: leg_var,
        max_operands: options.max_operands && options.max_operands - other_operands,
        variables: {
            [strategy_var]: spliceExpr(strategy.legs, idx, 1, leg_var).join(' OR '),
            [leg_var]: scratch ? '' : strategy.legs[idx].expr
        }
    });
    if (!scratch) {
        opts.score = latest.score;
        opts.cost = getStrategyCost(opts.variables[leg_var], options);
    }
    return searchLeg(signals, opts).then(leg_signals => _.mapObject(leg_signals, (best, name) => {
        if (signals[name] && name != leg_var) return best;
        var new_leg = best.variables[leg_var];
        var new_expr = spliceExpr(strategy.legs, idx, 1, new_leg).join(' OR ');
        return _.defaults({
            cost: getStrategyCost(new_expr, options),
            strategy_variable: strategy_var,
            max_operands: options.max_operands,
            variables: _.defaults({
                [strategy_var]: new_expr
            }, _.omit(best.variables, leg_var))
        },  best);
    })).then(leg_signals => _.defaults({
        [strategy_var]: leg_signals[leg_var]
    }, _.omit(leg_signals, leg_var)));
}

/**
 * Recursively tests incremental solutions to improve the score
 * @return the best solution found as a hash of signals making up the solution
 */
function searchLeg(bestsignals, prng, parser, terminateAt, max_attempts, scores, signals, latest) {
    var check = interrupt(true);
    _.defaults(scores, {bestsignal: {}, evaluate: {}});
    var bestsignalFn = bestsignal.bind(this, bestsignals, terminateAt, scores.bestsignal);
    var evaluateFn = evaluate.bind(this, bestsignals, scores.evaluate);
    var max_operands = latest.max_operands;
    var disjunction_cost = latest.disjunction_cost;
    var strategy_var = latest.strategy_variable;
    var strategy = latest.variables[strategy_var];
    var moreStrategiesFn = moreStrategies.bind(this, prng, evaluateFn, parser, max_operands);
    var empty = !strategy || strategy == latest.signal_variable;
    var leg_signals = _.extend({}, signals, {[strategy_var]: latest});
    var attempts = 1;
    var cb = next_signals => {
        var best = next_signals[strategy_var];
        var next_expr = best.variables[strategy_var];
        var better = empty ? best.score > best.cost + disjunction_cost :
            latest.score - latest.cost < best.score - best.cost;
        if (better || attempts >= max_attempts || check()) return next_signals;
        attempts = _.isEqual(next_signals, leg_signals) ? attempts + 1 : 0;
        leg_signals = next_signals;
        return next(next_signals, latest, cb);
    };
    var next = search.bind(this, bestsignalFn, moreStrategiesFn, terminateAt);
    return next(leg_signals, latest, cb);
}

/**
 * Recursively tests solutions to improve the score
 * @return the best solution found
 */
function search(bestsignal, moreStrategies, terminateAt, signals, options, cb) {
    if (Date.now() > terminateAt) return signals; // times up
    var strategy_var = options.strategy_variable;
    var latest = signals[strategy_var];
    return moreStrategies(latest)
      .then(strategies => Promise.all(strategies.map(st => bestsignal(st, latest))))
      .then(solutions => _.last(_.sortBy(solutions, sol => sol.score - sol.cost)))
      .then(solution => {
        if (!solution || solution.revisited) {
            return cb(signals);
        } else if (latest.variables[strategy_var] && _.has(latest, 'score') &&
                solution.score - solution.cost <= latest.score - latest.cost) {
            var strategy = solution.variables[strategy_var];
            logger.debug("Strategize", options.label || '\b', "leg", strategy, solution.score);
            return cb(signals);
        } else {
            var formatted = formatSolution(solution, latest, '_');
            var improved = merge(latest, formatted);
            var next_signals = _.defaults({
                [formatted.solution_variable]: solution,
                [strategy_var]: improved
            }, signals);
            var strategy = improved.variables[strategy_var];
            logger.log("Strategize", options.label || '\b', "leg", strategy, solution.score);
            return cb(next_signals);
        }
    });
}

/**
 * Finds the best signal for the strategy
 */
function bestsignal(bestsignals, terminateAt, scores, signal_strategy, latest) {
    if (scores[signal_strategy])
        return scores[signal_strategy].then(score => ({score, revisited: true}));
    logger.debug("bestsignal", latest.label || '\b', signal_strategy);
    var regex = new RegExp('\\b' + latest.signal_variable + '\\b','g');
    var token = signal_strategy.split(' ').find(token => regex.exec(token));
    var sign = token && token.replace(regex, '');
    var label = sign && latest.label ? sign + ' ' + latest.label : sign || latest.label;
    var optimize_termination = latest.optimize_termination || terminateAt &&
        moment.duration(Math.floor((terminateAt - Date.now())/1000)*1000).toISOString() || undefined;
    var promise = bestsignals(_.defaults({
        label: label,
        solution_count: null,
        optimize_termination: optimize_termination,
        variables: _.defaults({
            [latest.strategy_variable]: signal_strategy
        }, latest.variables)
    }, latest)).then(best => {
        return merge({
            variables:{
                [latest.strategy_variable]: signal_strategy
            },
            strategy_variable: latest.strategy_variable,
            cost: getStrategyCost(signal_strategy, latest)
        }, best);
    });
    scores[signal_strategy] = promise.then(best => best.score);
    return promise;
}

function getStrategyCost(strategy_expr, options) {
    var disjunctions = strategy_expr.split(' OR ').length -1;
    var conjunctions = strategy_expr.split(' AND ').length -1;
    return disjunctions * options.disjunction_cost + conjunctions * options.conjunction_cost;
}

function countOperands(strategy_expr) {
    return strategy_expr.split(' OR ').reduce((count, operand) => {
        return count + operand.split(' AND ').length;
    }, 0);
}

/**
 * Evaluates the score for the given strategy
 */
function evaluate(bestsignals, scores, strategy, latest) {
    if (!strategy) return Promise.resolve(null);
    else if (scores[strategy]) return scores[strategy];
    else return scores[strategy] = bestsignals(_.defaults({
        solution_count: null,
        signals: [],
        signalset: [],
        variables: _.defaults({
            [latest.strategy_variable]: strategy
        }, latest.variables)
    }, latest)).then(best => best.score);
}

/**
 * Randomly modifies the strategy adding or substituting signals
 */
function moreStrategies(prng, evaluate, parser, max_operands, latest) {
    var strategy_var = latest.strategy_variable;
    var strategy = parser(latest.variables[strategy_var]);
    var signal_var = latest.signal_variable;
    if (!strategy.legs.length || signal_var == strategy.expr) { // initial signal
        return Promise.resolve(invert(signal_var));
    }
    expect(latest).to.have.property('score');
    expect(strategy.legs).to.have.lengthOf(1);
    var leg = _.last(strategy.legs);
    var comparisons = leg.comparisons;
    var signal = leg.signal;
    var isolations = leg.comparisons.map((cmp, j) => {
        return spliceExpr(comparisons, j, 1).concat(signal.expr).join(' AND ');
    });
    return Promise.all(isolations.map(isolation => evaluate(isolation, latest)))
      .then(scores => scores.map(score => latest.score - score))
      .then(contributions => { // change comparator
        var room = !latest.disjunctions_only && max_operands &&
            max_operands > countOperands(strategy.expr);
        var cmpIdx = chooseContribution(prng, contributions, room ? 2 : 1);
        if (cmpIdx < comparisons.length)
            logger.debug("Strategize", latest.label || '\b', "contrib",
                comparisons[cmpIdx].expr, contributions[cmpIdx]);
        if (cmpIdx < contributions.length && contributions[cmpIdx] <= latest.conjunction_cost) {
            // drop comparison
            return [spliceExpr(comparisons, cmpIdx, 1).concat(signal.expr).join(' AND ')];
        } else if (cmpIdx > comparisons.length || !room && cmpIdx == comparisons.length) {
            // replace reference signal
            var needle = signal.variable || signal.expr;
            return [
                createReplacer({[needle]: signal_var})(leg.expr),
                leg.expr.replace(new RegExp('-1\\*' + needle + '\\b','g'), signal_var)
                        .replace(new RegExp('\\b' + needle + '\\b','g'), '-1*' + signal_var)
            ];
        } else { // add or replace comparison
            return listComparators(latest).map(comparator => {
                var expr = comparator(signal_var, signal.variable || signal.expr);
                return spliceExpr(comparisons, cmpIdx, 1, expr).concat(signal.expr).join(' AND ');
            });
        }
    }).then(strategies => {
        if (max_operands && countOperands(strategies[0]) > max_operands) return [];
        else return strategies;
    });
}

/**
 * A function that parses a strategy into a disjunction of conjunction legs of comparisons
 * {legs:[{comparisons:[{expr}],signal:{expr}}]}
 */
function createParser() {
    var comparators = _.uniq(_.pluck(listComparators(), 'operator').sort(), true);
    var parser = Parser({
        expression(expr, operator, args) {
            if (operator == 'AND') {
                var members = args.reduce((args, arg) => {
                    if (arg.legs) args.push({expr: arg.expr});
                    else if (arg.signal) return args.concat(arg.comparisons, arg.signal);
                    else if (arg.expr) args.push(arg);
                    else args.push({expr: arg});
                    return args;
                }, []);
                return {expr, comparisons: _.initial(members), signal: _.last(members)};
            } else if (operator == 'OR') {
                var members = args.reduce((args, arg) => {
                    if (arg.legs) return args.concat(arg.legs);
                    else if (arg.signal) args.push(arg);
                    else if (arg.expr) args.push({expr: arg.expr, comparisons: [], signal: arg});
                    else args.push({expr: arg, comparisons: [], signal: {expr: arg}});
                    return args;
                }, []);
                return {expr, legs: members};
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
        var legs = strategy ? parsed.legs ? parsed.legs : [
            parsed.signal ? parsed : {
                expr: parsed.expr || parsed,
                comparisons: [],
                signal: parsed.expr ? parsed : {expr: parsed}
            }
        ] : [];
        return {
            expr: parsed.expr || parsed,
            legs: legs
        };
    };
}

/**
 * Randomly returns an index from the given an array of contribution amounts
 */
function chooseContribution(prng, contributions, extra) {
    var items = contributions.map((contrib, i) => ({
        p: i,
        contrib: contrib
    }));
    var byContrib = _.sortBy(items, 'contrib');
    var idx = choose(prng, byContrib.length, extra);
    if (byContrib[idx]) return byContrib[idx].p;
    else return idx;
}

/**
 * Randomly returns a number between 0 and max+extra (exclusive)
 * The distribution is exponentially weighted to 0
 * @param extra number of additional values beyond max
 */
function choose(prng, max, extra) {
    var t = 1.5;
    if (max+extra < 1) return 0;
    var weights = _.range(max).map(i => Math.pow(i + 1, -t));
    if (extra) {
        weights = weights.concat(_.range(extra).map(i => Math.pow(weights.length +2 +i, -t)));
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
    if (options && !options.directional) return direct;
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
 * Renames signals variables, that are used in the given strategy, to use unique
 * variable names starting from suffix 'A'
 */
function combine(signals, options) {
    var strategy_var = options.strategy_variable;
    var best = signals[strategy_var];
    if (!best.variables[strategy_var]) return null;
    var variables = getReferences(best.variables)[strategy_var];
    var used = _.intersection(variables, _.keys(signals));
    var replacement = {};
    var result = used.reduce((combined, variable) => {
        var solution = signals[variable];
        if (!solution || strategy_var == variable)
            return combined; // not created here or leg variable
        var formatted = formatSolution(solution, merge(options, combined));
        delete formatted.variables[formatted.strategy_variable];
        replacement[variable] = formatted.solution_variable;
        return merge(combined, _.omit(formatted, 'solution_variable', 'signal_variable'));
    }, {});
    var combined_strategy = Parser({substitutions:replacement}).parse(best.variables[strategy_var]);
    return merge(result, {
        score: best.score,
        cost: best.cost,
        variables: {
            [strategy_var]: combined_strategy
        },
        strategy_variable: strategy_var
    });
}

/**
 * Renames solution results to avoid variables already in options
 */
function formatSolution(solution, options, suffix) {
    var parser = createReplacer({});
    var signal = solution.variables[solution.signal_variable];
    var existing = _.keys(options.variables)
        .filter(name => name.indexOf(signal) === 0)
        .map(name => name.substring(signal.length));
    var formatted = existing.reduce((already, id) => {
        if (already) return already;
        var formatted = formatSolutionWithId(solution, options, id);
        if (signalConflicts(parser, formatted, options)) return null;
        else return formatted;
    }, null);
    if (formatted) return formatted; // reuse existing signal
    for (var id_num=10; id_num < 100; id_num++) {
        var id = (suffix || '') + id_num.toString(36).toUpperCase();
        if (!~existing.indexOf(id)) {
            var formatted = formatSolutionWithId(solution, options, id);
            if (!signalConflicts(parser, formatted, options)) return formatted;
        }
    }
    throw Error(`Could not determine reasonable signal name for ${signal}`);
}

/**
 * Checks if the solutions have conflicting variable/parameter names
 */
function signalConflicts(parser, s1, s2) {
    var params = _.intersection(_.keys(s1.parameters), _.keys(s2.parameters));
    var vars = _.intersection(_.keys(s1.variables), _.keys(s2.variables));
    var varnames = _.without(vars, s1.strategy_variable);
    var cmp = (a, b) => name => a[name] != b[name] && parser(a[name]) != parser(b[name]);
    return params.find(cmp(s1.parameters, s2.parameters)) ||
        varnames.find(cmp(s1.variables, s2.variables));
}

/**
 * Renames solution result variables to has the given id as a suffix
 */
function formatSolutionWithId(solution, options, id) {
    var signal = solution.signal_variable;
    var fixed = _.extend({}, options.parameters, options.variables);
    var values = _.extend({}, solution.variables, solution.parameters);
    var conflicts = _.reduce(values, (conflicts, value, name) => {
        if (fixed[name] != value && _.has(fixed, name))
            conflicts.push(name);
        return conflicts;
    }, _.keys(solution.parameters));
    var references = getReferences(values);
    var local = [signal].concat(references[signal]);
    var overlap = references[signal].filter(name => ~conflicts.indexOf(name) ||
        _.intersection(conflicts, references[name]).length);
    var replacement = _.object(overlap, overlap.map(name => name + id));
    var replacer = createReplacer(replacement);
    var rename = (object, value, name) => _.extend(object, {[replacement[name] || name]: value});
    var parser = Parser({substitutions:{
        [signal]: solution.variables[signal]
    }});
    var strategy = parser.parse(solution.variables[solution.strategy_variable]);
    var eval_validity = replacer(_.compact(_.flatten([solution.eval_validity])));
    var variables = _.omit(_.pick(solution.variables, local), signal, options.leg_variable)
    return _.omit({
        score: solution.score,
        cost: solution.cost,
        signal_variable: signal,
        solution_variable: replacement[solution.variables[signal]] || solution.variables[signal],
        strategy_variable: solution.strategy_variable,
        variables: replacer(_.extend(variables, {
            [solution.strategy_variable]: strategy
        })),
        parameters: _.reduce(_.pick(solution.parameters, local), rename, {}),
        pad_leading: !options.pad_leading || solution.pad_leading > options.pad_leading ?
            solution.pad_leading : undefined,
    }, value => value == null);
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
        if (_.isArray(expr) || _.isString(expr)) return parsed;
        return _.object(_.keys(parsed).map(map), _.values(parsed));
    };
}

function chooseVariable(prefix, options) {
    var references = getReferences(merge(options.columns, options.variables));
    var portfolioCols = _.flatten(_.flatten([options.portfolio]).map(portfolio => _.keys(portfolio.columns)));
    var variables = _.uniq(_.keys(references).concat(_.flatten(_.values(references)), portfolioCols));
    if (!~variables.indexOf(prefix)) return prefix;
    var i = 0;
    while (~variables.indexOf(prefix + i)) i++;
    return prefix + i;
}
