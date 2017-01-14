// quote.js
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const storage = require('./storage.js');
const periods = require('./periods.js');
const List = require('./list.js');
const expressions = require('./expressions.js');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(fetch) {
    var store = storage(path.resolve(config('prefix'), 'var/quotes/'));
    var fetchOptions = fetchOptionsFactory(fetch);
    var self = function(options) {
        return fetchOptions(options).then(options => quote(fetch, store, options));
    };
    self.close = () => store.close();
    return self;
};

function fetchOptionsFactory(fetch) {
    var memoizeFirstLookup = _.memoize((symbol, exchange) => {
        return fetch({
            interval: 'lookup',
            symbol: symbol,
            exchange: exchange
        }).then(matches => _.first(matches)).then(security =>{
            if (_.isEmpty(security)) throw Error("Unknown symbol: " + symbol);
            else if (security.symbol == symbol) return security;
            else throw Error("Unknown symbol: " + symbol + ", but " + security.symbol + " is known");
        });
    }, (symbol, exchange) => {
        return exchange ? symbol + ' ' + exchange : symbol;
    });
    return function(options) {
        expect(options).to.have.property('symbol');
        var symbol = options.symbol.toUpperCase();
        var exchange = options.exchange;
        var exchanges = config('exchanges');
        if (exchange) expect(exchange).to.be.oneOf(_.keys(exchanges));
        var args = _.toArray(arguments);
        return memoizeFirstLookup(symbol, exchange).then(security => {
            return _.extend(
                _.omit(exchanges[security.exchange], 'datasources', 'label', 'description'),
                options,
                security
            );
        }, err => {
            if (!exchange) throw err;
            logger.warn("Fetch lookup failed", err);
            return _.defaults(
                _.omit(exchanges[exchange], 'datasources', 'label', 'description'),
                options,
                {symbol: symbol}
            );
        }).then(options => {
            var eod = moment(options.now).tz(options.tz).endOf('day');
            var begin = options.begin ? moment.tz(options.begin, options.tz) : eod;
            var oend = options.end && moment.tz(options.end, options.tz);
            var end = oend && eod.isBefore(oend) ? eod : oend; // limit end to end of today
            var pad_begin = options.pad_begin ? options.pad_begin :
                    options.begin ? 0 : 99;
            var pad_end = end && options.pad_end || 0;
            return _.defaults({
                begin: begin,
                pad_begin: pad_begin,
                end: end,
                pad_end: pad_end
            }, options);
        }).then(opt => {
            if (!opt.begin.isValid())
                throw Error("Begin date is not valid " + options.begin);
            if (opt.end && !opt.end.isValid())
                throw Error("End date is not valid " + options.end);
            return opt;
        });
    };
}

function quote(fetch, store, options) {
    return getPossibleFields(fetch, options).then(fields => {
        var exprMap = getExpressionsMap(fields, options);
        var exprFields = _.mapObject(exprMap, (exprs, interval) => {
            return _.keys(exprs).concat(fields[interval]);
        });
        var criteria = expressions.parseCriteriaMap(options.criteria, exprFields, options);
        var name = options.exchange ?
            options.symbol + '.' + options.exchange : options.symbol;
        var intervals = _.keys(exprMap);
        expect(intervals).not.to.be.empty;
        var interval = intervals[0];
        intervals.forEach(interval => expect(interval).to.be.oneOf(periods.values));
        return store.open(name, (err, db) => {
            if (err) throw err;
            var quoteBars = fetchBars.bind(this, fetch, db);
            return inlinePadBegin(quoteBars, interval, options)
              .then(options => inlinePadEnd(quoteBars, interval, options))
              .then(options => mergeBars(quoteBars, exprMap, criteria, options));
        });
    }).then(points => formatColumns(points, options));
}

function getPossibleFields(fetch, options) {
    return fetch(_.defaults({interval: 'columns'}, options)).then(fields => {
        return _.object(periods.values, periods.values.map(interval => fields));
    }).then(fields => _.defaults({
        "": ['symbol', 'exchange', 'ending']
    }, fields));
}

function getExpressionsMap(fields, options) {
    if (!options.columns && !options.criteria && !options.interval) return {day:{}};
    else if (!options.columns && !options.criteria) return {[options.interval]:{}};
    else return expressions.parseWarmUpMap(
        _.compact([options.columns, options.criteria]).join(','),
        fields, options
    );
}

function inlinePadBegin(quoteBars, interval, options) {
    if (!options.pad_begin) return Promise.resolve(options);
    else return quoteBars({}, _.defaults({
        interval: interval,
        end: options.begin,
        pad_end: 0
    }, options)).then(bars => {
        if (!bars.length) return options;
        return _.defaults({
            pad_begin: 0,
            begin: moment.tz(bars.first().ending, options.tz)
        }, options);
    });
}

function inlinePadEnd(quoteBars, interval, options) {
    if (!options.pad_end) return Promise.resolve(options);
    else return quoteBars({}, _.defaults({
        interval: interval,
        pad_begin: 0,
        begin: options.end
    }, options)).then(bars => {
        if (!bars.length) return options;
        return _.defaults({
            pad_end: 0,
            end: moment.tz(bars.last().ending, options.tz)
        }, options);
    });
}

function mergeBars(quoteBars, exprMap, criteria, options) {
    var intervals = _.keys(exprMap);
    return intervals.reduceRight((promise, interval) => {
        return promise.then(signals => Promise.all(signals.map(signal => {
            var entry = signal.points ? signal.points.first() : {ending: options.begin.format()};
            var begin = moment.tz(entry.ending, options.tz);
            var end = signal.exit ? moment.tz(signal.exit.ending, options.tz) : options.end;
            var opts = _.defaults({
                interval: interval,
                begin: options.begin.isBefore(begin) ? begin : options.begin,
                end: options.end && options.end.isBefore(end) ? options.end : end
            }, options);
            return quoteBars(exprMap[interval], opts)
              .then(bars => bars.map(bar => createPoint(bar, opts)))
              .then(intraday => {
                var points = signal.points ? new List().concat(signal.points) : new List();
                if (signal.exit) points.push(signal.exit);
                points.reduceRight((stop, point, idx) => {
                    var start = intraday.sortedIndexOf(point, 'ending');
                    for (var j=start; j<stop; j++) {
                        _.defaults(intraday.item(j), point);
                    }
                    return start;
                }, intraday.length);
                return intraday;
            }).then(points => readSignals(points, interval, entry, signal.exit, criteria));
        }))).then(signalsMap => _.flatten(signalsMap, true));
    }, Promise.resolve([{}])).then(signals => {
        return signals.reduce((points, signal, i) => {
            if (i === 0 && options.begin.isAfter(signal.points.first().ending))
                return points.concat(signal.points.slice(1));
            else
                return points.concat(signal.points);
            // TODO what about exit points?
        }, new List());
    });
}

function readSignals(points, interval, entry, exit, criteria) {
    if (!points.length) return [];
    var start = points.sortedIndexOf(entry, 'ending');
    if (start > 0 && (start == points.length || entry.ending < points.item(start).ending))
        start--;
    var expr = criteria[interval];
    if (!expr && exit) return [{
        points: points.slice(start, points.length -1),
        exit: points.last()
    }];
    else if (!expr) return [{
        points: points.slice(start)
    }];
    var entry = 0;
    var signals = [];
    points.slice(start).reduce((position, point, i) => {
        var to = start + i;
        var from = position ? entry : to;
        var pass = expr(points.slice(from, to+1).toArray());
        if (pass && !position) {
            entry = i;
            signals.push({points: new List([point])});
        } else if (pass && position) {
            _.last(signals).points = points.slice(start + entry, start + i +1);
        } else if (!pass && position) {
            _.last(signals).exit = point;
        }
        return pass;
    }, false);
    if (exit && signals.length && !_.last(signals).exit && _.last(signals).points.length > 1)
        _.last(signals).exit = _.last(signals).points.pop();
    return signals;
}

function fetchBars(fetch, db, expressions, options) {
    var name = getCollectionName(options);
    return db.collection(name).then(collection => {
        return fetchNeededBlocks(fetch, collection, options)
          .then(blocks => evalBlocks(collection, blocks, expressions, options))
          .then(blocks => readBlocks(collection, blocks, options));
    });
}

function getCollectionName(options) {
    var m = options.interval.match(/^m(\d+)$/);
    if (m && +m[1] < 30) return options.begin.year() + options.interval;
    else if (m) return options.interval;
    else return 'interday';
}

function fetchNeededBlocks(fetch, collection, options) {
    var period = periods(options);
    var begin = options.begin;
    var start = options.pad_begin ? period.dec(begin, options.pad_begin) : period.floor(begin);
    var end = options.end || moment(options.now).tz(options.begin.tz());
    var stop = options.pad_end ? period.inc(end, options.pad_end) : end;
    var blocks = getBlocks(options.interval, start, stop, options);
    return collection.lockWith(blocks, blocks => fetchBlocks(fetch, options, collection, stop, blocks));
}

function evalBlocks(collection, blocks, expressions, options) {
    if (_.isEmpty(expressions)) return blocks;
    return collection.lockWith(blocks, blocks => blocks.reduce((promise, block, i, blocks) => {
        if (i == 0) return promise; // warmUp block is not evaluated
        var missing = _.difference(_.keys(expressions), collection.columnsOf(block));
        if (!missing.length) return promise;
        return promise.then(dataBlocks => {
            if (!dataBlocks[blocks[i-1]])
                dataBlocks[blocks[i-1]] = collection.readFrom(blocks[i-1]);
            if (!dataBlocks[block])
                dataBlocks[block] = collection.readFrom(block);
            return Promise.all([dataBlocks[blocks[i-1]], dataBlocks[block]])
              .then(results => {
                var data = List.flatten(results, true).map(bar => createPoint(bar, options));
                var bars = _.last(results).map((bar, i, bars) => {
                    return _.extend(bar, _.object(missing, missing.map(expr => {
                        var end = results[0].length + i;
                        var start = Math.max(end - expressions[expr].warmUpLength, 0);
                        return expressions[expr](data.slice(start, end+1).toArray());
                    })));
                });
                return collection.writeTo(bars, block);
            }).then(() => dataBlocks);
        });
    }, Promise.resolve(_.object(blocks, [])))).then(() => blocks.slice(1));
}

function createPoint(bar, options) {
    return {
        ending: bar.ending,
        symbol: options.symbol,
        exchange: options.exchange,
        [options.interval]: bar
    };
}

function readBlocks(collection, blocks, options) {
    return Promise.all(blocks.map(block => collection.readFrom(block)))
      .then(tables => List.flatten(tables, true))
      .then(bars => {
        if (!bars.length) return bars;
        var format = options.begin.format();
        var from = bars.sortedIndexOf({ending: format}, 'ending');
        if (from == bars.length || from > 0 && format < bars.item(from).ending)
            from--; // include prior value for criteria
        var start = Math.min(Math.max(from - options.pad_begin, 0), bars.length -1);
        return bars.slice(start);
    }).then(bars => {
        if (!bars.length || !options.end) return bars;
        var format = options.end.format();
        var to = bars.sortedIndexOf({ending: format}, 'ending');
        if (to < bars.length && format != bars.item(to).ending) to--;
        var stop = Math.min(Math.max(to + options.pad_end, 0), bars.length -1);
        return bars.slice(0, stop +1);
    });
}

function formatColumns(points, options) {
    if (!points.length) return [];
    var fields = _.extend({
        "": _.keys(_.pick(points.first(), _.isString))
    }, _.mapObject(_.pick(points.first(), _.isObject), _.keys));
    var columns = options.columns ||
        _.flatten(_.map(fields, (keys, interval) => keys.map(field => {
            return interval ? interval + '.' + field : field;
        })), true).filter(field => field.match(/^\w+\.\w+$/)).join(',');
    var map = expressions.parseColumnsMap(columns, fields, options);
    var depth = 0;
    return points.map((bar, i, points) => _.mapObject(map, expr => {
        return expr(points.slice(0, i+1).toArray());
    })).toArray();
}

function fetchBlocks(fetch, options, collection, stop, blocks) {
    var fetchComplete = fetchCompleteBlock.bind(this, fetch, options, collection);
    var fetchPartial = fetchPartialBlock.bind(this, fetch, options, collection);
    return Promise.all(blocks.map((block, i, blocks) => {
        var last = i == blocks.length -1;
        if (!collection.exists(block))
            return fetchComplete(block, last);
        var tail = collection.tailOf(block);
        if (_.isEmpty(tail) || !_.last(tail).incomplete)
            return; // empty blocks are complete
        if (i == 0 || _.first(tail).incomplete)
            return fetchComplete(block, last);
        if (i < blocks.length -1 || stop && _.first(tail).ending < stop.format())
            return fetchPartial(block, _.first(tail).ending, blocks[i-1]);
    })).then(() => blocks);
}

function fetchCompleteBlock(fetch, options, collection, block, last) {
    return fetch(blockOptions(block, options)).then(records => {
        if (last && _.isEmpty(records)) return records; // don't write incomplete empty blocks
        return collection.remove(block).then(() => collection.writeTo(records, block));
    });
}

function fetchPartialBlock(fetch, options, collection, block, begin, priorBlock) {
    return fetch(_.defaults({
        begin: begin
    }, blockOptions(block, options))).then(List.from.bind(List)).then(records => {
        if (records.isEmpty()) return; // nothing newer
        return collection.readFrom(block).then(List.from.bind(List)).then(partial => {
            if (partial.last().incomplete) partial.pop();
            var idx = records.sortedIndexOf(partial.last(), 'ending');
            if (records.item(idx).ending == partial.last().ending) idx++;
            records.splice(0, idx);
            var warmUps = collection.columnsOf(block).filter(col => col.match(/\W/));
            if (warmUps.length) {
                var keys = _.intersection(collection.columnsOf(priorBlock), collection.columnsOf(block));
                var fields = {[options.interval]: keys.filter(col => col.match(/^\w+$/))};
                var exprs = _.object(warmUps, warmUps.map(expr => expressions.parse(expr, fields, options)));
                return collection.readFrom(priorBlock).then(prior => {
                    var data = new List().concat(prior, partial, records)
                        .map(bar => ({[options.interval]: bar}));
                    var bars = records.map((bar, i, bars) => {
                        var end = prior.length + partial.length + i;
                        return _.extend(bar, _.mapObject(exprs, expr => {
                            var start = Math.max(end - expr.warmUpLength, 0);
                            return expr(data.slice(start, end+1).toArray());
                        }));
                    });
                    return collection.writeTo(partial.concat(bars).toArray(), block);
                });
            } else {
                return collection.writeTo(partial.concat(records).toArray(), block);
            }
        });
    });
}

/**
 * Includes an extra block at the front for warmUp
 */
function getBlocks(interval, begin, end, options) {
    expect(interval).to.be.ok.and.a('string');
    var m = interval.match(/^m(\d+)$/);
    if (!m && interval != 'day') {
        return [interval]; // month and week are not separated
    } else if (!begin || !begin.isValid()) {
        throw Error("Begin date is not valid " + begin);
    } else if (!end || !end.isValid()) {
        throw Error("End date is not valid " + end);
    } else if (!m) { // day is separated every decade
        var start = begin.year() - 10;
        return _.range(
            Math.floor(start /10) *10,
            Math.floor(end.year() /10) *10 +10,
            10
        );
    } else if (+m[1] >= 30) { // m30 is separated monthly
        var start = moment(begin).subtract(1, 'months');
        return _.range(start.year(), end.year()+1).reduce((blocks, year) => {
            var starting = start.year() == year ? start.month() : 0;
            var ending = end.year() == year ? end.month() : 11;
            return blocks.concat(_.range(starting +1, ending +2).map(month => {
                return month < 10 ? year + '-0' + month : year + '-' + month;
            }));
        }, []);
    } else if (+m[1] >= 5) { // m5 is separated weekly
        var start = moment(begin).subtract(1, 'weeks');
        return _.range(begin.weekYear(), end.weekYear()+1).reduce((blocks, year) => {
            var starting = begin.weekYear() == year ? begin.week() : 1;
            var ending = end.weekYear() == year ? end.week() :
                monent.tz(year + '-02-01', begin.tz()).weeksInYear();
            return blocks.concat(_.range(starting, ending +1).map(week => {
                return week < 10 ? year + '-0' + week : year + '-' + week;
            }));
        }, []);
    }
    // m1 is separated daily
    var blocks = [];
    var start = periods(_.defaults({interval:'day'}, options)).dec(begin, 1);
    var d = moment.tz(start.format('Y-MM-DD'), start.tz());
    var until = end.valueOf();
    while (d.valueOf() <= until) {
        blocks.push(d.format('Y-MM-DD'));
        d.add(1, 'days');
    }
    return blocks;
}

function blockOptions(block, options) {
    var m = options.interval.match(/^m(\d+)$/);
    if (block == options.interval) {
        return _.defaults({
            begin: moment.tz(0, options.tz),
            end: null
        }, options);
    } else if ('day' == options.interval) {
        return _.defaults({
            begin: moment.tz(block + '-01-01', options.tz),
            end: moment.tz((10+block) + '-01-01', options.tz)
        }, options);
    } else if (+m[1] >= 30) {
        var begin = moment.tz(block + '-01', options.tz);
        return _.defaults({
            begin: begin,
            end: moment(begin).add(1, 'months')
        }, options);
    } else if (+m[1] >= 5) {
        var split = block.split('-');
        var year = split[0];
        var week = +split[1];
        var begin = moment.tz(year + '-01-01', options.tz).week(week).startOf('week');
        var end = moment(begin).add(1, 'week');
        return _.defaults({
            begin: begin,
            end: end
        }, options);
    } else {
        var begin = moment.tz(block, options.tz);
        var end = moment(begin).add(1, 'day');
        return _.defaults({
            begin: begin,
            end: end
        }, options);
    }
}
