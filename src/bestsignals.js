// bestsignals.js
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
 * Given signals and possible parameter_values, searches for the best signal
 * using an Evolution strategy with collect as the fitnenss test
 */
module.exports = function(collect) {
    var promiseHelp;
    var prng = new Alea();
    var collections = _.object(config.list(), []);
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(collect);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.defaults(_.pick(options, _.keys(_.first(help).options)), {
                tz: moment.tz.guess(),
                now: Date.now()
            });
            return bestsignals(collect, collections, prng, opts);
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
            name: 'bestsignals',
            usage: 'bestsignals(options)',
            description: "Searches possible signal parameters to find the highest score",
            properties: help.properties,
            options: _.extend({}, help.options, {
                signal_count: {
                    usage: '<number of signals>',
                    description: "Number of signals to include in result"
                },
                signals: {
                    usage: '[<variable name>,..]',
                    description: "Array of variable names that should be tested as signals"
                },
                sample_duration: {
                    usage: 'P1Y',
                    description: "Duration of each sample"
                },
                sample_count: {
                    usage: '<number of samples>',
                    description: "Number of samples to search before searching the entire date range (begin-end)"
                },
                signal_variable: {
                    usage: '<variable name>',
                    description: "The variable name to use when testing various signals"
                },
                eval_validity: {
                    usage: '<expression>',
                    description: "Simple expression that invalidates candidates by returning 0 or null"
                },
                eval_score: {
                    usage: '<expression>',
                    description: "Expression that determines the signal score for a sample"
                },
                parameter_values: {
                    usage: '{name: [value,..],..}',
                    description: "Possible parameter values for each each parameter name"
                },
                signalset: {
                    usage: '[<signalset>,..]',
                    description: "Array of signal sets that include array of signals (variable names), hash of variables, default parameters, and possible parameter_values. May either be an object or name of a stored session"
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
 * Searches possible signal parameters to determine the best score for a date range
 */
function bestsignals(collect, collections, prng, options) {
    return Promise.all(getSignalSets(collections, options).map(options => {
        var signals = getSignals(options);
        expect(options).to.have.property('parameter_values');
        return Promise.all(signals.map(signal => {
            return bestsignal(collect, prng, signal, options);
        })).then(_.flatten).then(signals => {
            var count = options.signal_count || 1;
            return _.sortBy(signals, 'score').slice(-count).reverse();
        });
    })).then(_.flatten).then(signals => formatSignals(signals, options));
}

/**
 * List of signal sets that each should be search independently
 */
function getSignalSets(collections, options) {
    var signalset = _.isArray(options.signalset) ? options.signalset :
        _.isObject(options.signalset) ? [options.signalset] : [options];
    return signalset.map(set => {
        if (_.isObject(set)) return set;
        if (!collections[set]) {
            var cfg = config.read(set);
            if (cfg) collections[set] = cfg;
        }
        if (collections[set]) return _.defaults({
            label: set
        }, collections[set]);
        else throw Error("Unknown signalset: " + set);
    }).map(signalset => _.defaults({
        variables: _.defaults({}, signalset.variables, options.variables),
        parameters: _.defaults({}, signalset.parameters, options.parameters),
        parameter_values: _.defaults({}, signalset.parameter_values, options.parameter_values),
    }, signalset, options));
}

function getSignals(options) {
    return _.isArray(options.signals) ? options.signals :
        _.isString(options.signals) ? options.signals.split(',') : [''];
}

/**
 * Searches a particular signal parameter values to determine the best score
 */
function bestsignal(collect, prng, signal, options) {
    var pnames = getParameterNames(signal, options);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    return searchParameters(collect, prng, signal, pnames, options)
      .then(solutions => solutions.map((solution, i) => ({
        score: solution.score,
        signals: signal ? [signal] : [],
        variables: options.variables,
        parameters: _.object(pnames,
            solution.pindex.map((idx, i) => pvalues[i][idx])
        ),
        parameter_values: _.object(pnames, pvalues)
    })));
}

/**
 * Searches the signal parameters returning signal_count results
 */
function searchParameters(collect, prng, signal, pnames, options) {
    var terminateAt = options.termination &&
        moment().add(moment.duration(options.termination)).valueOf()
    var space = createSearchSpace(pnames, options);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var staleAfter = _.max(pvalues.map(_.size));
    var createPopulation = options.sample_duration || options.sample_count ?
        sampleSolutions(collect, prng, signal, pnames, space, options) :
        initialPopulation(prng, pnames, space, options);
    return Promise.resolve(createPopulation).then(population => {
        var fitnessFn = fitness(collect, options, signal, pnames);
        var selectionFn = selection.bind(this, fitnessFn, Math.floor(_.size(population)/2));
        var mutationFn = mutation.bind(this, prng, _.size(population), pvalues, space);
        return optimize(selectionFn, mutationFn, signal, pnames, terminateAt, staleAfter, options, population);
    }).then(solutions => {
        var count = options.signal_count || 1;
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
 * Determines the parameter names that this signal depends on
 */
function getParameterNames(signal, options) {
    if (!options.variables[signal]) return _.keys(options.parameter_values);
    var varnames = Parser({
        substitutions: options.variables,
        constant(value) {
            return [];
        },
        variable(name) {
            return [name];
        },
        expression(expr, name, args) {
            return _.uniq(_.flatten(args, true));
        }
    }).parse(options.variables[signal]);
    return _.intersection(_.keys(options.parameter_values), varnames);
}

/**
 * Creates an initial population from the best signals of a set of sample periods
 */
function sampleSolutions(collect, prng, signal, pnames, space, options) {
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
            signal_count: Math.ceil(size/2),
            begin: periodBegin.format(), end: periodEnd.format()
        }, _.omit(options, ['sample_duration', 'sample_count']));
    });
    return Promise.all(optionset.map(opts => {
        return searchParameters(collect, prng, signal, pnames, opts);
    })).then(results => {
        var parameters = _.pick(options.parameters, pnames);
        var count = options.signal_count || 1;
        var seed = {pindex: pvalues.map((values, p) => values.indexOf(parameters[pnames[p]]))};
        var population = results.reduce((population, sols) => sols.reduce((population, solution) => {
            var candidate = {pindex: solution.pindex};
            if (space.add(candidate)) {
                population.push(candidate);
            }
            return population;
        }, population), []);
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
function initialPopulation(prng, pnames, space, options) {
    var parameters = _.pick(options.parameters, pnames);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var count = options.signal_count || 1;
    var size = options.population_size ||
        Math.max(_.max(_.map(pvalues, _.size)), count * 2, MIN_POPULATION);
    var seed = {pindex: pvalues.map((values, p) => values.indexOf(parameters[pnames[p]]))};
    var population = [];
    if (!_.isEmpty(parameters)) {
        population.push(seed);
        space.add(seed);
    }
    for (var i=0; i<size*2 && _.size(population) < size; i++) {
        var candidate = {
            pindex: pvalues.map(values => {
                return Math.floor(prng() * values.length);
            })
        };
        if (space.add(candidate)) {
            population.push(candidate);
        }
    }
    return population;
}

/**
 * Cycles between candidate selection and mutation until the score of the best/worst selected solution is the same for `stale` number of iterations
 */
function optimize(selection, mutation, signal, pnames, terminateAt, stale, options, population, stats) {
    return selection(population).then(solutions => {
        var best = _.first(solutions);
        var worst = _.last(solutions);
        var strength = stats && stats.high == best.score && stats.low == worst.score ?
            stats.strength + 1 : 0;
        if (stats) logger.log("Signal", signal, options.begin, "G" + stats.generation, "P" + population.length, "M" + stats.strength, best.pindex.map((idx,i) => {
            return options.parameter_values[pnames[i]][idx];
        }).join(','), ':', best.score);
        if (strength >= stale || terminateAt && terminateAt < Date.now()) return solutions;
        var candidates = mutation(solutions, strength);
        return optimize(selection, mutation, signal, pnames, terminateAt, stale, options, candidates, {
            high: best.score,
            low: worst.score,
            strength: strength,
            generation: stats ? stats.generation + 1 : 1,
            mtime: Date.now()
        });
    });
}

/**
 * Creates the fitness function for a signal
 */
function fitness(collect, options, signal, pnames) {
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var score_column = getScoreColumn(options);
    var signal_variable = signal ? {[options.signal_variable || 'signal']: signal} : {};
    return function(candidate) {
        var parameters = _.object(pnames, candidate.pindex.map((idx, p) => pvalues[p][idx]));
        var opts = _.defaults({
            tail: 1,
            transient: true, // don't persist signal values
            columns: _.defaults({[score_column]: options.eval_score}, options.columns),
            variables: _.defaults(signal_variable, options.variables),
            parameters: _.defaults(parameters, options.parameters)
        }, options);
        return collect(opts)
          .then(results => {
            return results;
          })
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
    var mutations = pvalues.map((values,i) => {
        var vals = _.map(solutions, sol => sol.pindex[i]);
        var avg = vals.reduce((a,b) => a + b) / vals.length;
        var stdev = Math.min((vals.length>2 && statkit.std(vals) || 0.5) + strength, Math.ceil(values.length/2));
        return function(value) {
            var val = arguments.length ? value : avg;
            var target = statkit.norminv(prng()) * stdev + val;
            if (target > values.length) target = values.length*2 - target%(values.length*2);
            if (target < 0) target = -target;
            var idx = Math.round(target);
            if (idx >= values.length) idx = values.length -1;
            return idx;
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
 * Merges signal results with options
 */
function formatSignals(signalsets, options) {
    var conflicts = [], shared = [];
    signalsets.reduce((values, signalset) => _.reduce(_.extend({}, signalset.variables, signalset.parameters), (values, value, name) => {
        if (_.has(values, name) && !~shared.indexOf(name))
            shared.push(name);
        if (values[name] != value && _.has(values, name) && !~conflicts.indexOf(name))
            conflicts.push(name);
        values[name] = value;
        return values;
    }, values), {});
    var signals = signalsets.map((signalset, i) => {
        var signal = _.first(signalset.signals);
        var vars = _.extend({}, signalset.variables, signalset.parameters);
        var cnames = _.intersection(_.keys(vars), conflicts);
        var references = getReferences(vars);
        var local = _.isEmpty(signalset.signals) ? _.keys(references) : [signal].concat(references[signal]);
        var overlap = local.filter(name => ~cnames.indexOf(name) ||
            ~shared.indexOf(name) && _.intersection(cnames, references[name]).length);
        var id = _.isEmpty(overlap) ? '' : (i + 10).toString(16).toUpperCase();
        var replacement = _.object(overlap, overlap.map(name => name + id));
        var replacer = createReplacer(replacement);
        var rename = (object, value, name) => _.extend(object, {[replacement[name] || name]: value});
        return {
            score: signalset.score,
            signals: signalset.signals.map(signal => replacement[signal] || signal),
            variables: replacer(_.pick(signalset.variables, local)),
            parameters: _.reduce(_.pick(signalset.parameters, local), rename, {}),
            parameter_values: _.reduce(_.pick(signalset.parameter_values, local), rename, {})
        };
    });
    return _.extend(_.clone(options), {
        score: _.max(_.pluck(signals, 'score')),
        signals: _.flatten(_.pluck(signals, 'signals'), true),
        variables: _.defaults(_.pluck(signals, 'variables').reduce(extend2, {}), options.variables),
        parameters: _.defaults(_.pluck(signals, 'parameters').reduce(extend2, {}), options.parameters),
        parameter_values: _.defaults(_.pluck(signals, 'parameter_values').reduce(extend2, {}), options.parameter_values),
    });
}

/**
 * Hash of variable names to array of variable names it depends on
 */
function getReferences(variables) {
    var references = Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            if (_.has(variables, name)) return [name];
            else return [];
        },
        expression(expr, name, args) {
            if (rolling.has(name))
                return _.intersection(rolling.getVariables(expr), _.keys(variables));
            else return _.uniq(_.flatten(args, true));
        }
    }).parse(variables);
    var follow = _.clone(references);
    while (_.reduce(follow, (more, reference, name) => {
        if (!reference.length) return more;
        follow[name] = _.uniq(_.flatten(reference.map(ref => ref == name ? [] : follow[ref]), true));
        references[name] = reference.reduce((union, ref) => {
            return _.union(union, references[ref]);
        }, references[name]);
        return more || follow[name].length;
    }, false));
    return references;
}

/**
 * Returns a function that takes an expression and rewrites replacing variables in in local with replacement
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
        return _.object(_.keys(parsed).map(map), _.values(parsed));
    };
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

/**
 * Like _.exend, but only looks at the first two parameters
 */
function extend2(a, b) {
    return _.extend(a, b);
}
