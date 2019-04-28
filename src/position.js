// position.js
/*
 *  Copyright (c) 2018-2019 James Leigh, Some Rights Reserved
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

const _ = require('underscore');
const fs = require('graceful-fs');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const logger = require('./logger.js');
const expect = require('chai').expect;
const version = require('../package.json').version;
const Broker = require('./broker.js');

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
module.exports = function(collect) {
    let promiseHelp;
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(collect, Broker);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            const opts = _.defaults({
                now: moment(options.now).valueOf()
            }, _.pick(options, _.keys(_.first(help).options)));
            const broker = Broker(opts);
            return collective2(collect, broker, opts).then(ret => {
                return broker.close().then(() => ret);
            }, err => {
                return broker.close().then(() => Promise.reject(err));
            });
        });
    }, {
        close() {
            return Promise.resolve();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function help(collect, Broker) {
    return Promise.all([collect({help: true}), Broker({help: true})]).then(_.flatten)
      .then(list => list.reduce((help, delegate) => {
        return _.extend(help, {options: _.extend({}, delegate.options, help.options)});
    }, {
        name: 'position',
        usage: 'position(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ['action', 'quant', 'symbol', 'typeofsymbol', 'duration', 'limit', 'parkUntilSecs', 'parkUntilYYYYMMDDHHMM'],
        options: {
            symbols: {
                usage: '[<symbol>]',
                description: "Array of position symbols that should be closed if no desired position exists"
            },
            quant_threshold: {
                usage: '<integer>',
                description: "Minimum quantity of shares/contracts that must change to generate a signal"
            },
            quant_threshold_percent: {
                usage: '<decimal>',
                description: "Minimum quantity, relative to current position, that must change to generate a signal"
            }
        }
    })).then(help => [help]);
}

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
function collective2(collect, broker, options) {
    const check = interrupt();
    return getWorkingPositions(broker, options)
      .then(working => getDesiredPositions(collect, broker, options)
      .then(desired => {
        const symbols = _.uniq(_.compact(_.keys(desired).concat(options.symbols)));
        _.forEach(working, (w, symbol) => {
            if (!desired[symbol] && w.quant_opened != w.quant_closed && !~symbols.indexOf(symbol)) {
                logger.warn("Unknown", w.long_or_short, "position",
                    w.quant_opened - w.quant_closed, w.symbol, w.symbol_description || '');
            }
        });
        return symbols.reduce((signals, symbol) => {
            const d = desired[symbol] || {
                symbol: symbol,
                quant_opened:0,
                quant_closed:0
            };
            const w = working[symbol] || {
                symbol: symbol,
                instrument: d.instrument,
                quant_opened:0,
                quant_closed:0
            };
            const quant_threshold = getQuantThreshold(w, options);
            const update = updateWorking(d, w, _.defaults({quant_threshold}, options));
            if (update.length)
                logger.debug("collective2", "desired", symbol, JSON.stringify(desired[symbol]));
            return signals.concat(update);
        }, []);
    })).then(signals => signals.reduce((promise, signal) => promise.then(async(result) => {
        await check();
        if (signal && signal.action) return broker(signal);
        else if (_.isString(signal)) return broker({action: 'cancelSignal', signalid: signal});
        else throw Error("Unknown signal: " + JSON.stringify(signal));
    }).then(signal => {
        const log = s => {
            const type = +s.isStopOrder ? '@STOP ' + s.isStopOrder :
                +s.isLimitOrder || +s.islimit ? '@LIMIT ' + (+s.isLimitOrder || +s.islimit) : '@MARKET';
            const tif = s.duration || s.tif || (+s.gtc ? 'GTC' : +s.day ? 'DAY' : '')
            logger.info(s.action, s.quant, s.symbol || '', type, tif, s.signalid || '', s.description || '');
        }
        if (signal.conditionalUponSignal) {
            log(signal.conditionalUponSignal);
            log(signal);
            const conditionalupon = signal.conditionalUponSignal.signalid;
            const flat = _.extend({conditionalupon}, _.omit(signal, 'conditionalUponSignal'));
            return promise.then(ar => ar.concat(_.compact([signal.conditionalUponSignal, flat])));
        } else if (signal.action) {
            log(signal);
            return promise.then(ar => ar.concat(signal));
        } else {
            return promise.then(ar => ar.concat(signal));
        }
    }), Promise.resolve([])));
}

/**
 * Collects the options results and converts the signals into positions
 */
function getDesiredPositions(collect, broker, options) {
    return broker({action: 'requestMarginEquity'})
      .then(requestMarginEquity => broker({action:'retrieveSystemEquity'})
      .then(retrieveSystemEquity => {
        const unix_timestamp = moment(options.begin).format('X');
        const idx = _.sortedIndex(retrieveSystemEquity, {unix_timestamp}, 'unix_timestamp');
        return retrieveSystemEquity[idx];
    }).then(systemEquity => collect(merge(options, {
        parameters: _.pick(requestMarginEquity, 'buyPower', 'marginUsed', 'modelAccountValue' , 'cash')
    }, {
        parameters: _.pick(systemEquity, 'strategy_with_cost', 'strategy_raw')
    })).then(signals => {
        return signals.reduce((positions, signal) => {
            const symbol = signal.c2_symbol || signal.symbol;
            const instrument = signal.typeofsymbol;
            const prior = positions[symbol] || {symbol, instrument, quant_opened:0, quant_closed:0};
            return _.defaults({
                [symbol]: advance(prior, signal, options)
            }, positions);
        }, {});
    })));
}

/**
 * Retrieves the open positions and working signals from collective2
 */
function getWorkingPositions(broker, options) {
    return broker({action: 'retrieveSignalsWorking'})
      .then(retrieveSignalsWorking => broker({action: 'requestTrades'})
      .then(requestTrades => {
        expect(retrieveSignalsWorking).to.be.an('array');
        expect(requestTrades).to.be.an('array');
        const positions = requestTrades.reduce((positions, pos) => {
            const dup = positions[pos.symbol];
            if (dup && dup.quant_closed != dup.quant_opened && pos.quant_closed != pos.quant_opened)
                throw Error("Two open positions for the same symbol found: " + JSON.stringify(dup) + JSON.stringify(pos));
            else if (!dup || pos.quant_closed != pos.quant_opened)
                return _.defaults({[pos.symbol]: pos}, positions);
            else if (dup.quant_closed != dup.quant_opened || dup.closedWhen > pos.closedWhen)
                return positions;
            else
                return _.defaults({[pos.symbol]: pos}, positions);
        }, {});
        const working = _.groupBy(retrieveSignalsWorking, 'symbol');
        return _.reduce(working, (positions, signals, symbol) => signals.sort((a,b) => {
            return sortSignals(positions[symbol], a, b);
        }).reduce((positions, signal) => {
            const instrument = signal.typeofsymbol;
            const prior = positions[symbol] || {symbol, instrument, quant_opened:0, quant_closed:0};
            return _.defaults({
                [symbol]: advance(prior, signal, options)
            }, positions);
        }, positions), positions);
    }));
}

/**
 * Converts quant_threshold_percent into quant_threshold relative to open position size
 */
function getQuantThreshold(working, options) {
    if (!options.quant_threshold_percent) return options.quant_threshold || 0;
    if (working.prior) return getQuantThreshold(working.prior, options);
    const opened = working.quant_opened - working.quant_closed;
    const threshold = Math.floor(opened * options.quant_threshold_percent /100);
    if (!threshold) return options.quant_threshold || 0;
    else if (!options.quant_threshold) return threshold;
    else return Math.min(threshold, options.quant_threshold);
}

/**
 * Array of signals to update the working positions to the desired positions
 */
function updateWorking(desired, working, options) {
    const ds = desired.signal;
    const ws = working.signal;
    const d_opened = desired.quant_opened - desired.quant_closed;
    const w_opened = working.quant_opened - working.quant_closed;
    const within = Math.abs(d_opened - w_opened) <= (options.quant_threshold || 0);
    const same_side = desired.long_or_short == working.long_or_short;
    const ds_projected = ds && +ds.parkUntilSecs * 1000 > options.now;
    if (_.has(ds, 'parkUntilSecs') && !working.prior && +working.closedWhenUnixTimeStamp > +ds.parkUntilSecs) {
        // working position has since been closed (stoploss) since the last desired signal was produced
        logger.warn(`Working ${desired.symbol} position has since been closed`);
        return [];
    } else if (!d_opened && !w_opened && !working.prior && !desired.prior) {
        // no open position
        return [];
    } else if (within && !working.prior && same_side && desired.prior && +ds.isStopOrder) {
        // advance working state
        const adj = updateWorking(desired.prior, working, options);
        return appendSignal(adj, _.defaults({
            // adjust stoploss quant if first signal
            quant: _.isEmpty(adj) && d_opened == ds.quant ? w_opened : ds.quant
        }, ds), options);
    } else if (within && !working.prior && same_side) {
        // positions are (nearly) the same
        return [];
    } else if (d_opened == w_opened && working.prior && !desired.prior && same_side) {
        // cancel working signals
        return cancelSignal(desired, working, options);
    } else if (desired.prior && !working.prior) {
        // advance working state
        const adj = updateWorking(desired.prior, working, options);
        return appendSignal(adj, _.defaults({
            // adjust quant if first signal
            quant: _.isEmpty(adj.filter(a=>!+a.isStopOrder)) && Math.abs(d_opened - w_opened) || ds.quant
        }, ds), options);
    } else if (working.prior && !desired.prior) {
        // cancel working signal
        expect(ws).to.have.property('signal_id');
        return cancelSignal(desired, working, options);
    } else if (desired.prior && working.prior) {
        if (sameSignal(ds, ws, options.quant_threshold)) {
            // don't change this signal
            return updateWorking(desired.prior, working.prior, options);
        } else if (+ds.isStopOrder && +ws.isStopOrder && sameSignal(ds, ws, options.quant_threshold)) {
            // signals are both stoploss orders and within quant_threshold
            return updateWorking(desired.prior, working.prior, options);
        } else if (+ds.isStopOrder && +ws.isStopOrder && ds_projected) {
            // signals are both stoploss orders, but the desired stoploss has not come into effect yet
            return updateWorking(desired.prior, working.prior, options);
        } else if (+ds.isStopOrder && !+ws.isStopOrder && ds_projected) {
            // desired signal is stoploss order, but has not come into effect yet
            return updateWorking(desired.prior, working, options);
        } else if (similarSignals(ds, ws)) {
            // update quant
            expect(ws).to.have.property('signal_id');
            const adj = updateWorking(desired.prior, working.prior, options);
            return appendSignal(adj, _.defaults({
                xreplace: ws.signal_id,
                quant: d_opened == w_opened ? ws.quant : ds.quant
            }, ds), options);
        } else if (d_opened != w_opened && same_side) {
            return cancelSignal(desired, working, options);
        } else {
            // cancel and submit
            const upon = cancelSignal(desired.prior, working, options);
            const cond = !_.isEmpty(upon) || +ws.isStopOrder || ws.conditionalupon ? ds : _.extend({
                conditionalupon: ws.signal_id
            }, ds);
            // check if there are too many chained conditions
            if (cond.conditionalupon && working.prior && working.prior.prior) return upon;
            else return appendSignal(upon, cond, options);
        }
    } else if (d_opened && w_opened && desired.long_or_short != working.long_or_short) {
        // reverse position
        return [c2signal({
            action: desired.long_or_short=='short' ? 'STO' : 'BTO',
            quant: d_opened,
            symbol: desired.symbol,
            typeofsymbol: desired.instrument,
            market: desired.limit ? 0 : 1,
            limit: desired.limit,
            duration: 'DAY',
            conditionalUponSignal: c2signal({
                action: working.long_or_short=='short' ? 'BTC' : 'STC',
                quant: w_opened,
                symbol: working.symbol,
                typeofsymbol: working.instrument,
                market: desired.limit ? 0 : 1,
                limit: desired.limit,
                duration: 'DAY'
            })
        })];
    } else if (d_opened < w_opened) {
        // reduce position
        return [c2signal({
            action: working.long_or_short=='short' ? 'BTC' : 'STC',
            quant: w_opened - d_opened,
            symbol: working.symbol,
            typeofsymbol: working.instrument,
            market: desired.limit ? 0 : 1,
            limit: desired.limit,
            duration: 'DAY'
        })];
    } else {
        // increase position
        return [c2signal({
            action: desired.long_or_short=='short' ? 'STO' : 'BTO',
            quant: d_opened - w_opened,
            symbol: desired.symbol,
            typeofsymbol: desired.instrument,
            market: desired.limit ? 0 : 1,
            limit: desired.limit,
            duration: 'DAY'
        })];
    }
}

/**
 * Checks if the two signals appear to be the same
 */
function sameSignal(a, b, threshold) {
    if (!a || !b) return false;
    const attrs = ['action', 'isLimitOrder', 'strike', 'isStopOrder', 'isMarketOrder', 'tif', 'expiration', 'putcall', 'duration', 'stop', 'market', 'profittarget', 'stoploss'];
    return _.matcher(_.pick(a, attrs))(b) && Math.abs(a.quant - b.quant) <= (threshold || 0);
}

/**
 * Cancels the latest working signal iff it would not be re-submitted
 */
function cancelSignal(desired, working, options) {
    const ws = working.signal;
    expect(ws).to.have.property('signal_id');
    const adj = updateWorking(desired, working.prior, options);
    // check if cancelling order is the same of submitting order
    const same = _.find(adj, a => sameSignal(a, ws));
    const same_cond = _.find(adj, a => sameSignal(a.conditionalUponSignal, ws));
    const similar = _.find(adj, a => !a.xreplace && similarSignals(a, ws));
    if (same)
        return _.without(adj, same);
    else if (same_cond)
        return _.map(adj, a => a == same_cond ? _.omit(a, 'conditionalUponSignal') : a);
    else if (similar)
        return adj.map(a => a == similar ? _.extend({xreplace: ws.signal_id}, a) : a);
    else if (+ws.isStopOrder && !_.every(adj, a => !(+a.parkUntilSecs * 1000 > options.now)))
        return adj; // don't cancel stoploss order until replacements orders come into effect
    else
        return [ws.signal_id].concat(adj);
}

/**
 * Adds ds to the upon array use another signal as a conditionalupon and avoiding double conditionals
 */
function appendSignal(upon, ds, options) {
    expect(ds).not.to.have.property('conditionalUponSignal');
    const adv = upon.find(s => _.isObject(s));
    if (upon.some(s => s.conditionalupon || s.conditionalUponSignal || +s.stoploss || +s.profittarget || s.xreplace))
        return upon; // Double conditionals not permitted
    else if (!adv)
        return upon.concat(ds);
    else if (adv && +ds.isStopOrder && isOpenAndClose(adv, ds, options))
        return _.without(upon, adv).concat(_.extend({stoploss: ds.isStopOrder}, adv));
    else if (+adv.isStopOrder)
        return _.without(upon, adv).concat(ds);
    else
        return _.without(upon, adv).concat(_.extend({conditionalUponSignal: adv}, ds));
}

/**
 * If two signals have the same order type, but may different on quant
 */
function similarSignals(a, b) {
    if (!a || !b) return false;
    return a.action == b.action &&
        !!+a.isStopOrder == !!+b.isStopOrder &&
        !!+a.isLimitOrder == !!+b.isLimitOrder;
}

/**
 * If the open signal is opening and the close signal closes the same quant
 */
function isOpenAndClose(open, close, options) {
    return open.quant == close.quant && !+open.stoploss &&
        (open.parkUntilSecs == close.parkUntilSecs ||
            !(+open.parkUntilSecs * 1000 >= options.now) &&
            !(+close.parkUntilSects * 1000 >= options.now)) &&
        (open.action == 'BTO' || open.action == 'STO') &&
        (close.action == 'STC' || close.action == 'BTC');
}

/**
 * Position after applying the given signal
 */
function advance(pos, signal, options) {
    const position = updateStoploss(pos, signal, options);
    if (!signal.limit) return position;
    // record limit for use with adjustements
    else return _.extend({}, position, {limit: signal.limit});
}

function updateStoploss(pos, signal, options) {
    if (signal.quant === 0 && signal.parkUntilSecs && +signal.parkUntilSecs * 1000 > options.now) {
        return pos; // don't update signal limits if in the future
    } else if (signal.stoploss) {
        const base = !+signal.quant && pos.prior && +pos.signal.isStopOrder ? pos.prior : pos;
        const prior = advance(base, _.omit(signal, 'stop', 'stoploss'), options);
        const stoploss = +signal.isStopOrder || +signal.stoploss || +signal.stop;
        const quant = +prior.signal.quant;
        expect(prior).to.have.property('long_or_short').that.is.oneOf(['long', 'short']);
        const stopSignal = _.omit(_.extend(_.pick(c2signal(signal), 'typeofsymbol', 'symbol', 'parkUntilSecs'), {
            action: prior.long_or_short == 'long' ? 'STC' : 'BTC',
            quant: quant,
            duration: 'GTC',
            stop: stoploss,
            isStopOrder: stoploss
        }), _.isUndefined);
        return _.defaults({stoploss, signal: stopSignal, prior}, prior);
    } else if (+signal.isStopOrder || signal.stop) {
        const stoploss = +signal.isStopOrder || signal.stoploss || signal.stop;
        const prior = pos.prior && +pos.signal.isStopOrder ? pos.prior : pos;
        return _.defaults({stoploss, signal: c2signal(signal), prior}, pos);
    } else {
        return updatePosition(pos, signal, options);
    }
}

/**
 * Position after applying the given signal
 */
function updatePosition(pos, signal, options) {
    if (+signal.quant > 0) {
        return changePosition(pos, signal, options);
    } else {
        return updateParkUntilSecs(pos, signal, options);
    }
}

/**
 * Position after applying the given signal parkUntilSecs and limit
 */
function updateParkUntilSecs(pos, signal, options) {
    if (signal.parkUntilSecs && pos.signal) {
        expect(signal).to.have.property('action').that.is.oneOf(['BTO', 'STO']);
        const updated = _.defaults({signal: _.defaults(_.pick(signal, 'parkUntilSecs'), pos.signal)}, pos);
        return updateLimit(updated, signal, options);
    } else {
        return updateLimit(pos, signal, options);
    }
}

/**
 * Position after applying the given signal limit
 */
function updateLimit(pos, signal, options) {
    if (signal.limit && pos.signal) {
        return _.defaults({signal: _.defaults(_.pick(signal, 'limit'), pos.signal)}, pos);
    } else {
        return pos;
    }
}

/**
 * Position after applying the given signal to change the position size
 */
function changePosition(pos, signal, options) {
    expect(signal).has.property('quant').that.is.above(0);
    const effective = (signal.parkUntilSecs || signal.posted_time_unix || Infinity) * 1000;
    const prior = signal.status == 'working' || effective > options.now ? {prior: pos} : {};
    if (signal.action == 'BTCBTO') {
        const short = changePositionSize(pos, _.defaults({
            action:'BTC',
            quant: pos.quant_opened - pos.quant_closed
        }, signal), options);
        const long = changePositionSize({quant_opened:0,quant_closed:0}, _.defaults({
            action:'BTO',
            quant: pos.quant_closed - pos.quant_opened + +signal.quant
        }, signal), options);
        return _.isEmpty(prior) ? long : _.extend(long, {prior: _.extend(short, prior)});
    } else if (signal.action == 'STCSTO') {
        const long = changePositionSize(pos, _.defaults({
            action:'STC',
            quant: pos.quant_opened - pos.quant_closed
        }, signal), options);
        const short = changePositionSize({quant_opened:0,quant_closed:0}, _.defaults({
            action:'STO',
            quant: pos.quant_closed - pos.quant_opened + signal.quant
        }, signal), options);
        return _.isEmpty(prior) ? short : _.extend(short, {prior: _.extend(long, prior)});
    } else {
        return _.extend(prior, changePositionSize(pos, signal, options));
    }
}

/**
 * Position after changing the position size
 */
function changePositionSize(pos, signal, options) {
    expect(signal).has.property('quant').that.is.above(0);
    const parkUntilSecs = signal.parkUntilSecs || signal.posted_time_unix;
    const m_when = parkUntilSecs ? moment.tz(parkUntilSecs, 'X', 'America/New_York') :
        moment(options.now).tz('America/New_York');
    if (!m_when.isValid()) throw Error("Invalid posted date: " + JSON.stringify(signal));
    const when = m_when.format('YYYY-MM-DD HH:mm:ss');
    if (signal.action == 'BTO') {
        return {
            symbol: signal.c2_symbol || signal.symbol,
            instrument: signal.typeofsymbol || signal.instrument,
            long_or_short: 'long',
            quant_opened: +pos.quant_opened + +signal.quant,
            quant_closed: pos.quant_closed,
            openedWhen: pos.long_or_short == 'long' ? pos.openedWhen : when,
            closedWhen: '',
            signal: c2signal(signal)
        };
    } else if (signal.action == 'STC') {
        expect(pos).to.have.property('long_or_short', 'long');
        return {
            symbol: signal.c2_symbol || signal.symbol,
            instrument: signal.typeofsymbol || signal.instrument,
            long_or_short: 'long',
            quant_opened: pos.quant_opened,
            quant_closed: +pos.quant_closed + +signal.quant,
            openedWhen: pos.openedWhen,
            closedWhen: pos.quant_opened == pos.quant_closed + signal.quant ? when : "",
            signal: c2signal(signal)
        };
    } else if (signal.action == 'STO') {
        return {
            symbol: signal.c2_symbol || signal.symbol,
            instrument: signal.typeofsymbol || signal.instrument,
            long_or_short: 'short',
            quant_opened: +pos.quant_opened + +signal.quant,
            quant_closed: pos.quant_closed,
            openedWhen: pos.long_or_short == 'short' ? pos.openedWhen : when,
            closedWhen: "",
            signal: c2signal(signal)
        };
    } else if (signal.action == 'BTC') {
        expect(pos).to.have.property('long_or_short', 'short');
        return {
            symbol: signal.c2_symbol || signal.symbol,
            instrument: signal.typeofsymbol || signal.instrument,
            long_or_short: 'short',
            quant_opened: pos.quant_opened,
            quant_closed: +pos.quant_closed + +signal.quant,
            openedWhen: pos.openedWhen,
            closedWhen: pos.quant_opened == pos.quant_closed + signal.quant ? when : "",
            signal: c2signal(signal)
        };
    } else {
        throw Error("Unknown signal action: " + signal.action);
    }
}

/**
 * Converts the signal into collective2 scheme
 */
function c2signal(signal) {
    const parameters = [
        'action', 'typeofsymbol', 'duration', 'stop', 'limit', 'market', 'profittarget',
        'stoploss', 'conditionalupon', 'conditionalUponSignal', 'xreplace',
        'isLimitOrder', 'strike', 'status', 'name', 'isStopOrder', 'instrument',
        'posted_time_unix', 'underlying', 'isMarketOrder', 'tif', 'putcall',
        'expiration', 'quant', 'signal_id', 'posted_time', 'signalid', 'comments',
        'day', 'systemid', 'parkUntilYYYYMMDDHHMM', 'conditionalupon', 'targetocagroupid',
        'decimalprecision', 'expiresat', 'pointvalue', 'parkUntilSecs', 'currency',
        'quant', 'gtc', 'ocaid', 'localsignalid', 'symbol_description', 'description',
        'pointvalue'
    ];
    return _.omit(_.extend(_.pick(signal, parameters), {
        symbol: signal.c2_symbol || signal.symbol,
        tif: signal.tif || signal.duration,
        duration: signal.duration || signal.tif,
        stop: +signal.stop || +signal.isStopOrder,
        isStopOrder: +signal.isStopOrder || +signal.stop,
        isLimitOrder: +signal.isLimitOrder || +signal.limit,
        limit: +signal.limit || +signal.isLimitOrder,
        quant: +signal.quant
    }), v => !v || v == '0');
}

/**
 * Sorts the signals into chronological order
 */
function sortSignals(position, a, b) {
    // increase position size
    if (position) {
        if (position.long_or_short == 'long' && a.action == 'BTO' && b.action != 'BTO') return -1;
        if (position.long_or_short == 'long' && a.action != 'BTO' && b.action == 'BTO') return 1;
        if (position.long_or_short == 'short' && a.action == 'STO' && b.action != 'STO') return -1;
        if (position.long_or_short == 'short' && a.action != 'STO' && b.action == 'STO') return 1;
        // reducing position size or profit target or stoploss
        if (position.long_or_short == 'long' && a.action == 'STC' && b.action != 'STC') return -1;
        if (position.long_or_short == 'long' && a.action != 'STC' && b.action == 'STC') return 1;
        if (position.long_or_short == 'short' && a.action == 'BTC' && b.action != 'BTC') return -1;
        if (position.long_or_short == 'short' && a.action != 'BTC' && b.action == 'BTC') return 1;
        // reversed position
        if (position.long_or_short == 'long' && a.action == 'STO' && b.action != 'STO') return -1;
        if (position.long_or_short == 'long' && a.action != 'STO' && b.action == 'STO') return 1;
        if (position.long_or_short == 'short' && a.action == 'BTO' && b.action != 'BTO') return -1;
        if (position.long_or_short == 'short' && a.action != 'BTO' && b.action == 'BTO') return 1;
        // reversed position's profit target or stoploss
        if (position.long_or_short == 'long' && a.action == 'STC' && b.action != 'STC') return -1;
        if (position.long_or_short == 'long' && a.action != 'STC' && b.action == 'STC') return 1;
        if (position.long_or_short == 'short' && a.action == 'BTC' && b.action != 'BTC') return -1;
        if (position.long_or_short == 'short' && a.action != 'BTC' && b.action == 'BTC') return 1;
        // stoploss before closing order
        if (+a.isStopOrder && !+b.isStopOrder && a.action == b.action) return -1;
        if (!+a.isStopOrder && +b.isStopOrder && a.action == b.action) return 1;
    }
    // keep stoploss at the end as it would likely be the first to be cancelled
    if (!+a.isStopOrder && +b.isStopOrder) return -1;
    if (+a.isStopOrder && !+b.isStopOrder) return 1;
    // parkUntilSecs is not available at this time
    if (a.parkUntilSecs && !b.parkUntilSecs) return -1;
    if (!a.parkUntilSecs && b.parkUntilSecs) return 1;
    if (a.parkUntilSecs && b.parkUntilSecs && a.parkUntilSecs != b.parkUntilSecs)
        return a.parkUntilSecs - b.parkUntilSecs;
    // posted order
    if (a.posted_time_unix && !b.posted_time_unix) return -1;
    if (!a.posted_time_unix && b.posted_time_unix) return 1;
    if (a.posted_time_unix && b.posted_time_unix && a.posted_time_unix != b.posted_time_unix)
        return a.posted_time_unix - b.posted_time_unix;
    // should be similar to posted order, but accurate to less than 1s
    if (a.signal_id && b.signal_id)
        return a.signal_id - b.signal_id;
    // fallback for stable sorting, should not happen with live data
    if (_.isEqual(a, b)) return 0;
    else return JSON.stringify(a).length - JSON.stringify(b).length;
}
