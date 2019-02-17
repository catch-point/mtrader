// optimize.js
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
const statkit = require("statkit");
const Alea = require('alea');
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const lookback = require('./lookback-functions.js');
const rolling = require('./rolling-functions.js');
const logger = require('./logger.js');
const interrupt = require('./interrupt.js');
const expect = require('chai').expect;

const MIN_POPULATION = 2;
const MAX_POPULATION = 8;

/**
 * Given possible parameter_values, searches for better parameter values
 * using an evolution strategy with collect as the fitnenss test
 */
module.exports = function(collect) {
    let promiseHelp;
    let prng = new Alea();
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(collect);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            const fields = _.first(help).properties;
            const opts = _.defaults(_.pick(options, _.keys(_.first(help).options)), {
                tz: moment.tz.guess(),
                parameter_values: {},
                optimize_termination: options.termination
            });
            return optimize(collect, prng, opts);
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
function help(collect) {
    return collect({help: true}).then(_.first).then(help => {
        return [{
            name: 'optimize',
            usage: 'optimize(options)',
            description: "Searches possible parameter values to find a higher score",
            properties: ['score', 'parameters'],
            options: _.extend({}, help.options, {
                solution_count: {
                    usage: '<number of results>',
                    description: "Number of solutions to include in result"
                },
                sample_duration: {
                    usage: 'P1Y',
                    description: "Duration of each sample"
                },
                sample_count: {
                    usage: '<number of samples>',
                    description: "Number of samples to search before searching the entire date range (begin-end)"
                },
                sample_population_size: {
                    usage: '<number of candidates>',
                    description: "Number of candidates to test and mutate together in each sample"
                },
                sample_termination: {
                    usage: 'PT1M',
                    description: "Amount of time spent searching for sample solutions"
                },
                eval_validity: {
                    usage: '<expression>',
                    description: "Expression (or array) that invalidates candidates by returning 0 or null"
                },
                eval_variables: {
                    type: 'map',
                    usage: '<expression>',
                    description: "Variable used to help compute the eval_score. The expression can be any combination of field, constants, and function calls connected by an operator or operators.",
                    seeAlso: ['expression', 'common-functions', 'lookback-functions', 'indicator-functions', 'rolling-functions']
                },
                eval_score: {
                    usage: '<expression>',
                    description: "Expression that determines the score for a sample"
                },
                parameter_values: {
                    usage: '{name: [value,..],..}',
                    description: "Possible parameter values for each each parameter name"
                },
                population_size: {
                    usage: '<number of candidates>',
                    description: "Number of candidates to test and mutate together"
                },
                optimize_termination: {
                    usage: 'PT5M',
                    description: "Amount of time spent searching for a solution before the best yet is used"
                },
                termination: {
                    usage: 'PT5M',
                    description: "Amount of time spent searching for a solution before the best yet is used"
                }
            })
        }];
    });
}

/**
 * Searches possible parameter values to determine a higher score for a date range
 */
function optimize(collect, prng, options) {
    expect(options).to.have.property('parameter_values');
    expect(options).to.have.property('eval_score');
    const started = Date.now();
    const count = options.solution_count || 1;
    const pnames = _.keys(options.parameter_values);
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const space = createSearchSpace(pnames, options);
    return searchParameters(collect, prng, pnames, count, space, options).then(solutions => {
        if (_.isEmpty(solutions))
            throw Error("Could not create population for " + options.label);
        const duration = moment.duration(_.max(_.pluck(solutions, 'foundAt')) - started);
        if (!_.isEmpty(solutions) && solutions[0].pindex.length)
            logger.log("Found local extremum", options.label || '\b', solutions[0].pindex.map((idx, i) => pvalues[i][idx]).join(','), "in", duration.humanize(), solutions[0].score);
        else if (!_.isEmpty(solutions))
            logger.debug("Evaluated", options.label || '\b', solutions[0].score);
        return solutions.map((solution, i) => ({
            score: solution.score,
            parameters: _.object(pnames,
                solution.pindex.map((idx, i) => pvalues[i][idx])
            )
        }));
    }).then(results => {
        if (options.solution_count) return results;
        else return _.first(results);
    });
}

/**
 * Searches the parameter values returning count results
 */
function searchParameters(collect, prng, pnames, count, space, options) {
    const terminateAt = options.optimize_termination &&
        moment().add(moment.duration(options.optimize_termination)).valueOf();
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const size = options.population_size || Math.max(
        Math.min(Math.ceil(pvalues.map(_.size).reduce((a,b)=>a+b,0)/2), MAX_POPULATION),
        _.max(pvalues.map(_.size)), count * 2, MIN_POPULATION);
    const createPopulation = options.sample_duration || options.sample_count ?
        sampleSolutions(collect, prng, pnames, space, size, options) :
        initialPopulation(prng, pnames, space, size, options);
    return Promise.resolve(createPopulation).then(population => {
        if (population.length === 0)
            return [];
        if (population.length > 1)
            logger.debug("Initial population of", population.length, options.label || '\b');
        const fitnessFn = fitness(collect, options, pnames);
        const mutationFn = mutation.bind(this, prng, pvalues, space);
        return adapt(fitnessFn, mutationFn, pnames, terminateAt, options, population, size);
    }).then(solutions => {
        return _.sortBy(solutions.reverse(), 'score').slice(-count).reverse();
    });
}

/**
 * Simple in-memory cache of candidates to avoid re-evaluating them again
 */
function createSearchSpace(pnames, options) {
    const hash = {};
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const parser = Parser({
        constant(value) {
            return _.constant(value);
        },
        variable(name) {
            const idx = pnames.indexOf(name);
            if (idx >= 0) return pindex => pvalues[idx][pindex[idx]];
            const p = _.property(name);
            const value = p(options.parameters) || p(options.parameters);
            return _.constant(value);
        },
        expression(expr, name, args) {
            if (common.has(name)) return common(name, args, options);
            else throw Error("Cannot use " + name + " in eval_validity");
        }
    });
    const validity = parser.parseCriteriaList(options.eval_validity);
    const invalid = ctx => !!validity.find(fn => !fn(ctx));
    return candidate => {
        const key = candidate.pindex.join(',');
        if (hash[key] || invalid(candidate.pindex)) return false;
        hash[key] = candidate;
        return true;
    };
}

/**
 * Creates an initial population from the best result of a set of sample periods
 */
function sampleSolutions(collect, prng, pnames, space, size, options) {
    const begin = moment(options.begin);
    const end = moment(options.end || options.now);
    if (!begin.isValid()) throw Error("Invalid begin date: " + options.begin);
    if (!end.isValid()) throw Error("Invalid end date: " + options.end);
    const until = options.sample_duration ?
        moment(end).subtract(moment.duration(options.sample_duration)) : begin;
    const count = options.sample_count || 1;
    const period = createDuration(begin, until, count);
    const unit = getDurationUnit(period, count);
    const duration = options.sample_duration ?
        moment.duration(options.sample_duration) : moment.duration(end.diff(begin));
    if (duration && duration.asMilliseconds()<=0) throw Error("Invalid duration: " + options.sample_duration);
    const period_units = Math.max(period.as(unit), 0);
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const termination = options.sample_termination || options.optimize_termination &&
        moment.duration(moment.duration(options.optimize_termination).asSeconds()/3000).toISOString();
    const optionset = _.range(count).map(() => {
        let periodBegin = period_units ? moment(begin).add(Math.round(prng() * period_units), unit) : begin
        let periodEnd = moment(periodBegin).add(duration);
        if (!periodEnd.isBefore(end)) {
            periodEnd = end;
            if (periodBegin.isAfter(begin)) {
                periodBegin = moment(end).subtract(duration);
            }
        }
        return _.defaults({
            optimize_termination: termination,
            begin: periodBegin.format(), end: periodEnd.format(),
            population_size: options.sample_population_size || options.population_size
        }, _.omit(options, ['sample_duration', 'sample_count']));
    });
    const space_factory = period_units ? createSearchSpace : _.constant(space);
    return Promise.all(optionset.map(opts => {
        const sample_space = space_factory(pnames, options);
        return searchParameters(collect, prng, pnames, opts.population_size, sample_space, opts);
    })).then(results => {
        const parameters = _.pick(options.parameters, pnames);
        const pool = _.compact(_.flatten(_.zip.apply(_, results)));
        const sorted = period_units ? pool : _.sortBy(pool.reverse(), 'score').reverse();
        const population = sorted.reduce((population, solution) => {
            const candidate = {pindex: solution.pindex};
            if (population.length < size && (!period_units || space(candidate))) {
                population.push(candidate);
            }
            return population;
        }, []);
        const seed = _.isEmpty(parameters) ? null :
            {pindex: pvalues.map((values, p) => values.indexOf(parameters[pnames[p]]))};
        if (seed && space(seed)) {
            population.push(seed);
        }
        const mutate = mutation(prng, pvalues, space, population);
        for (let i=0; i/2<size && population.length < size; i++) {
            const mutant = mutate(seed);
            if (mutant) population.push(mutant);
        }
        return population;
    });
}

/**
 * Creates a random initial population, but also includes the default parameters.
 */
function initialPopulation(prng, pnames, space, size, options) {
    const parameters = _.pick(options.parameters, pnames);
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const population = [];
    const seed = _.isEmpty(parameters) ? null : {
        pindex: pvalues.map((values, p) => values.indexOf(parameters[pnames[p]]))
    };
    if (seed && space(seed)) {
        population.push(seed);
    }
    const mutate = mutation(prng, pvalues, space);
    for (let i=0; i<size*2 && population.length < size; i++) {
        const mutant = mutate(seed);
        if (mutant) population.push(mutant);
    }
    return population;
}

/**
 * Creates the fitness function for a set of parameter values
 */
function fitness(collect, options, pnames) {
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const score_column = getScoreColumn(options);
    const transient = _.isBoolean(options.transient) ? options.transient :
        isLookbackParameter(pnames, options);
    return function(candidate) {
        const params = _.object(pnames, candidate.pindex.map((idx, p) => pvalues[p][idx]));
        const parameters = _.defaults(params, options.parameters);
        const label = pnames.length ? (options.label ? options.label + ' ' : '') +
                candidate.pindex.map((idx,i) => {
            return options.parameter_values[pnames[i]][idx];
        }).join(',') : options.label;
        const picked = ['portfolio', 'columns', 'variables', 'parameters', 'filter', 'precedence', 'order', 'pad_leading', 'reset_every', 'tail', 'transient'];
        const opts = _.defaults({
            tail: 1,
            transient: transient,
            label: label,
            portfolio: [_.pick(options, picked)],
            columns: {[score_column]: options.eval_score},
            variables: options.eval_variables,
            parameters: parameters
        }, _.omit(options, picked));
        return collect(opts)
          .then(_.last).then(_.property(score_column)).then(score => {
            return _.extend(candidate, {
                score: score || 0
            });
        });
    };
}

/**
 * Cycles between candidate selection and mutation until the score of the best/worst selected solution is the same for `stale` number of iterations
 */
function adapt(fitness, mutation, pnames, terminateAt, options, population, size) {
    const check = interrupt(true);
    const maxEliteSize = Math.max(options.solution_count || 1, Math.floor(size/2));
    const generation = size - maxEliteSize || 1;
    let elite = []; // elite solutions best one last
    const solutions = []; // unsorted solutions with a score
    const candidates = population.slice(0); // solutions without a score
    let strength = 0;
    let counter = 0;
    let until = Promise.resolve();
    const rank = candidate => {
        return fitness(candidate).then(solution => {
            candidates.splice(candidates.indexOf(candidate), 1);
            solutions.push(solution);
        }).then(() => {
            if (!solutions.length || check()) return;
            const population = solutions.concat(elite);
            const top = _.sortBy(population, 'score').slice(-maxEliteSize);
            const additions = _.difference(top, elite);
            const better = _.difference(_.pluck(top, 'score'), _.pluck(elite, 'score')).length;
            if (better || counter % generation === 0) {
                const best = _.last(top);
                if (best.pindex.length) logger.debug("Optimize",
                  options.label || '\b', options.begin,
                  "G" + Math.floor(counter/generation),
                  "P" + (elite.length+candidates.length),
                  "M" + Math.round(strength * pnames.length),
                  best.pindex.map((idx,i) => {
                    return options.parameter_values[pnames[i]][idx];
                }).join(','), ':', best.score);
            }
            if (better) {
                const now = Date.now();
                additions.forEach(solution => solution.foundAt = now);
                elite = top;
                strength = 0;
            }
            if (!terminateAt || terminateAt > Date.now()) {
                const ranking = [];
                while (!ranking.length && strength < generation/pnames.length*2) {
                    const mutate = mutation(elite, strength);
                    for (let i=0; i<size*2 && elite.length+candidates.length<size; i++) {
                        const mutant = mutate(additions[i], _.last(elite));
                        if (mutant) {
                            candidates.push(mutant);
                            ranking.push(rank(mutant));
                        }
                    }
                    strength += 1/generation/pnames.length;
                }
                if (ranking.length) {
                    until = until.then(() => Promise.all(ranking));
                }
            }
            counter += solutions.length;
            solutions.splice(0, solutions.length);
        });
    };
    until = until.then(() => Promise.all(candidates.map(rank)));
    const wait = promise => promise.then(() => {
        if (promise != until && !check()) return wait(until);
        else return elite.slice(0).reverse();
    });
    return wait(until);
}

/**
 * Takes the solutions and adds mutated candidates using the gaussian distribution of the solution set
 */
function mutation(prng, pvalues, space, solutions, strength) {
    const empty = _.isEmpty(solutions);
    const one = solutions && solutions.length == 1;
    const mutations = pvalues.map((values,i) => {
        const vals = empty || one ? _.range(values.length) : _.map(solutions, sol => sol.pindex[i]);
        const avg = one ? solutions[0].pindex[i] : vals.reduce((a,b) => a + b) / vals.length;
        const stdev = vals.length>1 ? statkit.std(vals) : 0;
        const window = Math.min(stdev + (strength || 0), Math.ceil(values.length/2));
        return function(value) {
            const val = arguments.length ? value : avg;
            const target = statkit.norminv(prng()) * window + val;
            const abs = Math.abs(target % (values.length * 2));
            return abs >= values.length ?
                Math.ceil(values.length * 2 - abs) - 1 : Math.floor(abs);
        };
    });
    return function(...solutions) {
        const result = solutions.reduce((result, solution) => {
            if (result || !solution) return result;
            const mutated = {pindex: mutations.map((fn, i) => fn(solution.pindex[i]))};
            if (space(mutated)) return mutated;
        }, null);
        if (result) return result;
        const candidate = {pindex: mutations.map(fn => fn())};
        if (space(candidate)) return candidate;
        else return null;
    };
}

/**
 * Splits the date range begin-end up into even count segments along major divisions (year,month,day)
 */
function createDuration(begin, end, count) {
    const duration = moment.duration(end.diff(begin));
    const unit = getDurationUnit(duration, count);
    return moment.duration(duration.as(unit), unit);
}

/**
 * Chooses a major division unit, one of years, months, days, hours, or minutes
 */
function getDurationUnit(duration, count) {
    return ['years', 'months', 'weeks', 'days', 'hours', 'minutes'].reduce((result, unit) => {
        const number = duration.as(unit);
        if (!result && number > count && Math.abs(number - Math.round(number)) < 0.1)
            return unit;
        else return result;
    }, null) || 'minutes';
}

/**
 * Chooses a score column name that does not conflict with existing columns
 */
function getScoreColumn(options) {
    let score_column = 'score';
    if (options.eval_score) {
        // find a unique column
        for (let i=0; _.has(options.columns, score_column); i++) {
            score_column = 'score' + i;
        }
    } else if (!options.columns[score_column]) {
        throw Error("Must have eval_score options set or a score column");
    }
    return score_column;
}

/**
 * Checks if any of the parameters are used in lookback functions.
 * Lookback functions are aggressively cached by quote.js unless transient flag is set.
 */
function isLookbackParameter(pnames, options) {
    const parser = Parser({
        constant(value) {
            return {};
        },
        variable(name) {
            return {variables:[name]};
        },
        expression(expr, name, args) {
            const lookbacks = lookback.has(name) && [name];
            return args.reduce((memo, arg) => {
                const lookbackParams = lookbacks && _.intersection(pnames, arg.variables);
                return {
                    variables: _.union(memo.variables, arg.variables),
                    lookbacks: _.union(lookbacks, memo.lookbacks, arg.lookbacks),
                    lookbackParams: _.union(lookbackParams, memo.lookbackParams, arg.lookbackParams)
                };
            }, {});
        }
    });
    const lookbackParams = _.uniq(_.flatten(_.compact(parser.parse(_.flatten(_.compact([
        _.values(options.columns), _.values(options.variables),
        options.criteria, options.filter, options.precedence, options.order
    ]))).map(item => item.lookbackParams))));
    if (lookbackParams.length) return true; // don't persist parameter values
    else return false;
}
