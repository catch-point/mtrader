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
const expect = require('chai').expect;

module.exports = function(settings) {
    let promiseHelpWithSettings, promiseHelpWithOptions;
    if (!promiseHelpWithSettings) promiseHelpWithSettings = helpWithSettings(Collective2);
    if (settings.help) return promiseHelpWithSettings;
    else return promiseHelpWithSettings
      .then(help => _.pick(settings, _.flatten(_.map(help, info => _.keys(info.options)))))
      .then(settings => {
        const collective2 = Collective2(settings);
        return _.extend(function(options) {
            if (!promiseHelpWithOptions) promiseHelpWithOptions = helpWithOptions(collective2);
            if (options.help) return promiseHelpWithOptions;
            else return promiseHelpWithOptions
              .then(help => _.pick(options, _.flatten(_.map(help, info => _.keys(info.options)))))
              .then(options => {
                return broker(collective2, options);
            });
        }, {
            close() {
                return collective2.close();
            }
        });
    });
};

function broker(collective2, options) {
    return collective2(options);
}

function helpWithSettings(Collective2) {
    return Collective2({help: true});
}

function helpWithOptions(collective2) {
    return collective2({help: true});
}
