// read-write-lock.js
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

/**
 * Maintains a pair of associated locks, one for read-only operations and one
 * for writing. Locks are held until the given function's promise is resolved.
 * The read lock may be held simultaneously by multiple callers, so long as
 * there are no writers. The write lock is exclusive.
 */
module.exports = function() {
    let write_lock = Promise.resolve();
    const read_locks = [];
    return Object.assign(new.target ? this : {}, {
        async readLock(fn) {
            const promise = write_lock.catch(err => {}).then(fn);
            const entry = promise.catch(err => {}).then(() => {
                const idx = read_locks.indexOf(entry);
                if (~idx) read_locks.splice(idx, 1);
            });
            read_locks.push(entry);
            return promise;
        },
        async writeLock(fn) {
            const wait_for = read_locks.slice(0);
            return write_lock = write_lock
              .catch(err => {})
              .then(() => Promise.all(wait_for))
              .then(() => {})
              .then(fn);
        }
    });
}
