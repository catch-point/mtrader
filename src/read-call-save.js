// read-call-save.js
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

const fs = require('fs');
const path = require('path');
const Writable = require('stream').Writable;
const _ = require('underscore');
const merge = require('./merge.js');
const awriter = require('./atomic-write.js');
const logger = require('./logger.js');
const config = require('./config.js');

var collections = {};
process.on('SIGHUP', () => _.keys(collections).forEach(key=>delete collections[key]));

module.exports = function(read, call, save) {
    var file = read && _.isString(read) && config.resolve(read);
    var original = file ? config.read(file) : read ? read : {};
    if (!original) throw Error("Could not read " + read + " settings");
    var amend = arguments.length>2 && config('amend');
    var target = save && amend ? config.read(save) : original;
    var dir = file ? path.dirname(file) : '.';
    var inlineOriginal = inlineCollections(collections, dir, original, [read]);
    var options = mergeSignals(inlineOriginal, _.isString(read) ? read : '');
    var inlineOptions = inlineCollections(collections, '.', options, [read]);
    return Promise.resolve(!call ? inlineOptions : call(inlineOptions))
      .then(result => amend ? mergeSignalSets(target, result) : result)
      .then(result => arguments.length>2 ? outputFile(result, save || amend && file) : result);
};

function inlineCollections(collections, base, options, avoid) {
    if (!options)
        return options;
    else if (_.isArray(options))
        return options.map(item => inlineCollections(collections, base, item, avoid));
    else if (_.isObject(options) && (options.portfolio || options.signalset))
        return _.omit(_.defaults({
            portfolio: inlineCollections(collections, base, options.portfolio, avoid),
            signalset: inlineCollections(collections, base, options.signalset, avoid)
        }, options), val => val == null || _.isObject(val) && _.isEmpty(val));
    else if (_.isObject(options))
        return options;
    else if (_.contains(avoid, options))
        throw Error("Cycle profile detected: " + avoid + " -> " + options);
    if (_.isEmpty(collections)) {
        _.extend(collections, _.object(config.list(), []));
    }
    if (collections[options]) return collections[options];
    else if (_.has(collections, options) || ~options.indexOf('.json') || ~options.indexOf('/')) {
        var file = config.resolve(base, options);
        var dir = path.dirname(file);
        try {
            var cfg = config.read(file);
            if (cfg) collections[options] = inlineCollections(collections, dir, _.extend({
                label: options,
            }, cfg), _.flatten(_.compact([avoid, options]), true));
        } catch (e) {
            logger.warn("Failed to include", options, e.message || e);
        }
    }
    if (collections[options]) return collections[options];
    else return options;
}

function mergeSignals(original, label) {
    return _.defaults({
        label: label,
        parameters: _.defaults({}, config('parameters'), original.parameters),
        columns: _.extend({}, original.columns, config('columns')),
        variables: _.defaults({}, config('variables'), original.variables),
        criteria: _.compact(_.flatten([config('criteria'), original.criteria], true)),
        filter: _.compact(_.flatten([config('filter'), original.filter], true)),
        precedence: _.compact(_.flatten([config('precedence'), original.precedence], true)),
        order: _.compact(_.flatten([config('order'), original.order], true))
    }, config.options(), original);
}

function mergeSignalSets(original, result) {
    var merged = merge(original, result);
    if (_.isArray(merged.signalset))
        merged.signalset = merged.signalset.map(signalset => signalset.name || signalset);
    if (original.eval_validity && result.eval_validity)
        merged.eval_validity = _.flatten([original.eval_validity, result.eval_validity]);
    if (_.isFinite(original.pad_leading) && _.isFinite(result.pad_leading))
        merged.pad_leading = Math.max(original.pad_leading, result.pad_leading);
    return merged;
}

function outputFile(result, file) {
    if (file) return awriter(file => output(result, file), file);
    else return output(result);
}

function output(result, file) {
    return new Promise(done => {
        var output = JSON.stringify(result, null, ' ') + '\n';
        var writer = createWriteStream(file);
        writer.on('finish', done);
        if (output) writer.write(output, 'utf-8');
        writer.end();
    });
}

function createWriteStream(outputFile) {
    if (outputFile) return fs.createWriteStream(outputFile);
    var delegate = process.stdout;
    var output = Object.create(Writable.prototype);
    output.cork = delegate.cork.bind(delegate);
    output.end = function(chunk) {
        if (chunk) delegate.write.apply(delegate, arguments);
        delegate.uncork();
        output.emit('finish');
    };
    output.setDefaultEncoding = encoding => delegate.setDefaultEncoding(encoding);
    output.uncork = delegate.uncork.bind(delegate);
    output.write = delegate.write.bind(delegate);
    return output;
}
