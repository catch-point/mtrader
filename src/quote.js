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
const Lookup = require('./lookup.js');
const periods = require('./periods.js');
const interrupt = require('./interrupt.js');
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
    var promiseHelp;
    var lookup = Lookup(fetch);
    var store = storage(path.resolve(config('prefix'), 'var/'));
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(fetch);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            var fields = _.first(help).properties;
            var opts = _.pick(options, _.keys(_.first(help).options));
            return lookup(opts).then(opts =>  {
                return quote(fetch, store, fields, opts);
            });
        });
    }, {
        close() {
            return store.close();
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function help(fetch) {
    return fetch({help: true})
      .then(help => _.indexBy(help, 'name'))
      .then(help => _.pick(help, ['lookup', 'interday', 'intraday'])).then(help => {
        var downstream = _.reduce(help, (downstream, help) => _.extend(downstream, help.options), {});
        var variables = periods.values.reduce((variables, interval) => {
            var fields = interval.charAt(0) != 'm' ? help.interday.properties :
                help.intraday ? help.intraday.properties : [];
            return variables.concat(fields.map(field => interval + '.' + field));
        }, ['ending', 'tz', 'currency'].concat(help.lookup.properties));
        return [{
            name: 'quote',
            usage: 'quote(options)',
            description: "Formats historic data into provided columns",
            properties: variables,
            options: _.extend({}, _.omit(downstream, help.lookup.properties), {
                symbol: downstream.symbol,
                exchange: downstream.exchange,
                begin: downstream.begin,
                end: downstream.end,
                interval: downstream.interval,
                columns: {
                    type: 'map',
                    usage: '<expression>',
                    description: "Column expression included in the output. The expression can be any combination of field, constants, and function calls connected by an operator or operators.",
                    seeAlso: ['expression', 'common-functions', 'lookback-functions', 'indicator-functions', 'rolling-functions']
                },
                criteria: {
                    usage: '<expression>',
                    description: "An expression (possibly of an rolling function) of each included security bar that must be true to be included in the result.",
                    seeAlso: ['expression', 'common-functions', 'lookback-functions', 'indicator-functions', 'rolling-functions']
                },
                parameters: {
                    type: 'map',
                    usage: 'string|number',
                    description: "Parameter used to help compute a column. The value must be a constant literal.",
                    seeAlso: ['columns']
                },
                variables: {
                    type: 'map',
                    usage: '<expression>',
                    description: "Variable used to help compute a column. The expression can be any combination of field, constants, and function calls connected by an operator or operators.",
                    seeAlso: ['expression', 'common-functions', 'lookback-functions', 'indicator-functions', 'rolling-functions']
                },
                pad_begin: {
                    usage: '<number of bar>',
                    description: "Sets the number of additional rows to include before the begin date (might be less)"
                },
                pad_end: {
                    usage: '<number of bar>',
                    description: "Sets the number of additional rows to include after the end date (might be less)"
                },
                now: {
                    usage: '<timestamp>',
                    description: "The current date/time this request is started"
                },
                offline: {
                    usage: 'true',
                    description: "If only the local data should be used in the computation"
                },
                transient: {
                    usage: 'true',
                    description: "If no computed columns should be persisted to disk. Useful when evaluating expressions, over a short time period, that might not be evaluated again."
                }
            })
        }];
    });
}

/**
 * Given begin/end range, columns, and criteria returns an array of row objects
 * that each pass the given criteria and are within the begin/end range.
 */
function quote(fetch, store, fields, options) {
    var exprMap = parseWarmUpMap(fields, options);
    var cached = _.mapObject(exprMap, _.keys);
    var intervals = periods.sort(_.keys(exprMap));
    if (_.isEmpty(intervals)) throw Error("At least one column need to reference an interval fields");
    var criteria = parseCriteriaMap(options.criteria, fields, cached, intervals, options);
    var name = options.exchange ?
        options.symbol + '.' + options.exchange : options.symbol;
    var interval = intervals[0];
    intervals.forEach(interval => expect(interval).to.be.oneOf(periods.values));
    return store.open(name, (err, db) => {
        if (err) throw err;
        var quoteBars = fetchBars.bind(this, fetch, db, fields);
        return inlinePadBegin(quoteBars, interval, options)
          .then(options => inlinePadEnd(quoteBars, interval, options))
          .then(options => mergeBars(quoteBars, exprMap, criteria, options));
    }).then(signals => formatColumns(fields, signals, options));
}

/**
 * Finds out what intervals are used in columns and criteria and put together a
 * list of what expressions should be computed and stored for further reference.
 */
function parseWarmUpMap(fields, options) {
    var exprs = _.compact(_.flatten([
        _.values(options.columns), options.criteria
    ]));
    if (!exprs.length && !options.interval) return {day:{}};
    else if (!exprs.length) return {[options.interval]:{}};
    var p = createParser(fields, {}, options);
    var parser = Parser({
        substitutions: getVariables(fields, options),
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
            map.warmUpLength = _.max([0].concat(_.pluck(args, 'warmUpLength')));
            if (fn.warmUpLength>map.warmUpLength && fn.sideEffect)
                throw Error("Cannot use lookback function " + name + " with side effects: " + expr);
            if (_.size(fn.intervals)!=1 || fn.warmUpLength==map.warmUpLength || !_.isFinite(fn.warmUpLength))
                return map;
            return {[_.first(fn.intervals)]: {[expr]: fn}, warmUpLength: fn.warmUpLength};
        }
    });
    var values = parser.parse(exprs).map(o => _.omit(o, 'warmUpLength'));
    var intervals = periods.sort(_.uniq(_.flatten(values.map(_.keys), true)));
    return _.object(intervals, intervals.map(interval => {
        return _.extend.apply(_, _.compact(_.pluck(values, interval)));
    }));
}

/**
 * Create a function for each interval that should be evaluated to include in result.
 */
function parseCriteriaMap(criteria, fields, cached, intervals, options) {
    var list = createParser(fields, cached, options).parseCriteriaList(criteria);
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
function createParser(fields, cached, options) {
    return Parser({
        substitutions: getVariables(fields, options),
        constant(value) {
            return () => value;
        },
        variable(name) {
            if (_.contains(['symbol', 'exchange', 'ending'], name))
                return _.compose(_.property(name), _.last);
            else if (!~name.indexOf('.') && ~fields.indexOf(name))
                return _.constant(options[name]);
            else if (!~name.indexOf('.'))
                throw Error("Unknown field: " + name);
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
                indicator(name, args, options);
            if (!fn) throw Error("Unknown function: " + name);
            var interval =_.first(fn.intervals);
            if (!_.contains(cached[interval], expr)) return fn;
            else return _.extend(_.compose(_.property(expr), _.property(interval), _.last), {
                intervals: fn.intervals
            });
        }
    });
}

/**
 * Returns map of variables and columns, excluding columns with field names
 */
function getVariables(fields, options) {
    var params = _.mapObject(_.pick(options.parameters, val => {
        return _.isString(val) || _.isNumber(val);
    }), val => JSON.stringify(val));
    var opts = _.mapObject(_.pick(options, (val, name) => {
        if (~fields.indexOf(name))
            return _.isString(val) || _.isNumber(val);
    }), val => JSON.stringify(val));
    var nulls = _.mapObject(_.pick(options.parameters, _.isNull), val => "NULL()");
    var cols = _.omit(options.columns, fields);
    return _.defaults({}, options.variables, params, nulls, cols, opts);
}

/**
 * Changes pad_begin to zero and adjusts begin by reading the bars from a block
 */
function inlinePadBegin(quoteBars, interval, opts) {
    var options = formatBeginEnd(opts);
    if (!options.pad_begin) return Promise.resolve(options);
    else return quoteBars({}, _.defaults({
        interval: interval,
        end: options.begin,
        pad_end: 0
    }, options)).then(bars => {
        if (!bars.length) return options;
        var start = _.sortedIndex(bars, {ending: options.begin}, 'ending');
        var i = Math.max(start - options.pad_begin, 0);
        return _.defaults({
            pad_begin: 0,
            begin: bars[i].ending
        }, options);
    });
}

/**
 * Formats begin and end options.
 */
function formatBeginEnd(options) {
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
            end: _.last(bars).ending
        }, options);
    });
}

/**
 * For each expression interval it reads the bars and evaluates the criteria.
 * @returns the combined bars as a list of points
 */
function mergeBars(quoteBars, exprMap, criteria, options) {
    var intervals = _.keys(exprMap);
    return intervals.reduceRight((promise, interval) => {
        return promise.then(signals => Promise.all(signals.map(signal => {
            var entry = signal.points ? _.first(signal.points) : {ending: options.begin};
            var end = signal.exit ? signal.exit.ending : options.end;
            var opts = _.defaults({
                interval: interval,
                begin: options.begin < entry.ending ? entry.ending : options.begin,
                end: options.end && options.end < end ? options.end : end && end
            }, options);
            return quoteBars(exprMap[interval], opts)
              .then(bars => createPoints(bars, opts))
              .then(intraday => {
                var points = signal.points ? signal.points.slice(0) : [];
                if (signal.exit) points.push(signal.exit);
                points.reduceRight((stop, point, idx) => {
                    var start = _.sortedIndex(intraday, point, 'ending');
                    var lt = start < intraday.length;
                    var last = idx == points.length-1;
                    if (start > 0 && lt && intraday[start].ending != point.ending || !lt && !last) {
                        var item = _.defaults({ending: point.ending}, intraday[start -1]);
                        intraday.splice(start, 0, item);
                        stop++;
                    }
                    for (var j=start; j<stop; j++) {
                        _.defaults(intraday[j], point);
                    }
                    return start;
                }, intraday.length);
                return intraday;
            }).then(points => readSignals(points, entry, signal.exit, criteria[interval]));
        }))).then(signalsMap => {
            return signalsMap.reduce((result, signals) => {
                while (result.length && signals.length && _.first(_.first(signals).points).ending <= _.last(_.last(result).points).ending) {
                    // remove overlap
                    if (_.first(signals).points.length == 1) signals.shift();
                    else _.first(signals).points.shift();
                }
                return result.concat(signals);
            }, []);
        });
    }, Promise.resolve([{}])).then(signals => {
        if (signals.length && options.begin > _.first(_.first(signals).points).ending) {
            if (_.first(signals).points.length == 1) signals.shift();
            else _.first(signals).points = _.first(signals).points.slice(1);
        }
        return signals.reduce((points, signal) => {
            return points.concat(signal.points);
        }, []);
    });
}

/**
 * Identifies the entry and exit points and returns an array of these signals
 */
function readSignals(points, entry, exit, criteria) {
    if (!points.length) return [];
    var check = interrupt();
    var start = _.sortedIndex(points, entry, 'ending');
    if (start > 0 && (start == points.length || entry.ending < points[start].ending))
        start--;
    if (!criteria && exit) return [{
        points: points.slice(start, points.length -1),
        exit: _.last(points)
    }];
    else if (!criteria) return [{
        points: points.slice(start)
    }];
    var e = 0;
    var signals = [];
    criteria = criteria || _.constant(true);
    points.slice(start).reduce((active, point, i) => {
        check();
        var to = start + i;
        var keep = criteria(points.slice(active ? e : to, to+1)) ||
            active && e != to && criteria(points.slice(to, to+1));
        if (keep) {
            if (active) { // extend
                _.last(signals).points = points.slice(start + e, start + i +1);
            } else { // reset
                e = i;
                signals.push({points: [point]});
            }
        } else if (active) {
            _.last(signals).exit = point;
        }
        return keep;
    }, false);
    if (exit && signals.length && !_.last(signals).exit) {
        if (_.last(_.last(signals).points).ending < exit.ending) _.last(signals).exit = exit;
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
function fetchBars(fetch, db, fields, expressions, options) {
    var warmUpLength = _.max(_.pluck(_.values(expressions), 'warmUpLength').concat([0]));
    var name = getCollectionName(options);
    return db.collection(name).then(collection => {
        return fetchNeededBlocks(fetch, fields, collection, warmUpLength, options)
          .then(blocks => readBlocks(collection, warmUpLength, blocks, expressions, options))
          .then(tables => trimTables(tables, options));
    }).catch(err => {
        if (!options.offline) throw err;
        else return db.flushCache().then(() => {
            throw Error("Couldn't read needed data, try again without offline flag " + err.message);
        });
    });
}

/**
 * The storage location used for this interval.
 */
function getCollectionName(options) {
    var m = options.interval.match(/^m(\d+)$/);
    if (m && +m[1] < 30) return options.begin.substring(0,4) + options.interval;
    else if (m) return options.interval;
    else return 'daily';
}

/**
 * Determines the blocks that will be needed for this begin/end range.
 */
function fetchNeededBlocks(fetch, fields, collection, warmUpLength, options) {
    var period = periods(options);
    var begin = options.begin;
    var pad_begin = options.pad_begin + warmUpLength;
    var start = pad_begin ? period.dec(begin, pad_begin) : period.floor(begin);
    var end = options.end || moment(options.now).tz(options.tz);
    var stop = options.pad_end ? period.inc(end, options.pad_end) : moment.tz(end, options.tz);
    var blocks = getBlocks(options.interval, start, stop, options);
    if (options.offline) return Promise.resolve(blocks);
    else return collection.lockWith(blocks, blocks => {
        var version = getStorageVersion(collection);
        return fetchBlocks(fetch, fields, options, collection, version, stop, blocks);
    });
}

/**
 * Read the blocks into memory and ensure that expressions have already been computed
 */
function readBlocks(collection, warmUpLength, blocks, expressions, options) {
    if (_.isEmpty(expressions))
        return Promise.all(blocks.map(block => collection.readFrom(block)));
    var dataPoints = _.object(blocks, []);
    return collection.lockWith(blocks, blocks => blocks.reduce((promise, block, i, blocks) => {
        var last = _.last(collection.tailOf(block));
        if (!last || options.begin > last.ending)
            return promise; // warmUp blocks are not evaluated
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
            return Promise.all(blocks.slice(0, i+1).map(block => {
                if (dataPoints[block]) return dataPoints[block];
                else return dataPoints[block] = dataBlocks[block].then(bars => createPoints(bars, options));
            })).then(results => {
                var dataSize = results.reduce((size,result) => size + result.length, 0);
                var warmUpRecords = dataSize - _.last(results).length;
                var bars = _.last(results).map((point, i, points) => {
                    var bar = point[options.interval];
                    if (options.transient) {
                        if (points[i+1] && points[i+1].ending < options.begin)
                            return bar;
                        if (options.end && points[i-1] && points[i-1].ending > options.end)
                            return bar;
                        bar = _.clone(bar);
                    }
                    return _.extend(bar, _.object(missing, missing.map(expr => {
                        var end = warmUpRecords + i;
                        var start = Math.max(end - expressions[expr].warmUpLength, 0);
                        return expressions[expr](flattenSlice(results, start, end+1));
                    })));
                });
                dataBlocks[block] = bars;
                if (options.transient) return dataBlocks;
                else return collection.writeTo(bars, block).then(() => {
                    var value = collection.propertyOf(block, 'warmUpBlocks') || [];
                    var blocks = _.union(value, warmUpBlocks).sort();
                    collection.propertyOf(block, 'warmUpBlocks', blocks);
                }).then(() => dataBlocks);
            });
        });
    }, Promise.resolve(_.object(blocks, [])))).then(dataBlocks => {
        return Promise.all(blocks.map(block => dataBlocks[block] || collection.readFrom(block)));
    });
}

/**
 * Convert bars into points (a point contains bars from multilpe intervals).
 */
function createPoints(bars, options) {
    return bars.map(bar => ({
        ending: bar.ending,
        symbol: options.symbol,
        exchange: options.exchange,
        [options.interval]: bar
    }));
}

/**
 * Optimized version of _.flatten(array, true).slice(start, end)
 */
function flattenSlice(array, start, end) {
    var chunks = array.slice(0);
    while (start >= _.first(chunks).length) {
        var len = chunks.shift().length;
        start -= len;
        end -= len;
    }
    var totalSize = chunks.reduce((size, chunk) => size + chunk.length, 0);
    while (end <= totalSize - _.last(chunks).length) {
        totalSize -= chunks.pop().length;
    }
    if (chunks.length == 1) return chunks[0].slice(start, end);
    if (start > 0) chunks[0] = chunks[0].slice(start);
    if (end < totalSize) chunks.push(chunks.pop().slice(0, end - totalSize));
    return Array.prototype.concat.apply([], chunks);
}

/**
 * trims the result to be within the begin/end range
 */
function trimTables(tables, options) {
    var dataset = tables.filter(table => table.length);
    if (!dataset.length) return [];
    while (dataset.length > 1 && _.first(dataset[1]).ending < options.begin) {
        dataset.shift();
    }
    var bars = _.flatten(dataset, true);
    if (!bars.length) return bars;
    var format = options.begin;
    var from = _.sortedIndex(bars, {ending: format}, 'ending');
    if (from == bars.length || from > 0 && format < bars[from].ending)
        from--; // include prior value for criteria
    var start = Math.min(Math.max(from - options.pad_begin, 0), bars.length -1);
    bars = bars.slice(start);
    if (!bars.length || !options.end) return bars;
    var format = options.end;
    var to = _.sortedIndex(bars, {ending: format}, 'ending');
    if (to < bars.length && format != bars[to].ending) to--;
    var stop = Math.min(Math.max(to + options.pad_end, 0), bars.length -1);
    return bars.slice(0, stop +1);
}

/**
 * Converts list of points into array of rows keyed by column names
 */
function formatColumns(fields, points, options) {
    if (!points.length) return [];
    var props = _.mapObject(_.pick(_.first(points), _.isObject), _.keys);
    var fieldCols = _.mapObject(props, (props, interval) => {
        var keys = props.filter(field => field.match(/^\w+$/));
        var values = keys.map(field => interval + '.' + field);
        return _.object(keys, values);
    }); // {interval: {field: "$interval.$field"}}
    var columns = options.columns ? options.columns :
        _.size(props) == 1 ? _.first(_.values(fieldCols)) :
        _.reduce(fieldCols, (map, fieldCols) => {
            return _.defaults(map, _.object(_.values(fieldCols), _.values(fieldCols)));
        }, {});
    var map = createParser(fields, props, options).parse(columns);
    return points.map(point => _.mapObject(map, expr => expr([point])));
}

/**
 * Returns a compatibility version used to indicate if the block needs to be reset
 */
function getStorageVersion(collection) {
    var blocks = collection.listNames();
    var versions = blocks
        .map(block => collection.propertyOf(block, 'version'))
        .filter(version => version && version.indexOf(minor_version) === 0);
    var len = _.max(_.map(versions, 'length'));
    var version = _.last(versions.filter(version => version.length==len).sort());
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
function fetchBlocks(fetch, fields, options, collection, version, stop, blocks) {
    var fetchComplete = fetchCompleteBlock.bind(this, fetch, options, collection, version);
    var fetchPartial = fetchPartialBlock.bind(this, fetch, fields, options, collection);
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
            return fetchPartial(block, _.first(tail).ending).catch(error => {
                logger.warn("Fetch failed", error);
            });
    })).then(results => {
        if (!_.contains(results, 'incompatible')) return blocks;
        var version = createStorageVersion();
        return fetchBlocks(fetch, fields, options, collection, version, stop, blocks);
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
function fetchPartialBlock(fetch, fields, options, collection, block, begin) {
    return fetch(_.defaults({
        begin: begin
    }, blockOptions(block, options))).then(records => {
        if (_.isEmpty(records)) return; // nothing newer
        return collection.readFrom(block).then(partial => {
            partial.pop(); // incomplete
            if (!_.isMatch(_.last(partial), records.shift())) return 'incompatible';
            var warmUps = collection.columnsOf(block).filter(col => col.match(/\W/));
            if (warmUps.length) {
                var exprs = _.object(warmUps, warmUps.map(expr => createParser(fields, {}, options).parse(expr)));
                var warmUpBlocks = collection.propertyOf(block, 'warmUpBlocks') || [];
                return Promise.all(warmUpBlocks.map(block => collection.readFrom(block)))
                  .then(results => _.flatten(results, true))
                  .then(prior => {
                    var data = prior.concat(partial, records)
                        .map(bar => ({[options.interval]: bar}));
                    var bars = records.map((bar, i, bars) => {
                        var end = prior.length + partial.length + i;
                        return _.extend(bar, _.mapObject(exprs, expr => {
                            var start = Math.max(end - expr.warmUpLength, 0);
                            return expr(data.slice(start, end+1));
                        }));
                    });
                    return collection.writeTo(partial.concat(bars), block);
                });
            } else {
                return collection.writeTo(partial.concat(records), block);
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
    } else if (!m) { // day is separated every half decade
        var start = begin.year() - 5;
        return _.range(
            Math.floor(start /5) *5,
            Math.floor(end.year() /5) *5 +5,
            5
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
                moment.tz(year + '-02-01', begin.tz()).weeksInYear();
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
        var begin = moment.tz('1990-01-01', options.tz);
        return _.defaults({
            begin: begin.format(),
            end: null
        }, options);
    } else if ('day' == options.interval) {
        var begin = moment.tz(block + '-01-01', options.tz);
        var end = moment.tz((5+block) + '-01-01', options.tz);
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
