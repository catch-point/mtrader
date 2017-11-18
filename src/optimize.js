// optimize.js
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
const statkit = require("statkit");
const Alea = require('alea');
const Parser = require('./parser.js');
const common = require('./common-functions.js');
const rolling = require('./rolling-functions.js');
const config = require('./config.js');
const logger = require('./logger.js');
const expect = require('chai').expect;

const MIN_POPULATION = 8;

/**
 * Given possible parameter_values, searches for better parameter values
 * using an evolution strategy with collect as the fitnenss test
 */
module.exports = function(collect) {
    var promiseHelp;
    var prng = new Alea();
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(collect);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.defaults(_.pick(options, _.keys(_.first(help).options)), {
                tz: moment.tz.guess(),
                now: Date.now()
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
                label: {
                    usage: '<name>',
                    description: "Identifier used in logging messages"
                },
                signal_count: {
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
                eval_validity: {
                    usage: '<expression>',
                    description: "Simple expression that invalidates candidates by returning 0 or null"
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
    var count = options.signal_count || 1;
    var pnames = _.keys(options.parameter_values);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    return searchParameters(collect, prng, pnames, count, options)
      .then(solutions => solutions.map((solution, i) => _.defaults({
        score: solution.score,
        parameters: _.object(pnames,
            solution.pindex.map((idx, i) => pvalues[i][idx])
        )
    }, options))).then(results => {
        if (options.signal_count) return results;
        else return _.first(results);
    });
}

/**
 * Searches the parameter values returning count results
 */
function searchParameters(collect, prng, pnames, count, options) {
    var terminateAt = options.termination &&
        moment().add(moment.duration(options.termination)).valueOf()
    var space = createSearchSpace(pnames, options);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var staleAfter = _.max(pvalues.map(_.size));
    var createPopulation = options.sample_duration || options.sample_count ?
        sampleSolutions(collect, prng, pnames, space, count, options) :
        initialPopulation(prng, pnames, space, count, options);
    return Promise.resolve(createPopulation).then(population => {
        var fitnessFn = fitness(collect, options, pnames);
        var selectionFn = selection.bind(this, fitnessFn, Math.floor(_.size(population)/2));
        var mutationFn = mutation.bind(this, prng, _.size(population), pvalues, space);
        return adapt(selectionFn, mutationFn, pnames, terminateAt, staleAfter, options, population);
    }).then(solutions => {
        return _.sortBy(solutions, 'score').slice(-count).reverse();
    });
}

/**
 * Simple in-memory cache of candidates to avoid re-evaluating them again
 */
function createSearchSpace(pnames, options) {
    var hash = {};
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var parser = Parser({
        constant(value) {
            return _.constant(value);
        },
        variable(name) {
            var idx = pnames.indexOf(name);
            if (idx >= 0) return pindex => pvalues[idx][pindex[idx]];
            var p = _.property(name);
            var value = p(options.parameters) || p(options.parameters);
            return _.constant(value);
        },
        expression(expr, name, args) {
            if (common.has(name)) return common(name, args, options);
            else throw Error("Cannot use " + name + " in eval_validity");
        }
    });
    var validity = parser.parseCriteriaList(options.eval_validity);
    var invalid = ctx => !!validity.find(fn => !fn(ctx));
    return {
        add(candidate) {
            var key = candidate.pindex.join(',');
            if (hash[key] || invalid(candidate.pindex)) return false;
            hash[key] = candidate;
            return true;
        }
    };
}

/**
 * Creates an initial population from the best result of a set of sample periods
 */
function sampleSolutions(collect, prng, pnames, space, count, options) {
    var begin = moment(options.begin);
    var end = moment(options.end || options.now);
    if (!begin.isValid()) throw Error("Invalid begin date: " + options.begin);
    if (!end.isValid()) throw Error("Invalid end date: " + options.end);
    var count = options.sample_count || 1;
    var period = createDuration(begin, end, count);
    var unit = getDurationUnit(period, count);
    var duration = options.sample_duration ?
        moment.duration(options.sample_duration) :
        moment.duration(Math.round(period.as(unit) / count), unit);
    if (duration && duration.asMilliseconds()<=0) throw Error("Invalid duration: " + options.sample_duration);
    var period_units = period.subtract(duration).as(unit);
        var pvalues = pnames.map(name => options.parameter_values[name]);
    var size = options.population_size ||
        Math.max(_.max(pvalues.map(_.size)), count * 2, MIN_POPULATION);
    var termination = options.termination &&
        moment.duration(moment.duration(options.termination).asMilliseconds()/3).toISOString();
    var optionset = _.range(count).map(() => {
        var periodBegin = moment(begin).add(Math.round(prng() * period_units), unit);
        var periodEnd = moment(periodBegin).add(duration);
        if (periodEnd.isAfter(end)) {
            periodEnd = end;
            periodBegin = moment(end).subtract(duration);
        }
        return _.defaults({
            termination: termination,
            begin: periodBegin.format(), end: periodEnd.format()
        }, _.omit(options, ['sample_duration', 'sample_count']));
    });
    return Promise.all(optionset.map(opts => {
        return searchParameters(collect, prng, pnames, Math.ceil(size/2), opts);
    })).then(results => {
        var parameters = _.pick(options.parameters, pnames);
        var population = results.reduce((population, sols) => sols.reduce((population, solution) => {
            var candidate = {pindex: solution.pindex};
            if (space.add(candidate)) {
                population.push(candidate);
            }
            return population;
        }, population), []);
        var seed = {pindex: pvalues.map((values, p) => values.indexOf(parameters[pnames[p]]))};
        if (!_.isEmpty(parameters) && space.add(seed)) {
            population.push(seed);
        }
        if (population.length >= size) return population;
        else return mutation(prng, size, pvalues, space, population, 0);
    });
}

/**
 * Creates a random initial population, but also includes the default parameters.
 */
function initialPopulation(prng, pnames, space, count, options) {
    var parameters = _.pick(options.parameters, pnames);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var size = options.population_size ||
        Math.max(_.max(_.map(pvalues, _.size)), count * 2, MIN_POPULATION);
    var population = [];
    if (!_.isEmpty(parameters)) {
        var seed = {
            pindex: pvalues.map((values, p) => values.indexOf(parameters[pnames[p]]))
        };
        population.push(seed);
        space.add(seed);
    }
    return mutation(prng, size, pvalues, space, population, 0);
}

/**
 * Cycles between candidate selection and mutation until the score of the best/worst selected solution is the same for `stale` number of iterations
 */
function adapt(selection, mutation, pnames, terminateAt, stale, options, population, stats) {
    return selection(population).then(solutions => {
        var best = _.first(solutions);
        var worst = _.last(solutions);
        var strength = stats && stats.high == best.score && stats.low == worst.score ?
            stats.strength + 1 : 0;
        if (stats) logger.log("Optimize", options.label || '\b', options.begin, "G" + stats.generation, "P" + population.length, "M" + stats.strength, best.pindex.map((idx,i) => {
            return options.parameter_values[pnames[i]][idx];
        }).join(','), ':', best.score);
        if (strength >= stale || terminateAt && terminateAt < Date.now()) return solutions;
        var candidates = mutation(solutions, strength);
        return adapt(selection, mutation, pnames, terminateAt, stale, options, candidates, {
            high: best.score,
            low: worst.score,
            strength: strength,
            generation: stats ? stats.generation + 1 : 1,
            mtime: Date.now()
        });
    });
}

/**
 * Creates the fitness function for a set of parameter values
 */
function fitness(collect, options, pnames) {
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var score_column = getScoreColumn(options);
    return function(candidate) {
        var parameters = _.object(pnames, candidate.pindex.map((idx, p) => pvalues[p][idx]));
        var picked = ['portfolio', 'columns', 'variables', 'parameters', 'filter', 'precedence', 'order', 'pad_leading', 'reset_every'];
        var opts = _.defaults({
            tail: 1,
            transient: true, // don't persist parameter values
            portfolio: [_.pick(options, picked)],
            columns: {[score_column]: options.eval_score},
            parameters: parameters
        }, _.omit(options, picked));
        return collect(opts)
          .then(_.last).then(_.property(score_column)).then(score => {
            return _.extend(candidate, {
                score: score
            });
        });
    };
}

/**
 * Determines the score of the population and returns the best size solutions
 */
function selection(fitness, size, population) {
    var candidates = [];
    var elite = [];
    population.forEach(candidate => {
        if (_.has(candidate, 'score')) {
            elite.push(candidate);
        } else {
            candidates.push(candidate);
        }
    });
    return Promise.all(candidates.map(fitness))
      .then(solutions => {
        return _.sortBy(elite.concat(solutions), 'score').slice(-Math.ceil(size)).reverse();
    });
}

/**
 * Takes the solutions and adds mutated candidates using the gaussian distribution of the solution set
 */
function mutation(prng, size, pvalues, space, solutions, strength) {
    var empty = _.isEmpty(solutions);
    var one = solutions.length == 1;
    var mutations = pvalues.map((values,i) => {
        var vals = empty || one ? _.range(values.length) : _.map(solutions, sol => sol.pindex[i]);
        var avg = one ? solutions[0].pindex[i] : vals.reduce((a,b) => a + b) / vals.length;
        var stdev = vals.length>2 && statkit.std(vals) || 0.5;
        var window = Math.min(stdev + strength, Math.ceil(values.length/2));
        return function(value) {
            var val = arguments.length ? value : avg;
            var target = statkit.norminv(prng()) * window + val;
            var abs = Math.abs(target % (values.length * 2));
            return abs >= values.length ?
                Math.ceil(values.length * 2 - abs) - 1 : Math.floor(abs);
        };
    });
    var population = solutions;
    solutions.forEach(solution => {
        var mutated = {pindex: mutations.map((fn, i) => fn(solution.pindex[i]))};
        if (space.add(mutated)) {
            population.push(mutated);
        }
    });
    var target = size + strength;
    for (var i=0; i<target && _.size(population) < target; i++) {
        var candidate = {pindex: mutations.map(fn => fn())};
        if (space.add(candidate)) {
            population.push(candidate);
        }
    }
    return population;
}

/**
 * Splits the date range begin-end up into even count segments along major divisions (year,month,day)
 */
function createDuration(begin, end, count) {
    var duration = moment.duration(Math.round(end.diff(begin, 'seconds')), 'seconds');
    var unit = getDurationUnit(duration, count);
    return moment.duration(duration.as(unit), unit);
}

/**
 * Chooses a major division unit, one of years, months, days, hours, minutes, or seconds
 */
function getDurationUnit(duration, count) {
    return ['years', 'months', 'days', 'hours', 'minutes'].reduce((result, unit) => {
        var number = duration.as(unit);
        if (!result && number > count && Math.abs(number - Math.round(number)) < 0.1)
            return unit;
        else return result;
    }, null) || 'seconds';
}

/**
 * Chooses a score column name that does not conflict with existing columns
 */
function getScoreColumn(options) {
    var score_column = 'score';
    if (options.eval_score) {
        // find a unique column
        for (var i=0; _.has(options.columns, score_column); i++) {
            score_column = 'score' + i;
        }
    } else if (!options.columns[score_column]) {
        throw Error("Must have eval_score options set or a score column");
    }
    return score_column;
}
