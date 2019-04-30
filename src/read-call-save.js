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
'use strict';

const fs = require('graceful-fs');
const path = require('path');
const Writable = require('stream').Writable;
const _ = require('underscore');
const merge = require('./merge.js');
const awriter = require('./atomic-write.js');
const logger = require('./logger.js');
const config = require('./config.js');

const collections = {};
process.on('SIGHUP', () => _.keys(collections).forEach(key=>delete collections[key]));

module.exports = function(read, call, save) {
    const file = read && _.isString(read) && config.resolve(read);
    const original = file ? config.read(file) : read ? read : {};
    if (!original) throw Error("Could not read " + read + " settings");
    const amend = arguments.length>2 && config('amend');
    const target = save && amend ? config.read(save) : original;
    const dir = file ? path.dirname(file) : '.';
    const inlineOriginal = inlineCollections(collections, dir, original, [read]);
    const options = mergeSignals(inlineOriginal, _.isString(read) ? read : '');
    const inlineOptions = inlineCollections(collections, '.', options, [read]);
    return Promise.resolve(!call ? inlineOptions : call(inlineOptions))
      .then(result => amend ? mergeSignalSets(target, result) : result)
      .then(result => arguments.length>2 ? outputFile(result, save || amend && file) : result);
};

function inlineCollections(collections, base, options, avoid) {
    if (!options)
        return options;
    else if (_.isArray(options))
        return options.map(item => inlineCollections(collections, base, item, avoid));
    else if (_.isString(options))
        return readCollection(collections, base, options, avoid);
    else
        return _.omit(
            inlineSignalset(collections, base, options, avoid),
            val => val == null || _.isObject(val) && _.isEmpty(val)
        );
}

function inlineSignalset(collections, base, options, avoid) {
    const opts = options.signalset ? _.defaults({
            signalset: inlineCollections(collections, base, options.signalset, avoid)
        }, options) : options;
    return inlinePortfolio(collections, base, opts, avoid);
}

function inlinePortfolio(collections, base, options, avoid) {
    const opts = options.portfolio ? _.defaults({
            portfolio: inlineCollections(collections, base, options.portfolio, avoid)
        }, options) : options;
    return loadCollection(collections, base, opts, avoid);
}

function loadCollection(collections, base, options, avoid) {
    return options.load ? _.compact(_.flatten([options.load])).reduce((options, load) => {
        const loaded = inlineCollections(collections, base, load, avoid);
        return merge(options, loaded, options, options.portfolio && loaded.portfolio ? {
            portfolio: [].concat(options.portfolio, loaded.portfolio)
        } : {});
    }, _.omit(options, 'load')) : options;
}

function readCollection(collections, base, filename, avoid) {
    if (_.contains(avoid, filename))
        throw Error("Cycle profile detected: " + avoid + " -> " + filename);
    if (_.isEmpty(collections)) {
        _.extend(collections, _.object(config.list(), []));
    }
    if (collections[filename]) return collections[filename];
    else if (_.has(collections, filename) || ~filename.indexOf('.json') || ~filename.indexOf('/')) {
        const file = config.resolve(base, filename);
        const dir = path.dirname(file);
        try {
            const cfg = config.read(file);
            if (cfg) collections[filename] = inlineCollections(collections, dir, _.extend({
                label: filename,
            }, cfg), _.flatten(_.compact([avoid, filename]), true));
        } catch (e) {
            logger.warn("Failed to include", filename, e.message || e);
        }
    }
    if (collections[filename]) return collections[filename];
    else return filename;
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
    const merged = merge(original, result);
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
        const output = JSON.stringify(result, null, ' ') + '\n';
        const writer = createWriteStream(file);
        writer.on('finish', done);
        if (output) writer.write(output, 'utf-8');
        writer.end();
    });
}

function createWriteStream(outputFile) {
    if (outputFile) return fs.createWriteStream(outputFile);
    const delegate = process.stdout;
    const output = Object.create(Writable.prototype);
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
