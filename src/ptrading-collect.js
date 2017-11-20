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
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const config = require('./ptrading-config.js');
const Collect = require('./collect.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');

const WORKER_COUNT = require('os').cpus().length;

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Collects historic portfolio data")
        .usage('<identifier> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
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
        .option('-o, --offline', "Disable data updates")
        .option('--workers <numOfWorkers>', "Number of workers to spawn")
        .option('--remote-workers <host:port,..>', "List of host:port addresses to connect to")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('--transpose', "Swap the columns and rows");
}

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    if (program.args.length) {
        var collect = createInstance(program);
        process.on('SIGINT', () => collect.close());
        process.on('SIGTERM', () => collect.close());
        var name = program.args.join(' ');
        var options = readCollect(name);
        collect(options).then(result => tabular(result))
          .catch(err => logger.error(err, err.stack))
          .then(() => collect.close());
    } else if (process.send) {
        spawn();
    } else {
        program.help();
    }
} else {
    module.exports = createInstance(usage(new commander.Command()));
}

function createInstance(program) {
    var quote = require('./ptrading-quote.js');
    var workers = [];
    var stoppedWorkers = [];
    var queue = [];
    var collect = function(options) {
        var loads = workers.map(w => {
            return (w.stats.requests_sent - w.stats.replies_rec)/(w.count || 1) || 0;
        });
        var worker = workers[loads.indexOf(_.min(loads))];
        return worker.request('collect', options).catch(err => {
            if (!worker.process.remote) throw err;
            var loads = workers.map(w => {
                if (w.process.remote) return Infinity;
                return (w.stats.requests_sent - w.stats.replies_rec)/(w.count || 1) || 0;
            });
            var local = workers[loads.indexOf(_.min(loads))];
            if (!local) throw err;
            logger.debug("Collect", worker.process.pid, err, err.stack);
            logger.debug("Retrying", options.label || '\b', "using local node", local.process.pid);
            return local.request('collect', options);
        });
    };
    var check_queue = function() {
        stoppedWorkers.forEach(worker => {
            if (worker.stats.requests_sent == worker.stats.replies_rec) {
                worker.disconnect();
            }
        });
        var spare = workers.reduce((capacity, worker) => {
            return capacity + (worker.count || 1) - worker.stats.requests_sent + worker.stats.replies_rec;
        }, 0);
        queue.splice(0, spare).forEach(item => {
            collect(item.options).then(item.resolve, item.reject);
        });
    };
    workers.push.apply(workers, createWorkers(quote, collect, program));
    workers.forEach(worker => worker.on('message', check_queue).handle('stop', function() {
        var idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        stoppedWorkers.push(this);
        check_queue();
    }).once('disconnect', function() {
        var idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        var sidx = stoppedWorkers.indexOf(this);
        if (sidx >= 0) stoppedWorkers.splice(sidx, 1);
        logger.log("Worker", this.process.pid, "has disconnected");
    }));
    var collections = {};
    config.addListener(name => name=='prefix' && _.keys(collections).forEach(key=>delete collections[key]));
    var promiseKeys = _.first(workers).request('collect', {help: true})
        .then(_.first).then(info => ['help'].concat(_.keys(info.options)));
    var promiseDefaults = promiseKeys.then(k => _.pick(_.defaults({}, config.opts(), config.options()), k));
    var instance = function(options) {
        return promiseKeys.then(keys => promiseDefaults.then(defaults => {
            return _.extend({}, defaults, _.pick(options, keys));
        })).then(options => inlineCollections(collections, options))
          .then(options => new Promise((resolve, reject) => {
            queue.push({options, resolve, reject});
            check_queue();
        }));
    };
    instance.close = function() {
        queue.splice(0).forEach(item => {
            item.reject(Error("Collect is closing"));
        });
        return Promise.all(_.flatten([
            workers.map(child => child.disconnect()),
            stoppedWorkers.map(child => child.disconnect())
        ])).then(quote.close).then(collect.close);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    return instance;
}

function createWorkers(quote, collect, program) {
    var single = config('workers') == 0 && !config('remote_workers');
    if (single) return [{
        request: _.partial(function(collect, cmd, payload) {
            return (cmd == 'quote' ? quote(payload) :
                cmd == 'collect' ? collect(payload) :
                cmd == 'disconnect' ? quote.close() :
                Promise.reject(Error("Unknown cmd " + cmd))
            ).then(result => {
                this.listener();
                return result;
            }, err => {
                this.listener();
                throw err;
            });
        }, Collect(quote)),
        disconnect() {
            return this.request('disconnect');
        },
        on: function(message, listener) {
            this.listener = listener;
            return this;
        },
        once: function() {
            return this;
        },
        stats: {
            requests_sent: 0,
            replies_rec: 0
        },
        process: process
    }];
    var local = _.range(config('workers') || WORKER_COUNT).map(() => {
        return replyTo(config.fork(module.filename, program))
          .handle('quote', payload => quote(payload))
          .handle('collect', payload => collect(payload));
    });
    var remote_workers = _.flatten(_.compact(_.flatten([config('remote_workers')]))
        .map(addr => addr.split(',')));
    if (_.isEmpty(remote_workers)) return local;
    var remoteWorkers = remote_workers.map(address => {
        return replyTo(remote(address))
            .on('error', err => logger.warn(err.message || err));
    });
    remoteWorkers.forEach(worker => {
        worker.request('worker_count')
            .then(count => worker.count = count)
            .catch(err => logger.debug(err, err.stack));
    });
    return local.concat(remoteWorkers);
}

function spawn() {
    var parent = replyTo(process).handle('collect', payload => {
        return collect()(payload);
    });
    var collect = _.once(() => Collect(function(options) {
        return parent.request('quote', options);
    }, function(options) {
        return parent.request('collect', options);
    }));
    process.on('disconnect', () => collect().close());
    process.on('SIGINT', () => collect().close());
    process.on('SIGTERM', () => collect().close());
}

function inlineCollections(collections, options, avoid) {
    if (!options)
        return options;
    else if (_.isArray(options))
        return options.map(item => inlineCollections(collections, item, avoid));
    else if (_.isObject(options) && options.portfolio)
        return _.defaults({
            portfolio: inlineCollections(collections, options.portfolio, avoid)
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

function readCollect(name) {
    var read = name ? config.read(name) : {};
    if (!read) throw Error("Could not read " + name + " settings");
    return _.defaults({
        label: name,
        parameters: _.defaults({}, config('parameters'), read.parameters),
        columns: _.extend({}, read.columns, config('columns')),
        variables: _.defaults({}, config('variables'), read.variables),
        criteria: _.compact(_.flatten([config('criteria'), read.criteria], true)),
        filter: _.compact(_.flatten([config('filter'), read.filter], true)),
        precedence: _.compact(_.flatten([config('precedence'), read.precedence], true)),
        order: _.compact(_.flatten([config('order'), read.order], true))
    }, read, config.opts(), config.options());
}

function shell(desc, collect, app) {
    app.on('quit', () => collect.close());
    app.on('exit', () => collect.close());
    app.cmd('collect', desc, (cmd, sh, cb) => {
        collect(config.options()).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    app.cmd("collect :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        var options = readCollect(cmd.params.name);
        collect(options).then(result => tabular(result)).then(() => sh.prompt(), cb);
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
