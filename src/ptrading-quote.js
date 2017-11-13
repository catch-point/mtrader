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

var os = require('os');
const _ = require('underscore');
const commander = require('commander');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const Quote = require('./quote.js');
const replyTo = require('./ipc-promise-reply.js');
const config = require('./ptrading-config.js');
const expect = require('chai').expect;
const common = require('./common-functions.js');
const lookback = require('./lookback-functions.js');
const indicator = require('./indicator-functions.js');

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
    var prime = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
    var workers = commander.workers == 0 ? 1 :
        commander.workers || prime[_.sortedIndex(prime, os.cpus().length)] || os.cpus().length;
    var children = commander.workers == 0 ? [{
        request: ((quote, cmd, payload) => {
            if (cmd == 'fetch') return fetch(payload);
            else if (cmd == 'quote') return quote(payload);
            else if (cmd == 'disconnect') return quote.close();
        }).bind(this, Quote(fetch)),
        disconnect() {
            return this.request('disconnect');
        }
    }] : _.range(workers).map(() => {
        return replyTo(config.fork(module.filename, program))
          .handle('fetch', payload => fetch(payload));
    });
    var queue = [];
    var processing = children.map(_.constant(0));
    var quote = function(options) {
        var master = getMasterIndex(children, options);
        var slave = chooseSlaveIndex(master, processing, options);
        processing[slave]++;
        var opts = _.extend({read_only: slave != master}, options);
        return children[slave].request('quote', opts).then(result => {
            processing[slave]--;
            if (!processing[slave]) queue_ready();
            return result;
        }, err => {
            processing[slave]--;
            try {
                if (master == slave || _.has(options, 'read_only')) throw err;
                else if (!err || !err.message) throw err;
                else if (!~err.message.indexOf('read_only')) throw err;
                logger.debug("Retrying", options.label || '', "using master node");
                return quote(_.extend({read_only: false}, options)); // retry using master
            } finally {
                if (!processing[slave]) queue_ready();
            }
        });
    };
    var queue_ready = function() {
        var available = processing.filter(load => load === 0).length;
        var selected = [];
        for (var i=0; i<queue.length && selected.length<available; i++) {
            var item = queue[i];
            var master = getMasterIndex(children, item.options);
            if (processing[master] < children.length) selected.push(i);
        }
        selected.reverse().map(i => queue.splice(i, 1)[0]).reverse().forEach(item => {
            quote(item.options).then(item.resolve, item.reject);
        });
    };
    module.exports = function(options) {
        return new Promise((resolve, reject) => {
            queue.push({options, resolve, reject});
            queue_ready();
        });
    };
    module.exports.close = function() {
        queue.splice(0).forEach(item => {
            item.reject(Error("Collect is closing"));
        });
        children.forEach(child => child.disconnect());
        return fetch.close();
    };
    module.exports.shell = shell.bind(this, program.description(), module.exports);
}

function getMasterIndex(workers, options) {
    if (!options.help) expect(options).to.have.property('symbol');
    var name = options.help ? 'help' : options.exchange ?
        options.symbol + '.' + options.exchange : options.symbol;
    expect(workers).to.be.an('array').and.not.empty;
    var mod = workers.length;
    return (hashCode(name) % mod + mod) % mod;
}

function chooseSlaveIndex(master, processing, options) {
    var avail = _.min(processing);
    if (processing[master] == avail) return master; // master is available
    else if (_.has(options, 'read_only') && !options.read_only) return master; // write requested
    else return processing.indexOf(avail); // use available slave
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
