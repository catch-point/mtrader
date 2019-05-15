// broker.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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
const Collective2 = require('./broker-collective2.js');
const IB = require('./broker-ib.js');
const Simulation = require('./broker-simulation.js');
const expect = require('chai').expect;

module.exports = function(settings) {
    const Brokers = [IB, Collective2, Simulation];
    let promiseHelpWithSettings, promiseHelpWithOptions;
    if (settings.help && !promiseHelpWithSettings) promiseHelpWithSettings = helpWithSettings(Brokers);
    if (settings.help) return promiseHelpWithSettings.then(help => [].concat(...help));
    let broker_promise;
    return Object.assign(async function(options) {
        if (!promiseHelpWithSettings) promiseHelpWithSettings = helpWithSettings(Brokers);
        broker_promise = broker_promise || createBroker(await promiseHelpWithSettings, Brokers, settings);
        const broker = await broker_promise;
        if (!promiseHelpWithOptions) promiseHelpWithOptions = broker({help:true});
        if (options.help) return promiseHelpWithOptions;
        const help = await promiseHelpWithOptions;
        const opts = _.pick(options, _.flatten(_.map(help, info => _.keys(info.options))));
        return broker(opts);
    }, {
        async close() {
            if (broker_promise) return broker_promise.then(broker => broker.close(), err => {});
        }
    });
};

function helpWithSettings(Brokers) {
    return Promise.all(Brokers.map(Broker => Broker({help:true})));
}

async function createBroker(promiseHelpWithSettings, Brokers, settings) {
    const help = await promiseHelpWithSettings;
    let error;
    const broker = chooseBroker(help, settings).reduce((broker, idx) => {
        if (broker) return broker; // already found one
        const mini_settings = _.pick(settings, _.flatten(_.map(help[idx], info => _.keys(info.options))));
        try {
            return new Brokers[idx](mini_settings);
        } catch (err) {
            if (error) logger.debug("Could not created broker", error);
            error = err;
        }
    }, null);
    if (broker && error) logger.debug("Could not create broker", error);
    if (broker) return broker;
    else if (error) throw error;
    else throw Error("Missing broker settings or no broker setup");
}

function chooseBroker(help, settings) {
    return _.sortBy(help.map(help => {
        return _.max(help.map(help => {
            return _.filter(help.options, (desc, name) => name in settings).length;
        }));
    }).map((count, index) => ({count, index})), 'count')
      .reverse().map(obj => obj.index);
}
