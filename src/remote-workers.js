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

process.on('SIGHUP', () => module.exports.reload());
process.on('SIGINT', () => module.exports.close());
process.on('SIGTERM', () => module.exports.close());

var check = interrupt(true);

module.exports = _.extend(workerQueue(createRemoteWorkers, (worker, cmd, options) => {
    return worker.request(cmd, options).catch(err => {
        if (check()) throw err;
        if (worker.connected) {
            remote.stopWorker(worker);
            logger.warn("Worker failed to process ", options.label || '\b', worker.process.pid, err);
        }
        if (module.exports.getWorkers().length) return module.exports(cmd, options);
        else throw err;
    });
}), {
    fetch(options) {
        return module.exports('fetch', options);
    },
    quote(options) {
        return module.exports('quote', options);
    },
    collect(options) {
        return module.exports('collect', options);
    },
    optimize(options) {
        return module.exports('optimize', options);
    },
    bestsignals(options) {
        return module.exports('bestsignals', options);
    },
    strategize(options) {
        return module.exports('strategize', options);
    }
});

function createRemoteWorkers(check_queue) {
    check = interrupt(true);
    var remote_workers = _.flatten(_.compact(_.flatten([config('remote_workers')]))
        .map(addr => addr.split(',')));
    var remoteWorkers = remote_workers.map(address => {
        return replyTo(remote(address))
            .on('connect', function() {logger.log("Worker", this.process.pid, "is connected");})
            .on('disconnect', function() {logger.log("Worker", this.process.pid, "has disconnected");})
            .on('error', err => logger.warn(err.message || err));
    });
    Promise.all(remoteWorkers.map(worker => worker.request('worker_count').catch(err => err)))
      .then(counts => {
        var errors = counts.filter((count, i) => {
            if (!isFinite(count)) return count;
            else remoteWorkers[i].count = count;
        });
        if (errors.length) throw errors[0];
    }).catch(err => logger.debug(err, err.stack)).then(() => {
        if (_.some(remoteWorkers, worker => worker.count > 1)) check_queue();
    });
    return remoteWorkers;
}
