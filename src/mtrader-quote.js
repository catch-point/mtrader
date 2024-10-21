#!/usr/bin/env -S node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-quote.js
/*
 *  Copyright (c) 2016-2019 James Leigh, Some Rights Reserved
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const commander = require('commander');
const share = require('./share.js');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const interrupt = require('./interrupt.js');
const workerQueue = require('./worker-queue.js');
const Model = require('./quote-model.js');
const Quote = require('./quote.js');
const replyTo = require('./promise-reply.js');
const config = require('./config.js');
const expect = require('chai').expect;
const common = require('./common-functions.js');
const lookback = require('./lookback-functions.js');
const indicator = require('./indicator-functions.js');
const version = require('./version.js').version;
const Fetch = require('./mtrader-fetch.js');

const WORKER_COUNT = require('os').cpus().length;

function usage(command) {
    return command.version(version)
        .description("Quotes historical data for the given symbol")
        .usage('<symbol.market> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('-i, --runInBand', "Runs in the same process rather than spawning processes")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-begin <number>', "Number of bars before begin dateTime")
        .option('--pad-end <number>', "Number of bars after end dateTime")
        .option('--add-column <name=expression>', "Add a column to the output (such as close=day.close)")
        .option('--add-variable <name=expression>', "Add a variable to include in column expressions")
        .option('--add-parameter <name=value>', "Name=Value pair to include as expression parameter")
        .option('--criteria <expression>', "Expression that must evaluate to a non-zero to be retained")
        .option('-o, --offline', "Disable data updates")
        .option('-u, --update', "Update the last bar of assets")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('-a, --append', "Append the new rows to the end of the file")
        .option('-c, --csv', "Use comma delimited output")
        .option('-z, --gzip', "Compress the output file")
        .option('-t, --transpose', "Swap the columns and rows");
}

process.setMaxListeners(process.getMaxListeners()+1);

if (require.main === module) {
    const program = usage(commander).parse(process.argv);
    if (program.args.length) {
        const quote = createInstance(program);
        process.on('SIGINT', () => quote.close());
        process.on('SIGTERM', () => quote.close());
        let symbol = program.args[0];
        let market = program.args[1];
        if (!market && ~symbol.indexOf('.')) {
            market = symbol.substring(symbol.lastIndexOf('.')+1);
            symbol = symbol.substring(0, symbol.lastIndexOf('.'));
        }
        Promise.resolve().then(() => quote(_.defaults({
            symbol: symbol,
            market: market
        }, config.options())))
        .then(result => tabular(result, config()))
        .catch(err => logger.error(err, err.stack) || (process.exitCode = 1))
        .then(() => quote.close());
    } else if (process.send) {
        const settings = config('quote');
        const parent = replyTo(process).handle('quote', payload => quote()(payload));
        const fetch = options => parent.request('fetch', options);
        const parent_quote = options => parent.request('quote', options);
        const model = new Model(fetch, parent_quote, settings);
        const quote = _.once(() => new Quote(model, settings));
        const close = () => Promise.all([quote().close(), model.close()]);
        process.on('disconnect', close);
        process.on('SIGINT', close);
        process.on('SIGTERM', close);
    } else {
        program.help();
    }
} else {
    const program = usage(new commander.Command());
    const shared = module.exports = share(() => createInstance(program));
    process.on('SIGHUP', () => shared.instance && shared.instance.reload());
}

function createInstance(program) {
    const fetch = new Fetch();
    let promiseKeys, closed;
    const instance = async function(options) {
        if (options.info=='pending')
            return queue.pending();
        if (!promiseKeys) {
            promiseKeys = direct({info:'help'})
                .then(_.first).then(info => ['info'].concat(_.keys(info.options)));
        }
        return promiseKeys.then(keys => _.pick(options, keys)).then(options => {
            if (options.info || _.isEmpty(queue.getWorkers()))
                return direct(options);
            else return queue(options);
        });
    };
    const direct_factory = () => {
        const settings = config('quote');
        const model = new Model(fetch, instance, settings);
        const quote = new Quote(model, settings);
        quote.close = _.wrap(quote.close, async function(fn) {
            await model.close();
            return fn.apply(this, _.rest(arguments));
        });
        return quote;
    };
    let shared_direct_factory = share(direct_factory);
    let direct_instance = shared_direct_factory();
    const direct = options => {
        const instance = shared_direct_factory();
        return instance(options).then(async(result) => {
            await instance.close();
            return result;
        }, async(err) => {
            await instance.close();
            throw err;
        });
    };
    instance.close = function() {
        if (closed) return closed;
        else return closed = Promise.all([queue.close(), direct_instance.close(), fetch.close()]);
    };
    instance.shell = shell.bind(this, program.description(), instance);
    instance.reload = async() => {
        const prior_direct = direct_instance;
        shared_direct_factory = share(direct_factory);
        direct_instance = shared_direct_factory();
        await queue.reload();
        await prior_direct.close();
    };
    instance.reset = async() => {
        const prior_direct = direct_instance;
        shared_direct_factory = share(direct_factory);
        direct_instance = shared_direct_factory();
        await prior_direct.close();
        try {
            return await queue.close();
        } finally {
            queue = createQueue(createWorkers.bind(this, program, fetch, instance));
        }
    };
    let queue = createQueue(createWorkers.bind(this, program, fetch, instance));
    return instance;
}

function createQueue(createWorkers) {
    const check = interrupt(true);
    const queue = workerQueue(createWorkers, (worker, options) => {
        const master = getMasterWorker(queue.getWorkers(), options);
        const slave = chooseSlaveWorker(queue.getWorkers(), master, options);
        const opts = slave == master ? options :
            _.extend({read_only: true}, options);
        return slave.request('quote', opts).catch(async(err) => {
            if (!err || !err.message) throw err;
            else if (!~err.message.indexOf('read_only')) throw err;
            else if (!opts.read_only || _.has(options, 'read_only')) throw err;
            else if (slave == getMasterWorker(queue.getWorkers(), options)) throw err;
            else if (await check()) throw err;
            logger.debug("Retrying", options.label || '\b', "using master node", master.process.pid);
            return queue(_.extend({read_only: false}, options)); // retry using master
        });
    });
    return queue;
}

function createWorkers(program, fetch, quote) {
    const prime = [0,1,2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
    const size = config('runInBand') || ~process.argv.indexOf('-i') || ~process.argv.indexOf('--runInBand') ? 0 :
        _.isFinite(config('quote.workers')) ? +config('quote.workers') :
        prime[_.sortedIndex(prime, WORKER_COUNT)] || WORKER_COUNT;
    if (size) logger.debug("Launching", size, "quote workers");
    return _.range(size).map(() => {
        const worker = replyTo(config.fork(module.filename, program));
        return worker.handle('fetch', payload => fetch(payload)).handle('quote', payload => quote(payload));
    });
};

function getMasterWorker(workers, options) {
    if (!options.info) expect(options).to.have.property('symbol');
    const name = options.info ? options.info : options.market ?
        options.symbol + '.' + options.market : options.symbol;
    expect(workers).to.be.an('array').and.not.empty;
    const capacity = workers.length;
    const number = (hashCode(name) % capacity + capacity) % capacity;
    return workers[number];
}

function chooseSlaveWorker(workers, master, options) {
    if (_.has(options, 'read_only') && !options.read_only)
        return master; // write requested
    if (!options.end || moment(options.end).valueOf() >= Date.now())
        return master; // latest data requested
    const loads = workers.map(load);
    const light = _.min(loads);
    if (loads[workers.indexOf(master)] == light) return master; // master is available
    else return workers[loads.indexOf(light)]; // use available slave
}

function load(worker) {
    const stats = worker.stats;
    if (!stats || !stats.requests_sent) return 0;
    else if (!stats.replies_rec) return stats.requests_sent;
    else return stats.requests_sent - stats.replies_rec;
}

function hashCode(str){
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0, l = str.length; i < l; i++) {
        let char = str.charCodeAt(i);
        hash = char + (hash << 6) + (hash << 16) - hash;
    }
    return hash;
}

function shell(desc, quote, app) {
    app.on('quit', () => quote.close());
    app.on('exit', () => quote.close());
    app.cmd('quote :symbol', desc, (cmd, sh, cb) => {
        const s = cmd.params.symbol;
        const symbol = ~s.indexOf('.') ? s.substring(0, s.lastIndexOf('.')) : s;
        const market = ~s.indexOf('.') ? s.substring(s.lastIndexOf('.')+1) : null;
        quote(_.defaults({
            symbol: symbol,
            market: market
        }, config.options())).then(result => tabular(result, config())).then(() => sh.prompt(), cb);
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
return quote({info:'help'}).then(_.first).then(info => {
help(app, 'quote', `
  Usage: quote :symbol.market

  ${info.description}

    :symbol.market
      The ticker symbol used by the market followed by a dot and one of the following market acronyms:
${listOptions(config('markets'))}
  Options:
${listOptions(_.omit(info.options, ['symbol', 'market']))}
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
    symbol    Represents the symbol used by the market
    market  Represents the market acronym
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
    const source = fn.toString();
    const m = source.match(/^[^(]*\(([^)]*)\)/);
    const args = _.isString(fn.args) ? fn.args : _.property(1)(m) || '';
    const usage = ['\n', '  Usage: ', name, '(', args, ')', '  \n'].join('');
    const body = source.replace(/[^\{]*\{([\s\S]*)\}[^}]*/,'$1');
    const desc = fn.description ? '\n  ' + wrap(fn.description, '  ', 80) + '\n' : body;
    const seeAlso = fn.seeAlso ? '\n  See also:\n' + fn.seeAlso.map(name => {
        return '    help ' + name + '  ';
    }).join('\n') + '\n' : '';
    return usage + desc + seeAlso;
}

function listFunctions(functions) {
    return listOptions(_.mapObject(functions, (fn, name) => {
        const source = fn.toString();
        const m = source.match(/^[^(]*\(\s*opt\w*\s*,\s*([^)]*)\)/) ||
            source.match(/^[^(]*\(([^)]*)\)/);
        const args = fn.args || _.property(1)(m) || '';
        const desc = fn.description || name + '(' + args + ')';
        return {description:  desc};
    }));
}

function listOptions(options) {
    const buf = [];
    const left = Math.max(_.max(_.keys(options).map(name => name.length)), 5) + 8;
    const indent = new Array(left+1).join(' ');
    const width = 80 - indent.length;
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
    const buf = [];
    if (desc && desc.length < len - indent.length) {
        buf.push(desc);
    } else if (desc) {
        const width = len - indent.length;
        let remain = desc.trim();
        while (remain) {
            let idx = remain.lastIndexOf(' ', width);
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
