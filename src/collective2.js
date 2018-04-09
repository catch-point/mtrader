// collective2.js
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

const _ = require('underscore');
const fs = require('fs');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const config = require('./config.js');
const logger = require('./logger.js');
const expect = require('chai').expect;
const version = require('../package.json').version;

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
module.exports = function(collect) {
    var promiseHelp;
    var agent = new https.Agent({
        keepAlive: config('collective2.keepAlive') || false,
        keepAliveMsecs: config('collective2.keepAliveMsecs') || 1000,
        maxSockets: config('collective2.maxSockets'),
        maxFreeSockets: config('collective2.maxFreeSockets') || 256,
        ciphers: config('tls.ciphers'),
        honorCipherOrder: config('tls.honorCipherOrder'),
        ecdhCurve: config('tls.ecdhCurve'),
        secureProtocol: config('tls.secureProtocol'),
        secureOptions: config('tls.secureOptions'),
        handshakeTimeout: config('tls.handshakeTimeout'),
        requestCert: config('tls.requestCert'),
        rejectUnauthorized: config('tls.rejectUnauthorized'),
        NPNProtocols: config('tls.NPNProtocols'),
        ALPNProtocols: config('tls.ALPNProtocols')
    });
    var settings = _.extend({offline: config('offline')}, config('collective2'));
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(collect);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.defaults({
                now: moment.tz(options.now || Date.now(), options.tz).valueOf()
            }, _.pick(options, _.keys(_.first(help).options)), {
                tz: moment.tz.guess()
            });
            return collective2(collect, agent, settings, opts);
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
function help(bestsignals) {
    return bestsignals({help: true}).then(_.first).then(help => {
        return [{
            name: 'collective2',
            usage: 'collective2(options)',
            description: "Changes workers orders to align with signal orders in result",
            properties: ["systemid", "parkUntilSecs", "symbol", "duration", "typeofsymbol", "currency", "quant", "limit", "action"],
            options: _.extend({}, help.options, {
                systemid: {
                    usage: '<integer>',
                    description: "The Collective2 system identifier"
                },
                symbols: {
                    usage: '[<symbol>]',
                    description: "Array of position symbols that should be closed if no desired position exists"
                }
            })
        }];
    });
}

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
function collective2(collect, agent, settings, options) {
    return getDesiredPositions(collect, agent, settings, options)
      .then(desired => getWorkingPositions(agent, settings, options)
      .then(working => {
        var symbols = _.uniq(_.keys(desired).concat(options.symbols));
        _.forEach(working, (w, symbol) => {
            if (!desired[symbol] && w.quant_opened != w.quant_closed && !~symbols.indexOf(symbol)) {
                logger.warn("Unknown", w.long_or_short, "position",
                    w.quant_opened - w.quant_closed, w.symbol, w.symbol_description || '');
            }
        });
        return symbols.reduce((signals, symbol) => {
            var d = desired[symbol] || {
                symbol: symbol,
                quant_opened:0,
                quant_closed:0
            };
            var w = working[symbol] || {
                symbol: symbol,
                instrument: d.instrument,
                quant_opened:0,
                quant_closed:0
            };
            var update = updateWorking(d, w);
            if (update.length)
                logger.trace("collective2", "desired", symbol, JSON.stringify(desired[symbol]));
            return signals.concat(update);
        }, []);
    })).then(signals => signals.reduce((promise, signal) => promise.then(result => {
        if (signal && signal.action) return submit(agent, 'submitSignal', {
            apikey: settings.apikey,
            systemid: options.systemid,
            signal: signal
        }, settings, options);
        else if (_.isString(signal)) return submit(agent, 'cancelSignal', {
            apikey: settings.apikey,
            systemid: options.systemid,
            signalid: signal
        }, settings, options);
        else throw Error("Unknown signal: " + JSON.stringify(signal));
    }).then(res => {
        var log = s => {
            var type = +s.isStopOrder ? '@STOP ' + s.isStopOrder :
                +s.isLimitOrder || +s.islimit ? '@LIMIT ' + (+s.isLimitOrder || +s.islimit) : '@MARKET';
            var tif = s.duration || s.tif || (+s.gtc ? 'GTC' : +s.day ? 'DAY' : '')
            logger.info(s.action, s.quant, s.symbol || '', type, tif, s.signalid || '', s.description || '');
        }
        if (res.signal.conditionalUponSignal) {
            log(res.signal.conditionalUponSignal);
            log(res.signal);
            var conditionalupon = res.signal.conditionalUponSignal.signalid;
            var flat = _.extend({conditionalupon}, _.omit(res.signal, 'conditionalUponSignal'));
            return promise.then(ar => ar.concat(_.compact([res.signal.conditionalUponSignal, flat])));
        } else if (res.signal.action) {
            log(res.signal);
            return promise.then(ar => ar.concat(res.signal));
        } else {
            return promise.then(ar => ar.concat(res.signal));
        }
    }), Promise.resolve([])));
}

/**
 * Collects the options results and converts the signals into positions
 */
function getDesiredPositions(collect, agent, settings, options) {
    return retrieve(agent, 'requestMarginEquity', settings, options)
      .then(requestMarginEquity => retrieve(agent, 'retrieveSystemEquity', settings, options)
      .then(retrieveSystemEquity => {
        var unix_timestamp = moment.tz(options.begin, options.tz).format('X');
        var idx = _.sortedIndex(retrieveSystemEquity.equity_data, {unix_timestamp}, 'unix_timestamp');
        return retrieveSystemEquity.equity_data[Math.max(idx-1, 0)];
    }).then(systemEquity => collect(merge(options, {
        parameters: _.pick(requestMarginEquity, 'buyPower', 'marginUsed', 'modelAccountValue' , 'cash')
    }, {
        parameters: _.pick(systemEquity, 'strategy_with_cost', 'strategy_raw')
    })).then(signals => {
        return signals.reduce((positions, signal) => {
            var symbol = signal.c2_symbol || signal.symbol;
            var instrument = signal.typeofsymbol;
            var prior = positions[symbol] || {symbol, instrument, quant_opened:0, quant_closed:0};
            return _.defaults({
                [symbol]: advance(prior, signal, options)
            }, positions);
        }, {});
    })));
}

/**
 * Retrieves the open positions and working signals from collective2
 */
function getWorkingPositions(agent, settings, options) {
    return retrieve(agent, 'retrieveSignalsWorking', settings, options)
      .then(retrieveSignalsWorking => retrieve(agent, 'requestTrades', settings, options)
      .then(requestTrades => {
        expect(retrieveSignalsWorking).to.have.property('response').that.is.an('array');
        expect(requestTrades).to.have.property('response').that.is.an('array');
        var positions = requestTrades.response.reduce((positions, pos) => {
            var dup = positions[pos.symbol];
            if (dup && dup.quant_closed != dup.quant_opened && pos.quant_closed != pos.quant_opened)
                throw Error("Two open positions for the same symbol found: " + JSON.stringify(dup) + JSON.stringify(pos));
            else if (dup && dup.quant_closed != dup.quant_opened)
                return positions;
            else
                return _.defaults({[pos.symbol]: pos}, positions);
        }, {});
        var working = _.groupBy(retrieveSignalsWorking.response, 'symbol');
        return _.reduce(working, (positions, signals, symbol) => signals.sort((a,b) => {
            return sortSignals(positions[symbol], a, b);
        }).reduce((positions, signal) => {
            var instrument = signal.typeofsymbol;
            var prior = positions[symbol] || {symbol, instrument, quant_opened:0, quant_closed:0};
            return _.defaults({
                [symbol]: advance(prior, signal, options)
            }, positions);
        }, positions), positions);
    }));
}

/**
 * Array of signals to update the working positions to the desired positions
 */
function updateWorking(desired, working) {
    var attrs = ['action', 'isLimitOrder', 'strike', 'isStopOrder', 'isMarketOrder', 'tif', 'expiration', 'putcall', 'duration', 'stop', 'market', 'profittarget', 'stoploss'];
    var d_opened = desired.quant_opened - desired.quant_closed;
    var w_opened = working.quant_opened - working.quant_closed;
    if (_.has(desired.signal, 'parkUntilSecs') && +working.closedWhenUnixTimeStamp > +desired.signal.parkUntilSecs) {
        // working position has since been closed (stoploss) since the last desired signal was produced
        return [];
    } else if (d_opened == w_opened && (!w_opened || desired.long_or_short == working.long_or_short)) {
        // they are or will align soon
        if (!working.prior || !desired.prior) return [];
        else if (_.matcher(_.pick(desired.signal, attrs))(working.signal)) return [];
        // update working limit, stoploss, or parkUntil to desired
        else if (desired.signal.action == working.signal.action) return [_.defaults({
            quant: working.signal.quant,
            action: working.signal.action,
            xreplace: working.signal.signal_id
        }, desired.signal, working.signal)];
        // cancel working signal
        else return [working.signal.signal_id].concat(updateWorking(desired, working.prior));
    } else if (desired.prior && !working.prior) {
        // advance working state
        var sig = desired.signal;
        expect(sig).not.to.have.property('conditionalUponSignal');
        var upon = updateWorking(desired.prior, working);
        var creating = upon.filter(s => _.isObject(s) && !s.xreplace);
        var adv = creating.length == 1 && creating[0];
        if (upon.some(s => s.conditionalupon || s.conditionalUponSignal || +s.stoploss || +s.profittarget) || creating.length>1)
            return upon; // Double conditionals not permitted
        else if (creating.length>1)
            return upon;
        else if (!adv && working.signal && working.signal.status == 'working')
            return upon.concat(_.extend({conditionalupon: working.signal.signal_id}, sig));
        else if (!adv)
            return upon.concat(sig);
        else if (adv && +sig.isStopOrder && isOpenAndClose(adv, sig))
            return _.without(upon, adv).concat(_.extend({stoploss: sig.isStopOrder}, adv));
        else if (adv && +sig.isLimitOrder && isOpenAndClose(adv, sig))
            return _.without(upon, adv).concat(_.extend({profittarget: sig.isLimitOrder}, adv));
        else
            return _.without(upon, adv).concat(_.extend({conditionalUponSignal: adv}, sig));
    } else if (working.prior && !desired.prior) {
        // cancel working signal
        return [working.signal.signal_id].concat(updateWorking(desired, working.prior));
    } else if (desired.prior && working.prior && desired.signal.action == working.signal.action) {
        // update quant
        return updateWorking(desired.prior, working.prior).concat(_.defaults({
            xreplace: working.signal.signal_id
        }, desired.signal));
    } else if (desired.prior && working.prior) {
        // cancel and submit
        return [working.signal.signal_id]
            .concat(updateWorking(desired.prior, working.prior), desired.signal);
    } else if (d_opened && w_opened && desired.long_or_short != working.long_or_short) {
        // reverse position
        return [{
            action: desired.long_or_short=='short' ? 'STO' : 'BTO',
            quant: d_opened,
            symbol: desired.symbol,
            typeofsymbol: desired.instrument,
            market: 1,
            duration: 'DAY',
            conditionalUponSignal: {
                action: working.long_or_short=='short' ? 'BTC' : 'STC',
                quant: w_opened,
                symbol: working.symbol,
                typeofsymbol: working.instrument,
                market: 1,
                duration: 'DAY'
            }
        }];
    } else if (d_opened < w_opened) {
        // reduce position
        return [{
            action: working.long_or_short=='short' ? 'BTC' : 'STC',
            quant: w_opened - d_opened,
            symbol: working.symbol,
            typeofsymbol: working.instrument,
            market: 1,
            duration: 'DAY'
        }];
    } else {
        // increase position
        return [{
            action: desired.long_or_short=='short' ? 'STO' : 'BTO',
            quant: d_opened - w_opened,
            symbol: desired.symbol,
            typeofsymbol: desired.instrument,
            market: 1,
            duration: 'DAY'
        }];
    }
}

/**
 * If the open signal is opening and the close signal closes the same quant
 */
function isOpenAndClose(open, close) {
    return open.quant == close.quant && !+open.stoploss &&
        open.parkUntilSecs == close.parkUntilSecs &&
        (open.action == 'BTO' || open.action == 'STO') &&
        (close.action == 'STC' || close.action == 'BTC');
}

/**
 * Position after applying the given signal
 */
function advance(pos, signal, options) {
    if (signal.stoploss) {
        var base = !+signal.quant && pos.prior && +pos.signal.isStopOrder ? pos.prior : pos;
        var prior = updatePosition(base, _.omit(signal, 'stop', 'stoploss'), options);
        var stoploss = +signal.isStopOrder || +signal.stoploss || +signal.stop;
        var quant = +prior.signal.quant;
        expect(prior).to.have.property('long_or_short').that.is.oneOf(['long', 'short']);
        var stopSignal = _.omit(_.extend(_.pick(c2signal(signal), 'typeofsymbol', 'symbol', 'parkUntilSecs'), {
            action: prior.long_or_short == 'long' ? 'STC' : 'BTC',
            quant: quant,
            duration: 'GTC',
            stop: stoploss,
            isStopOrder: stoploss
        }), _.isUndefined);
        return _.defaults({stoploss, signal: stopSignal, prior}, prior);
    } else if (+signal.isStopOrder || signal.stop) {
        var stoploss = +signal.isStopOrder || signal.stoploss || signal.stop;
        var prior = pos.prior && +pos.signal.isStopOrder ? pos.prior : pos;
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
    } else if (signal.parkUntilSecs) {
        expect(signal).to.have.property('action').that.is.oneOf(['BTO', 'STO']);
        expect(pos).to.have.property('signal');
        return _.defaults({signal: _.defaults(_.pick(signal, 'parkUntilSecs'), pos.signal)}, pos);
    } else {
        return pos;
    }
}

/**
 * Position after applying the given signal to change the position size
 */
function changePosition(pos, signal, options) {
    expect(signal).has.property('quant').that.is.above(0);
    var effective = (signal.parkUntilSecs || signal.posted_time_unix || Infinity) * 1000;
    var prior = signal.status == 'working' || effective > options.now ? {prior: pos} : {};
    if (signal.action == 'BTCBTO') {
        var short = changePositionSize(pos, _.defaults({
            action:'BTC',
            quant: pos.quant_opened - pos.quant_closed
        }, signal), options);
        var long = changePositionSize({quant_opened:0,quant_closed:0}, _.defaults({
            action:'BTO',
            quant: pos.quant_closed - pos.quant_opened + +signal.quant
        }, signal), options);
        return _.isEmpty(prior) ? long : _.extend(long, {prior: _.extend(short, prior)});
    } else if (signal.action == 'STCSTO') {
        var long = changePositionSize(pos, _.defaults({
            action:'STC',
            quant: pos.quant_opened - pos.quant_closed
        }, signal), options);
        var short = changePositionSize({quant_opened:0,quant_closed:0}, _.defaults({
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
    var parkUntilSecs = signal.parkUntilSecs || signal.posted_time_unix;
    var m_when = parkUntilSecs ? moment.tz(parkUntilSecs, 'X', 'America/New_York') :
        moment.tz(options.now || Date.now(), options.tz);
    if (!m_when.isValid()) throw Error("Invalid posted date: " + JSON.stringify(signal));
    var when = m_when.format('YYYY-MM-DD HH:mm:ss');
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
    var parameters = [
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
    }
    // stoploss before reducing position and/or profit target
    if (+a.isStopOrder && !+b.isStopOrder) return -1;
    if (!+a.isStopOrder && +b.isStopOrder) return 1;
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

/**
 * Retrieve the collective2 response
 */
function retrieve(agent, name, settings, options) {
    expect(settings).to.have.property('apikey').that.is.a('string');
    expect(options).to.have.property('systemid').that.is.a('string');
    return new Promise((ready, error) => {
        var uri = settings[name];
        var parsed = _.isString(uri) && url.parse(uri);
        if (_.isObject(uri)) {
            ready(JSON.stringify(uri));
        } else if (parsed.protocol == 'https:' || parsed.protocol == 'http:') {
            var client = parsed.protocol == 'https:' ? https : http;
            var request = client.request(_.defaults({
                method: 'POST',
                headers: {'User-Agent': 'ptrading/' + version},
                agent: parsed.protocol == 'https:' && agent
            }, parsed), res => {
                try {
                    if (res.statusCode >= 300)
                        throw Error("Unexpected response code " + res.statusCode);
                    if (!~res.headers['content-type'].indexOf('/json'))
                        throw Error("Unexpected response type " + res.headers['content-type']);
                    var data = [];
                    res.setEncoding('utf8');
                    res.on('data', chunk => {
                        data.push(chunk);
                    });
                    res.on('end', () => {
                        ready(data.join(''));
                    });
                } catch(err) {
                    error(err);
                }
            }).on('error', error);
            request.end(JSON.stringify({
                apikey: settings.apikey,
                systemid: options.systemid
            }));
        } else if (parsed.protocol == 'file:') {
            fs.readFile(parsed.pathname, 'utf8', (err, data) => err ? error(err) : ready(data));
        } else {
            throw Error("Unknown protocol " + uri);
        }
    }).then(JSON.parse).then(res => {
        if (!res.equity_data) logger.trace("collective2", name, JSON.stringify(res));
        if (res.title)
            logger.log(res.title);
        else if (res.error && res.error.title)
            logger.error(res.error.title);
        if (!+res.ok)
            throw Error(res.message || res.error && res.error.message || JSON.stringify(res));
        return res;
    });
}

/**
 * Submits a new or updated signal or cancels a signal
 */
function submit(agent, name, body, settings, options) {
    expect(settings).to.have.property('apikey').that.is.a('string');
    expect(options).to.have.property('systemid').that.is.a('string');
    return new Promise((ready, error) => {
        var uri = settings[name];
        var parsed = _.isString(uri) && url.parse(uri);
        if (settings.offline || !parsed) {
            ready(JSON.stringify(_.defaults({
                ok: 1,
                signal: _.extend({
                    signalid: body.signalid
                }, body.signal)
            }, body)));
        } else if (parsed.protocol == 'https:' || parsed.protocol == 'http:') {
            var client = parsed.protocol == 'https:' ? https : http;
            var request = client.request(_.defaults({
                method: 'POST',
                headers: {'User-Agent': 'ptrading/' + version},
                agent: parsed.protocol == 'https:' && agent
            }, parsed), res => {
                try {
                    if (res.statusCode >= 300)
                        throw Error("Unexpected response code " + res.statusCode);
                    if (!~res.headers['content-type'].indexOf('/json'))
                        throw Error("Unexpected response type " + res.headers['content-type']);
                    var data = [];
                    res.setEncoding('utf8');
                    res.on('data', chunk => {
                        data.push(chunk);
                    });
                    res.on('end', () => {
                        ready(data.join(''));
                    });
                } catch(err) {
                    error(err);
                }
            }).on('error', error);
            request.end(JSON.stringify(_.extend({
                apikey: settings.apikey,
                systemid: options.systemid
            }, body)));
        } else if (parsed.protocol == 'file:') {
            var data = JSON.stringify(body, null, ' ');
            fs.writeFile(parsed.pathname, data, err => err ? error(err) : ready(JSON.stringify(_.defaults({
                ok: 1,
                signal: _.extend({
                    signalid: body.signalid || Math.floor(Math.random() * 100000000)
                }, body.signal)
            }, body))));
        } else {
            throw Error("Unknown protocol " + uri);
        }
    }).then(JSON.parse).then(res => {
        logger.debug("collective2", name, JSON.stringify(body), JSON.stringify(res));
        if (res.title)
            logger.log(res.title, res.signalid || '');
        else if (res.error && res.error.title)
            logger.error(res.error.title, res.signalid || '');
        if (!+res.ok)
            throw Error(res.message || res.error && res.error.message || JSON.stringify(res));
        return res;
    });
}
