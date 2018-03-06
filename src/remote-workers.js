// remote-workers.js
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

const _ = require('underscore');
const interrupt = require('./interrupt.js');
const replyTo = require('./promise-reply.js');
const remote = require('./remote-process.js');
const workerQueue = require('./worker-queue.js');
const logger = require('./logger.js');
const config = require('./ptrading-config.js');

process.on('SIGHUP', () => instance && instance.reload());
process.on('SIGINT', () => instance && instance.close());
process.on('SIGTERM', () => instance && instance.close());

var instance;
var instanceCount = 0;

module.exports = function() {
    instanceCount++;
    if (!instance) {
        instance = createInstance();
        var close = instance.close;
        instance.close = function() {
            if (instance == this && --instanceCount) return Promise.resolve(); // still in use
            try {
                return close.apply(this);
            } finally {
                if (instance == this) instance = null;
            }
        };
    }
    return instance;
};

function createInstance() {
    var check = interrupt(true);
    var queue = workerQueue(createRemoteWorkers, (worker, cmd, options) => {
        return worker.request(cmd, options).catch(err => {
            if (check() || queue.isClosed() || options && options.remote_failed) throw err;
            if (worker.connected) queue.stopWorker(worker);
            var addresses = getRemoteWorkerAddresses();
            if (!addresses.length || addresses.length < 2 && _.first(addresses) == worker.process.pid) {
                throw err;
            } else if (worker.connected) {
                logger.warn("Worker failed to process ", options && options.label || '\b', worker.process.pid, err);
            } else {
                logger.trace("Worker failed to process ", options && options.label || '\b', worker.process.pid, err);
            }
            return queue(cmd, _.defaults({remote_failed: true}, options));
        });
    });
    var disconnectStoppedWorkers = _.debounce(() => {
        return queue.getStoppedWorkers().forEach(worker => worker.disconnect());
    }, 500);
    var reload = queue.reload;
    return _.extend(queue, {
        reload: _.debounce(function() {
            check = interrupt(true);
            try {
                return reload.apply(queue);
            } finally {
                if (getRemoteWorkerAddresses().length > 1 && queue.getStoppedWorkers().length) {
                    disconnectStoppedWorkers();
                }
            }
        }, 100),
        fetch(options) {
            return queue('fetch', options);
        },
        quote(options) {
            return queue('quote', options);
        },
        collect(options) {
            return queue('collect', options);
        },
        optimize(options) {
            return queue('optimize', options);
        },
        bestsignals(options) {
            return queue('bestsignals', options);
        },
        strategize(options) {
            return queue('strategize', options);
        },
        version() {
            return queue.all('version').then(versions => {
                var workers = queue.getWorkers();
                return _.object(workers.map(worker => worker.process.pid), versions);
            });
        }
    });
}

function createRemoteWorkers(check_queue) {
    var remote_workers = getRemoteWorkerAddresses();
    var remoteWorkers = remote_workers.map(address => {
        return replyTo(remote(address))
            .on('connect', function() {logger.log("Worker", this.process.pid, "is connected");})
            .on('disconnect', function() {logger.log("Worker", this.process.pid, "has disconnected");})
            .on('error', err => logger.warn(err.message || err));
    });
    var nice = config('nice');
    Promise.all(remoteWorkers.map(worker => worker.request('worker_count').catch(err => err)))
      .then(counts => {
        var errors = counts.filter((count, i) => {
            if (!isFinite(count)) return count;
            else if (!nice || !_.isFinite(nice)) remoteWorkers[i].count = count;
            else remoteWorkers[i].count = Math.ceil(count * (1 - nice/100));
        });
        if (errors.length) throw errors[0];
    }).catch(err => logger.debug(err, err.stack)).then(() => {
        if (_.some(remoteWorkers, worker => worker.count > 1)) check_queue();
    });
    return remoteWorkers;
}

function getRemoteWorkerAddresses() {
    return _.flatten(_.compact(_.flatten([config('remote_workers')]))
        .map(addr => addr.split(',')));
}
