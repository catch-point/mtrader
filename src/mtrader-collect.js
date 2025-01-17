#!/usr/bin/env -S node --max-http-header-size=65536
// vim: set filetype=javascript:
// mtrader-collect.js
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

const net = require('net');
const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const commander = require('commander');
const Big = require('big.js');
const debounce = require('./debounce.js');
const merge = require('./merge.js');
const share = require('./share.js');
const logger = require('./logger.js');
const tabular = require('./tabular.js');
const Parser = require('./parser.js');
const replyTo = require('./promise-reply.js');
const interrupt = require('./interrupt.js');
const workerQueue = require('./worker-queue.js');
const Remote = require('./remote-workers.js');
const Cache = require('./disk-cache.js');
const config = require('./config.js');
const version = require('./version.js').version;
const Fetch = require('./mtrader-fetch.js');
const Quote = require('./mtrader-quote.js');
const Broker = require('./mtrader-broker.js');
const Model = require('./quote-model.js');
const SlaveQuote = require('./quote.js');
const Collect = require('./collect.js');
const expect = require('chai').expect;
const rolling = require('./rolling-functions.js');
const Quoting = require('./quoting-functions.js');
const formatDate = new require('./mtrader-date.js')();
const readCallSave = require('./read-call-save.js');

const WORKER_COUNT = require('os').cpus().length;

process.setMaxListeners(process.getMaxListeners()+1);

function usage(command) {
    return command.version(version)
        .description("Collects historic portfolio data")
        .usage('<identifier> [options]')
        .option('-v, --verbose', "Include more information about what the system is doing")
        .option('-q, --quiet', "Include less information about what the system is doing")
        .option('-x, --debug', "Include details about what the system is working on")
        .option('-X', "Hide details about what the system is working on")
        .option('-i, --runInBand', "Runs in the same process rather than spawning or using remote workers")
        .option('--prefix <dirname>', "Path where the program files are stored")
        .option('--config-dir <dirname>', "Directory where stored sessions are kept")
        .option('--cache-dir <dirname>', "Directory where processed data is kept")
        .option('--load <filename>', "Read the given session settings")
        .option('--begin <dateTime>', "ISO dateTime of the starting point")
        .option('--end <dateTime>', "ISO dateTime of the ending point")
        .option('--pad-leading <number>', "Number of work days prior to begin to compute initial variables")
        .option('--portfolio <list>', "Comma separated list of <symbol>.<market> to search")
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
        .option('-u, --update', "Update the last bar of assets")
        .option('--allocation-pct <percent>', "Percentage 0-100 of the balance that should be allocated to this strategy")
        .option('--allocation-peak-pct <percent>', "Percentage 0-100 of the maximum balance in the past 12 months to allocate")
        .option('--reserve-peak-allocation <number>', "Amount to exclude from allocation at peak balance in the past 12 month")
        .option('--reserve-allocation <number>', "Monetary amount to exclude from allocation")
        .option('--allocation-min <number>', "Minimum monetary amount that should be allocated to this strategy")
        .option('--allocation-max <number>', "Maximum monetary amount that should be allocated to this strategy")
        .option('--set <name=value>', "Name=Value pairs to be used in session")
        .option('--output <file>', "CSV file to write the result into")
        .option('--launch <program>', "Program used to open the output file")
        .option('--reverse', "Reverse the order of the rows")
        .option('-a, --append', "Append the new rows to the end of the file")
        .option('-c, --csv', "Use comma delimited output")
        .option('-z, --gzip', "Compress the output file")
        .option('-t, --transpose', "Swap the columns and rows");
}

function collect_help(info) {
    return info.map(help => ({
        name: 'collect',
        usage: 'collect(options)',
        description: "Evaluates columns using historic security data",
        properties: help.properties,
        options: _.extend({}, help.options, {
            allocation_pct: {
                usage: '<number>',
                description: "Percentage 0-100 of the balance that should be allocated to this strategy"
            },
            allocation_peak_pct: {
                usage: '<number>',
                description: "Percentage 0-100 of the maximum balance in the past 12 months to allocate"
            },
            reserve_peak_allocation: {
                usage: '<number>',
                description: "Amount to exclude from allocation at peak balance in the past 12 months"
           },
            reserve_allocation: {
                usage: '<number>',
                description: "Amount to exclude from allocation to this strategy"
            },
            allocation_min: {
                usage: '<number>',
                description: "Minimum amount that should be allocated to this strategy"
            },
            allocation_max: {
                usage: '<number>',
                description: "Maximum amount that should be allocated to this strategy"
            }
        })
    }));
}

if (require.main === module) {
    const program = usage(commander).parse(process.argv);
    if (program.args.length || !process.send) {
        const runInBand = ~process.argv.indexOf('-i') || ~process.argv.indexOf('--runInBand');
        const shared = settings => createSharedInstance(program, runInBand);
        const collect = createInstance(shared, config.options());
        process.on('SIGHUP', () => collect.reload());
        process.on('SIGINT', () => collect.close());
        process.on('SIGTERM', () => collect.close());
        const args = program.args.length ? program.args : [''];
        Promise.all(args.map(name => readCallSave(name, collect)))
          .then(results => [].concat(...results))
          .then(result => tabular(result, config()))
          .catch(err => logger.error(err, err.stack) || (process.exitCode = 1))
          .then(() => collect.close());
    } else {
        spawn();
    }
} else {
    const prog = usage(new commander.Command());
    const shared = share(settings => createSharedInstance(prog, settings.runInBand));
    process.on('SIGHUP', () => shared.instance && shared.instance.reload());
    module.exports = function(settings = {}) {
        return createInstance(shared, settings);
    };
}

function createInstance(createSharedInstance, settings) {
    const broker = settings.mock_broker || new Broker(settings);
    const shared = settings.mock_collect || createSharedInstance(settings);
    const remoteAddress = settings.remoteAddress;
    let broker_help;
    const instance = async function(options) {
        const begin = options.begin || options.working_duration && formatDate(moment.defaultFormat, {
            duration: options.working_duration,
            negative_duration: true,
            now: options.now
        }) || options.now;
        broker_help = broker_help || broker({info:'help'});
        const desired_parameters = _.isEmpty(await broker_help) ? {} :
            await getDesiredParameters(broker, begin, options);
        const parameters = {
            ...desired_parameters,
            ...(options.parameters || {})
        };
        logger.debug("collect", options.label || '', begin, "parameters", parameters);
        return shared(merge(options, {begin, parameters, remoteAddress}));
    };
    return Object.assign(instance, _.pick(shared, 'shell', 'reload', 'reset'), {
        close() {
            return Promise.all([
                shared.close(),
                broker.close()
            ]);
        }
    });
}

function createSharedInstance(program, runInBand = false) {
    const settings = config('collect');
    let promiseKeys, closed;
    const fetch = new Fetch();
    const quote = new Quote();
    const instance = function(options) {
        if (closed) throw Error("Collect is closed");
        else if (options.info=='pending')
            return direct(options).then(result => result.concat(local.pending(), remote.pending()));
        if (!promiseKeys) {
            promiseKeys = direct({info:'help'})
                .then(_.first).then(info => ['info'].concat(_.keys(info.options)));
        }
        const local_tier = settings.tier || 0;
        const remoteAddress = options.remoteAddress;
        return promiseKeys.then(keys => trimOptions(keys, options))
          .then(options => {
            const remote_tier = remote.getWorkerTier() || local_tier;
            if (options.info=='help') return direct(options).then(info => collect_help(info));
            else if (options.info=='version') return direct(options);
            else if (options.info)
                return Promise.all([
                    direct(options),
                    local.countConnectedWorkers() ? local(options) : [],
                    remote.hasWorkers() ? remote(options) : []
                ]).then(_.flatten);
            else if (isSplitting(options)) return direct(options);
            else if (cache) return cache(options);
            else if (config('runInBand') || runInBand) return direct(options);
            else if (!local.hasWorkers() && !remote.hasWorkers()) return direct(options);
            else if (!remote.hasWorkers()) return local(options);
            else if (local.hasWorkers() && local_tier < remote_tier) return local(options);
            else if (!remoteAddress && (options.reset_every || isQuoting(options))) return remote(options);
            else if (!local.hasWorkers()) return remote(options);
            else if (remote.hasWorkers() && remote_tier < local_tier) return remote(options);
            else return local(options);
        });
    };
    instance.close = function() {
        if (closed) return closed;
        else return closed = remote.close()
          .then(local.close, local.close)
          .then(direct.close)
          .then(quote.close)
          .then(fetch.close)
          .then(() => cache && cache.close());
    };
    instance.shell = shell.bind(this, program.description(), instance);
    instance.reload = debounce(async() => {
        Object.assign(settings, config('collect'));
        await local.reload();
        await remote.reload();
        const promise = (cache && cache.close()
            .catch(err => logger.warn("Could not reset collect cache", err)));
        cache = createCache(direct, local, remote, settings);
        promiseKeys = null;
        await promise;
    }, 100);
    instance.reset = () => {
        try {
            return Promise.all([local.close(), remote.close(), cache && cache.close()])
              .catch(err => logger.warn("Could not reset collect", err));
        } finally {
            Object.assign(settings, config('collect'));
            local = createQueue(localWorkers);
            remote = new Remote(settings);
            cache = createCache(direct, local, remote, settings);
            promiseKeys = null;
        }
    };
    const direct = new Collect(fetch, quote, instance);
    const localWorkers = createLocalWorkers.bind(this, program, fetch, quote, instance, settings);
    let local = createQueue(localWorkers);
    let remote = new Remote(settings);
    let cache = createCache(direct, local, remote, settings);
    return instance;
}

async function getDesiredParameters(broker, begin, options) {
    const [current_balances, past_positions] = await Promise.all([
        broker({action: 'balances', now: options.now}),
        broker({action: 'positions', begin, now: options.now})
    ]);
    const first_traded_at = getFirstTradedAt(past_positions, begin, options);
    const initial_balances = await broker({action: 'balances', asof: first_traded_at, now: options.now});
    const peak_balances = options.allocation_peak_pct || options.reserve_peak_allocation ? await broker({
        action: 'balances',
        begin: moment(first_traded_at).subtract(1,'year').format(),
        now: options.now
    }) : initial_balances;
    const peak_initial_balances = peak_balances.filter(bal => !moment(bal.asof).isAfter(first_traded_at));
    const initial_deposit = getAllocation(peak_initial_balances, initial_balances, options);
    const net_allocation = getAllocation(peak_balances, current_balances, options);
    const net_deposit = getNetDeposit(peak_balances, current_balances, past_positions, options);
    const settled_cash = getSettledCash(current_balances, options);
    const accrued_cash = getAccruedCash(current_balances, options);
    const total_cash = getTotalCash(current_balances, options);
    return { initial_deposit, net_deposit, net_allocation, settled_cash, accrued_cash, total_cash };
}

function getAllocation(peak_balances, balances, options) {
    const initial_balance = getBalance(balances, options);
    const peak_balance = !options.allocation_peak_pct && !options.reserve_peak_allocation ?
        initial_balance : getPeakBalance(peak_balances, options);
    const reserve_alloc = +options.reserve_allocation || 0;
    const reserve_peak_alloc = +options.reserve_peak_allocation || 0;
    const alloc_peak_pct = +options.allocation_peak_pct || 0;
    const alloc_pct = +options.allocation_pct || !reserve_alloc && 100;
    return Math.min(
        Math.max(
            Math.min(
                reserve_alloc ? initial_balance.minus(reserve_alloc) : Infinity,
                reserve_peak_alloc ? peak_balance.minus(reserve_peak_alloc) : Infinity,
                alloc_peak_pct ? peak_balance.times(alloc_peak_pct).div(100) : Infinity,
                alloc_pct ? initial_balance.times(alloc_pct).div(100) : Infinity
            ),
            options.allocation_min||0
        ),
        options.allocation_max||Infinity
    );
}

function getNetDeposit(peak_balances, balances, positions, options) {
    const portfolio = getPortfolio(options.markets, options).reduce((hash, item) => {
        const [, symbol, market] = item.match(/^(.+)\W(\w+)$/);
        (hash[symbol] = hash[symbol] || []).push(market);
        return hash;
    }, {});
    const relevant = _.isEmpty(portfolio) ? positions :
        positions.filter(pos => ~(portfolio[pos.symbol]||[]).indexOf(pos.market));
    const mtm = relevant.map(pos => Big(pos.mtm||0)).reduce((a,b) => a.add(b), Big(0));
    const balance = getAllocation(peak_balances, balances, options);
    return Math.min(Math.max(
        +Big(balance).minus(mtm),
        options.allocation_min||0), options.allocation_max||Infinity);
}

function getBalance(balances, options) {
    const cash_acct = balances.every(bal => bal.margin == null);
    const local_balances = balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    const local_balance_net = local_balances.reduce((net, bal) => net.add(bal.net), Big(0));
    const local_rate = local_balances.length ? _.last(local_balances).rate : 1;
    return cash_acct ? Big(local_balance_net) : balances.map(bal => {
        return Big(bal.net).times(bal.rate).div(local_rate);
    }).reduce((a,b) => a.add(b), Big(0));
}

function getPeakBalance(balances, options) {
    const group_by_date = balances.reduce((group, bal) => {
        const last = group.last = group[bal.asof] = group[bal.asof] || [].concat(group.last);
        const found_idx = last.findIndex(_.matcher(_.pick(bal, 'acctNumber', 'currency')));
        if (found_idx >= 0) last.splice(found_idx, 1);
        last.push(bal); // preserve the original order of balances
        return group;
    }, {last:[]});
    return _.max(Object.values(group_by_date).map(balances => getBalance(balances, options)));
}

function getSettledCash(current_balances, options) {
    const local_balances = current_balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    return +local_balances.map(bal => Big(bal.settled||0)).reduce((a,b) => a.add(b), Big(0));
}

function getAccruedCash(current_balances, options) {
    const local_balances = current_balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    return +local_balances.map(bal => Big(bal.accrued||0)).reduce((a,b) => a.add(b), Big(0));
}

function getTotalCash(balances, options) {
    const cash_acct = balances.every(bal => bal.margin == null);
    const local_balances = balances.filter(options.currency ?
        bal => bal.currency == options.currency : bal => +bal.rate == 1
    );
    const local_cash = local_balances.reduce((total, bal) => {
        return total.add(bal.settled||0).add(bal.accrued||0);
    }, Big(0));
    const local_rate = local_balances.length ? local_balances[0].rate : 1;
    const total_cash = cash_acct ? Big(local_cash) : balances.map(bal => {
        return Big(bal.settled||0).add(bal.accrued||0).times(bal.rate).div(local_rate);
    }).reduce((a,b) => a.add(b), Big(0));
    return total_cash.toString();
}

function getFirstTradedAt(positions, begin, options) {
    const portfolio = getPortfolio(options.markets, options).reduce((hash, item) => {
        const [, symbol, market] = item.match(/^(.+)\W(\w+)$/);
        (hash[symbol] = hash[symbol] || []).push(market);
        return hash;
    }, {});
    const relevant = _.isEmpty(portfolio) ? positions :
        positions.filter(pos => ~(portfolio[pos.symbol]||[]).indexOf(pos.market));
    if (!relevant.length) return options.asof;
    const initial_positions = _.flatten(_.values(_.groupBy(relevant, pos => {
        return `${pos.symbol}.${pos.market}`;
    })).map(positions => {
        return positions.reduce((earliest, pos) => {
            if (!earliest.length) return earliest.concat(pos);
            else if (pos.asof == earliest[0].asof) return earliest.concat(pos);
            else if (pos.asof < earliest[0].asof) return [pos];
            else return earliest;
        }, []);
    }));
    // check if there was an open initial position
    if (initial_positions.some(pos => pos.position != pos.quant)) return begin;
    const eod = initial_positions.reduce((earliest, pos) => {
        if (!earliest || pos.traded_at < earliest.traded_at) return pos;
        else return earliest;
    }, null).asof;
    return moment(eod).subtract(1, 'days').format();
}

function getPortfolio(markets, options, portfolio = []) {
    return [].concat(options.portfolio||[]).reduce((portfolio,item) => {
        if (item && typeof item == 'object')
            return getPortfolio(markets, item, portfolio);
        else if (typeof item == 'string' && !markets)
            return ~portfolio.indexOf(item) ? portfolio : portfolio.concat(item);
        const [, symbol, market] = (item||'').toString().match(/^(.+)\W(\w+)$/) || [];
        if (!market) throw Error(`Unknown contract syntax ${item} in portfolio ${portfolio}`);
        else if (~markets.indexOf(market) && !~portfolio.indexOf(item))
            return portfolio.concat(item);
        else
            return portfolio;
    }, portfolio);
}

function trimOptions(keys, options) {
    if (!_.isObject(options)) return options;
    const array = _.isArray(options.portfolio) ? options.portfolio :
        _.isString(options.portfolio) ? options.portfolio.split(',') :
        [options.portfolio];
    return _.extend(_.pick(options, keys), {
        portfolio: array.map(portfolio => trimOptions(keys, portfolio))
    });
}

function createCache(direct, local, remote, settings) {
    const collect_cache_size = settings.cache_size;
    if (!_.isFinite(settings.cache_size)) return null;
    const cache_dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const dir = path.resolve(cache_dir, 'collect');
    const local_tier = settings.tier || 0;
    return Cache(dir, function(options) {
        const remote_tier = remote.getWorkerTier() || 0;
        if (!local.hasWorkers() && !remote.hasWorkers()) return direct(options);
        else if (options.info=='help' || isSplitting(options)) return direct(options);
        else if (options.info=='version' && !remote.hasWorkers()) return direct(options);
        else if (options.info=='version') return Promise.all([direct(options), remote.version()]).then(_.flatten);
        else if (!remote.hasWorkers()) return local(options);
        else if (local.hasWorkers() && local_tier < remote_tier) return local(options);
        else if (!local.hasWorkers()) return remote(options);
        else if (remote.hasWorkers() && remote_tier < local_tier) return remote(options);
        else return local(options);
    }, collect_cache_size);
}

function isSplitting(options) {
    if (!options.reset_every) return false;
    const reset_every = moment.duration(options.reset_every);
    const begin = moment(options.begin);
    const end = moment(options.end || options.now);
    return begin.add(Math.abs(reset_every.asMilliseconds())*1.5, 'milliseconds').isBefore(end);
}

function isQuoting(options) {
    if (isLeaf(options)) return true;
    const expressions = _.compact(_.values(options.columns).concat(
        _.values(options.variables), options.criteria, options.filter, options.order
    ));
    const parser = new Parser({
        constant(value) {
            return null;
        },
        variable(name) {
            return null;
        },
        expression(expr, name, args) {
            if (Quoting.has(name)) return [name];
            else return _.compact(_.flatten(args));
        }
    });
    const quoting_functions = _.compact(_.flatten(parser.parseCriteriaList(expressions)));
    return quoting_functions.length;
}

function isLeaf(options) {
    if (!options.portfolio) return false;
    const portfolio = _.isArray(options.portfolio) ? options.portfolio : [options.portfolio];
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

function createLocalWorkers(program, fetch, quote, collect, settings) {
    const count = config('runInBand') || ~process.argv.indexOf('-i') || ~process.argv.indexOf('--runInBand') ? 0 :
        _.isFinite(settings.workers) ? settings.workers : WORKER_COUNT;
    return _.range(count).map(() => {
        return replyTo(config.fork(module.filename, program))
          .handle('fetch', payload => fetch(payload))
          .handle('quote', payload => quote(payload))
          .handle('collect', payload => collect(payload));
    });
}

function spawn() {
    const parent = replyTo(process).handle('collect', payload => {
        return collect()(payload);
    });
    const fetch = callFetch.bind(this, parent);
    const settings = config('quote');
    const model = new Model(fetch, options => quote(options), settings);
    const quote = new SlaveQuote(model, settings);
    const quoteFn = createSlaveQuote(quote, parent);
    const collect = _.once(() => new Collect(fetch, quoteFn, callCollect.bind(this, parent)));
    process.on('disconnect', () => collect().close().then(quote.close));
    process.on('SIGINT', () => collect().close().then(quote.close));
    process.on('SIGTERM', () => collect().close().then(quote.close));
}

function createSlaveQuote(quote, parent) {
    const check = interrupt(true);
    return function(options) {
        if (_.has(options, 'read_only') && !options.read_only)
            return parent.request('quote', options); // write requested
        if (!options.end || moment(options.end).valueOf() >= Date.now())
            return parent.request('quote', options); // latest data requested
        const opts = _.extend({read_only: true}, options);
        return quote(opts).catch(async(err) => {
            if (!err || !err.message) throw err;
            else if (!~err.message.indexOf('read_only')) throw err;
            else if (await check()) throw err;
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
        readCallSave(null, () => collect(config.options()))
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
return collect({info:'help'}).then(_.first).then(info => {
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
