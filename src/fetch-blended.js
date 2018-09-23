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

const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const config = require('./config.js');
const logger = require('./logger.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const remote = require('./fetch-remote.js');
const files = require('./fetch-files.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

module.exports = function() {
    var cfg = config('fetch.blended.config') ?
        readConfig(config('fetch.blended.config')) : config('fetch.blended');
    if (_.isEmpty(cfg)) throw Error("Missing fetch blended config");
    expect(cfg).to.have.property('delegate').that.is.oneOf(['remote', 'iqfeed', 'yahoo', 'files']);
    expect(cfg).to.have.property('assets').that.is.an('array');
    var delegate = cfg.delegate == 'remote' ? remote() :
        cfg.delegate == 'iqfeed' ? iqfeed() :
        cfg.delegate == 'files' ? files() : yahoo();
    var markets = _.uniq(cfg.assets.map(asset => asset.market));
    return {
        close() {
            return Promise.resolve(delegate && delegate.close());
        },
        help() {
            return delegate.help().then(_.flatten).then(info => info.map(interday => {
                if (!interday.options || !interday.options.market) return info;
                else return merge(interday, {options: {market: {
                    values: _.union(markets, interday.options.market.values)
                }}});
            }));
        },
        lookup: lookup.bind(this, delegate, cfg, 'lookup'),
        fundamental: delegateCall.bind(this, delegate, cfg, 'fundamental'),
        intraday: delegateCall.bind(this, delegate, cfg, 'intraday'),
        interday: options => {
            expect(options.interval).to.be.oneOf(['year', 'quarter', 'month', 'week', 'day']);
            var dayFn = day.bind(this, blendCall.bind(this, delegate, cfg, 'interday'));
            switch(options.interval) {
                case 'year': return year(dayFn, options);
                case 'quarter': return quarter(dayFn, options);
                case 'month': return month(dayFn, options);
                case 'week': return week(dayFn, options);
                case 'day': return dayFn(options);
                default:
                    expect(options.interval).to.be.oneOf([
                        'year', 'quarter', 'month', 'week', 'day'
                    ]);
            }
        }
    };
};

function readConfig(name) {
    var filename = config.resolve(name);
    var base = path.dirname(filename);
    var cfg = _.extend({base}, config.read(filename), config('fetch.blended'));
    var dname = cfg.delegate;
    if (!dname) throw Error("Missing fetch.blended.delegate");
    return cfg;
}

function lookup(delegate, cfg, cmd, options) {
    var asset = findAsset(cfg, cmd, options);
    return delegate[cmd](_.defaults({}, asset && asset.underlying, options))
      .then(result => result.map(item => {
        var asset = cfg.assets.find(a => _.matcher(a.underlying)(item));
        return _.defaults(_.omit(asset, 'underlying', 'blend'), item);
    }));
}

function delegateCall(delegate, cfg, cmd, options) {
    var asset = findAsset(cfg, cmd, options);
    return delegate[cmd](_.defaults({}, asset && asset.underlying, options));
}

function blendCall(delegate, cfg, cmd, options) {
    var asset = findAsset(cfg, cmd, options);
    if (!asset || !asset.blend)
        return delegateCall(delegate, cfg, cmd, _.defaults({interval: 'day'}, options));
    var end = options.end && moment.tz(options.end, options.tz).format();
    return asset.blend.reduceRight((promise, blend, i) => promise.then(result => {
        return readData(cfg, blend, options).then(part => {
            if (i == asset.blend.length-1) {
                var begin = _.isEmpty(part) && moment.tz(options.begin, options.tz).format();
                var ending = !_.isEmpty(part) && _.last(part).ending;
                return delegateCall(delegate, cfg, cmd, _.defaults({
                    interval: 'day',
                    begin: _.last(_.sortBy(_.compact([begin, ending]))),
                    end: _.last(_.sortBy(_.compact([end, ending])))
                }, options)).then(data => {
                    result = data;
                    return part;
                });
            } else {
                return part;
            }
        }).then(part => {
            if (_.isEmpty(result)) return part;
            var next = _.last(part);
            var overlap = _.sortedIndex(result, next, 'ending');
            if (result[overlap].ending > next.ending) overlap--;
            if (!result[overlap])
                return part.concat(result);
            else if (next.adj_close == result[overlap].adj_close)
                return part.concat(result.slice(overlap+1));
            var scale = result[overlap].adj_close / next.adj_close;
            return part.map(datum => _.defaults({adj_close: datum.adj_close * scale}, datum))
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
    var file = blend.filename && path.resolve(cfg.base, blend.filename);
    return Promise.resolve(file ? new Promise((present, absent) => {
        fs.access(file, fs.R_OK, err => err ? absent(err) : present(file));
    }).then(present => readTable(file), absent => {
        throw Error(`Could not read ${file} ${absent.message}`);
    }) : blend.data);
}

function readTable(filename) {
    var check = interrupt();
    return new Promise((ready, error) => {
        var objects = new Array();
        csv.fromStream(fs.createReadStream(filename), {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
                    check();
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
        var begin = moment.tz(options.begin, options.tz);
        var start = begin.format();
        var first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        var end = moment.tz(options.end || now, options.tz);
        if (end.isAfter()) return result;
        var final = end.format();
        var last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}

function year(day, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return month(day, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('year'),
        end: end && (end.isAfter(moment(end).startOf('year')) ? end.endOf('year') : end)
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).year()))
      .then(years => _.map(years, bars => bars.reduce((year, month) => {
        var adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('year', month.ending, options),
            open: year.open || adj(month.open),
            high: Math.max(year.high, adj(month.high)) || year.high || adj(month.high),
            low: Math.min(year.low, adj(month.low)) || year.low || adj(month.low),
            close: month.close,
            volume: year.volume + month.volume || year.volume || month.volume,
            adj_close: month.adj_close
        }, month, year);
      }, {})));
}

function quarter(day, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return month(day, _.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('quarter'),
        end: end && (end.isAfter(moment(end).startOf('quarter')) ? end.endOf('quarter') : end)
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('Y-Q')))
      .then(quarters => _.map(quarters, bars => bars.reduce((quarter, month) => {
        var adj = adjustment(_.last(bars), month);
        return _.defaults({
            ending: endOf('quarter', month.ending, options),
            open: quarter.open || adj(month.open),
            high: Math.max(quarter.high, adj(month.high)) || quarter.high || adj(month.high),
            low: Math.min(quarter.low, adj(month.low)) || quarter.low || adj(month.low),
            close: month.close,
            volume: quarter.volume + month.volume || quarter.volume || month.volume,
            adj_close: month.adj_close
        }, month, quarter);
      }, {})));
}

function month(day, options) {
    var end = options.end && moment.tz(options.end, options.tz);
    return day(_.defaults({
        begin: moment.tz(options.begin, options.tz).startOf('month'),
        end: end && (end.isAfter(moment(end).startOf('month')) ? end.endOf('month') : end)
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('Y-MM')))
      .then(months => _.map(months, bars => bars.reduce((month, day) => {
        var adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('month', day.ending, options),
            open: month.open || adj(day.open),
            high: Math.max(month.high, adj(day.high)) || month.high || adj(day.high),
            low: Math.min(month.low, adj(day.low)) || month.low || adj(day.low),
            close: day.close,
            volume: month.volume + day.volume || month.volume || day.volume,
            adj_close: day.adj_close
        }, day, month);
      }, {})));
}

function week(day, options) {
    var begin = moment.tz(options.begin, options.tz);
    return day(_.defaults({
        begin: begin.day() === 0 || begin.day() == 6 ? begin.startOf('day') :
            begin.startOf('isoWeek').subtract(1, 'days'),
        end: options.end && moment.tz(options.end, options.tz).endOf('isoWeek').subtract(2, 'days')
    }, options))
      .then(bars => _.groupBy(bars, bar => moment(bar.ending).format('gggg-WW')))
      .then(weeks => _.map(weeks, bars => bars.reduce((week, day) => {
        var adj = adjustment(_.last(bars), day);
        return _.defaults({
            ending: endOf('isoWeek', day.ending, options),
            open: week.open || adj(day.open),
            high: Math.max(week.high, adj(day.high)) || week.high || adj(day.high),
            low: Math.min(week.low, adj(day.low)) || week.low || adj(day.low),
            close: day.close,
            volume: week.volume + day.volume || week.volume || day.volume,
            adj_close: day.adj_close
        }, day, week);
      }, {})));
}

function adjustment(base, bar) {
    var scale = bar.adj_close/bar.close * base.close / base.adj_close;
    if (Math.abs(scale -1) < 0.000001) return _.identity;
    else return price => Math.round(price * scale * 10000) / 10000;
}

function endOf(unit, date, options) {
    var start = moment.tz(date, options.tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    var ending = moment(start).endOf(unit);
    var days = 0;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        var closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.format();
}
