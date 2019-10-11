// atomic-write.js
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

const fs = require('graceful-fs');
const path = require('path');
const util = require('util');
const _ = require('underscore');

/**
 * Writes to temporary file followed by an atomic rename to target filename
 */
module.exports = Object.assign(async function(fn, filename) {
    if (!filename) throw Error("No filename given");
    const part = partFor(filename);
    const dirname = await mkdirp(path.dirname(part));
    const result = await fn(part);
    return util.promisify(fs.rename)(part, filename)
      .catch(async cause => {
        await util.promisify(fs.unlink)(part);
        throw cause;
    });
}, {
    mkdirp,
    partFor,
    writeFileSync(filename, data) {
        const dirname = path.dirname(filename);
        mkdirpSync(dirname);
        const part = partFor(filename);
        fs.writeFileSync(part, data);
        fs.renameSync(part, filename);
        return filename;
    },
    async writeFile(filename, data) {
        const dir = await mkdirp(path.dirname(filename));
        const part = await new Promise((cb, fail) => {
            const part = partFor(filename);
            fs.writeFile(part, data, 'utf-8', (err, data) => err ? fail(err) : cb(part));
        });
        return new Promise((cb, fail) => {
            fs.rename(part, filename, err => err ? fail(err) : cb(filename));
        });
    }
});

/**
 * Creates directory and its parent directories
 */
function mkdirp(dirname) {
    return new Promise((present, absent) => {
        fs.access(dirname, fs.F_OK, err => err ? absent(err) : present(dirname));
    }).catch(async absent => {
        if (absent.code != 'ENOENT') throw absent;
        const parent = path.dirname(dirname);
        if (parent != dirname) await mkdirp(parent);
        return util.promisify(fs.mkdir)(dirname)
          .catch(err => {
            if (err.code == 'EEXIST') return dirname;
            else throw err;
        });
    });
}

function mkdirpSync(dirname) {
    try {
        fs.accessSync(dirname, fs.F_OK);
    } catch(absent) {
        if (absent.code != 'ENOENT') throw absent;
        const parent = path.dirname(dirname);
        if (parent != dirname) mkdirpSync(parent);
    }
    try {
        fs.mkdirSync(dirname);
    } catch (err) {
        if (err.code == 'EEXIST') return dirname;
        else throw err;
    }
}

/**
 * Provides a some what unique filename suffix
 */
let seq = Date.now() % 32768;
function partFor(filename) {
    return filename + '.part' + process.pid.toString(36) + (++seq).toString(36);
}
