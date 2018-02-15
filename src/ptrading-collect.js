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
const interrupt = require('./interrupt.js');
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
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
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
        var quote = require('./ptrading-quote.js');
        var collect = createInstance(program, quote);
        process.on('SIGHUP', () => collect.reload());
        process.on('SIGINT', () => collect.close());
        process.on('SIGTERM', () => collect.close());
        var name = program.args.join(' ');
        var options = readCollect(name);
        collect(options).then(result => tabular(result, config()))
          .catch(err => logger.error(err, err.stack))
          .then(() => collect.close());
    } else if (process.send) {
        spawn();
    } else {
        program.help();
    }
} else {
    var quote = require('./ptrading-quote.js');
    var prog = usage(new commander.Command());
    module.exports = createInstance(prog, quote);
    process.on('SIGHUP', () => module.exports.reload());
    process.on('SIGINT', () => module.exports.reset().then(_.noop, err => logger.warn("Collect reset", err)));
    process.on('SIGTERM', () => module.exports.close());
}

function createInstance(program, quote) {
    var promiseKeys;
    var check = interrupt(true);
    var instance = function(options) {
        if (!promiseKeys) {
            promiseKeys = direct({help: true})
                .then(_.first).then(info => ['help'].concat(_.keys(info.options)));
        }
        return promiseKeys.then(keys => _.pick(options, keys))
          .then(options => inlineCollections(collections, options))
          .then(options => {
            if (_.isEmpty(local.getWorkers()) && _.isEmpty(remote.getWorkers())) return direct(options);
            else if (options.help || isSplitting(options)) return direct(options);
            else if (_.isEmpty(remote.getWorkers())) return local(options);
            else if (!options.reset_every || isLeaf(options)) return remote(options);
            else if (_.isEmpty(local.getWorkers())) return remote(options);
            else return local(options);
        });
    };
    instance.close = function() {
        return remote.close().then(local.close, local.close).then(direct.close).then(quote.close);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    instance.reload = () => {
        _.keys(collections).forEach(key=>delete collections[key]);
        local.reload();
        remote.reload();
    };
    instance.reset = () => {
        _.keys(collections).forEach(key=>delete collections[key]);
        try {
            return Promise.all([local.close(), remote.close()]);
        } finally {
            local = createQueue(localWorkers);
            remote = createQueue(createRemoteWorkers, onerror);
        }
    };
    var collections = {};
    var direct = Collect(quote, instance);
    var localWorkers = createLocalWorkers.bind(this, program, quote, instance);
    var onerror = (err, options, worker) => {
        if (!worker.process.remote || check()) throw err;
        logger.trace("Collect", options.label || '\b', worker.process.pid, err, err.stack);
        return local(options).catch(e => {
            throw err;
        });
    };
    var local = createQueue(localWorkers);
    var remote = createQueue(createRemoteWorkers, onerror);
    return instance;
}

function isSplitting(options) {
    if (!options.reset_every) return false;
    var reset_every = moment.duration(options.reset_every);
    var begin = moment(options.begin);
    var end = moment(options.end || options.now);
    return begin.add(reset_every).isBefore(end);
}

function isLeaf(options) {
    if (!options.portfolio) return false;
    var portfolio = _.isArray(options.portfolio) ? options.portfolio : [options.portfolio];
    return portfolio.every(_.isString);
}

function createQueue(createWorkers, onerror) {
    var queue = [];
    var workers = [];
    var stoppedWorkers = [];
    var run = function(options) {
        var loads = workers.map(load);
        var min = _.min(loads);
        var avail = _.reject(loads.map((load, idx) => load == min ? idx : null), _.isNull);
        var idx = avail.length == 1 ? 0 : Math.floor(Math.random() * avail.length);
        var worker = workers[avail[idx]];
        return worker.request('collect', options).catch(err => {
            if (!onerror) throw err;
            else return onerror(err, options, worker);
        });
    };
    var checking = false;
    var check_queue = function() {
        if (checking) return;
        else checking = true;
        try {
            if (_.isEmpty(workers)) {
                registerWorkers(createWorkers(check_queue), workers, stoppedWorkers, check_queue);
                if (_.isEmpty(workers)) throw Error("No workers available");
            }
            stoppedWorkers.forEach(worker => {
                if (!load(worker)) {
                    worker.disconnect();
                }
            });
            var spare = workers.reduce((capacity, worker) => {
                return capacity + Math.max((worker.count || 1) * (1 - load(worker)), 0);
            }, 0);
            queue.splice(0, spare).forEach(item => {
                run(item.options).then(item.resolve, item.reject);
            });
            if (queue.length && spare) {
                logger.trace("Queued", queue.length, "collect", _.first(queue).options.label || '\b',
                    workers.map(w => (load(w) * 100) + '%').join(' '));
            }
        } finally {
            checking = false;
        }
    };
    return _.extend(function(options) {
        return new Promise((resolve, reject) => {
            queue.push({options, resolve, reject});
            check_queue();
        });
    },{
        getWorkers() {
            if (_.isEmpty(workers)) {
                registerWorkers(createWorkers(check_queue), workers, stoppedWorkers, check_queue);
            }
            return workers.slice(0);
        },
        reload() {
            stoppedWorkers.push.apply(stoppedWorkers, workers.splice(0, workers.length));
        },
        close() {
            queue.splice(0).forEach(item => {
                item.reject(Error("Collect is closing"));
            });
            return Promise.all(_.flatten([
                workers.map(child => child.disconnect()),
                stoppedWorkers.map(child => child.disconnect())
            ])).then(quote.close);
        }
    });
}

function load(worker) {
    var stats = worker.stats.collect;
    if (!stats || !stats.requests_sent) return 0;
    var outstanding = stats.requests_sent - (stats.replies_rec || 0);
    var subcollecting = (stats.requests_rec || 0) - (stats.replies_sent || 0);
    return Math.max((outstanding - subcollecting) / (worker.count || 1), 0) || 0;
}

function registerWorkers(newWorkers, workers, stoppedWorkers, check) {
    workers.push.apply(workers, newWorkers);
    workers.forEach(worker => worker.on('message', check).handle('stop', function() {
        var idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        stoppedWorkers.push(this);
        if (!load(this)) {
            this.disconnect();
        }
    }).once('disconnect', function() {
        var idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        var sidx = stoppedWorkers.indexOf(this);
        if (sidx >= 0) stoppedWorkers.splice(sidx, 1);
        logger.log("Worker", this.process.pid, "has disconnected");
    }));
}

function createLocalWorkers(program, quote, collect) {
    return _.range(config('workers') || WORKER_COUNT).map(() => {
        return replyTo(config.fork(module.filename, program))
          .handle('quote', payload => quote(payload))
          .handle('collect', payload => collect(payload));
    });
}

function createRemoteWorkers(check_queue) {
    var remote_workers = _.flatten(_.compact(_.flatten([config('remote_workers')]))
        .map(addr => addr.split(',')));
    var remoteWorkers = remote_workers.map(address => {
        return replyTo(remote(address))
            .on('error', err => logger.warn(err.message || err));
    });
    Promise.all(remoteWorkers.map(worker => worker.request('worker_count').catch(err => err)))
      .then(counts => {
        var errors = counts.filter((count, i) => {
            if (!isFinite(count)) return count;
            else remoteWorkers[i].count = count;
        });
        if (errors.length) throw errors[0];
    }).catch(err => logger.debug(err, err.stack)).then(() => {
        if (_.some(remoteWorkers, worker => worker.count > 1)) check_queue();
    });
    return remoteWorkers;
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
    if (!options) {
        return options;
    } else if (_.isArray(options)) {
        var inlined = options.map(item => inlineCollections(collections, item, avoid));
        if (inlined.every((item, i) => item == options[i])) return options;
        else return inlined;
    } else if (_.isObject(options) && options.portfolio) {
        var inlined = inlineCollections(collections, options.portfolio, avoid);
        if (inlined == options) return options;
        else return _.defaults({portfolio: inlined}, options);
    } else if (_.isObject(options)) {
        return options;
    } else if (_.contains(avoid, options)) {
        throw Error("Cycle profile detected: " + avoid + " -> " + options);
    }
    if (_.isEmpty(collections)) {
        _.extend(collections, _.object(config.list(), []));
    }
    if (collections[options]) return collections[options];
    else if (_.has(collections, options) || ~options.indexOf('.json') || ~options.indexOf('/')) {
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
    }, config.options(), read);
}

function shell(desc, collect, app) {
    app.on('quit', () => collect.close());
    app.on('exit', () => collect.close());
    app.cmd('collect', desc, (cmd, sh, cb) => {
        collect(config.options()).then(result => tabular(result, config())).then(() => sh.prompt(), cb);
    });
    app.cmd("collect :name([a-zA-Z0-9\\-._!\\$'\\(\\)\\+,;=\\[\\]@ ]+)", desc, (cmd, sh, cb) => {
        var options = readCollect(cmd.params.name);
        collect(options).then(result => tabular(result, config())).then(() => sh.prompt(), cb);
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
