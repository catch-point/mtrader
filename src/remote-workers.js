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
'use strict';

const _ = require('underscore');
const moment = require('moment-timezone');
const share = require('./share.js');
const interrupt = require('./interrupt.js');
const replyTo = require('./promise-reply.js');
const remote = require('./remote-process.js');
const workerQueue = require('./worker-queue.js');
const logger = require('./logger.js');
const config = require('./config.js');

process.setMaxListeners(process.getMaxListeners()+1);

module.exports = createInstance;

function createInstance(settings = {}) {
    let check = interrupt(true);
    const queue = workerQueue(_.partial(createRemoteWorkers, settings), (worker, cmd, options) => {
        return worker.request(cmd, options).catch(async err => {
            if (await check() || queue.isClosed() || !err || !err.message) throw err;
            else if (options && options.remote_failed) throw err;
            const stillConnected = !!worker.connected && !~err.message.indexOf('Disconnecting');
            if (worker.connected) queue.stopWorker(worker);
            const addresses = getRemoteWorkerSettings(settings);
            if (!addresses.length || addresses.length < 2 && _.first(addresses).location == worker.process.pid) {
                throw err;
            }
            await new Promise(cb => _.delay(cb, 1000));
            if (worker.connected) {
                logger.warn("Worker failed to process ", options && options.label || '\b', worker.process.pid, err);
            } else {
                logger.trace("Worker failed to process ", options && options.label || '\b', worker.process.pid, err);
            }
            return queue(cmd, _.defaults({remote_failed: stillConnected}, options));
        });
    });
    const disconnectStoppedWorkers = _.debounce(() => {
        return queue.getStoppedWorkers().forEach(worker => worker.disconnect());
    }, 500);
    const reload = queue.reload;
    return _.extend(queue, {
        reload: _.debounce(function() {
            check = interrupt(true);
            try {
                return reload.apply(queue);
            } finally {
                if (getRemoteWorkerSettings(settings).length > 1 && queue.getStoppedWorkers().length) {
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
        async version() {
            const versions = await queue.all('version');
            const workers = queue.getWorkers();
            return _.object(workers.map(worker => worker.process.pid), versions);
        }
    });
}

function createRemoteWorkers(settings, check_queue) {
    const queue = this;
    const remote_workers = getRemoteWorkerSettings(settings);
    const remoteWorkers = remote_workers.map(remote_settings => {
        return replyTo(remote(remote_settings)).on('connect', function() {
            if (!queue.getStoppedWorkers().find(w => w.connected && w.process.pid == this.process.pid))
                logger.log("Worker", this.process.pid, "is connected");
            if (queue.isClosed()) this.disconnect();
        }).on('disconnect', function() {
            if (queue.getConnectedWorkers().find(w => w!=this && w.process.pid == this.process.pid))
                logger.debug("Worker", this.process.pid, "has reconnected");
            else
                logger.log("Worker", this.process.pid, "has disconnected");
        }).on('error', err => logger.warn(err.message || err));
    });
    const nice = settings.nice;
    Promise.all(remoteWorkers.map(worker => worker.request('worker_count').catch(err => err)))
      .then(counts => {
        const errors = counts.filter((count, i) => {
            if (!isFinite(count)) return count;
            else if (!nice || !_.isFinite(nice)) remoteWorkers[i].count = count;
            else remoteWorkers[i].count = Math.ceil(count * (1 - nice/100));
        });
        if (errors.length && !queue.isClosed()) throw errors[0];
    }).catch(err => logger.debug(err, err.stack)).then(() => {
        if (_.some(remoteWorkers, worker => worker.count > 1)) check_queue();
    }).then(() => Promise.all(remoteWorkers.map(async(worker) => {
        const tz = (moment.defaultZone||{}).name || moment.tz.guess();
        const format = moment.defaultFormat;
        const [rtz, rformat] = await Promise.all([worker.request('tz'), worker.request('ending_format')]);
        if (tz != rtz) logger.warn(`Worker ${worker.process.pid} has a different time zone of ${rtz}`);
        if (format != rformat) logger.warn(`Worker ${worker.process.pid} has a different format of ${rformat}`);
    }))).catch(err => logger.debug(err, err.stack));
    return remoteWorkers;
}

function getRemoteWorkerSettings(settings) {
    return _.flatten(_.compact(_.flatten([settings.remote]))).filter(settings => settings.enabled);
}
