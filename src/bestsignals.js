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
const logger = require('./logger.js');
const expect = require('chai').expect;

/**
 * Given signals and possible parameter_values, returns the best signals
 * and their parameter values after optimizing each of them
 */
module.exports = function(optimize) {
    var promiseHelp;
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(optimize);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.defaults(_.pick(options, _.keys(_.first(help).options)), {
                tz: moment.tz.guess(),
                now: Date.now()
            });
            return bestsignals(optimize, opts);
        });
    }, {
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function help(optimize) {
    return optimize({help: true}).then(_.first).then(help => {
        return [{
            name: 'bestsignals',
            usage: 'bestsignals(options)',
            description: "Searches possible signal parameters to find the highest score",
            properties: ['signals'].concat(help.properties),
            options: _.extend({}, help.options, {
                signals: {
                    usage: '[<variable name>,..]',
                    description: "Array of variable names that should be tested as signals"
                },
                signal_variable: {
                    usage: '<variable name>',
                    description: "The variable name to use when testing various signals"
                },
                signalset: {
                    usage: '[<signalset>,..]',
                    description: "Array of signal sets that include array of signals (variable names), hash of variables, default parameters, and possible parameter_values"
                }
            })
        }];
    });
}

/**
 * Searches possible signal parameters to determine the best score for a date range
 */
function bestsignals(optimize, options) {
    return Promise.all(getSignalSets(options).map(options => {
        var signals = _.isString(options.signals) ?
            options.signals.split(',') : options.signals;
        expect(options).to.have.property('parameter_values');
        expect(options).to.have.property('signals');
        return Promise.all(signals.map(signal => {
            return bestsignal(optimize, signal, options);
        })).then(_.flatten).then(signals => {
            var count = options.solution_count || 1;
            return _.sortBy(signals, 'score').slice(-count).reverse();
        });
    })).then(_.flatten).then(signals => formatSignals(signals, options));
}

/**
 * List of signal sets that each should be search independently
 */
function getSignalSets(options) {
    var signalset = _.isArray(options.signalset) ? options.signalset :
        _.isObject(options.signalset) ? [options.signalset] : [options];
    return signalset.map(signalset => _.defaults({
        variables: _.defaults({}, signalset.variables, options.variables),
        parameters: _.defaults({}, signalset.parameters, options.parameters),
        parameter_values: _.defaults({}, signalset.parameter_values, options.parameter_values),
    }, signalset, options));
}

/**
 * Optimizes signal parameter values to determine the ones with the best scores
 */
function bestsignal(optimize, signal, options) {
    var pnames = getParameterNames(signal, options);
    var pvalues = pnames.map(name => options.parameter_values[name]);
    var signal_variable = {[options.signal_variable || 'signal']: signal};
    return optimize(_.defaults({
        label: (options.label ? options.label + ' ' : '') + signal,
        solution_count: options.solution_count || 1,
        variables: _.defaults(signal_variable, options.variables),
        parameter_values: _.object(pnames, pvalues)
    }, options))
      .then(solutions => solutions.map((solution, i) => _.defaults({
        score: solution.score,
        signals: [signal],
        variables: options.variables,
        parameters: solution.parameters,
        parameter_values: _.object(pnames, pvalues)
    }, options)));
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
    var extend2 = (a, b) => _.extend(a, b);
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
        return _.object(_.keys(parsed).map(map), _.values(parsed));
    };
}
