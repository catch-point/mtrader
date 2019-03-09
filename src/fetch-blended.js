// fetch-blended.js
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
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const config = require('./config.js');
const logger = require('./logger.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const remote = require('./fetch-remote.js');
const files = require('./fetch-files.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

module.exports = function() {
    const cfg = config('fetch.blended.config') ?
        readConfig(config('fetch.blended.config')) : config('fetch.blended');
    if (_.isEmpty(cfg)) throw Error("Missing fetch blended config");
    expect(cfg).to.have.property('delegate').that.is.oneOf(['remote', 'iqfeed', 'yahoo', 'files']);
    expect(cfg).to.have.property('assets').that.is.an('array');
    const delegate = cfg.delegate == 'remote' ? remote() :
        cfg.delegate == 'iqfeed' ? iqfeed() :
        cfg.delegate == 'files' ? files() : yahoo();
    const markets = _.uniq(cfg.assets.map(asset => asset.market));
    return Object.assign(options => {
        if (options.help) return delegate({help:true}).then(_.flatten).then(info => info.map(interday => {
            if (!interday.options || !interday.options.market) return info;
            else return merge(interday, {options: {market: {
                values: markets
            }}});
        }));
        const dayFn = day.bind(this, blendCall.bind(this, delegate, cfg, 'interday'));
        switch(options.interval) {
            case 'lookup': return lookup(delegate, cfg, 'lookup', options);
            case 'fundamental': return delegateCall(delegate, cfg, 'fundamental', options);
            case 'year': return year(dayFn, options);
            case 'quarter': return quarter(dayFn, options);
            case 'month': return month(dayFn, options);
            case 'week': return week(dayFn, options);
            case 'day': return dayFn(options);
            default: return delegateCall(delegate, cfg, 'intraday', options);
        }
    }, {
        close() {
            return Promise.resolve(delegate && delegate.close());
        }
    });
};

function readConfig(name) {
    const filename = config.resolve(name);
    const base = path.dirname(filename);
    const cfg = _.extend({base}, config.read(filename), config('fetch.blended'));
    const dname = cfg.delegate;
    if (!dname) throw Error("Missing fetch.blended.delegate");
    return cfg;
}

function lookup(delegate, cfg, cmd, options) {
    return delegateCall(delegate, cfg, cmd, options).then(result => result.map(item => {
        const asset = cfg.assets.find(a => _.matcher(a.underlying)(item));
        return _.defaults(_.omit(asset, 'underlying', 'blend'), item);
    }));
}

function delegateCall(delegate, cfg, cmd, options) {
    const asset = findAsset(cfg, cmd, options);
    const market = asset && asset.underlying && asset.underlying.market ?
        _.omit(config('markets')[asset.underlying.market], 'datasources', 'label', 'description') : null;
    const opts = !asset || !asset.underlying ? options :
        _.defaults({}, asset && asset.underlying, market, options);
    return delegate(opts);
}

function blendCall(delegate, cfg, cmd, options) {
    const asset = findAsset(cfg, cmd, options);
    if (!asset || !asset.blend)
        return delegateCall(delegate, cfg, cmd, _.defaults({interval: 'day'}, options));
    const end = options.end && moment.tz(options.end, options.tz).format();
    return asset.blend.reduceRight((promise, blend, i) => promise.then(result => {
        return readData(cfg, blend, options).then(part => {
            if (i == asset.blend.length-1) {
                const begining = _.isEmpty(part) && moment.tz(options.begin, options.tz).format();
                const ending = !_.isEmpty(part) && _.last(part).ending;
                const earlier = _.last(_.sortBy(_.compact([begining, ending])));
                const later = _.last(_.sortBy(_.compact([end, ending])));
                return delegateCall(delegate, cfg, cmd, _.defaults({
                    interval: 'day',
                    begin: earlier,
                    end: later != earlier ? later : undefined
                }, options)).then(data => {
                    result = data;
                    return part;
                });
            } else {
                return part;
            }
        }).then(part => {
            if (_.isEmpty(result)) return part;
            const next = _.last(part);
            let overlap = _.sortedIndex(result, next, 'ending');
            if (!result[overlap] || result[overlap].ending > next.ending) overlap--;
            if (!result[overlap])
                return part.concat(result);
            else if (next.adj_close == result[overlap].adj_close)
                return part.concat(result.slice(overlap+1));
            const scale = result[overlap].adj_close / next.adj_close;
            return part.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}))
                .concat(result.slice(overlap+1));
        });
    }), Promise.resolve([]));
}

function findAsset(cfg, cmd, options) {
    expect(cfg).to.have.property('assets').that.is.an('array');
    return cfg.assets.find(asset => asset.symbol == options.symbol && asset.market == options.market);
}

function readData(cfg, blend, options) {
    if (!blend.data) expect(blend).to.have.property('filename');
    const file = blend.filename && path.resolve(cfg.base, blend.filename);
    return Promise.resolve(file ? new Promise((present, absent) => {
        fs.access(file, fs.R_OK, err => err ? absent(err) : present(file));
    }).then(present => readTable(file), absent => {
        throw Error(`Could not read ${file} ${absent.message}`);
    }) : blend.data);
}

function readTable(filename) {
    return new Promise((ready, error) => {
        const objects = new Array();
        csv.fromStream(fs.createReadStream(filename), {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
                    objects.push(_.mapObject(data, value => _.isFinite(value) ? +value : value));
                } catch (e) {
                    this.emit('error', e);
                }
            })
            .on('end', () => ready(objects));
    });
}

function day(readTable, options) {
    return readTable(options).then(result => {
        const begin = moment.tz(options.begin, options.tz);
        const start = begin.format();
        const first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        const end = moment.tz(options.end || now, options.tz);
        if (end.isAfter()) return result;
        const final = end.format();
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

async function year(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('year'),
        end: end && (end.isAfter(moment(end).startOf('year')) ? end.endOf('year') : end)
    }, options));
    const years = _.groupBy(bars, bar => moment(bar.ending).year());
    return _.map(years, bars => bars.reduce((year, month) => {
        const adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('year', month.ending, options),
            open: year.open || adj(month.open),
            high: Math.max(year.high, adj(month.high)) || year.high || adj(month.high),
            low: Math.min(year.low, adj(month.low)) || year.low || adj(month.low),
            close: month.close,
            volume: year.volume + month.volume || year.volume || month.volume,
            adj_close: month.adj_close
        }, month, year);
      }, {}));
}

async function quarter(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('quarter'),
        end: end && (end.isAfter(moment(end).startOf('quarter')) ? end.endOf('quarter') : end)
    }, options));
    const quarters = _.groupBy(bars, bar => moment(bar.ending).format('Y-Q'));
    return _.map(quarters, bars => bars.reduce((quarter, month) => {
        const adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('quarter', month.ending, options),
            open: quarter.open || adj(month.open),
            high: Math.max(quarter.high, adj(month.high)) || quarter.high || adj(month.high),
            low: Math.min(quarter.low, adj(month.low)) || quarter.low || adj(month.low),
            close: month.close,
            volume: quarter.volume + month.volume || quarter.volume || month.volume,
            adj_close: month.adj_close
        }, month, quarter);
      }, {}));
}

async function month(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await day(_.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('month'),
        end: end && (end.isAfter(moment(end).startOf('month')) ? end.endOf('month') : end)
    }, options));
    const months = _.groupBy(bars, bar => moment(bar.ending).format('Y-MM'));
    return _.map(months, bars => bars.reduce((month, day) => {
        const adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('month', day.ending, options),
            open: month.open || adj(day.open),
            high: Math.max(month.high, adj(day.high)) || month.high || adj(day.high),
            low: Math.min(month.low, adj(day.low)) || month.low || adj(day.low),
            close: day.close,
            volume: month.volume + day.volume || month.volume || day.volume,
            adj_close: day.adj_close
        }, day, month);
      }, {}));
}

async function week(day, options) {
    const begin = moment.tz(options.begin, options.tz);
    const bars = await day(_.defaults({
        begin: begin.day() === 0 || begin.day() == 6 ? begin.startOf('day') :
            begin.startOf('isoWeek').subtract(1, 'days'),
        end: options.end && moment.tz(options.end, options.tz).endOf('isoWeek').subtract(2, 'days')
    }, options));
    const weeks = _.groupBy(bars, bar => moment(bar.ending).format('gggg-WW'));
    return _.map(weeks, bars => bars.reduce((week, day) => {
        const adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('isoWeek', day.ending, options),
            open: week.open || adj(day.open),
            high: Math.max(week.high, adj(day.high)) || week.high || adj(day.high),
            low: Math.min(week.low, adj(day.low)) || week.low || adj(day.low),
            close: day.close,
            volume: week.volume + day.volume || week.volume || day.volume,
            adj_close: day.adj_close
        }, day, week);
      }, {}));
}

function adjustment(base, bar) {
    const scale = bar.adj_close/bar.close * base.close / base.adj_close;
    if (Math.abs(scale -1) < 0.000001) return _.identity;
    else return price => Math.round(price * scale * 10000) / 10000;
}

function endOf(unit, date, options) {
    const start = moment.tz(date, options.tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    let ending = moment(start).endOf(unit);
    let days = 0, closes;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.format();
}
