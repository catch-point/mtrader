// version.js
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
'use strict';

const _ = require('underscore');

const pkg = require('../package.json');
const resolved = require('../package.json')._resolved;
const gitHead = pkg.gitHead || resolved && ~resolved.indexOf('#') &&
    resolved.substring(resolved.indexOf('#') + 1);

/**
 * Parses the module version into an object
 */
module.exports = _.omit({
    id: pkg._id,
    name: pkg.name,
    license: pkg.license,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    from: pkg._from,
    location: pkg._location,
    resolved: resolved,
    gitHead: gitHead,
    major_version: pkg.version.replace(/^(\d+).*$/,'$1.0.0'),
    minor_version: pkg.version.replace(/^(\d+\.\d+).*$/,'$1.0'),
    patch_version: pkg.version.replace(/^(\d+\.\d+.\d+).*$/,'$1'),
    major: pkg.version.replace(/^(\d+).*$/,'$1'),
    minor: pkg.version.replace(/^\d+\.(\d+).*$/,'$1'),
    patch: pkg.version.replace(/^\d+\.\d+\.(\d+).*$/,'$1'),
    pre_release: pkg.version.replace(/^\d+\.\d+\.\d+/,'').replace(/\+.*$/,''),
    build: gitHead || pkg.version.replace(/^.*\+?/,''),
    toString() {
        if (gitHead) return pkg.version + '+' + gitHead;
        else return pkg.version;
    }
}, value => value == null);
