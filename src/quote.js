// quote.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const minor_version = require('./version.js').minor_version;
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
    let promiseHelp;
    const lookup = Lookup(fetch);
    const dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const store = storage(dir);
    return _.extend(function(options) {
        if (!promiseHelp) promiseHelp = help(fetch);
        if (options.help) return promiseHelp;
        else return promiseHelp.then(help => {
            const fields = _.first(help).properties;
            const opts = _.pick(options, _.keys(_.first(help).options));
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
        const downstream = _.reduce(help, (downstream, help) => _.extend(downstream, help.options), {});
        const variables = periods.values.reduce((variables, interval) => {
            const fields = interval.charAt(0) != 'm' ? help.interday.properties :
                help.intraday ? help.intraday.properties : [];
            return variables.concat(fields.map(field => interval + '.' + field));
        }, ['ending', 'tz', 'currency'].concat(help.lookup.properties));
        return [{
            name: 'quote',
            usage: 'quote(options)',
            description: "Formats historic data into provided columns",
            properties: variables,
            options: _.extend({}, _.omit(downstream, help.lookup.properties), {
                label: downstream.label,
                symbol: downstream.symbol,
                market: downstream.market,
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
                read_only: {
                    usage: 'true',
                    descirption: "If only precomputed lookback and indicator function should be used"
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
    const name = options.market ?
        options.symbol + '.' + options.market : options.symbol;
    try {
        if (options.columns) expect(options.columns).not.to.have.property('length'); // not array like
        if (options.variables) expect(options.variables).not.to.have.property('length'); // not array like
        if (options.parameters) expect(options.parameters).not.to.have.property('length'); // not array like
        const exprMap = parseWarmUpMap(fields, options);
        const cached = _.mapObject(exprMap, _.keys);
        const intervals = periods.sort(_.keys(exprMap));
        if (_.isEmpty(intervals)) throw Error("At least one column need to reference an interval fields");
        const criteria = parseCriteriaMap(options.criteria, fields, cached, intervals, options);
        const interval = intervals[0];
        intervals.forEach(interval => expect(interval).to.be.oneOf(periods.values));
        return store.open(name, (err, db) => {
            if (err) throw err;
            const quoteBars = fetchBars.bind(this, fetch, db, fields);
            return inlinePadBegin(quoteBars, interval, options)
              .then(options => inlinePadEnd(quoteBars, interval, options))
              .then(options => mergeBars(quoteBars, exprMap, criteria, options));
        }).then(signals => formatColumns(fields, signals, options));
    } catch (e) {
        throw Error((e.message || e) + " for " + name);
    }
}

/**
 * Finds out what intervals are used in columns and criteria and put together a
 * list of what expressions should be computed and stored for further reference.
 */
function parseWarmUpMap(fields, options) {
    const exprs = _.compact(_.flatten([
        _.compact(_.values(options.columns)), options.criteria
    ]));
    if (!exprs.length && !options.interval) return {day:{}};
    else if (!exprs.length) return {[options.interval]:{}};
    const p = createParser(fields, {}, options);
    const parser = Parser({
        substitutions: getVariables(fields, options),
        constant(value) {
            return {warmUpLength: 0};
        },
        variable(name) {
            if (!~name.indexOf('.')) return {warmUpLength: 0};
            else return {[name.substring(0, name.indexOf('.'))]: {}, warmUpLength: 0};
        },
        expression(expr, name, args) {
            const fn = p.parse(expr);
            const args_inters = _.without(_.flatten(args.map(_.keys), true), 'warmUpLength');
            const inters = periods.sort(_.uniq(args_inters.concat(fn.intervals || [])));
            const map = _.object(inters, inters.map(interval => {
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
    const values = parser.parse(exprs).map(o => _.omit(o, 'warmUpLength'));
    const intervals = periods.sort(_.uniq(_.flatten(values.map(_.keys), true)));
    return _.object(intervals, intervals.map(interval => {
        return _.extend.apply(_, _.compact(_.pluck(values, interval)));
    }));
}

/**
 * Create a function for each interval that should be evaluated to include in result.
 */
function parseCriteriaMap(criteria, fields, cached, intervals, options) {
    const list = createParser(fields, cached, options).parseCriteriaList(criteria);
    const group = list.reduce((m, fn) => {
        const interval = _.first(fn.intervals);
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
            if (_.contains(['symbol', 'market', 'ending'], name))
                return ctx => _.last(ctx)[name];
            else if (!~name.indexOf('.') && ~fields.indexOf(name))
                return _.constant(options[name]);
            else if (!~name.indexOf('.'))
                throw Error("Unknown field: " + name);
            const interval = name.substring(0, name.indexOf('.'));
            expect(interval).to.be.oneOf(periods.values);
            const lname = name.substring(name.indexOf('.')+1);
            return _.extend(ctx => {
                if (!ctx.length) return undefined;
                const last = ctx[ctx.length -1];
                const obj = last[interval];
                return obj ? obj[lname] : undefined;
            }, {
                intervals: [interval]
            });
        },
        expression(expr, name, args) {
            const fn = common(name, args, options) ||
                lookback(name, args, options) ||
                indicator(name, args, options);
            if (!fn) throw Error("Unknown function: " + name);
            const interval =_.first(fn.intervals);
            if (!_.contains(cached[interval], expr)) return fn;
            else return _.extend(ctx => {
                const obj = _.last(ctx)[interval];
                return obj ? obj[expr] : undefined;
            }, {
                intervals: fn.intervals
            });
        }
    });
}

/**
 * Returns map of variables and columns, excluding columns with field names
 */
function getVariables(fields, options) {
    const params = _.mapObject(_.pick(options.parameters, val => {
        return _.isString(val) || _.isNumber(val);
    }), val => JSON.stringify(val));
    const opts = _.mapObject(_.pick(options, (val, name) => {
        if (~fields.indexOf(name))
            return _.isString(val) || _.isNumber(val);
    }), val => JSON.stringify(val));
    const nulls = _.mapObject(_.pick(options.parameters, _.isNull), val => 'NULL()');
    const cols = _.omit(options.columns, fields);
    return _.mapObject(_.defaults({}, options.variables, params, nulls, cols, opts), valOrNull);
}

function valOrNull(value) {
    return value == null || value == '' ? 'NULL()' : value;
}

/**
 * Changes pad_begin to zero and adjusts begin by reading the bars from a block
 */
function inlinePadBegin(quoteBars, interval, opts) {
    const options = formatBeginEnd(opts);
    if (!options.pad_begin) return Promise.resolve(options);
    else return quoteBars({}, _.defaults({
        interval: interval,
        end: options.begin,
        pad_end: 0
    }, options)).then(bars => {
        if (!bars.length) return options;
        const start = _.sortedIndex(bars, {ending: options.begin}, 'ending');
        const i = Math.max(start - options.pad_begin, 0);
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
    const eod = moment.tz(options.now, options.tz).endOf('day');
    const begin = options.begin ? moment.tz(options.begin, options.tz) : eod;
    const oend = options.end && moment.tz(options.end, options.tz);
    const end = !oend || eod.isBefore(oend) ? eod : oend; // limit end to end of today
    const pad_begin = options.pad_begin ? options.pad_begin :
            options.begin ? 0 : 100;
    const pad_end = end && options.pad_end || 0;
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
    const intervals = _.keys(exprMap);
    return intervals.reduceRight((promise, interval) => {
        return promise.then(signals => Promise.all(signals.map(signal => {
            const entry = signal.points ? _.first(signal.points) : {ending: options.begin};
            const end = signal.exit ? signal.exit.ending : options.end;
            const opts = _.defaults({
                interval: interval,
                begin: options.begin < entry.ending ? entry.ending : options.begin,
                end: options.end && options.end < end ? options.end : end && end
            }, options);
            return quoteBars(exprMap[interval], opts)
              .then(bars => createPoints(bars, opts))
              .then(intraday => {
                const points = signal.points ? signal.points.slice(0) : [];
                if (signal.exit) points.push(signal.exit);
                points.reduceRight((stop, point, idx) => {
                    const start = _.sortedIndex(intraday, point, 'ending');
                    const lt = start < intraday.length;
                    const last = idx == points.length-1;
                    if (start > 0 && lt && intraday[start].ending != point.ending || !lt && !last) {
                        const item = _.defaults({ending: point.ending}, intraday[start -1]);
                        intraday.splice(start, 0, item);
                        stop++;
                    }
                    for (let j=start; j<stop; j++) {
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
async function readSignals(points, entry, exit, criteria) {
    if (!points.length) return [];
    const check = interrupt();
    let start = _.sortedIndex(points, entry, 'ending');
    if (start > 0 && (start == points.length || entry.ending < points[start].ending))
        start--;
    if (!criteria && exit) return [{
        points: points.slice(start, points.length -1),
        exit: _.last(points)
    }];
    else if (!criteria) return [{
        points: points.slice(start)
    }];
    let e = 0;
    const signals = [];
    criteria = criteria || _.constant(true);
    await points.slice(start).reduce(async(pactive, point, i) => {
        await check();
        const active = await pactive;
        const to = start + i;
        const keep = criteria(points.slice(active ? e : to, to+1)) ||
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
    }, Promise.resolve(false));
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
    const warmUpLength = _.max(_.pluck(_.values(expressions), 'warmUpLength').concat([0]));
    const name = getCollectionName(options);
    return db.collection(name).then(collection => {
        return fetchNeededBlocks(fetch, fields, collection, warmUpLength, options)
          .then(blocks => readBlocks(collection, warmUpLength, blocks, expressions, options))
          .then(tables => trimTables(tables, options));
    }).catch(err => {
        if (!options.offline && !options.read_only) throw err;
        else return db.flushCache().then(() => {
            throw Error("Couldn't read needed data, try again without offline/read_only flag " + err.message);
        });
    });
}

/**
 * The storage location used for this interval.
 */
function getCollectionName(options) {
    const m = options.interval.match(/^m(\d+)$/);
    if (m && +m[1] < 30) return options.begin.substring(0,4) + options.interval;
    else if (m) return options.interval;
    else return 'daily';
}

/**
 * Determines the blocks that will be needed for this begin/end range.
 */
function fetchNeededBlocks(fetch, fields, collection, warmUpLength, options) {
    const period = periods(options);
    const begin = options.begin;
    const pad_begin = options.pad_begin + warmUpLength;
    const start = pad_begin ? period.dec(begin, pad_begin) : period.floor(begin);
    const end = options.end || moment.tz(options.now, options.tz);
    const stop = options.pad_end ? period.inc(end, options.pad_end) : moment.tz(end, options.tz);
    const blocks = getBlocks(options.interval, start, stop, options);
    if (options.offline) return Promise.resolve(blocks);
    else return collection.lockWith(blocks, blocks => {
        const version = getStorageVersion(collection);
        return fetchBlocks(fetch, fields, options, collection, version, stop.format(), blocks);
    });
}

/**
 * Read the blocks into memory and ensure that expressions have already been computed
 */
function readBlocks(collection, warmUpLength, blocks, expressions, options) {
    if (_.isEmpty(expressions))
        return Promise.all(blocks.map(block => collection.readFrom(block)));
    const dataPoints = _.object(blocks, []);
    return collection.lockWith(blocks, blocks => blocks.reduce((promise, block, i, blocks) => {
        const last = _.last(collection.tailOf(block));
        if (!last || options.begin > last.ending)
            return promise; // warmUp blocks are not evaluated
        const missing = _.difference(_.keys(expressions), collection.columnsOf(block));
        if (!missing.length) return promise;
        else if (options.read_only && !options.transient)
            throw Error("Missing " + _.first(missing) + " try again without the read_only flag");
        return promise.then(dataBlocks => {
            const warmUpBlocks = blocks.slice(0, i);
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
                const dataSize = results.reduce((size,result) => size + result.length, 0);
                const warmUpRecords = dataSize - _.last(results).length;
                const bars = _.last(results).map((point, i, points) => {
                    let bar = point[options.interval];
                    if (options.transient) {
                        if (points[i+1] && points[i+1].ending < options.begin)
                            return bar;
                        if (options.end && points[i-1] && points[i-1].ending > options.end)
                            return bar;
                        bar = _.clone(bar);
                    }
                    return _.extend(bar, _.object(missing, missing.map(expr => {
                        const end = warmUpRecords + i;
                        const start = Math.max(end - expressions[expr].warmUpLength, 0);
                        return expressions[expr](flattenSlice(results, start, end+1));
                    })));
                });
                dataBlocks[block] = bars;
                if (options.transient) return dataBlocks;
                else return collection.writeTo(bars, block).then(() => {
                    const value = collection.propertyOf(block, 'warmUpBlocks') || [];
                    const blocks = _.union(value, warmUpBlocks).sort();
                    return collection.propertyOf(block, 'warmUpBlocks', blocks);
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
        market: options.market,
        [options.interval]: bar
    }));
}

/**
 * Optimized version of _.flatten(array, true).slice(start, end)
 */
function flattenSlice(array, start, end) {
    const chunks = array.slice(0);
    while (start >= _.first(chunks).length) {
        const len = chunks.shift().length;
        start -= len;
        end -= len;
    }
    let totalSize = chunks.reduce((size, chunk) => size + chunk.length, 0);
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
    const dataset = tables.filter(table => table.length);
    if (!dataset.length) return [];
    while (dataset.length > 1 && _.first(dataset[1]).ending < options.begin) {
        dataset.shift();
    }
    let bars = _.flatten(dataset, true);
    if (!bars.length) return bars;
    const formatB = options.begin;
    let from = _.sortedIndex(bars, {ending: formatB}, 'ending');
    if (from == bars.length || from > 0 && formatB < bars[from].ending)
        from--; // include prior value for criteria
    const start = Math.min(Math.max(from - options.pad_begin, 0), bars.length -1);
    bars = bars.slice(start);
    if (!bars.length || !options.end) return bars;
    const formatE = options.end;
    let to = _.sortedIndex(bars, {ending: formatE}, 'ending');
    if (to < bars.length && formatE != bars[to].ending) to--;
    const stop = Math.min(Math.max(to + options.pad_end, 0), bars.length -1);
    return bars.slice(0, stop +1);
}

/**
 * Converts list of points into array of rows keyed by column names
 */
function formatColumns(fields, points, options) {
    if (!points.length) return [];
    const props = _.mapObject(_.pick(_.first(points), _.isObject), _.keys);
    const fieldCols = _.mapObject(props, (props, interval) => {
        const keys = props.filter(field => field.match(/^\w+$/));
        const values = keys.map(field => interval + '.' + field);
        return _.object(keys, values);
    }); // {interval: {field: "$interval.$field"}}
    const columns = options.columns ? options.columns :
        _.size(props) == 1 ? _.first(_.values(fieldCols)) :
        _.reduce(fieldCols, (map, fieldCols) => {
            return _.defaults(map, _.object(_.values(fieldCols), _.values(fieldCols)));
        }, {});
    const map = createParser(fields, props, options).parse(_.mapObject(columns, valOrNull));
    return points.map(point => _.mapObject(map, expr => expr([point])));
}

/**
 * Returns a compatibility version used to indicate if the block needs to be reset
 */
function getStorageVersion(collection) {
    const blocks = collection.listNames();
    const versions = blocks
        .map(block => collection.propertyOf(block, 'version'))
        .filter(version => version && version.indexOf(minor_version) === 0);
    const len = _.max(_.map(versions, 'length'));
    const version = _.last(versions.filter(version => version.length==len).sort());
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
    const cmsg = "Incomplete data try again without the read_only flag";
    const pmsg = "or without the read_only flag";
    const fetchComplete = options.read_only ? () => Promise.reject(Error(cmsg)) :
        fetchCompleteBlock.bind(this, fetch, options, collection, version);
    const fetchPartial = options.read_only ? () => Promise.reject(Error(pmsg)) :
        fetchPartialBlock.bind(this, fetch, fields, options, collection);
    return Promise.all(blocks.map((block, i, blocks) => {
        const last = i == blocks.length -1;
        if (!collection.exists(block) || collection.propertyOf(block, 'version') != version)
            return fetchComplete(block, last);
        const tail = collection.tailOf(block);
        if (_.isEmpty(tail) || !_.last(tail).incomplete)
            return; // empty blocks are complete
        if (_.first(tail).incomplete)
            return fetchComplete(block, last);
        if (i < blocks.length -1 || _.last(tail).ending <= stop || _.last(tail).asof <= stop)
            return fetchPartial(block, _.first(tail).ending).catch(error => {
                if (stop) logger.debug("Need to fetch", _.last(tail).ending);
                logger.debug("Fetch failed", error);
                throw Error("Fetch failed try using the offline flag " + error.message);
            });
    })).then(results => {
        if (!_.contains(results, 'incompatible')) return blocks;
        const version = createStorageVersion();
        return fetchBlocks(fetch, fields, options, collection, version, stop, blocks);
    });
}

/**
 * Attempts to load a complete block
 */
function fetchCompleteBlock(fetch, options, collection, version, block, last) {
    return fetch(blockOptions(block, options)).then(records => {
        if (last && _.isEmpty(records)) return records; // don't write incomplete empty blocks
        return collection.replaceWith(records, block)
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
            const warmUps = collection.columnsOf(block).filter(col => col.match(/\W/));
            if (warmUps.length) {
                const exprs = _.object(warmUps, warmUps.map(expr => createParser(fields, {}, options).parse(expr)));
                const warmUpBlocks = collection.propertyOf(block, 'warmUpBlocks') || [];
                return Promise.all(warmUpBlocks.map(block => collection.readFrom(block)))
                  .then(results => _.flatten(results, true))
                  .then(prior => {
                    const data = createPoints(prior.concat(partial, records), options);
                    const bars = records.map((bar, i, bars) => {
                        const end = prior.length + partial.length + i;
                        return _.extend(bar, _.mapObject(exprs, expr => {
                            const start = Math.max(end - expr.warmUpLength, 0);
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
    const m = interval.match(/^m(\d+)$/);
    if (!m && interval != 'day') {
        return [interval]; // month and week are not separated
    } else if (!begin || !begin.isValid()) {
        throw Error("Begin date is not valid " + begin);
    } else if (!end || !end.isValid()) {
        throw Error("End date is not valid " + end);
    } else if (!m) { // day is separated every half decade
        const start = begin.year() - 5;
        return _.range(
            Math.floor(start /5) *5,
            Math.floor(end.year() /5) *5 +5,
            5
        );
    } else if (+m[1] >= 30) { // m30 is separated monthly
        const start = moment(begin).subtract(1, 'months');
        return _.range(start.year(), end.year()+1).reduce((blocks, year) => {
            const starting = start.year() == year ? start.month() : 0;
            const ending = end.year() == year ? end.month() : 11;
            return blocks.concat(_.range(starting +1, ending +2).map(month => {
                return month < 10 ? year + '-0' + month : year + '-' + month;
            }));
        }, []);
    } else if (+m[1] >= 5) { // m5 is separated weekly
        const start = moment(begin).subtract(1, 'weeks');
        return _.range(begin.weekYear(), end.weekYear()+1).reduce((blocks, year) => {
            const starting = begin.weekYear() == year ? begin.week() : 1;
            const ending = end.weekYear() == year ? end.week() :
                moment.tz(year + '-02-01', begin.tz()).weeksInYear();
            return blocks.concat(_.range(starting, ending +1).map(week => {
                return week < 10 ? year + '-0' + week : year + '-' + week;
            }));
        }, []);
    }
    // m1 is separated daily
    const blocks = [];
    const start = periods(_.defaults({interval:'day'}, options)).dec(begin, 1);
    const d = moment.tz(start.format('Y-MM-DD'), start.tz());
    const until = end.valueOf();
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
    const m = options.interval.match(/^m(\d+)$/);
    if (block == options.interval) {
        const begin = moment.tz('1990-01-01', options.tz);
        return _.defaults({
            begin: begin.format(),
            end: null
        }, options);
    } else if ('day' == options.interval) {
        const begin = moment.tz(block + '-01-01', options.tz);
        const end = moment.tz((5+block) + '-01-01', options.tz);
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    } else if (+m[1] >= 30) {
        const begin = moment.tz(block + '-01', options.tz);
        const end = moment(begin).add(1, 'months');
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    } else if (+m[1] >= 5) {
        const split = block.split('-');
        const year = split[0];
        const week = +split[1];
        const begin = moment.tz(year + '-01-01', options.tz).week(week).startOf('week');
        const end = moment(begin).add(1, 'week');
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    } else {
        const begin = moment.tz(block, options.tz);
        const end = moment(begin).add(1, 'day');
        return _.defaults({
            begin: begin.format(),
            end: end.format()
        }, options);
    }
}
