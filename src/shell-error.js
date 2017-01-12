// shell-error.js
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

const _ = require('underscore');
const diff = require('diff');

module.exports = function(settings) {
    if (!settings.shell) throw Error('No shell provided');
    var shell = settings.shell;
    // Define empty error handler to avoid shell to throwing error when no event handler are defined
    shell.on('error', function() {});
    return function(err, cmd, sh, cb) {
        try {
            if (err.message) sh.red(err.message).ln();
            if (err.actual && err.expected) {
                var patch = diff.createPatch(err.name,
                    JSON.stringify(err.actual, null, 2),
                    JSON.stringify(err.expected, null, 2)
                );
                var ind = "      ";
                if (patch.length < 1000) patch.split('\n').splice(4).forEach(line => {
                    if (line[0] == '-') {
                        sh.red(ind).red(line).ln();
                    } else if (line[0] == ' ') {
                        sh.white(ind).white(line).ln();
                    } else if (line[0] == '+') {
                        sh.green(ind).green(line).ln();
                    }
                });
            }
            if (err.stack) sh.red(err.stack).ln();
            _.forEach(err, (v, k) => {
              if (k === 'message') return;
              if (k === 'stack') return;
              if (k === 'showDiff') return;
              if (k === 'actual') return;
              if (k === 'expected') return;
              if (k === 'name') return;
              if (typeof v === 'function') return;
              sh.magenta(k).white(': ').red(v).ln();
            });
        } finally {
            sh.prompt();
        }
    };
};
