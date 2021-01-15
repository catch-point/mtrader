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
const version = require('./version.js');
const storage = require('./storage.js');
const Lookup = require('./lookup.js');
const Periods = require('./periods.js');
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
module.exports = function(fetch, settings = {}) {
    let promiseHelp;
    const lookup = Lookup(fetch);
    const cache_dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    const dir = path.resolve(config('prefix'), settings.cache_dir || cache_dir);
    const stores = {};
    const tz = (moment.defaultZone||{}).name || moment.tz.guess();
    return _.extend(async function(options) {
        if (!promiseHelp) promiseHelp = help(fetch);
        if (options.info=='help') return promiseHelp;
        if (options.info=='version') return [{version: version.toString()}];
        if (options.info) return [];
        const market = options.market || '';
        const store = stores[market] = stores[market] || storage(path.resolve(dir, market || ''));
        return promiseHelp.then(help => {
            const fields = _.first(help).properties;
            const opts = _.pick(options, _.keys(_.first(help).options));
            return lookup(opts).then(security =>  {
                return quote(fetch, store, fields, {
                    ...opts,
                    ...security,
                    tz, // quote must save/work in local time-zone
                    ending_format: moment.defaultFormat,
                    salt: settings.salt || config('salt') || ''
                });
            });
        });
    }, {
        close() {
            return Promise.all(_.keys(stores).map(market => stores[market].close()));
        }
    });
};

/**
 * Array of one Object with description of module, including supported options
 */
function help(fetch) {
    return fetch({info:'help'})
      .then(help => _.indexBy(help, 'name'))
      .then(help => _.pick(help, ['lookup', 'interday', 'intraday'])).then(help => {
        const downstream = _.reduce(help, (downstream, help) => _.extend(downstream, help.options), {});
        const variables = Periods.values.reduce((variables, interval) => {
            const fields = interval.charAt(0) != 'm' ? help.interday.properties :
                help.intraday ? help.intraday.properties : [];
            return variables.concat(fields.map(field => interval + '.' + field));
        }, ['ending', 'currency'].concat(help.lookup.properties));
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
                update: {
                    usage: 'true',
                    description: "If the system should (re)fetch the last bar"
                },
                read_only: {
                    usage: 'true',
                    descirption: "If only precomputed lookback and indicator function should be used"
                },
                transient: {
                    usage: 'true',
                    description: "If no computed columns should be persisted to disk. Useful when evaluating expressions, over a short time period, that might not be evaluated again."
                },
                fast_arithmetic: {
                    usage: 'true',
                    description: "If native double-precision numeric operators should be used with fractional errors"
                }
            })
        }];
    });
}

/**
 * Given begin/end range, columns, and criteria returns an array of row objects
 * that each pass the given criteria and are within the begin/end range.
 */
async function quote(fetch, store, fields, options) {
    try {
        if (options.columns) expect(options.columns).not.to.have.property('length'); // not array like
        if (options.variables) expect(options.variables).not.to.have.property('length'); // not array like
        if (options.parameters) expect(options.parameters).not.to.have.property('length'); // not array like
        const exprMap = await parseWarmUpMap(fields, options);
        const cached = _.mapObject(exprMap, _.keys);
        const intervals = Periods.sort(_.keys(exprMap));
        if (_.isEmpty(intervals)) throw Error("At least one column need to reference an interval fields");
        const criteria = await parseCriteriaMap(options.criteria, fields, cached, intervals, options);
        const interval = intervals[0];
        intervals.forEach(interval => expect(interval).to.be.oneOf(Periods.values));
        return store.open(options.symbol, (err, db) => {
            if (err) throw err;
            const quoteBars = fetchBars.bind(this, fetch, db, fields);
            return inlinePadBegin(quoteBars, interval, options)
              .then(options => inlinePadEnd(quoteBars, interval, options))
              .then(options => mergeBars(quoteBars, exprMap, criteria, options));
        }).then(signals => formatColumns(fields, signals, options));
    } catch (e) {
        logger.debug(e);
        throw Error((e.message || e) + " for " + options.symbol);
    }
}

/**
 * Finds out what intervals are used in columns and criteria and put together a
 * list of what expressions should be computed and stored for further reference.
 */
async function parseWarmUpMap(fields, options) {
    const exprs = _.compact(_.flatten([
        _.compact(_.values(options.columns)), options.criteria
    ]));
    if (!exprs.length && !options.interval) return {day:{}};
    else if (!exprs.length) return {[options.interval]:{}};
    const p = createParser(fields, {}, options);
    const parser = new Parser({
        substitutions: getVariables(fields, options),
        constant(value) {
            return {warmUpLength: 0};
        },
        variable(name) {
            if (!~name.indexOf('.')) return {warmUpLength: 0};
            else return {[name.substring(0, name.indexOf('.'))]: {}, warmUpLength: 0};
        },
        async expression(expr, name, args) {
            const fn = await p.parse(expr);
            const args_inters = _.without(_.flatten(args.map(_.keys), true), 'warmUpLength');
            const inters = Periods.sort(_.uniq(args_inters.concat(fn.intervals || [])));
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
    const values = (await parser.parse(exprs)).map(o => _.omit(o, 'warmUpLength'));
    const intervals = Periods.sort(_.uniq(_.flatten(values.map(_.keys), true)));
    return _.object(intervals, intervals.map(interval => {
        return _.extend.apply(_, _.compact(_.pluck(values, interval)));
    }));
}

/**
 * Create a function for each interval that should be evaluated to include in result.
 */
async function parseCriteriaMap(criteria, fields, cached, intervals, options) {
    const list = await createParser(fields, cached, options).parseCriteriaList(criteria);
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
    return new Parser({
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
            expect(interval).to.be.oneOf(Periods.values);
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
            pad_begin: Math.max(+options.pad_begin - start, 0),
            begin: bars[i].ending
        }, options);
    });
}

/**
 * Formats begin and end options.
 */
function formatBeginEnd(options) {
    const tz = options.tz;
    const now = moment.tz(options.now, tz);
    const eod = moment(now).endOf('day');
    const begin = options.begin ? moment.tz(options.begin, tz) : eod;
    const oend = options.end && moment.tz(options.end, tz);
    const end = !oend || eod.isBefore(oend) ? eod : oend; // limit end to end of today
    const pad_begin = options.pad_begin ? +options.pad_begin :
            options.begin ? 0 : 100;
    const pad_end = end && options.pad_end || 0;
    if (!begin.isValid())
        throw Error("Begin date is not valid " + options.begin);
    if (end && !end.isValid())
        throw Error("End date is not valid " + options.end);
    return _.defaults({
        now: now.format(options.ending_format),
        begin: begin.format(options.ending_format),
        pad_begin: pad_begin,
        end: end && end.format(options.ending_format),
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
        const idx = _.sortedIndex(bars, {ending: options.end}, 'ending');
        const start = idx && bars[idx].ending == options.end ? idx : idx -1;
        const i = Math.min(start + options.pad_end, bars.length-1);
        return _.defaults({
            pad_end: Math.max(+options.pad_end + start - i, 0),
            end: bars[i].ending
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
        return readBlocks(fetch, fields, collection, warmUpLength, expressions, options)
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
    if (m) return options.interval;
    else return 'daily';
}

async function readBlocks(fetch, fields, collection, warmUpLength, expressions, options) {
    const period = new Periods(options);
    const start = parseBegin(period, options);
    const start_format = start.format(options.ending_format);
    const now = moment(options.now).tz(options.tz);
    const stop = parseEnd(period, now, options);
    const loaded_blocks = await fetchNeededBlocks(fetch, fields, collection, warmUpLength, start, stop, now, options);
    if (options.transient) {
        const warm_format = period.dec(start, warmUpLength).format(options.ending_format);
        const stop_format = stop.format(options.ending_format);
        const blocks = getBlocks(warmUpLength, start, stop, false, options);
        return readComputedBlocks({
            async readFrom(block) {
                if (collection.exists(block)) return collection.readFrom(block);
                const block_opts = blockOptions(block, options);
                if (block_opts.end < warm_format) return [];
                const begin = warm_format < block_opts.begin ? block_opts.begin : warm_format;
                const end = stop_format < block_opts.end ? stop_format : block_opts.end;
                return fetch({...options, begin, end});
            },
            lockWith(blocks, fn) {
                return fn(blocks);
            },
            tailOf(block) {
                return [{ending: moment.tz(blockOptions(block, options).end, options.tz).subtract(1,'ms')}];
            },
            columnsOf(block) {
                if (!collection.exists(block)) return [];
                else return collection.columnsOf(block);
            },
            writeTo(bars, block) {
                return Promise.resolve();
            },
            propertyOf(block, name, value) {
                return value;
            }
        }, warmUpLength, blocks, start_format, expressions, options);
    } else {
        return readComputedBlocks(collection, warmUpLength, loaded_blocks, start_format, expressions, options);
    }
}

function parseBegin(period, options) {
    const begin = options.begin;
    const pad_begin = +options.pad_begin;
    if (!pad_begin) return moment.tz(begin, options.tz);
    else return period.floor(pad_begin ? period.dec(begin, pad_begin) : begin);
}

function parseEnd(period, now, options) {
    const end = options.pad_end ? period.inc(options.end || now, options.pad_end) :
        moment.tz(options.end || now, options.tz);
    return now.isBefore(end) ? now : end;
}

/**
 * Determines the blocks that will be needed for this date range.
 */
function fetchNeededBlocks(fetch, fields, collection, warmUpLength, start, stop, now, options) {
    const blocks = getBlocks(warmUpLength, start, stop, options.transient, options);
    const future = !stop.isBefore(now);
    const current = future || _.last(getBlocks(warmUpLength, now, now, false, options));
    const latest = future || _.contains(blocks, current);
    if (options.offline || !blocks.length) return Promise.resolve(blocks);
    else return collection.lockWith(blocks, blocks => {
        const store_ver = getStorageVersion(collection);
        return fetchBlocks(fetch, fields, options, collection, store_ver, stop.format(), now, blocks, latest);
    });
}

/**
 * Read the blocks into memory and ensure that expressions have already been computed
 */
function readComputedBlocks(collection, warmUpLength, blocks, begin, expressions, options) {
    const check = interrupt();
    if (_.isEmpty(expressions))
        return Promise.all(blocks.map(block => collection.readFrom(block)));
    const dataPoints = _.object(blocks, []);
    return collection.lockWith(blocks, blocks => blocks.reduce((promise, block, i, blocks) => {
        const last = _.last(collection.tailOf(block));
        if (!last || begin > last.ending)
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
            })).then(async(results) => {
                const dataSize = results.reduce((size,result) => size + result.length, 0);
                const warmUpRecords = dataSize - _.last(results).length;
                const bars = await Promise.all(_.last(results).map(async(point, i, points) => {
                    let bar = point[options.interval];
                    if (options.transient) {
                        if (points[i+1] && points[i+1].ending < options.begin)
                            return bar;
                        if (options.end && points[i-1] && points[i-1].ending > options.end)
                            return bar;
                        bar = _.clone(bar);
                    }
                    const ret = _.extend(bar, _.object(missing, missing.map(expr => {
                        const end = warmUpRecords + i;
                        const start = Math.max(end - expressions[expr].warmUpLength, 0);
                        return expressions[expr](flattenSlice(results, start, end+1));
                    })));
                    await check();
                    return ret;
                }));
                dataBlocks[block] = bars;
                await check();
                return collection.writeTo(bars, block).then(() => {
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
    const begin = parseBegin(new Periods(options), options).format(options.ending_format);
    const dataset = tables.filter(table => table.length);
    if (!dataset.length) return [];
    while (dataset.length > 1 && _.first(dataset[1]).ending < begin) {
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
    const stop = Math.min(Math.max(to + options.pad_end +1, 0), bars.length);
    return bars.slice(0, stop);
}

/**
 * Converts list of points into array of rows keyed by column names
 */
async function formatColumns(fields, points, options) {
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
    const map = await createParser(fields, props, options).parse(_.mapObject(columns, valOrNull));
    return points.map(point => _.mapObject(map, expr => expr([point])));
}

/**
 * Returns a compatibility version used to indicate if the block needs to be reset
 */
function getStorageVersion(collection) {
    const blocks = collection.listNames();
    const versions = blocks
        .map(block => collection.propertyOf(block, 'version'))
        .filter(ver => ver && ver.indexOf(version.major_version) === 0);
    const len = _.max(_.map(versions, 'length'));
    const store_ver = _.last(versions.filter(ver => ver.length==len).sort());
    if (store_ver) return store_ver;
    else return createStorageVersion();
}

/**
 * Returns a new version that must match among compatible blocks
 */
function createStorageVersion() {
    return version.major_version + '+' + new Date().valueOf().toString(36);
}

/**
 * Checks if any of the blocks need to be updated
 */
function fetchBlocks(fetch, fields, options, collection, store_ver, stop, now, blocks, latest_blocks) {
    const cmsg = "Incomplete data try again without the read_only flag";
    const pmsg = "or without the read_only flag";
    const fetchComplete = options.read_only ? () => Promise.reject(Error(cmsg)) :
        fetchCompleteBlock.bind(this, fetch, options, collection, store_ver, now);
    const fetchPartial = options.read_only ? () => Promise.reject(Error(pmsg)) :
        fetchPartialBlock.bind(this, fetch, fields, options, collection, now);
    return Promise.all(blocks.map((block, i, blocks) => {
        const latest = i == blocks.length -1 && latest_blocks;
        if (!collection.exists(block))
            return fetchComplete(block, latest);
        if (collection.propertyOf(block, 'ending_format') != options.ending_format ||
                collection.propertyOf(block, 'version') != store_ver ||
                collection.propertyOf(block, 'salt') != options.salt ||
                collection.propertyOf(block, 'tz') != options.tz)
            return fetchComplete(block, latest);
        const tail = collection.tailOf(block);
        if (collection.propertyOf(block, 'complete'))
            return; // no need to update complete blocks
        if (!collection.sizeOf(block))
            return fetchComplete(block, latest);
        if (options.update || i < blocks.length -1 || (_.last(tail).asof || _.last(tail).ending) <= stop) {
            if (!options.update && isMarketClosed(_.last(tail), now, options)) return;
            if (!now.isAfter(collection.propertyOf(block, 'asof') || _.last(tail).ending))
                return; // already updated it
            return fetchPartial(block, _.first(tail).ending, latest).catch(error => {
                if (stop) logger.debug("Need to fetch", _.last(tail).ending);
                logger.trace("Fetch failed", error);
                throw Error(`Fetch failed in ${collection.filenameOf(block)} try using the offline flag: ${error.message}`);
            });
        }
    })).then(results => {
        if (!_.contains(results, 'incompatible')) return blocks;
        logger.log("Replacing all stored quotes for", options.symbol, options.market);
        const store_ver = createStorageVersion();
        return fetchBlocks(fetch, fields, options, collection, store_ver, stop, now, blocks, latest_blocks);
    });
}

function isMarketClosed(bar, now, options) {
    const periods = new Periods(options);
    const opens_at = periods.floor(bar.asof || bar.ending);
    return now.isBefore(opens_at);
}

/**
 * Attempts to load a complete block
 */
async function fetchCompleteBlock(fetch, options, collection, store_ver, now, block, latest) {
    const records = await fetch(blockOptions(block, options));
    await collection.replaceWith(records, block);
    await collection.propertyOf(block, 'complete', !latest);
    await collection.propertyOf(block, 'version', store_ver);
    await collection.propertyOf(block, 'tz', options.tz);
    await collection.propertyOf(block, 'salt', options.salt);
    await collection.propertyOf(block, 'ending_format', options.ending_format);
    await collection.propertyOf(block, 'asof', now.format(options.ending_format));
}

/**
 * Attempts to add additional bars to a block
 */
function fetchPartialBlock(fetch, fields, options, collection, now, block, begin, latest) {
    return fetch(_.defaults({
        begin: begin
    }, blockOptions(block, options))).then(new_records => {
        if (_.isEmpty(new_records)) return; // nothing newer
        return collection.readFrom(block).then(async(previous) => {
            const partial = previous.slice(0, -1); // remove last incomplete row
            const first = new_records[0]; // overlap
            const records = new_records.slice(1);
            if (!_.isMatch(_.last(partial), first)) {
                logger.debug("Quote blocks incompatible", options.symbol, options.market, _.last(partial), first);
                return 'incompatible';
            }
            await collection.propertyOf(block, 'complete', !latest);
            await collection.propertyOf(block, 'asof', now.format(options.ending_format));
            const warmUps = collection.columnsOf(block).filter(col => col.match(/\W/));
            if (warmUps.length) {
                const warmUps_promises = warmUps.map(expr => createParser(fields, {}, options).parse(expr));
                const exprs = _.object(warmUps, await Promise.all(warmUps_promises));
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
function getBlocks(warmUpLength, begin, end, within, options) {
    // FIXME begin does not consider market closures, so pad a little extra
    expect(options).to.have.property('interval').that.is.ok.and.a('string');
    const interval = options.interval;
    const periods = new Periods(options);
    const m = interval.match(/^m(\d+)$/);
    if (!m && interval != 'day') {
        return [interval]; // month and week are not separated
    } else if (!begin || !begin.isValid()) {
        throw Error("Begin date is not valid " + begin);
    } else if (!end || !end.isValid()) {
        throw Error("End date is not valid " + end);
    } else if (!m && within) {
        const start = Math.floor(begin.year() /5) *5 +5;
        const stop = Math.floor(end.year() /5) *5 -5;
        // don't return anything unless completely within range
        if (start > stop) return [];
        return _.range(start, stop +5, 5);
    } else if (!m) { // day is separated every half decade
        const begin_5yr = Math.floor(begin.year()/5)*5;
        const warm_yr = periods.dec(`${begin_5yr}-01-01`, warmUpLength);
        const start = Math.floor(warm_yr.year() /5) *5;
        const stop = Math.floor(end.year() /5) *5;
        return _.range(start, stop +5, 5);
    } else if (+m[1] >= 15) { // m15 is separated monthly
        const start = within ? moment(begin).add(1, 'months') :
            periods.dec(moment(begin).startOf('month'), warmUpLength);
        const stop = within ? moment(end).subtract(1, 'months') : end;
        if (start.year() > stop.year()) return [];
        return _.range(start.year(), stop.year()+1).reduce((blocks, year) => {
            const starting = start.year() == year ? start.month() : 0;
            const ending = stop.year() == year ? stop.month() : 11;
            if (starting > ending) return blocks;
            return blocks.concat(_.range(starting +1, ending +2).map(month => {
                return month < 10 ? year + '-0' + month : year + '-' + month;
            }));
        }, []);
    } else if (+m[1] >= 5) { // m5 is separated weekly
        const start = within ? moment(begin).add(1, 'weeks') :
            periods.dec(moment(begin).startOf('week'), warmUpLength);
        const stop = within ? moment(end).subtract(1, 'weeks') : end;
        if (start.weekYear() > stop.weekYear()) return [];
        return _.range(begin.weekYear(), stop.weekYear()+1).reduce((blocks, year) => {
            const starting = begin.weekYear() == year ? begin.week() : 1;
            const ending = stop.weekYear() == year ? stop.week() :
                moment.tz(year + '-02-01', begin.tz()).weeksInYear();
            if (starting > ending) return blocks;
            return blocks.concat(_.range(starting, ending +1).map(week => {
                return week < 10 ? year + '-0' + week : year + '-' + week;
            }));
        }, []);
    }
    // m1 is separated daily
    const blocks = [];
    const d = within ? moment(begin).add(1, 'days') :
            periods.dec(moment(begin).startOf('day'), warmUpLength);
    const stop = within ? moment(end).subtract(1, 'days') : end;
    while (!d.isAfter(stop)) {
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
            begin: begin.format(options.ending_format),
            end: null
        }, options);
    } else if ('day' == options.interval) {
        const begin = moment.tz(block + '-01-01', options.tz);
        const end = moment.tz((5+block) + '-01-01', options.tz);
        return _.defaults({
            begin: begin.format(options.ending_format),
            end: end.format(options.ending_format)
        }, options);
    } else if (+m[1] >= 15) {
        const begin = moment.tz(block + '-01', options.tz);
        const end = moment(begin).add(1, 'months');
        return _.defaults({
            begin: begin.format(options.ending_format),
            end: end.format(options.ending_format)
        }, options);
    } else if (+m[1] >= 5) {
        const split = block.split('-');
        const year = split[0];
        const week = +split[1];
        const begin = moment.tz(year + '-01-01', options.tz).week(week).startOf('week');
        const end = moment(begin).add(1, 'week');
        return _.defaults({
            begin: begin.format(options.ending_format),
            end: end.format(options.ending_format)
        }, options);
    } else {
        const begin = moment.tz(block, options.tz);
        const end = moment(begin).add(1, 'day');
        return _.defaults({
            begin: begin.format(options.ending_format),
            end: end.format(options.ending_format)
        }, options);
    }
}
