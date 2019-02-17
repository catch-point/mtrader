// broker-collective2.js
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
const logger = require('./logger.js');
const Collective2 = require('./collective2-client.js');
const expect = require('chai').expect;

/**
 * Aligns the working signals on collective2 with the signal rows from the collect result
 */
module.exports = function(settings) {
    if (settings.help) return helpSettings();
    expect(settings).to.have.property('systemid').that.is.a('string');
    var client = Collective2(settings.systemid);
    return _.extend(function(options) {
        if (options.help) return helpOptions();
        else return collective2(client, options);
    }, {
        close() {
            return client.close();
        }
    });
};

function collective2(collective2, options) {
    expect(options).to.have.property('action').to.be.oneOf([
        'requestMarginEquity', 'retrieveSystemEquity',
        'retrieveSignalsWorking', 'requestTrades',
        'cancelSignal', 'BTO', 'STO', 'BTC', 'STC'
    ]);
    switch(options.action) {
        case 'requestMarginEquity': return collective2.requestMarginEquity();
        case 'retrieveSystemEquity': return collective2.retrieveSystemEquity();
        case 'retrieveSignalsWorking': return collective2.retrieveSignalsWorking();
        case 'requestTrades': return collective2.requestTrades();
        case 'cancelSignal': return collective2.cancelSignal(options.signalid);
        case 'BTO':
        case 'STO':
        case 'BTC':
        case 'STC': return collective2.submitSignal(options);
        default: throw Error("Unknown action: " + options.action);
    }
}

/**
 * Array of one Object with description of module, including supported options
 */
function helpSettings() {
    return Promise.resolve([{
        name: 'broker',
        usage: 'broker(settings)',
        description: "Information needed to identify the broker account",
        options: {
            systemid: {
                usage: '<integer>',
                description: "The Collective2 system identifier"
            }
        }
    }]);
}

/**
 * Array of one Object with description of module, including supported options
 */
function helpOptions() {
    return Promise.resolve([{
        name: 'retrieve',
        usage: 'broker(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ["ok", "signal", "market", "strike", "signalid", "stoploss", "comments", "tif", "day", "systemid", "parkUntilYYYYMMDDHHMM", "symbol", "conditionalupon", "duration", "description", "targetocagroupid", "expiresat", "pointvalue", "isLimitOrder", "parkUntilSecs", "typeofsymbol", "currency", "quant", "limit", "gtc", "stop", "profittarget", "action", "ocaid","signalid", "elapsed_time", "buyPower", "marginUsed", "equity", "updatedLastTimeET", "ok", "modelAccountValue", "cash"],
        options: {
            action: {
                usage: '<string>',
                values: [
                    'requestMarginEquity', 'retrieveSystemEquity',
                    'retrieveSignalsWorking', 'requestTrades'
                ]
            }
        }
    }, {
        name: 'cancelSignal',
        usage: 'broker(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ["ok", "signal", "market", "strike", "signalid", "stoploss", "comments", "tif", "day", "systemid", "parkUntilYYYYMMDDHHMM", "symbol", "conditionalupon", "duration", "description", "targetocagroupid", "expiresat", "pointvalue", "isLimitOrder", "parkUntilSecs", "typeofsymbol", "currency", "quant", "limit", "gtc", "stop", "profittarget", "action", "ocaid","signalid", "elapsed_time", "buyPower", "marginUsed", "equity", "updatedLastTimeET", "ok", "modelAccountValue", "cash"],
        options: {
            action: {
                usage: '<string>',
                values: ['cancelSignal']
            },
            signalid: {
                usage: '<integer>',
                description: "The signal identifier that should be cancelled"
            }
        }
    }, {
        name: 'submitSignal',
        usage: 'broker(options)',
        description: "Changes workers orders to align with signal orders in result",
        properties: ["ok", "signal", "market", "strike", "signalid", "stoploss", "comments", "tif", "day", "systemid", "parkUntilYYYYMMDDHHMM", "symbol", "conditionalupon", "duration", "description", "targetocagroupid", "expiresat", "pointvalue", "isLimitOrder", "parkUntilSecs", "typeofsymbol", "currency", "quant", "limit", "gtc", "stop", "profittarget", "action", "ocaid","signalid", "elapsed_time", "buyPower", "marginUsed", "equity", "updatedLastTimeET", "ok", "modelAccountValue", "cash"],
        options: {
            action: {
                usage: '<string>',
                values: ['BTO', 'STO', 'BTC', 'STC']
            },
            typeofsymbol: {
                values: ['stock', 'option', 'future', 'forex'],
                description: "instruments like ETFs and mutual funds should be treated as a 'stock' Click here for C2 Symbols Help"
            },
            duration: {
                values: ['DAY', 'GTC']
            },
            stop: {
                usage: '<price>'
            },
            limit: {
                usage: '<price>'
            },
            market: {
                description: "Set to 1 to declare this is a market order. If you do not supply limit or stop parameters, order will be assumed to be a market order."
            },
            profittarget: {
                usage: '<price>',
                description: "Used when submitting an position-entry order. Automatically create a conditional order to close the position at this limit price. When used in conjunction with stoploss, a One-Cancels-All group is created."
            },
            stoploss: {
                usage: '<price>',
                description: "Used when submitting an position-entry order. Automatically create a conditional order to close the position at this stop price. When used in conjunction with profittarget, a One-Cancels-All group is created."
            },
            conditionalupon: {
                usage: '<signalid>',
                description: "Do not allow this order to start 'working' unless the parent order is filled (parent order has signalid = conditionalupon)"
            },
            conditionalUponSignal: {
                description: "Same as conditionalupon, but instead of supplying already-determined signalid, you can provide nested JSON containing entire signal hash"
            },
            xreplace: {
                usage: '<signalid>',
                description: "Cancel the signalid specified, and if the cancel is successful, submit this new order to replace it"
            },
            symbol: {},
            quant: {},
            isLimitOrder: {},
            strike: {},
            status: {},
            name: {},
            isStopOrder: {},
            instrument: {},
            posted_time_unix: {},
            underlying: {},
            isMarketOrder: {},
            tif: {},
            putcall: {},
            expiration: {},
            quant: {},
            signal_id: {},
            posted_time: {},
            signalid: {},
            comments: {},
            day: {},
            systemid: {},
            parkUntilYYYYMMDDHHMM: {},
            targetocagroupid: {},
            decimalprecision: {},
            expiresat: {},
            pointvalue: {},
            parkUntilSecs: {},
            currency: {},
            quant: {},
            gtc: {},
            ocaid: {},
            localsignalid: {},
            symbol_description: {},
            description: {},
            pointvalue: {}
        }
    }]);
}

