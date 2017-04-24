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
const minor_version = require('../package.json').version.replace(/^(\d+\.\d+).*$/,'$1.0');
const storage = require('./storage.js');
const periods = require('./periods.js');
const List = require('./list.js');
const Parser = require('./parser.js');
const common = require('../src/common-functions.js');
const lookback = require('../src/lookback-functions.js');
const indicator = require('../src/indicator-functions.js');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

/**
 * @returns a function that returns array of row objects based on given options
 */
module.exports = function(fetch) {
    var store = storage(path.resolve(config('prefix'), 'var/quotes/'));
    var fetchOptions = fetchOptionsFactory(fetch);
    var self = function(options) {
        return fetchOptions(options).then(options => quote(fetch, store, options));
    };
    self.close = () => store.close();
    return self;
};

/**
 * Converts begin/end to moments and includes some additional options like yahoo_symbol.
 */
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
                    options.begin ? 0 : 100;
            var pad_end = end && options.pad_end || 0;
            if (!begin.isValid())
                throw Error("Begin date is not valid " + options.begin);
            if (end && !end.isValid())
                throw Error("End date is not valid " + options.end);
            return _.defaults({
                begin: begin.format(),
                pad_begin: pad_begin,
                end: end && end.format(),
                pad_end: pad_end
            }, options);
        });
    };
}

/**
 * Given begin/end range, columns, and retain returns an array of row objects
 * that each pass the given criteria and are within the begin/end range.
 */
function quote(fetch, store, options) {
    var exprMap = parseWarmUpMap(options);
    var cached = _.mapObject(exprMap, _.keys);
    var intervals = periods.sort(_.keys(exprMap));
    var retain = parseCriteriaMap(options.retain, cached, intervals, options);
    var criteria = parseCriteriaMap(options.criteria, cached, intervals, options);
    var name = options.exchange ?
        options.symbol + '.' + options.exchange : options.symbol;
    expect(intervals).not.to.be.empty;
    var interval = intervals[0];
    intervals.forEach(interval => expect(interval).to.be.oneOf(periods.values));
    return store.open(name, (err, db) => {
        if (err) throw err;
        var quoteBars = fetchBars.bind(this, fetch, db);
        return inlinePadBegin(quoteBars, interval, options)
          .then(options => inlinePadEnd(quoteBars, interval, options))
          .then(options => mergeBars(quoteBars, exprMap, retain, criteria, options));
    }).then(signals => formatColumns(signals, options));
}

/**
 * Finds out what intervals are used in columns and retain and put together a
 * list of what expressions should be computed and stored for further reference.
 */
function parseWarmUpMap(options) {
    var exprs = _.compact(_.flatten([options.columns, options.criteria, options.retain])).join(',');
    if (!exprs.length && !options.interval) return {day:{}};
    else if (!exprs.length) return {[options.interval]:{}};
    var p = createParser({}, options);
    var parser = Parser({
        substitutions: _.flatten([options.columns]).join(','),
        constant(value) {
            return {warmUpLength: 0};
        },
        variable(name) {
            if (!~name.indexOf('.')) return {warmUpLength: 0};
            else return {[name.substring(0, name.indexOf('.'))]: {}, warmUpLength: 0};
        },
        expression(expr, name, args) {
            var fn = p.parse(expr);
            var args_inters = _.without(_.flatten(args.map(_.keys), true), 'warmUpLength');
            var inters = periods.sort(_.uniq(args_inters.concat(fn.intervals || [])));
            var map = _.object(inters, inters.map(interval => {
                return _.extend.apply(_, _.compact(_.pluck(args, interval)));
            }));
            map.warmUpLength = _.max(_.pluck(args, 'warmUpLength'));
            if (_.size(fn.intervals)!=1 || fn.warmUpLength==map.warmUpLength || !_.isFinite(fn.warmUpLength))
                return map;
            return {[_.first(fn.intervals)]: {[expr]: fn}, warmUpLength: fn.warmUpLength};
        }
    });
    var values = _.values(_.mapObject(parser.parseColumnsMap(exprs), o => _.omit(o, 'warmUpLength')));
    var intervals = periods.sort(_.uniq(_.flatten(values.map(_.keys), true)));
    return _.object(intervals, intervals.map(interval => {
        return _.extend.apply(_, _.compact(_.pluck(values, interval)));
    }));
}

/**
 * Create a function for each interval that should be evaluated to include in result.
 */
function parseCriteriaMap(criteria, cached, intervals, options) {
    var list = createParser(cached, options).parseCriteriaList(criteria);
    var group = list.reduce((m, fn) => {
        var interval = _.first(fn.intervals);
        if (m[interval]) {
            m[interval] = m[interval].concat([fn]);
            return m;
        } else return _.extend(m, {
            [interval]: [fn]
        });
    }, {});
    _.reduceRight(intervals, (ar, interval) => {
        if (!group[interval]) return group[interval] = ar;
        return group[interval] = group[interval].concat(ar);
    }, []);
    return _.mapObject(group, (list, interval) => {
        return bars => _.every(list, fn => fn(bars));
    });
}

/**
 * Creates a parser that can parse expressions into functions
 */
function createParser(cached, options) {
    return Parser({
        substitutions: _.flatten([options.columns]).join(','),
        constant(value) {
            return () => value;
        },
        variable(name) {
            if (_.contains(['symbol', 'exchange', 'ending'], name))
                return _.compose(_.property(name), _.last);
            else if (_.has(options, name) && !_.isObject(options[name]) && name.match(/^\w+$/))
                return _.constant(options[name]);
            else if (!~name.indexOf('.'))
                throw Error("Unknown field: " + name + " in " + options.symbol);
            var interval = name.substring(0, name.indexOf('.'));
            expect(interval).to.be.oneOf(periods.values);
            var lname = name.substring(name.indexOf('.')+1);
            return _.extend(_.compose(_.property(lname), _.property(interval), _.last), {
                intervals: [interval]
            });
        },
        expression(expr, name, args) {
            var fn = common(name, args, options) ||
                lookback(name, args, options) ||
                indicator(name, args, options) ||
                name == 'LEADING' && leading(_.first(args));
            if (!fn) throw Error("Unknown function: " + name);
            var interval =_.first(fn.intervals);
            if (!_.contains(cached[interval], expr)) return fn;
            else return _.extend(_.compose(_.property(expr), _.property(interval), _.last), {
                intervals: fn.intervals
            });
        }
    });
}

function leading(arg) {
    return _.extend(points => {
        return arg(points.slice(0, 1));
    }, {
        intervals: arg.intervals,
        warmUpLength: Infinity
    });
}

/**
 * Changes pad_begin to zero and adjusts begin by reading the bars from a block
 */
function inlinePadBegin(quoteBars, interval, options) {
    if (!options.pad_begin) return Promise.resolve(options);
    else return quoteBars({}, _.defaults({
        interval: interval,
        end: options.begin,
        pad_end: 0
    }, options)).then(bars => {
        if (!bars.length) return options;
        var start = bars.sortedIndexOf({ending: options.begin}, 'ending');
        var i = Math.max(start - options.pad_begin, 0);
        return _.defaults({
            pad_begin: 0,
            begin: bars.item(i).ending
        }, options);
    });
}

/**
 * Changes pad_end to zero and adjusts end by reading the bars from a block
 */
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
            end: bars.last().ending
        }, options);
    });
}

/**
 * For each expression interval it reads the bars and evaluates the retain.
 * @returns the combined bars as an array of points
 */
function mergeBars(quoteBars, exprMap, retain, criteria, options) {
    var intervals = _.keys(exprMap);
    return intervals.reduceRight((promise, interval) => {
        return promise.then(signals => Promise.all(signals.map(signal => {
            var entry = signal.points ? signal.points.first() : {ending: options.begin};
            var end = signal.exit ? signal.exit.ending : options.end;
            var opts = _.defaults({
                interval: interval,
                begin: options.begin < entry.ending ? entry.ending : options.begin,
                end: options.end && options.end < end ? options.end : end && end
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
            }).then(points => readSignals(points, entry, signal.exit, retain[interval], criteria[interval]));
        }))).then(signalsMap => {
            return signalsMap.reduce((result, signals) => {
                while (result.length && signals.length && _.first(signals).points.first().ending <= result.last().points.last().ending) {
                    // remove overlap
                    if (_.first(signals).points.length == 1) signals.shift();
                    else _.first(signals).points.shift();
                }
                return result.concat(signals);
            }, new List()).toArray();
        });
    }, Promise.resolve([{}])).then(signals => {
        if (signals.length && options.begin > _.first(signals).points.first().ending) {
            if (_.first(signals).points.length == 1) signals.shift();
            else _.first(signals).points = _.first(signals).points.slice(1);
        }
        return signals;
    });
}

/**
 * Identifies the entry and exit points and returns an array of these signals
 */
function readSignals(points, entry, exit, retain, criteria) {
    if (!points.length) return [];
    var start = points.sortedIndexOf(entry, 'ending');
    if (start > 0 && (start == points.length || entry.ending < points.item(start).ending))
        start--;
    if (!retain && !criteria && exit) return [{
        points: points.slice(start, points.length -1),
        exit: points.last()
    }];
    else if (!retain && !criteria) return [{
        points: points.slice(start)
    }];
    var e = 0;
    var signals = [];
    retain = retain || _.constant(true);
    criteria = criteria || _.constant(true);
    points.slice(start).reduce((position, point, i) => {
        var to = start + i;
        var active = position && _.last(signals).leading;
        var keep = retain(points.slice(active ? e : to, to+1).toArray()) ||
            position && e != to && retain(points.slice(to, to+1).toArray());
        var hold = active && criteria(points.slice(active ? e : to, to+1).toArray());
        var pass = hold || criteria(points.slice(to, to+1).toArray());
        if (keep && pass) {
            if (hold) { // extend
                _.last(signals).points = points.slice(start + e, start + i +1);
            } else { // reset
                if (position) {
                    _.last(signals).exit = point;
                }
                e = i;
                signals.push({leading: point, points: new List([point])});
            }
        } else if (keep) {
            // retain w/o leading
            if (position && !_.last(signals).leading) { // extend
                _.last(signals).points = points.slice(start + e, start + i +1);
            } else { // reset
                if (position) {
                    _.last(signals).exit = point;
                }
                e = i;
                signals.push({points: new List([point])});
            }
        } else if (position) {
            _.last(signals).exit = point;
        }
        return keep;
    }, false);
    if (exit && signals.length && !_.last(signals).exit) {
        if (_.last(signals).points.last().ending < exit.ending) _.last(signals).exit = exit;
        else if (_.last(signals).points.length == 1) signals.pop();
        else _.last(signals).exit = _.last(signals).points.pop();
    }
    return signals;
}

/**
 * Given a date range and a set of expressions, this reads the bars from blocks
 * and stores the expressions results.
 * @returns the bars of the blocks
 */
function fetchBars(fetch, db, expressions, options) {
    var warmUpLength = _.max(_.pluck(_.values(expressions), 'warmUpLength').concat([0]));
    var name = getCollectionName(options);
    return db.collection(name).then(collection => {
        return fetchNeededBlocks(fetch, collection, warmUpLength, options)
          .then(blocks => evalBlocks(collection, warmUpLength, blocks, expressions, options))
          .then(blocks => readBlocks(collection, blocks, options));
    });
}

/**
 * The storage location used for this interval.
 */
function getCollectionName(options) {
    var m = options.interval.match(/^m(\d+)$/);
    if (m && +m[1] < 30) return options.begin.substring(0,4) + options.interval;
    else if (m) return options.interval;
    else return 'interday';
}

/**
 * Determines the blocks that will be needed for this begin/end range.
 */
function fetchNeededBlocks(fetch, collection, warmUpLength, options) {
    var period = periods(options);
    var begin = options.begin;
    var pad_begin = options.pad_begin + warmUpLength;
    var start = pad_begin ? period.dec(begin, pad_begin) : period.floor(begin);
    var end = options.end || moment(options.now).tz(options.tz);
    var stop = options.pad_end ? period.inc(end, options.pad_end) : moment.tz(end, options.tz);
    var blocks = getBlocks(options.interval, start, stop, options);
    return collection.lockWith(blocks, blocks => {
        var version = getStorageVersion(collection);
        return fetchBlocks(fetch, options, collection, version, stop, blocks);
    });
}

/**
 * If any of the blocks are missing some expressions, evaluate them and store them.
 */
function evalBlocks(collection, warmUpLength, blocks, expressions, options) {
    if (_.isEmpty(expressions)) return blocks;
    return collection.lockWith(blocks, blocks => blocks.reduce((promise, block, i, blocks) => {
        var last = _.last(collection.tailOf(block));
        if (!last || options.begin > last.ending) return promise; // warmUp blocks are not evaluated
        var missing = _.difference(_.keys(expressions), collection.columnsOf(block));
        if (!missing.length) return promise;
        return promise.then(dataBlocks => {
            var warmUpBlocks = blocks.slice(0, i);
            warmUpBlocks.forEach(block => {
                if (!dataBlocks[block])
                    dataBlocks[block] = collection.readFrom(block);
            });
            if (!dataBlocks[block])
                dataBlocks[block] = collection.readFrom(block);
            return Promise.all(blocks.slice(0, i+1).map(block => dataBlocks[block]))
              .then(results => {
                var data = List.flatten(results, true).map(bar => createPoint(bar, options));
                var warmUpRecords = data.length - _.last(results).length;
                var bars = _.last(results).map((bar, i, bars) => {
                    return _.extend(bar, _.object(missing, missing.map(expr => {
                        var end = warmUpRecords + i;
                        var start = Math.max(end - expressions[expr].warmUpLength, 0);
                        return expressions[expr](data.slice(start, end+1).toArray());
                    })));
                });
                return collection.writeTo(bars, block);
            }).then(() => {
                var value = collection.propertyOf(block, 'warmUpBlocks') || [];
                var blocks = _.union(value, warmUpBlocks).sort();
                collection.propertyOf(block, 'warmUpBlocks', blocks);
            }).then(() => dataBlocks);
        });
    }, Promise.resolve(_.object(blocks, [])))).then(() => blocks);
}

/**
 * Convert a bar into a point (a point contains bars from multilpe intervals).
 */
function createPoint(bar, options) {
    return {
        ending: bar.ending,
        symbol: options.symbol,
        exchange: options.exchange,
        [options.interval]: bar
    };
}

/**
 * Reads the blocks and trims the result to be within the begin/end range
 */
function readBlocks(collection, blocks, options) {
    return Promise.all(blocks.map(block => collection.readFrom(block)))
      .then(tables => List.flatten(tables, true))
      .then(bars => {
        if (!bars.length) return bars;
        var format = options.begin;
        var from = bars.sortedIndexOf({ending: format}, 'ending');
        if (from == bars.length || from > 0 && format < bars.item(from).ending)
            from--; // include prior value for retain
        var start = Math.min(Math.max(from - options.pad_begin, 0), bars.length -1);
        return bars.slice(start);
    }).then(bars => {
        if (!bars.length || !options.end) return bars;
        var format = options.end;
        var to = bars.sortedIndexOf({ending: format}, 'ending');
        if (to < bars.length && format != bars.item(to).ending) to--;
        var stop = Math.min(Math.max(to + options.pad_end, 0), bars.length -1);
        return bars.slice(0, stop +1);
    });
}

/**
 * Converts array of signals into array of rows keyed by column names
 */
function formatColumns(signals, options) {
    if (!signals.length) return [];
    var fields = _.mapObject(_.pick(_.first(signals).points.first(), _.isObject), _.keys);
    var columns = options.columns ? _.flatten([options.columns]) :
        _.size(fields) == 1 ? _.first(_.map(fields, (keys, interval) => {
            return keys.filter(field => field.match(/^\w+$/)).map(field => {
                return interval + '.' + field + ' AS "' + field + '"';
            });
        })) :
        _.flatten(_.map(fields, (keys, interval) => {
            return keys.filter(field => field.match(/^\w+$/)).map(field => {
                return interval + '.' + field;
            });
        }), true);
    var map = createParser(fields, options).parseColumnsMap(columns.join(','));
    var depth = 0;
    return signals.reduce((bars, signal) =>
        signal.points.reduce((bars, point, i) => {
            bars.push(_.mapObject(map, expr => {
                if (!signal.leading) return expr([point]);
                else return expr(signal.points.slice(0, i+1).toArray());
            }));
            return bars;
        }, bars), []);
}

/**
 * Returns a compatibility version used to indicate if the block needs to be reset
 */
function getStorageVersion(collection) {
    var blocks = collection.listNames();
    var versions = blocks
        .map(block => collection.propertyOf(block, 'version'))
        .filter(version=>version.indexOf(minor_version) === 0);
    var len = _.max(_.map(versions, 'length'));
    var version = _.last(versions.filter(version=>version.length==len).sort());
    if (version) return version;
    else return createStorageVersion();
}

/**
 * Returns a new version that must match among compatible blocks
 */
function createStorageVersion() {
    return minor_version + '+' + new Date().valueOf().toString(36);
}

/**
 * Checks if any of the blocks need to be updated
 */
function fetchBlocks(fetch, options, collection, version, stop, blocks) {
    var fetchComplete = fetchCompleteBlock.bind(this, fetch, options, collection, version);
    var fetchPartial = fetchPartialBlock.bind(this, fetch, options, collection);
    return Promise.all(blocks.map((block, i, blocks) => {
        var last = i == blocks.length -1;
        if (!collection.exists(block) || collection.propertyOf(block, 'version') != version)
            return fetchComplete(block, last);
        var tail = collection.tailOf(block);
        if (_.isEmpty(tail) || !_.last(tail).incomplete)
            return; // empty blocks are complete
        if (_.first(tail).incomplete)
            return fetchComplete(block, last);
        if (i < blocks.length -1 || stop && _.first(tail).ending < stop.format())
            return fetchPartial(block, _.first(tail).ending);
    })).then(results => {
        if (!_.contains(results, 'incompatible')) return blocks;
        var version = createStorageVersion();
        return fetchBlocks(fetch, options, collection, version, stop, blocks);
    });
}

/**
 * Attempts to load a complete block
 */
function fetchCompleteBlock(fetch, options, collection, version, block, last) {
    return fetch(blockOptions(block, options)).then(records => {
        if (last && _.isEmpty(records)) return records; // don't write incomplete empty blocks
        return collection.remove(block)
          .then(() => collection.writeTo(records, block))
          .then(() => collection.propertyOf(block, 'version', version));
    });
}

/**
 * Attempts to add additional bars to a block
 */
function fetchPartialBlock(fetch, options, collection, block, begin) {
    return fetch(_.defaults({
        begin: begin
    }, blockOptions(block, options))).then(List.from.bind(List)).then(records => {
        if (records.isEmpty()) return; // nothing newer
        return collection.readFrom(block).then(List.from.bind(List)).then(partial => {
            partial.pop(); // incomplete
            if (!_.isMatch(partial.last(), records.shift())) return 'incompatible';
            var warmUps = collection.columnsOf(block).filter(col => col.match(/\W/));
            if (warmUps.length) {
                var exprs = _.object(warmUps, warmUps.map(expr => createParser({}, options).parse(expr)));
                var warmUpBlocks = collection.propertyOf(block, 'warmUpBlocks') || [];
                return Promise.all(warmUpBlocks.map(block => collection.readFrom(block)))
                  .then(results => List.flatten(results, true))
                  .then(prior => {
                    var data = prior.concat(partial, records)
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

/**
 * Determines the begin/end range to load a complete block
 */
function blockOptions(block, options) {
    var m = options.interval.match(/^m(\d+)$/);
    if (block == options.interval) {
        var begin = moment.tz(0, options.tz);
        return _.defaults({
            begin: begin.format(),
            end: null
        }, options);
    } else if ('day' == options.interval) {
        var begin = moment.tz(block + '-01-01', options.tz);
        var end = moment.tz((10+block) + '-01-01', options.tz);
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    } else if (+m[1] >= 30) {
        var begin = moment.tz(block + '-01', options.tz);
        var end = moment(begin).add(1, 'months');
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    } else if (+m[1] >= 5) {
        var split = block.split('-');
        var year = split[0];
        var week = +split[1];
        var begin = moment.tz(year + '-01-01', options.tz).week(week).startOf('week');
        var end = moment(begin).add(1, 'week');
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    } else {
        var begin = moment.tz(block, options.tz);
        var end = moment(begin).add(1, 'day');
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    }
}
