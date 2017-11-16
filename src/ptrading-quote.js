#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading-quote.js
/*
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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

const path = require('path');
const _ = require('underscore');
const commander = require('commander');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const Quote = require('./quote.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const config = require('./ptrading-config.js');
const expect = require('chai').expect;
const common = require('./common-functions.js');
const lookback = require('./lookback-functions.js');
const indicator = require('./indicator-functions.js');

const WORKER_COUNT = require('os').cpus().length;

function usage(command) {
    return command.version(require('../package.json').version)
        .description("Quotes historical data for the given symbol")
        .usage('<symbol.exchange> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-s, --silent', "Include less information about what the system is doing")
        .option('--debug', "Include details about what the system is working on")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--load <identifier>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-begin <number>', "Number of bars before begin dateTime")
        .option('--pad-end <number>', "Number of bars after end dateTime")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--criteria <expression>', "Conditional expression that must evaluate to a non-zero for an interval to be included in the result")
        .option('-o, --offline', "Disable data updates")
        .option('--workers <numOfWorkers>', 'Number of workers to spawn')
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('--transpose', "Swap the columns and rows");
}

if (require.main === module) {
    var program = usage(commander).parse(process.argv);
    if (program.args.length) {
        var fetch = require('./ptrading-fetch.js');
        var quote = Quote(fetch);
        process.on('SIGINT', () => quote.close().then(() => fetch.close()));
        var symbol = program.args[0];
        var exchange = program.args[1];
        if (!exchange && ~symbol.indexOf('.')) {
            exchange = symbol.substring(symbol.lastIndexOf('.')+1);
            symbol = symbol.substring(0, symbol.lastIndexOf('.'));
        }
        Promise.resolve().then(() => quote(_.defaults({
            symbol: symbol,
            exchange: exchange
        }, config.opts(), config.options())))
        .then(result => tabular(result))
        .catch(err => logger.error(err, err.stack))
        .then(() => quote.close())
        .then(() => fetch.close());
    } else if (process.send) {
        var parent = replyTo(process).handle('quote', payload => {
            return quote()(payload);
        });
        var quote = _.once(() => Quote(function(options) {
            return parent.request('fetch', options);
        }));
        process.on('disconnect', () => quote().close());
    } else {
        program.help();
    }
} else {
    var fetch = require('./ptrading-fetch.js');
    var program = usage(new commander.Command());
    var workers = [];
    var stoppedWorkers = [];
    var queue = [];
    var quote = function(options) {
        var master = getMasterWorker(workers, options);
        var slave = chooseSlaveWorker(workers, master, options);
        var opts = slave.process.remote || slave == master ? options :
            _.extend({read_only: true}, options);
        return slave.request('quote', opts).catch(err => {
            if (slave.process.remote && options.read_only != false) {
                logger.debug("Quote", slave.process.pid, err, err.stack);
            } else {
                if (!err || !err.message) throw err;
                else if (!~err.message.indexOf('read_only')) throw err;
                else if (!opts.read_only || _.has(options, 'read_only')) throw err;
                else if (slave == getMasterWorker(workers, options)) throw err;
            }
            logger.debug("Retrying", options.label || '', "using master node", master.process.pid);
            return quote(_.extend({read_only: false}, options)); // retry using master
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
            quote(item.options).then(item.resolve, item.reject);
        });
    };
    workers.push.apply(workers, createWorkers(fetch, quote, program));
    workers.forEach(worker => worker.on('message', check_queue).handle('stop', function() {
        var idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        stoppedWorkers.push(this);
        check_queue();
    }).once('disconnect', function() {
        var idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1)[0];
        var sidx = stoppedWorkers.indexOf(this);
        if (sidx >= 0) stoppedWorkers.splice(sidx, 1);
        logger.log("Worker", this.process.pid, "has disconnected");
    }));
    var promiseKeys = _.first(workers).request('quote', {help: true})
        .then(_.first).then(info => ['help'].concat(_.keys(info.options)));
    var promiseDefaults = promiseKeys.then(k => _.pick(_.defaults({}, config.opts(), config.options()), k));
    module.exports = function(options) {
        return promiseKeys.then(keys => promiseDefaults.then(defaults => {
            return _.extend({}, defaults, _.pick(options, keys));
        })).then(options => new Promise((resolve, reject) => {
            queue.push({options, resolve, reject});
            check_queue();
        }));
    };
    module.exports.close = function() {
        queue.splice(0).forEach(item => {
            item.reject(Error("Collect is closing"));
        });
        return Promise.all(_.flatten([
            workers.map(child => child.disconnect()),
            stoppedWorkers.map(child => child.disconnect())
        ])).then(fetch.close);
    };
    module.exports.shell = shell.bind(this, program.description(), module.exports);
}

function createWorkers(fetch, quote, program) {
    var signal = config('workers') == 0 && !config('remote_workers');
    if (signal) return [{
        request: ((quote, cmd, payload) => {
            if (cmd == 'fetch') return fetch(payload);
            else if (cmd == 'quote') return quote(payload);
            else if (cmd == 'disconnect') return quote.close();
        }).bind(this, Quote(fetch)),
        disconnect() {
            return this.request('disconnect');
        },
        once: function() {},
        stats: {
            requests_sent: 0,
            replies_rec: 0
        },
        process: process
    }];
    var prime = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
    var size = _.isFinite(config('workers')) ? config('workers') :
        prime[_.sortedIndex(prime, WORKER_COUNT)] || WORKER_COUNT;
    var local = _.range(size).map(() => {
        return replyTo(config.fork(module.filename, program))
          .handle('fetch', payload => fetch(payload));
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
};

function getMasterWorker(workers, options) {
    if (!options.help) expect(options).to.have.property('symbol');
    var name = options.help ? 'help' : options.exchange ?
        options.symbol + '.' + options.exchange : options.symbol;
    expect(workers).to.be.an('array').and.not.empty;
    var local = workers.filter(worker => !worker.process.remote);
    var pool = _.isEmpty(local) ? workers : local; // use local workers as masters
    var capacity = pool.reduce((capacity, worker) => capacity + (worker.count || 1), 0);
    var number = (hashCode(name) % capacity + capacity) % capacity;
    return pool.find(worker => (number-= worker.count || 1) < 0);
}

function chooseSlaveWorker(workers, master, options) {
    if (_.has(options, 'read_only') && !options.read_only)
        return master; // write requested
    var loads = workers.map(w => {
        return (w.stats.requests_sent - w.stats.replies_rec)/(w.count || 1) || 0;
    });
    var light = _.min(loads);
    if (loads[workers.indexOf(master)] == light) return master; // master is available
    else return workers[loads.indexOf(light)]; // use available slave
}

function hashCode(str){
    var hash = 0, i, char;
    if (str.length === 0) return hash;
    for (i = 0, l = str.length; i < l; i++) {
        char = str.charCodeAt(i);
        hash = char + (hash << 6) + (hash << 16) - hash;
    }
    return hash;
}

function shell(desc, quote, app) {
    app.on('quit', () => quote.close());
    app.on('exit', () => quote.close());
    app.cmd('quote :symbol', desc, (cmd, sh, cb) => {
        var s = cmd.params.symbol;
        var symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        var exchange = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        quote(_.defaults({
            symbol: symbol,
            exchange: exchange
        }, config.options())).then(result => tabular(result)).then(() => sh.prompt(), cb);
    });
    _.forEach(common.functions, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
    _.forEach(lookback.functions, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
    _.forEach(indicator.functions, (fn, name) => {
        help(app, name, functionHelp(name, fn));
    });
// help
return quote({help: true}).then(_.first).then(info => {
help(app, 'quote', `
  Usage: quote :symbol.exchange

  ${info.description}

    :symbol.exchange
      The ticker symbol used by the exchange followed by a dot and one of the following exchange acronyms:
${listOptions(config('exchanges'))}
  Options:
${listOptions(_.omit(info.options, ['symbol', 'exchange']))}
  See also:
    help output  
    help reverse  
`);
_.each(info.options, (option, name) => {
if (option.type == 'map') {
help(app, name, `
  Usage: add ${name} :label ${option.usage || 'value'}
  Usage: remove ${name} :label

  ${option.description}
` + (option.seeAlso ? `
  See also:` +
option.seeAlso.reduce((buf, also) => buf + `
    help ${also}  `, '') + `  
` : ''));
} else {
help(app, name, `
  Usage: set ${name} ${option.usage || 'value'}  

  ${option.description}
` + (option.seeAlso ? `
  See also:` +
option.seeAlso.reduce((buf, also) => buf + `
    help ${also}  `, '') + `  
` : ''));
}
});
help(app, 'expression', `
  :expression
    An expression is any combination of field, constants, and function calls
    connected by an operator or operators.

    A constant can be a number or a quoted string.

    A function call has a name followed parentheses enclosed comma separated
    list of expressions.

    A field can be one of the following without a prefix:
    symbol    Represents the symbol used by the exchange
    exchange  Represents the exchange acronym
    ending    Represents the dateTime of when an interval ended

    A field can also be one of the following prefixed by an interval:
    <interval>.ending     DateTime when the interval ends (interval prefix is optional)
    <interval>.open       Price when the interval began
    <interval>.high       highest price during the interval
    <interval>.low        Lowest price during the interval
    <interval>.close      Price when the interval ended
    <interval>.volume     Volume during the interval
    <interval>.adj_close  Close price adjusted for dividends and splits

    An <interval> can be one of the following:
    year        Yearly quotes for security
    quarter     Quarterly quotes for security
    month       Monthly quotes for security
    week        Weekly quotes for security
    day         Daily quotes for security
    mX          Intraday quotes for security by X minutes

    Operators include the following:
    OR   0 if both expressions are 0.
    AND  0 if either expression is 0.
    =    0 if both expressions have the same value.
    !=   0 if either expression has a different value.
    <>   0 if either expression has a different value.
    <=   0 if the left expression is larger than the right.
    >=   0 if the right expression is larger than the left.
    <    0 if the left expression is larger than or equal to the right.
    >    0 if the right expression is larger than or equal to the left.
    +    Adds both values together.
    -    Subtracts the right value from the left value.
    *    Multiples the values together.
    /    Divides the right values into the left value.
    %    Returns the integer remainder of a division
    !    0 if the expression was not zero
    ()   Groups expressions together to possibly change their precedence.

  See also:
    help common-functions  
`);
help(app, 'common-functions', `
  Common functions have no restrictions on what expressions they can be used in.

  The following functions are available:
${listFunctions(common.functions)}
`);
help(app, 'lookback-functions', `
  Lookback functions may read data in the past to determine the current value.

  The following functions are available:
${listFunctions(lookback.functions)}
`);
help(app, 'indicator-functions', `
  Indicator functions must be prefixed by an interval and a dot and take numbers
  as paratemeters.

  An interval can be one of the following:
      year        Yearly quotes for security
      quarter     Quarterly quotes for security
      month       Monthly quotes for security
      week        Weekly quotes for security
      day         Daily quotes for security
      mX          Intraday quotes for security by X minutes

  The following functions are available:
${listFunctions(indicator.functions)}
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
