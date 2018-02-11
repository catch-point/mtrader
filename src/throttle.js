// throttle.js
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

module.exports = function(fn, limit) {
    var max = limit || 1;
    var currently = 0;
    var queue = [];
    var next = function(){
        if (currently < max && queue.length) {
            currently++;
            queue.shift().call();
        }
    };
    return function(/* arguments */) {
        var context = this;
        var args = arguments;
        return new Promise(function(callback, abort){
            queue.push(() => {
                var idx = pending.indexOf(abort);
                if (idx < 0) return next();
                delete pending[idx];
                callback();
            });
            pending.push(abort);
            next();
        }).then(function(){
            return fn.apply(context, args);
        }).then(function(result){
            currently--;
            next();
            return result;
        }, function(error){
            currently--;
            next();
            return Promise.reject(error);
        });
    };
};

var pending = [];
process.on('SIGINT', () => {
    var err = Error('SIGINT');
    pending.splice(0).forEach(task => {
        task(Promise.reject(err));
    });
}).on('SIGTERM', () => {
    var err = Error('SIGTERM');
    pending.splice(0).forEach(task => {
        task(Promise.reject(err));
    });
});
