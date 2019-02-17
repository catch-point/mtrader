// worker-queue.js
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
const logger = require('./logger.js');

module.exports = function(createWorkers, execTask) {
    const queue = [];
    const workers = [];
    const stoppedWorkers = [];
    const run = function() {
        if (closed) throw Error("Workers have closed");
        const loads = workers.map(load);
        const min = _.min(loads);
        const avail = _.reject(loads.map((load, idx) => load == min ? idx : null), _.isNull);
        const idx = avail.length == 1 ? 0 : Math.floor(Math.random() * avail.length);
        const worker = workers[avail[idx]];
        return execTask.apply(this, [worker].concat(_.toArray(arguments)));
    };
    let closed = false;
    let checking = false;
    const check_queue = function() {
        if (checking) return;
        else checking = true;
        try {
            if (_.isEmpty(workers) && queue.length) {
                registerWorkers(createWorkers.call(self, check_queue), workers, stoppedWorkers, check_queue);
                if (_.isEmpty(workers)) throw Error("No workers available");
            }
            stoppedWorkers.forEach(worker => {
                if (idle(worker)) {
                    worker.disconnect();
                }
            });
            const spare = workers.reduce((capacity, worker) => {
                return capacity + Math.max(Math.ceil((worker.count || 1) * (1 - load(worker))), 0);
            }, 0);
            queue.splice(0, spare).forEach(item => {
                run.apply(item.self, item.args).then(item.resolve, item.reject);
            });
            if (queue.length && spare) {
                logger.trace("Queue", queue.length,
                    workers.map(w => (w.count || 1) * load(w)).join(' '));
            }
        } finally {
            checking = false;
        }
    };
    const self = _.extend(function() {
        const self = this;
        const args = _.toArray(arguments);
        return new Promise((resolve, reject) => {
            queue.push({self, args, resolve, reject});
            check_queue();
        });
    },{
        hasWorkers() {
            return !_.isEmpty(this.getWorkers());
        },
        countConnectedWorkers() {
            return workers.filter(worker => worker.connected).length;
        },
        getConnectedWorkers() {
            return workers.concat(stoppedWorkers).filter(worker => worker.connected);
        },
        getWorkers() {
            if (_.isEmpty(workers)) {
                registerWorkers(createWorkers.call(self, check_queue), workers, stoppedWorkers, check_queue);
            }
            return workers.slice(0);
        },
        getStoppedWorkers() {
            return stoppedWorkers.slice(0);
        },
        stopWorker(worker) {
            const idx = workers.indexOf(worker);
            if (idx >= 0) workers.splice(idx, 1);
            if (idle(worker)) {
                worker.disconnect();
            } else if (worker.connected) {
                stoppedWorkers.push(worker);
            }
        },
        all: function() {
            const self = this;
            const args = _.toArray(arguments);
            return Promise.all(this.getWorkers().map(worker => {
                return run.apply(self, args);
            }));
        },
        reload() {
            stoppedWorkers.push.apply(stoppedWorkers, workers.splice(0, workers.length));
            check_queue();
        },
        isClosed() {
            return closed;
        },
        close() {
            closed = true;
            queue.splice(0).forEach(item => {
                item.reject(Error("Workers are closing"));
            });
            return Promise.all(_.flatten([
                workers.map(child => child.disconnect()),
                stoppedWorkers.map(child => child.disconnect())
            ]));
        }
    });
    return self;
}

function idle(worker) {
    const stats = worker.stats;
    if (!stats || !stats.requests_sent) return true;
    return stats.requests_sent == stats.replies_rec;
}

function load(worker) {
    const stats = worker.stats;
    if (!stats || !stats.requests_sent) return 0;
    const outstanding = stats.requests_sent - (stats.replies_rec || 0);
    const subcollecting = (stats.requests_rec || 0) - (stats.replies_sent || 0);
    return Math.max((outstanding - subcollecting) / (worker.count || 1), 0) || 0;
}

function registerWorkers(newWorkers, workers, stoppedWorkers, check) {
    workers.push.apply(workers, newWorkers);
    newWorkers.forEach(worker => worker.on('message', check).handle('stop', function() {
        const idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        if (idle(this)) {
            this.disconnect();
        } else if (this.connected) {
            stoppedWorkers.push(this);
        }
    }).once('disconnect', function() {
        const idx = workers.indexOf(this);
        if (idx >= 0) workers.splice(idx, 1);
        const sidx = stoppedWorkers.indexOf(this);
        if (sidx >= 0) stoppedWorkers.splice(sidx, 1);
    }));
}
