#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-strategize.js
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
const Writable = require('stream').Writable;
const _ = require('underscore');
const moment = require('moment-timezone');
const commander = require('commander');
const merge = require('./merge.js');
const logger = require('./logger.js');
const replyTo = require('./promise-reply.js');
const config = require('./ptrading-config.js');
const Strategize = require('./strategize.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Modifies a strategy looking for improvements")
        .usage('<identifier> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <identifier>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-begin <number>', "Number of bars before begin dateTime")
        .option('--pad-end <number>', "Number of bars after end dateTime")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<exchange> to search")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--criteria <expression>', "Conditional expression that must evaluate to a non-zero to be retained in the result")
        .option('--precedence <expression>', "Indicates the order in which securities should be checked fore inclusion in the result")
        .option('--reset-every <Duration>', "Duration of time to reset rolling variables (ex. P1Y)")
        .option('--head <number>', "Limits the rows in the result to the given first few")
        .option('--tail <number>', "Include the given last few rows in the result")
        .option('--eval-score <expression>', "Expression that determines the score for a sample")
        .option('--solution-count <number>', "Number of solutions to include in result")
        .option('-o, --offline', "Disable data updates")
        .option('--workers <numOfWorkers>', 'Number of workers to spawn')
        .option('--remote-workers <host:port,..>', "List of host:port addresses to connect to")
        .option('--solution-count <number>', "Number of solutions to include in result")
        .option('--termination <Duration>', "Amount of time spent searching for a solution before the best yet is used")
        .option('--signalset <identifier,..>', "Comma separated signal set names")
        .option('--max-changes <number>', "The maximum number of changes allowed to strategy expressions")
        .option('--concurrent-strategies <number>', "Number of strategies to search for and evaluate at once")
        .option('--amend', "If the result should include option properties from the input")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--save <file>', "JSON file to write the result into");
}

var collections = {};
process.on('SIGHUP', () => _.keys(collections).forEach(key=>delete collections[key]));

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    if (program.args.length) {
        var strategize = createInstance(program, collections);
        process.on('SIGINT', () => strategize.close());
        process.on('SIGTERM', () => strategize.close());
        var name = program.args.join(' ');
        var options = readSignals(name);
        strategize(options)
          .then(result => config('amend') ? mergeSignalSets(read, result) : result)
          .then(result => output(result))
          .catch(err => logger.error(err, err.stack))
          .then(() => strategize.close());
    } else if (process.send) {
        spawn();
    } else {
        program.help();
    }
} else {
    module.exports = createInstance(usage(new commander.Command()), collections);
}

function createInstance(program, collections) {
    var bestsignals = require('./ptrading-bestsignals.js');
    var strategize = Strategize(bestsignals);
    var promiseKeys;
    var promiseDef;
    var instance = function(options) {
        if (!promiseKeys) {
            promiseKeys = strategize({help: true})
                .then(_.first).then(info => ['help'].concat(_.keys(info.options)));
            promiseDef = promiseKeys.then(k => _.pick(_.defaults({}, config.opts(), config.options()), k));
        }
        return promiseKeys.then(keys => promiseDef.then(defaults => {
            return _.extend({}, defaults, _.pick(options, keys));
        })).then(options => {
            if (options.signalset || options.protfolio)
                return strategize(inlineCollections(collections, options));
            else return strategize(options);
        });
    };
    instance.seed = strategize.seed;
    instance.close = function() {
        return bestsignals.close().then(strategize.close);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    return instance;
}

function inlineCollections(collections, options, avoid) {
    if (!options)
        return options;
    else if (_.isArray(options))
        return options.map(item => inlineCollections(collections, item, avoid));
    else if (_.isObject(options) && (options.portfolio || options.signalset))
        return _.defaults({
            portfolio: inlineCollections(collections, options.portfolio, avoid),
            signalset: inlineCollections(collections, options.signalset, avoid)
        }, options);
    else if (_.isObject(options))
        return options;
    else if (_.contains(avoid, options))
        throw Error("Cycle profile detected: " + avoid + " -> " + options);
    if (_.isEmpty(collections)) {
        _.extend(collections, _.object(config.list(), []));
    }
    if (!collections[options] && _.has(collections, options)) {
        var cfg = config.read(options);
        if (cfg) collections[options] = inlineCollections(collections, _.extend({
            label: options,
        }, cfg), _.flatten(_.compact([avoid, options]), true));
    }
    if (collections[options]) return collections[options];
    else return options;
}

function readSignals(name) {
    if (!name) return {};
    var read = config.read(name);
    if (!read) throw Error("Could not read " + name + " settings");
    return read;
}

function mergeSignals(read) {
    return _.defaults({
        label: name,
        parameters: _.defaults({}, config('parameters'), read.parameters),
        columns: _.extend({}, read.columns, config('columns')),
        variables: _.defaults({}, config('variables'), read.variables),
        criteria: _.compact(_.flatten([config('criteria'), read.criteria], true)),
        filter: _.compact(_.flatten([config('filter'), read.filter], true)),
        precedence: _.compact(_.flatten([config('precedence'), read.precedence], true)),
        order: _.compact(_.flatten([config('order'), read.order], true))
    }, config.opts(), config.options(), read);
}

function mergeSignalSets(read, result) {
    var merged = merge({}, read, result);
    if (_.isArray(merged.signalset))
        merged.signalset = merged.signalset.map(signalset => signalset.name || signalset);
    if (read.eval_validity && result.eval_validity)
        merged.eval_validity = _.flatten([read.eval_validity, result.eval_validity])
    return merged;
}

function output(result) {
    return new Promise(done => {
        var output = JSON.stringify(result, null, ' ');
        var writer = createWriteStream(config('save'));
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

function shell(desc, strategize, app) {
    app.on('quit', () => strategize.close());
    app.on('exit', () => strategize.close());
    app.cmd('strategize', desc, (cmd, sh, cb) => {
        strategize(config.options()).then(result => output(result)).then(() => sh.prompt(), cb);
    });
    app.cmd("strategize :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        var options = readSignals(cmd.params.name);
        strategize(options).then(result => output(result)).then(() => sh.prompt(), cb);
    });
// help
return strategize({help: true}).then(_.first).then(info => {
help(app, 'strategize', `
  Usage: strategize :name

  ${desc}

    :name
      Uses the values from the named stored session to override the values of
      the current session.

  Options:
${listOptions(info.options)}
`);
_.each(info.options, (option, name) => {
help(app, name, `
  Usage: set ${name} ${option.usage || 'value'}  

  ${option.description}
` + (option.seeAlso ? `
  See also:` +
option.seeAlso.reduce((buf, also) => buf + `
    help ${also}  `, '') + `  
` : ''));
});
});
}

function listOptions(options) {
    var buf = [];
    var left = Math.max(_.max(_.keys(options).map(name => name.length)), 5) + 8;
    var indent = new Array(left+1).join(' ');
    var width = 80 - indent.length;
    _.each(options, (option, name) => {
        buf.push(indent.substring(0,6));
        buf.push(name);
        buf.push(indent.substring(6 + name.length));
        buf.push(wrap(option.description, indent, 80));
        buf.push('\n');
    });
    return buf.join('');
}

function wrap(desc, indent, len) {
    var buf = [];
    if (desc && desc.length < len - indent.length) {
        buf.push(desc);
    } else if (desc) {
        var width = len - indent.length;
        var remain = desc.trim();
        while (remain) {
            var idx = remain.lastIndexOf(' ', width);
            if (idx <= 0) idx = remain.indexOf(' ', width);
            if (idx <= 0 || remain.length < width) idx = remain.length;
            buf.push(remain.substring(0, idx));
            remain = remain.substring(idx +1);
            if (remain) buf.push('\n' + indent);
        }
    }
    return buf.join('');
}

function help(app, cmd, usage) {
    app.cmd('help ' + cmd, (cmd, sh, cb) => {
        usage.split('\n').forEach(line => {
            if (~line.indexOf(' :')) {
                sh.cyan(line).ln();
            } else if (~line.indexOf(' ')) {
                sh.cyan(line.substring(0, line.lastIndexOf('  '))).white(line.substring(line.lastIndexOf('  '))).ln();
            } else {
                sh.white(line).ln();
            }
        });
        sh.prompt();
    });
}
