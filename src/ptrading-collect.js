#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-collect.js
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

const net = require('net');
const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const commander = require('commander');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const replyTo = require('./promise-reply.js');
const interrupt = require('./interrupt.js');
const workerQueue = require('./worker-queue.js');
const Remote = require('./remote-workers.js');
const Cache = require('./disk-cache.js');
const config = require('./ptrading-config.js');
const Collect = require('./collect.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');
const readCallSave = require('./read-call-save.js');

const WORKER_COUNT = require('os').cpus().length;

function usage(command) {
    return command.version(require('./version.js').version)
        .description("Collects historic portfolio data")
        .usage('<identifier> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-leading <number>', "Number of work days prior to begin to compute initial variables")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<exchange> to search")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--criteria <expression>', "Expression that must evaluate to a non-zero to be retained")
        .option('--filter <expression>', "Expression that must evaluate to non-zero to be included in result")
        .option('--precedence <expression>', "Indicates the order in which securities should be checked fore inclusion in the result")
        .option('--order <expression>', "Comma separated list of expressions to indicate the result order")
        .option('--reset-every <Duration>', "Duration of time to reset rolling variables (ex. P1Y)")
        .option('--head <number>', "Limits the rows in the result to the given first few")
        .option('--tail <number>', "Include the given last few rows in the result")
        .option('-o, --offline', "Disable data updates")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('--append', "Append the new rows to the end of the file")
        .option('--transpose', "Swap the columns and rows");
}

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    if (program.args.length) {
        var fetch = require('./ptrading-fetch.js');
        var quote = require('./ptrading-quote.js');
        var collect = createInstance(program, fetch, quote);
        process.on('SIGHUP', () => collect.reload());
        process.on('SIGINT', () => collect.close());
        process.on('SIGTERM', () => collect.close());
        var name = program.args.join(' ');
        readCallSave(name, collect)
          .then(result => tabular(result, config()))
          .catch(err => logger.error(err, err.stack))
          .then(() => collect.close());
    } else if (process.send) {
        spawn();
    } else {
        program.help();
    }
} else {
    var fetch = require('./ptrading-fetch.js');
    var quote = require('./ptrading-quote.js');
    var prog = usage(new commander.Command());
    module.exports = createInstance(prog, fetch, quote);
    process.on('SIGHUP', () => module.exports.reload());
    process.on('SIGINT', () => module.exports.reset().then(_.noop, err => logger.warn("Collect reset", err)));
    process.on('SIGTERM', () => module.exports.close());
}

function createInstance(program, fetch, quote) {
    var promiseKeys;
    var closed = false;
    var inPast = beforeTimestamp.bind(this, Date.now() - 24 * 60 * 60 * 1000);
    var instance = function(options) {
        if (closed) throw Error("Collect is closed");
        if (!promiseKeys) {
            promiseKeys = direct({help: true})
                .then(_.first).then(info => ['help'].concat(_.keys(info.options)));
        }
        return promiseKeys.then(keys => trimOptions(keys, options))
          .then(options => {
            if (options.help || isSplitting(options)) return direct(options);
            else if (cache && inPast(options)) return cache(options);
            else if (!local.hasWorkers() && !remote.hasWorkers()) return direct(options);
            else if (!remote.hasWorkers()) return local(options);
            else if (options.reset_every || isLeaf(options)) return remote.collect(options);
            else if (!local.hasWorkers()) return remote.collect(options);
            else return local(options);
        });
    };
    instance.close = function() {
        closed = true;
        return remote.close()
          .then(local.close, local.close)
          .then(direct.close)
          .then(quote.close)
          .then(fetch.close)
          .then(() => cache && cache.close());
    };
    instance.shell = shell.bind(this, program.description(), instance);
    instance.reload = _.debounce(() => {
        local.reload();
        inPast = beforeTimestamp.bind(this, Date.now() - 24 * 60 * 60 * 1000);
        try {
            cache && cache.close().catch(err => logger.warn("Could not reset collect cache", err));
        } finally {
            cache = createCache(direct, local, remote);
        }
    }, 100);
    instance.reset = () => {
        try {
            return Promise.all([local.close(), remote.close(), cache && cache.close()])
              .catch(err => logger.warn("Could not reset collect", err));
        } finally {
            local = createQueue(localWorkers);
            remote = Remote();
            cache = createCache(direct, local, remote);
        }
    };
    var direct = Collect(quote, instance);
    var localWorkers = createLocalWorkers.bind(this, program, fetch, quote, instance);
    var local = createQueue(localWorkers);
    var remote = Remote();
    var cache = createCache(direct, local, remote);
    return instance;
}

function trimOptions(keys, options) {
    if (!_.isObject(options)) return options;
    var array = _.isArray(options.portfolio) ? options.portfolio :
        _.isString(options.portfolio) ? options.portfolio.split(',') :
        [options.portfolio];
    return _.extend(_.pick(options, keys), {
        portfolio: array.map(portfolio => trimOptions(keys, portfolio))
    });
}

function createCache(direct, local, remote) {
    var collect_cache_size = config('collect_cache_size');
    if (!_.isFinite(config('collect_cache_size'))) return null;
    var cache_dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    var dir = path.resolve(cache_dir, 'collect');
    return Cache(dir, function(options) {
        if (!local.hasWorkers() && !remote.hasWorkers()) return direct(options);
        else if (options.help || isSplitting(options)) return direct(options);
        else if (!remote.hasWorkers()) return local(options);
        else if (options.reset_every || isLeaf(options)) return remote.collect(options);
        else if (!local.hasWorkers()) return remote.collect(options);
        else return local(options);
    }, collect_cache_size);
}

function beforeTimestamp(past, options) {
    return options.end && moment(options.end).valueOf() < past;
}

function isSplitting(options) {
    if (!options.reset_every) return false;
    var reset_every = moment.duration(options.reset_every);
    var begin = moment(options.begin);
    var end = moment(options.end || options.now);
    return begin.add(Math.abs(reset_every.asMilliseconds())*1.5, 'milliseconds').isBefore(end);
}

function isLeaf(options) {
    if (!options.portfolio) return false;
    var portfolio = _.isArray(options.portfolio) ? options.portfolio : [options.portfolio];
    return portfolio.some(_.isString);
}

function createQueue(createWorkers, onerror) {
    return workerQueue(createWorkers, (worker, options) => {
        return worker.request('collect', options).catch(err => {
            if (!onerror) throw err;
            else return onerror(err, options, worker);
        });
    });
}

function createLocalWorkers(program, fetch, quote, collect) {
    var count = _.isFinite(config('workers')) ? config('workers') : WORKER_COUNT;
    return _.range(count).map(() => {
        return replyTo(config.fork(module.filename, program))
          .handle('fetch', payload => fetch(payload))
          .handle('quote', payload => quote(payload))
          .handle('collect', payload => collect(payload));
    });
}

function spawn() {
    var parent = replyTo(process).handle('collect', payload => {
        return collect()(payload);
    });
    var quote = require('./quote.js')(callFetch.bind(this, parent));
    var quoteFn = createSlaveQuote(quote, parent);
    var collect = _.once(() => Collect(quoteFn, callCollect.bind(this, parent)));
    process.on('disconnect', () => collect().close().then(quote.close));
    process.on('SIGINT', () => collect().close().then(quote.close));
    process.on('SIGTERM', () => collect().close().then(quote.close));
}

function createSlaveQuote(quote, parent) {
    var check = interrupt(true);
    return function(options) {
        if (_.has(options, 'read_only') && !options.read_only)
            return parent.request('quote', options); // write requested
        if (!options.end || moment.tz(options.end, options.tz || moment.tz.guess()).valueOf() >= Date.now())
            return parent.request('quote', options); // latest data requested
        var opts = _.extend({read_only: true}, options);
        return quote(opts).catch(err => {
            if (!err || !err.message) throw err;
            else if (!~err.message.indexOf('read_only')) throw err;
            else if (check()) throw err;
            logger.trace("Quoting", options.label || '\b', "from parent node", parent.process.pid);
            return parent.request('quote', _.extend({read_only: false}, options)); // retry using master
        });
    };
}

function callFetch(parent, options) {
    return parent.request('fetch', options);
}

function callCollect(parent, options) {
    return parent.request('collect', options);
}

function shell(desc, collect, app) {
    app.on('quit', () => collect.close());
    app.on('exit', () => collect.close());
    app.cmd('collect', desc, (cmd, sh, cb) => {
        readCallSave(null, config.options())
          .then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
    app.cmd("collect :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        readCallSave(cmd.params.name, collect)
          .then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
    _.forEach(rolling.functions, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
// help
return collect({help: true}).then(_.first).then(info => {
help(app, 'collect', `
  Usage: collect :name

  ${info.description}

    :name
      Uses the values from the named stored session to override the values of
      the current session.

  Options:
${listOptions(info.options)}
  See also:
    help output  
    help reverse  
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
help(app, 'rolling-functions', `
  Aggregate functions may read points that pass the criteria and the proposed security values.

  The following functions are available:
${listFunctions(rolling.functions)}
`);
help(app, 'DESC', `
  Usage: DESC(expression)  

  Indicates the expression order should be reversed
`);
help(app, 'ASC', `
  Usage: ASC(expression)  

  Indicates the expression order should not be reversed
`);
});
}

function functionHelp(name, fn) {
    var source = fn.toString();
    var m = source.match(/^[^(]*\(([^)]*)\)/);
    var args = _.isString(fn.args) ? fn.args : _.property(1)(m) || '';
    var usage = ['\n', '  Usage: ', name, '(', args, ')', '  \n'].join('');
    var body = source.replace(/[^\{]*\{([\s\S]*)\}[^}]*/,'$1');
    var desc = fn.description ? '\n  ' + wrap(fn.description, '  ', 80) + '\n' : body;
    var seeAlso = fn.seeAlso ? '\n  See also:\n' + fn.seeAlso.map(name => {
        return '    help ' + name + '  ';
    }).join('\n') + '\n' : '';
    return usage + desc + seeAlso;
}

function listFunctions(functions) {
    return listOptions(_.mapObject(functions, (fn, name) => {
        var source = fn.toString();
        var m = source.match(/^[^(]*\(\s*opt\w*\s*,\s*([^)]*)\)/) ||
            source.match(/^[^(]*\(([^)]*)\)/);
        var args = fn.args || _.property(1)(m) || '';
        var desc = fn.description || name + '(' + args + ')';
        return {description:  desc};
    }));
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
