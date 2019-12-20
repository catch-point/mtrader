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
'use strict';

const _ = require('underscore');
const moment = require('moment-timezone');
const statkit = require("statkit");
const Alea = require('alea');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const version = require('./version.js');
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const rolling = require('./rolling-functions.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

/**
 * Iteratively improves a strategy by adding and substituting signals from given signalsets
 */
module.exports = function(bestsignals) {
    let promiseHelp;
    let prng = new Alea();
    return _.extend(async function(options) {
        if (!promiseHelp) promiseHelp = help(bestsignals);
        if (options.info=='help') return promiseHelp;
        else if (options.info=='version') return [{version:version.toString()}];
        else return promiseHelp.then(async(help) => {
            const fields = _.first(help).properties;
            const opts = _.defaults(_.pick(options, _.keys(_.first(help).options)), {
                variables: {},
                strategy_variable: 'strategy',
                leg_variable: await chooseVariable('leg', options),
                signal_variable: await chooseVariable('signal', options),
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
    return bestsignals({info:'help'}).then(_.first).then(help => {
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
                follow_signals_only: {
                    usage: 'true',
                    description: "If the strategy should never counter the signal direction"
                },
                from_scratch: {
                    usage: 'true',
                    description: "If the existing strategy should not be immediately considered"
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
    const now = Date.now();
    const parser = createParser();
    const termAt = options.termination && moment().add(moment.duration(options.termination)).valueOf();
    const strategize = strategizeLegs.bind(this, bestsignals, prng, parser, termAt, now);
    const strategy_var = options.strategy_variable;
    return strategize(options, {[strategy_var]: options})
      .then(signals => combine(signals, options))
      .then(best => {
        const strategy = best.variables[strategy_var];
        logger.info("Strategize", options.label || '\b', strategy, best.score);
        return best;
    });
}

/**
 * Tries to find an similar, but better strategy
 */
async function strategizeLegs(bestsignals, prng, parser, termAt, started, options, signals) {
    const scores = {};
    const strategy_var = options.strategy_variable;
    const latest = signals[strategy_var];
    const latest_expr = latest.variables[strategy_var];
    const strategy = await parser(isBlankStrategy(latest_expr, options) ? '' : latest_expr);
    const from_scratch = options.from_scratch || !strategy.legs.length;
    const incremental = strategy.legs.length;
    const searchFn = searchLeg.bind(this, bestsignals, prng, parser, termAt);
    const all = strategizeAll.bind(this, bestsignals, searchFn, parser, started, options);
    const some = strategizeSome.bind(this, bestsignals, prng, searchFn, parser, termAt, started, options);
    return Promise.resolve(from_scratch ? all(scores, merge({signals}, {signals:{
        [strategy_var]: {variables:{[strategy_var]:''}}
    }})) : null).then(reset => {
        if (!incremental) return reset;
        else if (!reset) return some(scores, signals);
        else return evaluate(bestsignals, scores, strategy.expr, latest)
          .then(latestScore => {
            const cost = getStrategyCost(strategy.expr, options);
            const better = reset[strategy_var];
            if (latestScore - cost < better.score - better.cost)
                return reset;
            if (latestScore - cost == better.score - better.cost)
                return merge(signals, {[strategy_var]: {score: latestScore}});
            logger.log("Strategize", options.label || '\b', "from scratch was not good enough", better.variables[strategy_var], better.score);
            return some(scores, signals);
        });
    });
}

/**
 * Some simple heuristics to identify if this strategy is obviously invalid or inactive
 */
function isBlankStrategy(expr, options) {
    return !expr || expr == '0' || expr == options.signal_variable;
}

/**
 * Tries to find an similar, but possibly a slightly better strategy
 */
async function strategizeSome(bestsignals, prng, searchLeg, parser, termAt, started, options, scores, signals) {
    const check = interrupt(true);
    const strategy_var = options.strategy_variable;
    const latest = signals[strategy_var];
    const latest_expr = latest.variables[strategy_var];
    const strategy = await parser(isBlankStrategy(latest_expr, options) ? '' : latest_expr);
    if (!strategy.legs.length)
        return strategizeAll(bestsignals, searchLeg, parser, started, options, scores, {signals});
    const isolations = strategy.legs.length > 1 && strategy.legs.map((leg, i) => {
        return spliceExpr(strategy.legs, i, 1).join(' OR ');
    });
    return evaluate(bestsignals, scores, strategy.expr, latest)
      .then(latestScore => Promise.all(strategy.legs.map((leg, i) => {
        if (strategy.legs.length == 1) return latestScore;
        const withoutIt = isolations[i];
        return evaluate(bestsignals, scores, withoutIt, latest).then(score => latestScore - score);
    })).then(async(contribs) => {
        if (await check()) return msignals;
        const label = options.label || '\b';
        logger.log("Strategize", label, "base", latest.variables[strategy_var], latestScore);
        const cost = getStrategyCost(strategy.expr, options);
        const msignals = merge(signals, {[strategy_var]:{score:latestScore, cost}});
        const full = options.conjunctions_only || options.max_operands &&
            options.max_operands <= countOperands(strategy.expr);
        const idx = chooseContribution(prng, options.disjunction_cost, contribs, full ? 0 : 1);
        if (idx < strategy.legs.length)
            logger.trace("Strategize", label, "contrib", strategy.legs[idx].expr, contribs[idx]);
        const searchFn = searchLeg.bind(this, 1, {}); // just try to improve one thing
        return strategizeContribs(searchFn, msignals, strategy, contribs[idx], idx, options)
          .then(signals => {
            const better = signals[strategy_var];
            const new_expr = better.variables[strategy_var];
            if (!new_expr) {
                logger.warn("Strategize", options.label || '\b', "failed to make sense of", latest_expr);
                return strategizeAll(bestsignals, searchLeg, parser, started, options, scores, {signals});
            }
            if (latestScore - cost < better.score - better.cost) return signals;
            else return msignals; // better was not significantly so
        });
    }));
}

/**
 * Recursively tries to find the best strategy, until no more improvements can be made
 */
async function strategizeAll(bestsignals, searchLeg, parser, started, options, scores, state) {
    _.defaults(state, {exhausted: [false], scores: []});
    const strategy_var = options.strategy_variable;
    const latest = state.signals[strategy_var];
    const latest_expr = latest.variables[strategy_var];
    const strategy = await parser(isBlankStrategy(latest_expr, options) ? '' : latest_expr);
    const isolations = strategy.legs.length > 1 && strategy.legs.map((leg, i) => {
        return spliceExpr(strategy.legs, i, 1).join(' OR ');
    });
    const leg_count = Math.max(strategy.legs.length+(options.conjunctions_only?0:1),1);
    return Promise.all(_.range(leg_count).map(idx => {
        if (state.exhausted[idx]) return state;
        const searchLegFn = searchLeg.bind(this, 100, state.scores[idx] = state.scores[idx] || {});
        return Promise.resolve(!strategy.legs.length ? 0 : strategy.legs.length == 1 ? latest.score :
            evaluate(bestsignals, scores, isolations[idx], latest).then(score => latest.score - score))
          .then(contrib => strategizeContribs(searchLegFn, state.signals, strategy, contrib, idx, options))
          .then(async(signals) => {
            const same = _.isEqual(signals, state.signals);
            const new_expr = same ? latest_expr : signals[strategy_var].variables[strategy_var];
            const new_strategy = same ? strategy : await parser(new_expr);
            const next_exhausted = same ? state.exhausted.slice(0) : new Array(new_strategy.legs.length+1);
            const next_scores = [];
            if (new_strategy.legs.length >= strategy.legs.length) {
                next_exhausted[idx] = same; // legs was not dropped
                next_scores[idx] = state.scores[idx];
            }
            if (idx < new_strategy.legs.length) {
                const full = options.conjunctions_only || options.max_operands &&
                    options.max_operands <= countOperands(new_expr);
                next_exhausted[new_strategy.legs.length] = full;
            }
            return {signals, exhausted: next_exhausted, scores: next_scores};
        });
    })).then(all => {
        const different = all.filter(se => !_.isEqual(se.signals, state.signals));
        const se = _.last(_.sortBy(different, se => {
            const better = se.signals[strategy_var];
            return better.score - better.cost;
        }));
        if (se) return se;
        return {
            signals: state.signals,
            exhausted: all.map((se, i) => se.exhausted[i]),
            scores: all.map((se, i) => se.scores[i])
        };
    }).then(state => {
        const better = state.signals[strategy_var];
        const new_expr = better.variables[strategy_var];
        if (!new_expr)
            throw Error(`Strategize ${options.label} failed to come up with a strategy`);
        if (_.every(state.exhausted)) return state.signals;
        const elapse = moment.duration(Date.now() - started).humanize();
        logger.log("Strategize", options.label || '\b', new_expr, "after", elapse, better.score);
        return strategizeAll(bestsignals, searchLeg, parser, started, options, scores, state);
    });
}

/**
 * Given a strategy leg contribution tries to find a better strategy for given leg index
 */
function strategizeContribs(searchLeg, signals, strategy, contrib, idx, options) {
    const label = options.label || '\b';
    const strategy_var = options.strategy_variable;
    const latest = signals[strategy_var];
    const empty = !strategy.legs.length;
    return strategizeLeg(searchLeg, signals, strategy, idx, options)
      .then(leg_signals => {
        const best = leg_signals[strategy_var];
        const new_expr = best.variables[strategy_var];
        const better = empty || best.score - best.cost > latest.score - latest.cost;
        const better_contrib = better ? best.score - latest.score + contrib : contrib;
        const drop = idx < strategy.legs.length && strategy.legs.length > 1 &&
            better_contrib < options.disjunction_cost;
        const drop_expr = drop && spliceExpr(strategy.legs, idx, 1).join(' OR ');
        if (drop) return _.extend({}, signals, {[strategy_var]: merge(latest, {
            score: latest.score - contrib,
            cost: getStrategyCost(drop_expr, options),
            variables:{[strategy_var]: drop_expr}
        })});
        return better ? leg_signals : signals;
    });
}

/**
 * Isolates the strategy leg as a strategy to search for a better solution
 */
async function strategizeLeg(searchLeg, signals, strategy, idx, options) {
    const leg_var = options.leg_variable; // move leg into temporary variable
    const strategy_var = options.strategy_variable;
    const latest = signals[strategy_var];
    const empty = !strategy.legs.length;
    const scratch = idx >= strategy.legs.length;
    const used = empty ? [] : await getReferences(latest.variables[strategy_var], options);
    const operands = idx < strategy.legs.length ? countOperands(strategy.legs[idx].expr) : 0;
    const other_operands = empty ? 0 : countOperands(strategy.expr) - operands;
    const opts = merge(latest, {
        score: latest.score || 0,
        cost: scratch ? 0 : getStrategyCost(strategy.legs[idx].expr, options),
        disjunction_cost: empty ? 0 : options.disjunction_cost,
        strategy_variable: leg_var,
        max_operands: options.max_operands && options.max_operands - other_operands,
        variables: {
            [strategy_var]: spliceExpr(strategy.legs, idx, 1, leg_var).join(' OR '),
            [leg_var]: scratch ? '' : strategy.legs[idx].expr
        }
    });
    return searchLeg(signals, opts).then(leg_signals => _.mapObject(leg_signals, (best, name) => {
        if (signals[name] && name != leg_var) return best;
        const new_leg = best.variables[leg_var];
        const new_expr = spliceExpr(strategy.legs, idx, 1, new_leg).join(' OR ');
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
    const check = interrupt(true);
    _.defaults(scores, {bestsignal: {}, evaluate: {}});
    const bestsignalFn = bestsignal.bind(this, bestsignals, terminateAt, scores.bestsignal);
    const evaluateFn = evaluate.bind(this, bestsignals, scores.evaluate);
    const max_operands = latest.max_operands;
    const strategy_var = latest.strategy_variable;
    const strategy = latest.variables[strategy_var];
    const moreStrategiesFn = moreStrategies.bind(this, prng, evaluateFn, parser, max_operands);
    const empty = !strategy || strategy == latest.signal_variable;
    let leg_signals = _.extend({}, signals, {[strategy_var]: latest});
    let attempts = 1;
    const next = search.bind(this, bestsignalFn, moreStrategiesFn);
    const cb = async(next_signals) => {
        const best = next_signals[strategy_var];
        const next_expr = best.variables[strategy_var];
        const disjunction_cost = latest.disjunction_cost;
        const better = empty ? best.score > best.cost + disjunction_cost :
            latest.score - latest.cost < best.score - best.cost;
        if (better || attempts >= max_attempts || await check() || Date.now() > terminateAt)
            return Promise.resolve(next_signals);
        attempts = _.isEqual(next_signals, leg_signals) ? attempts + 1 : 0;
        leg_signals = next_signals;
        return next(next_signals, latest, cb);
    };
    return next(leg_signals, latest, cb);
}

/**
 * Recursively tests solutions to improve the score
 * @return the best solution found
 */
function search(bestsignal, moreStrategies, signals, options, cb) {
    const strategy_var = options.strategy_variable;
    const latest = signals[strategy_var];
    return moreStrategies(latest)
      .then(strategies => Promise.all(strategies.map(st => bestsignal(st, latest))))
      .then(solutions => _.last(_.sortBy(solutions, sol => sol.score - sol.cost)))
      .then(async(solution) => {
        if (!solution || solution.revisited) {
            return cb(signals);
        } else if (latest.variables[strategy_var] && _.has(latest, 'score') &&
                solution.score - solution.cost <= latest.score - latest.cost) {
            const strategy = solution.variables[strategy_var];
            logger.debug("Strategize", options.label || '\b', "leg", strategy, solution.score);
            return cb(signals);
        } else {
            const formatted = await formatSolution(solution, latest, '_');
            const improved = merge(latest, formatted);
            const next_signals = _.defaults({
                [formatted.solution_variable]: solution,
                [strategy_var]: improved
            }, signals);
            const strategy = improved.variables[strategy_var];
            logger.log("Strategize", options.label || '\b', "leg", strategy, solution.score);
            return cb(next_signals);
        }
    });
}

/**
 * Finds the best signal for the strategy
 */
function bestsignal(bestsignals, terminateAt, scores, signal_strategy, latest) {
    const cost = getStrategyCost(signal_strategy, latest);
    if (scores[signal_strategy])
        return scores[signal_strategy].then(score => ({score, cost, revisited: true}));
    logger.debug("bestsignal", latest.label || '\b', signal_strategy);
    const regex = new RegExp('\\b' + latest.signal_variable + '\\b','g');
    const token = signal_strategy.split(' ').find(token => regex.exec(token));
    const sign = token && token.replace(regex, '');
    const label = sign && latest.label ? sign + ' ' + latest.label : sign || latest.label;
    const optimize_termination = latest.optimize_termination || terminateAt &&
        moment.duration(Math.floor((terminateAt - Date.now())/1000)*1000).toISOString() || undefined;
    const promise = bestsignals(_.defaults({
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
            cost: cost
        }, best);
    });
    scores[signal_strategy] = promise.then(best => best.score);
    return promise;
}

/**
 * Counts the conjunctions and disjunctions multiplying them by their cost
 */
function getStrategyCost(strategy_expr, options) {
    const disjunctions = strategy_expr.split(' OR ').length -1;
    const conjunctions = strategy_expr.split(' AND ').length -1;
    return disjunctions * options.disjunction_cost + conjunctions * options.conjunction_cost;
}

/**
 * Counts the number of operands between OR/AND operators
 */
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
async function moreStrategies(prng, evaluate, parser, max_operands, latest) {
    const strategy_var = latest.strategy_variable;
    const strategy = await parser(latest.variables[strategy_var]);
    const signal_var = latest.signal_variable;
    if (!strategy.legs.length || signal_var == strategy.expr) { // initial signal
        if (latest.follow_signals_only) return Promise.resolve([signal_var]);
        else return Promise.resolve(invert(signal_var));
    }
    expect(latest).to.have.property('score');
    expect(strategy.legs).to.have.lengthOf(1);
    const leg = _.last(strategy.legs);
    const comparisons = leg.comparisons;
    const signal = leg.signal;
    const isolations = leg.comparisons.map((cmp, j) => {
        return spliceExpr(comparisons, j, 1).concat(signal.expr).join(' AND ');
    });
    return Promise.all(isolations.map(isolation => evaluate(isolation, latest)))
      .then(scores => scores.map(score => latest.score - score))
      .then(contributions => { // change comparator
        const room = !latest.disjunctions_only && max_operands &&
            max_operands > countOperands(strategy.expr);
        const cmpIdx = chooseContribution(prng, latest.conjunction_cost, contributions, room ? 2 : 1);
        return Promise.resolve(contributions[cmpIdx]).then(contrib => {
            if (cmpIdx < comparisons.length)
                logger.debug("Strategize", latest.label || '\b', "contrib",
                    comparisons[cmpIdx].expr, contrib);
            if (cmpIdx > comparisons.length || !room && cmpIdx == comparisons.length) {
                // replace reference signal
                const needle = signal.variable || signal.expr;
                const follow = createReplacer({[needle]: signal_var})(leg.expr);
                if (latest.follow_signals_only) return [follow];
                else return [
                    follow,
                    leg.expr.replace(new RegExp('-' + needle + '\\b','g'), signal_var)
                            .replace(new RegExp('\\b' + needle + '\\b','g'), '-' + signal_var)
                ];
            } else { // add or replace comparison
                return listComparators(latest).map(comparator => {
                    const expr = comparator(signal_var, signal.variable || signal.expr);
                    return spliceExpr(comparisons, cmpIdx, 1, expr).concat(signal.expr).join(' AND ');
                });
            }
        }).then(strategies => {
            if (max_operands && countOperands(strategies[0]) > max_operands) return [];
            else return strategies;
        }).then(strategies => {
            if (cmpIdx < contributions.length && contributions[cmpIdx] < latest.conjunction_cost) {
                const dropped = spliceExpr(comparisons, cmpIdx, 1).concat(signal.expr).join(' AND ');
                return strategies.concat(dropped); // also try dropping the under performing comparison
            }
            return strategies;
        });
    });
}

/**
 * A function that parses a strategy into a disjunction of conjunction legs of comparisons
 * {legs:[{comparisons:[{expr}],signal:{expr}}]}
 */
function createParser() {
    const comparators = _.uniq(_.pluck(listComparators(), 'operator').sort(), true);
    const parser = new Parser({
        expression(expr, operator, args) {
            if (operator == 'AND') {
                const members = args.reduce((args, arg) => {
                    if (arg.legs) args.push({expr: arg.expr});
                    else if (arg.signal) return args.concat(arg.comparisons, arg.signal);
                    else if (arg.expr) args.push(arg);
                    else args.push({expr: arg});
                    return args;
                }, []);
                return {expr, comparisons: _.initial(members), signal: _.last(members)};
            } else if (operator == 'OR') {
                const members = args.reduce((args, arg) => {
                    if (arg.legs) return args.concat(arg.legs);
                    else if (arg.signal) args.push(arg);
                    else if (arg.expr) args.push({expr: arg.expr, comparisons: [], signal: arg});
                    else args.push({expr: arg, comparisons: [], signal: {expr: arg}});
                    return args;
                }, []);
                return {expr, legs: members};
            } else if (operator == 'NEGATIVE' && args.length == 1) {
                return {expr, inverse: true, variable: args[0].expr || args[0]};
            } else if (args.length != 2) {
                return {expr};
            } else if (~comparators.indexOf(operator) && ~args.indexOf('0')) {
                const arg = args.find(a => a != '0');
                return {expr, operator, zero: true, variable: arg.expr || arg};
            } else if (~comparators.indexOf(operator)) {
                const variable = args[0].expr || args[0];
                const comparand = args[1].expr || args[1];
                const inverse = args.some(arg => arg.inverse);
                return {expr, operator, inverse, variable, comparand};
            } else if (operator == 'PRODUCT' && ~args.indexOf('-1')) {
                const arg = args.find(a => a != '-1');
                return {expr, inverse: true, variable: arg.expr || arg};
            } else {
                return {expr};
            }
        }
    });
    return async(strategy) => {
        const parsed = strategy ? await parser.parse(strategy) : '';
        const legs = strategy ? parsed.legs ? parsed.legs : [
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
 * Randomly returns an index from the given an array of contribution amounts,
 * unless minimum contribution is less than threshold, in which case return 0
 */
function chooseContribution(prng, threshold, contributions, extra) {
    const items = contributions.map((contrib, i) => ({
        p: i,
        contrib: contrib
    }));
    const byContrib = _.sortBy(items, 'contrib');
    if (byContrib.length && byContrib[0].contrib < threshold) return byContrib[0].p;
    const idx = choose(prng, byContrib.length, extra);
    if (byContrib[idx]) return byContrib[idx].p;
    else return idx;
}

/**
 * Randomly returns a number between 0 and max+extra (exclusive)
 * The distribution is exponentially weighted to 0
 * @param extra number of additional values beyond max
 */
function choose(prng, max, extra) {
    const t = 1.5;
    if (max+extra < 1) return 0;
    let weights = _.range(max).map(i => Math.pow(i + 1, -t));
    if (extra) {
        weights = weights.concat(_.range(extra).map(i => Math.pow(weights.length +2 +i, -t)));
    }
    let target = prng() * weights.reduce((a,b) => a + b);
    for (let i=0; i<weights.length; i++) {
        if (target < weights[i]) return i;
        else target -= weights[i];
    }
    throw Error();
}

/**
 * List of possible comparators that can be used
 */
function listComparators(options) {
    const follow = [
        _.extend((a,b)=>`${a}=${b}`,     {operator: 'EQUALS'}),
        _.extend((a,b)=>`${a}!=-${b}`, {operator: 'NOT_EQUALS'})
    ];
    if (options && options.follow_signals_only) return follow;
    const direct = [
        _.extend((a,b)=>`${a}=-${b}`,  {operator: 'EQUALS'}),
        _.extend((a,b)=>`${a}=0`,        {operator: 'EQUALS'}),
        _.extend((a,b)=>`${a}!=${b}`,    {operator: 'NOT_EQUALS'}),
        _.extend((a,b)=>`${a}!=0`,       {operator: 'NOT_EQUALS'})
    ];
    if (options && !options.directional) return follow.concat(direct);
    const relative = [
        _.extend((a,b)=>`${a}<0`,  {operator: 'LESS_THAN'}),
        _.extend((a,b)=>`${a}>0`,  {operator: 'GREATER_THAN'}),
        _.extend((a,b)=>`${a}>=0`, {operator: 'NOT_LESS_THAN'}),
        _.extend((a,b)=>`${a}<=0`, {operator: 'NOT_GREATER_THAN'})
    ];
    return follow.concat(direct, relative);
}

/**
 * Splices an array of items with expr properties
 */
function spliceExpr(array, start, deleteCount, ...items) {
    const exprs = array.map(item => item.expr);
    exprs.splice.apply(exprs, _.rest(arguments));
    return exprs;
}

/**
 * returns variable with and without the (negative) prefix '-'
 */
function invert(variable) {
    return [variable, `-${variable}`];
}

/**
 * Renames signals variables, that are used in the given strategy, to use unique
 * variable names starting from suffix 'A'
 */
async function combine(signals, options) {
    const strategy_var = options.strategy_variable;
    const best = signals[strategy_var];
    if (!best.variables[strategy_var]) return null;
    const variables = (await getReferences(best.variables, options))[strategy_var];
    const used = _.intersection(variables, _.keys(signals));
    const replacement = {};
    const result = await used.reduce(async(promise, variable) => {
        const combined = await promise;
        const solution = signals[variable];
        if (!solution || strategy_var == variable)
            return combined; // not created here or leg variable
        const formatted = await formatSolution(solution, merge(options, combined));
        delete formatted.variables[formatted.strategy_variable];
        replacement[variable] = formatted.solution_variable;
        return merge(combined, _.omit(formatted, 'solution_variable', 'signal_variable'));
    }, {});
    const combined_strategy = await new Parser({substitutions:replacement}).parse(best.variables[strategy_var]);
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
async function formatSolution(solution, options, suffix) {
    const parser = createReplacer({});
    const signal = solution.variables[solution.signal_variable];
    const existing = _.keys(options.variables)
        .filter(name => name.indexOf(signal) === 0)
        .map(name => name.substring(signal.length));
    const formatted = await existing.reduce(async(promise, id) => {
        const already = await promise;
        if (already) return already;
        const formatted = await formatSolutionWithId(solution, options, id);
        if (signalConflicts(parser, formatted, options)) return null;
        else return formatted;
    }, null);
    if (formatted) return formatted; // reuse existing signal
    for (let id_num=10; id_num < 100; id_num++) {
        const id = (suffix || '') + id_num.toString(36).toUpperCase();
        if (!~existing.indexOf(id)) {
            const formatted = await formatSolutionWithId(solution, options, id);
            if (!signalConflicts(parser, formatted, options)) return formatted;
        }
    }
    throw Error(`Could not determine reasonable signal name for ${signal}`);
}

/**
 * Checks if the solutions have conflicting variable/parameter names
 */
function signalConflicts(parser, s1, s2) {
    const params = _.intersection(_.keys(s1.parameters), _.keys(s2.parameters));
    const vars = _.intersection(_.keys(s1.variables), _.keys(s2.variables));
    const varnames = _.without(vars, s1.strategy_variable);
    const cmp = (a, b) => name => a[name] != b[name] && parser(a[name]) != parser(b[name]);
    return params.find(cmp(s1.parameters, s2.parameters)) ||
        varnames.find(cmp(s1.variables, s2.variables));
}

/**
 * Renames solution result variables to has the given id as a suffix
 */
async function formatSolutionWithId(solution, options, id) {
    const signal = solution.signal_variable;
    const fixed = _.extend({}, options.parameters, options.variables);
    const values = _.extend({}, solution.variables, solution.parameters);
    const conflicts = _.reduce(values, (conflicts, value, name) => {
        if (fixed[name] != value && _.has(fixed, name))
            conflicts.push(name);
        return conflicts;
    }, _.keys(solution.parameters));
    const references = await getReferences(values, options);
    const local = [signal].concat(references[signal]);
    const overlap = references[signal].filter(name => ~conflicts.indexOf(name) ||
        _.intersection(conflicts, references[name]).length);
    const replacement = _.object(overlap, overlap.map(name => name + id));
    const replacer = createReplacer(replacement);
    const rename = (object, value, name) => _.extend(object, {[replacement[name] || name]: value});
    const parser = new Parser({substitutions:{
        [signal]: solution.variables[signal]
    }});
    const strategy = await parser.parse(solution.variables[solution.strategy_variable]);
    const eval_validity = replacer(_.compact(_.flatten([solution.eval_validity])));
    const variables = _.omit(_.pick(solution.variables, local), signal, options.leg_variable)
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
        pad_leading: !options.pad_leading && solution.pad_leading ||
            solution.pad_leading > options.pad_leading ? solution.pad_leading : undefined,
    }, value => value == null);
}

/**
 * Array of variable names used, iff given variables is a string, else
 * Hash of variable names to array of variable names it depends on
 * @param variables a string expression or map of names to string expressions
 */
async function getReferences(variables, options) {
    const references = await new Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            if (_.isString(variables) || _.has(variables, name)) return [name];
            else return [];
        },
        expression(expr, name, args) {
            if (rolling.has(name))
                return _.intersection(rolling.getVariables(expr, options), _.keys(variables));
            else return _.uniq(_.flatten(args, true));
        }
    }).parse(variables);
    if (_.isString(variables)) return references;
    const follow = _.clone(references);
    while (_.reduce(follow, (more, reference, name) => {
        if (!reference.length) return more;
        const followed = _.uniq(_.flatten(reference.map(ref => follow[ref]), true));
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

/**
 * Returns a function that takes an expression and rewrites replacing variables in replacement hash
 */
function createReplacer(replacement) {
    const parser = new Parser();
    const map = name => replacement[name] || name;
    const replacer = new Parser({
        variable(name) {
            return map(name);
        },
        expression(expr, name, args) {
            if (!rolling.has(name)) return name + '(' + args.join(',') + ')';
            const margs = args.map(arg => {
                if (!_.isString(arg) || '"' != arg.charAt(0)) return arg;
                return JSON.stringify(parser.parse(replacer.parse(JSON.parse(arg))));
            });
            return name + '(' + margs.join(',') + ')';
        }
    });
    return function(expr) {
        const parsed = parser.parse(replacer.parse(expr));
        if (_.isArray(expr) || _.isString(expr)) return parsed;
        return _.object(_.keys(parsed).map(map), _.values(parsed));
    };
}

/**
 * Chooses a variable name based on prefix that is not already used
 */
async function chooseVariable(prefix, options) {
    const references = await getReferences(merge(options.columns, options.variables), options);
    const portfolioCols = _.flatten(_.flatten([options.portfolio]).map(portfolio => _.keys(portfolio.columns)));
    const variables = _.uniq(_.keys(references).concat(_.flatten(_.values(references)), portfolioCols));
    if (!~variables.indexOf(prefix)) return prefix;
    let i = 0;
    while (~variables.indexOf(prefix + i)) i++;
    return prefix + i;
}
