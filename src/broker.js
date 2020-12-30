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
const version = require('./version.js');
const logger = require('./logger.js');
const config = require('./config.js');
const Collective2 = require('./broker-collective2.js');
const IB = require('./broker-ib.js');
const Simulation = require('./broker-simulation.js');
const Remote = require('./broker-remote.js');
const expect = require('chai').expect;

module.exports = function(settings, quote) {
    const Brokers = _.object(_.compact([
        (settings.ib||{}).enabled && ['ib', IB],
        (settings.collective2||{}).enabled && ['collective2', Collective2],
        (settings.simulation||{}).enabled && ['simulation', Simulation],
        (settings.remote||{}).enabled && ['remote', Remote]
    ]));
    let promiseHelpWithSettings, promiseHelpWithOptions;
    if (settings.info=='help' && !promiseHelpWithSettings) promiseHelpWithSettings = helpWithSettings(Brokers);
    if (settings.info=='help')
        return promiseHelpWithSettings.then(help => [].concat(...Object.values(help)));
    if (settings.info=='version')
        return Promise.all(Object.values(Brokers).map(Broker => Broker({info:'version'})));
    let broker_promise;
    return Object.assign(async function(options) {
        if (!promiseHelpWithSettings) promiseHelpWithSettings = helpWithSettings(Brokers);
        broker_promise = broker_promise || createBroker(await promiseHelpWithSettings, Brokers, settings, quote);
        const broker = await broker_promise.catch(err => {if (!options.info) throw err;});
        if (options.info && !broker) return [];
        if (!promiseHelpWithOptions) promiseHelpWithOptions = broker({info:'help'});
        if (options.info=='help') return promiseHelpWithOptions;
        if (options.info) return [];
        const help = await promiseHelpWithOptions;
        const opts = _.pick(options, _.flatten(_.map(help, info => _.keys(info.options))));
        return broker(opts);
    }, {
        async close() {
            if (broker_promise) return broker_promise.then(broker => broker.close(), err => {});
        }
    });
};

async function helpWithSettings(Brokers) {
    const values = await Promise.all(Object.values(Brokers).map(Broker => Broker({info:'help'})));
    return _.object(Object.keys(Brokers), values);
}

async function createBroker(promiseHelpWithSettings, Brokers, settings, quote) {
    const help = await promiseHelpWithSettings;
    let error;
    const broker = await chooseBroker(help, settings).reduce(async(broker, key) => {
        if (await broker) return broker; // already found one
        try {
            return Brokers[key](settings[key], quote);
        } catch (err) {
            if (error) logger.debug("Could not created broker", error);
            error = err;
        }
    }, null);
    if (broker && error) logger.debug("Could not create broker", error);
    if (broker) return broker;
    else if (error) throw error;
    else throw Error(`Missing broker settings or no broker setup, with: ${Object.keys(settings).join(', ')}`);
}

function chooseBroker(help, settings) {
    return _.sortBy(_.map(_.mapObject(help, (help, key) => {
        return _.max(help.map(help => {
            return _.filter(help.options, (desc, name) => (settings[key]||{})[name]).length;
        }));
    }), (count, key) => ({count, key})), 'count')
      .reverse().map(obj => obj.key);
}
