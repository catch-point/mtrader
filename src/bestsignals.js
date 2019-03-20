// bestsignals.js
/*
 *  Copyright (c) 2017-2019 James Leigh, Some Rights Reserved
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
    let promiseHelp;
    return Object.assign(async function(options) {
        if (!promiseHelp) promiseHelp = help(optimize);
        if (options.help) return promiseHelp;
        const keys = _.keys(_.first(await promiseHelp).options);
        const opts = _.pick(options, keys);
        return bestsignals(optimize, opts);
    }, {
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
async function help(optimize) {
    const help = _.first(await optimize({help: true}));
    return [{
        name: 'bestsignals',
        usage: 'bestsignals(options)',
        description: "Searches possible signal parameters to find the highest score",
        properties: ['signal_variable', 'variables'].concat(help.properties),
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
}

/**
 * Searches possible signal parameters to determine the best score for a date range
 */
async function bestsignals(optimize, options) {
    const signals = _.flatten(await Promise.all(getSignalSets(options).map(async(options, set) => {
        const signals = _.isString(options.signals) ? options.signals.split(',') :
            _.isEmpty(options.signals) ? ['signal'] :options.signals;
        expect(options).to.have.property('parameter_values');
        expect(options).to.have.property('signals');
        const all_signals = _.flatten(await Promise.all(signals.map(signal => {
            return bestsignal(optimize, signal, options);
        })));
        const count = options.solution_count || 1;
        const rev_signals = _.sortBy(all_signals, 'score').slice(-count).reverse();
        if (!options.signalset) return rev_signals;
        const signalset = _.isArray(options.signalset) ?
            [options.signalset[set]] : options.signalset;
        return rev_signals.map(signal => merge(options, signal, {signalset}));
    })));
    const count = options.solution_count || 1;
    const solutions = _.sortBy(signals, 'score').slice(-count).reverse();
    if (options.solution_count)
        return solutions.map(solution => formatSignal(solution, options));
    else return formatSignal(_.first(solutions), options);
}

/**
 * List of signal sets that each should be search independently
 */
function getSignalSets(options) {
    const signalset = _.isEmpty(options.signalset) ? [options] :
        _.isArray(options.signalset) ? options.signalset :
        _.isObject(options.signalset) ? [options.signalset] : [options];
    const label = options.label && signalset.label ?
        options.label + ' ' + signalset.label : options.label || signalset.label;
    return signalset.map(signalset => _.defaults({
        label: label,
        variables: _.defaults({}, signalset.variables, options.variables),
        parameters: _.defaults({}, signalset.parameters, options.parameters),
        parameter_values: _.defaults({}, signalset.parameter_values, options.parameter_values),
        eval_validity: _.compact(_.flatten([options.eval_validity, signalset.eval_validity]))
    }, signalset, options));
}

/**
 * Optimizes signal parameter values to determine the ones with the best scores
 */
async function bestsignal(optimize, signal, options) {
    const pnames = getParameterNames(signal, options);
    const pvalues = pnames.map(name => options.parameter_values[name]);
    const signal_variable = options.signal_variable || 'signal';
    const signal_vars = signal_variable != signal ? {[signal_variable]: signal} : {};
    const solutions = await optimize(_.defaults({
        label: signal + (options.label ? ' ' + options.label : ''),
        solution_count: options.solution_count || 1,
        variables: _.defaults(signal_vars, options.variables),
        parameter_values: _.object(pnames, pvalues)
    }, options));
    return solutions.map((solution, i) => _.defaults({
        score: solution.score,
        signal_variable: signal_variable,
        variables: _.defaults({[signal_variable]: signal}, options.variables),
        parameters: solution.parameters,
        parameter_values: _.object(pnames, pvalues)
    }, options));
}

/**
 * Determines the parameter names that this signal depends on
 */
function getParameterNames(signal, options) {
    if (!options.variables[signal]) return _.keys(options.parameter_values);
    const varnames = Parser({
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
 * Identifies and returns only relevant signal variables in result
 */
function formatSignal(signalset, options) {
    const signal = signalset.signal_variable;
    const vars = _.extend({}, signalset.variables, signalset.parameters);
    const references = getReferences(vars, options);
    const local = [signal].concat(references[signal]);
    return _.omit({
        score: signalset.score,
        signal_variable: signalset.signal_variable,
        variables: _.pick(signalset.variables, local),
        parameters: _.pick(signalset.parameters, local),
        pad_leading: signalset.pad_leading ? signalset.pad_leading : undefined
    }, value => value == null);
}

/**
 * Hash of variable names to array of variable names it depends on
 */
function getReferences(variables, options) {
    const references = Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            if (_.has(variables, name)) return [name];
            else return [];
        },
        expression(expr, name, args) {
            if (rolling.has(name))
                return _.intersection(rolling.getVariables(expr, options), _.keys(variables));
            else return _.uniq(_.flatten(args, true));
        }
    }).parse(variables);
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
