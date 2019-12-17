// fetch-model.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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
const zlib = require('zlib');
const _ = require('underscore');
const csv = require('fast-csv');
const moment = require('moment-timezone');
const Big = require('big.js');
const smr = require('smr');
const merge = require('./merge.js');
const interrupt = require('./interrupt.js');
const Parser = require('../src/parser.js');
const common = require('./common-functions.js');
const rolling = require('./rolling-functions.js');
const config = require('./config.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const Periods = require('./periods.js');
const Fetch = require('./fetch.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

function help(assets, settings = {}) {
    const intervals = _.uniq(_.flatten(assets.map(asset => asset.intervals)));
    const market_values = _.uniq(assets.map(asset => asset.market));
    const marketOptions = _.intersection(_.uniq(_.flatten(assets.map(_.keys))), [
        'symbol', 'market', 'name',
        'currency', 'security_type', 'security_tz',
        'liquid_hours', 'open_time', 'trading_hours'
    ]);
    const variables = _.uniq(_.flatten(assets.map(asset => {
        return (asset.models||[]).map(model => Object.keys(_.last(model.bars)||model.output||{}));
    })));
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: market_values
        }
    };
    const lookup = {
        name: "lookup",
        usage: "lookup(options)",
        properties: marketOptions,
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["lookup"]
            },
        })
    };
    const fundamental = {
        name: "fundamental",
        usage: "fundamental(options)",
        properties: _.difference(marketOptions, ['baskets']),
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["fundamental"]
            },
        })
    };
    const interday = {
        name: "interday",
        usage: "interday(options)",
        properties: _.uniq(['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'].concat(variables)),
        options: _.extend(commonOptions, {
            interval: {
                usage: "day",
                description: "The bar timeframe for the results",
                values: ["day"]
            },
            begin: {
                example: "YYYY-MM-DD",
                description: "Sets the earliest date (or dateTime) to retrieve"
            },
            end: {
                example: "YYYY-MM-DD HH:MM:SS",
                description: "Sets the latest dateTime to retrieve"
            },
            liquid_hours: {
                description: "Trading hours in the format 'hh:mm:00 - hh:mm:00'"
            },
            security_tz: {
                description: "Timezone of liquid_hours using the identifier in the tz database"
            },
            tz: {
                description: "Timezone of the ending formatted using the identifier in the tz database"
            },
            ending_format: {
                description: "Date and time format of the resulting ending field"
            }
        })
    };
    return [lookup, fundamental, interday];
}

module.exports = function(settings = {}) {
    expect(settings).to.have.property('assets').that.is.an('array');
    const fetch = new Fetch(merge(config('fetch'), {model:{enabled:false}}, settings.fetch));
    const assets = settings.assets.map(asset => typeof asset == 'string' ? readConfig(asset, settings) : asset);
    const market_values = _.uniq(assets.map(asset => asset.market));
    const markets = _.mapObject(
        _.pick(config('markets'), market_values),
        m => _.omit(m, 'datasources', 'label', 'description')
    );
    const helpInfo = help(assets, settings);
    return Object.assign(async(options) => {
        if (options.info=='version') return [{version}];
        if (options.info=='help') return helpInfo;
        const blend_fn = blendCall.bind(this, markets, fetch, assets);
        switch(options.interval) {
            case 'lookup': return lookup(markets, assets, options);
            case 'fundamental': return lookup(markets, assets, options).then(_.first);
            case 'day': return trim(await blend_fn(options), options);
            default: throw Error(`fetch-model does not support intraday in version ${version}`);
        }
    }, {
        close() {
            return Promise.resolve(fetch && fetch.close());
        }
    });
};

function readConfig(name, settings = {}) {
    const filename = config.resolve(name);
    const base = path.dirname(filename);
    return _.extend({base}, config.read(filename), settings);
}

async function lookup(markets, assets, options) {
    return assets.filter(asset => {
        return asset.symbol == options.symbol && (asset.market == options.market || !options.market);
    }).map(asset => {
        if (markets[asset.market]) return _.defaults(_.pick(asset, [
            'symbol', 'market', 'name', 'currency', 'security_type', 'security_tz',
            'liquid_hours', 'trading_hours', 'open_time'
        ]), _.pick(markets[asset.market], [
            'currency', 'security_type', 'security_tz',
            'liquid_hours', 'trading_hours', 'open_time'
        ]));
        else return _.pick(asset, [
            'symbol', 'market', 'name', 'currency', 'security_type', 'security_tz',
            'liquid_hours', 'trading_hours', 'open_time'
        ]);
    });
}

async function blendCall(markets, fetch, assets, options) {
    const asset = findAsset(assets, options);
    if (!asset || !asset.models) throw Error(`No model configured for ${options.symbol}.${options.market}`);
    const end = options.end && moment.tz(options.end, options.tz).format(options.ending_format);
    const begin = moment(options.begin);
    const models = sliceModelsAfter(await Promise.all(sliceModelsAfter(asset.models, begin)
        .map(async(model) => readModel(asset, model, options))), begin);
    return models.reduceRight(async(promise, model_p, i, models) => {
        const model = await model_p;
        const periods = new Periods({...options, ...asset});
        const max_begin = model.begin || maxDate((await (models[i-1]||{})).end, options.begin);
        const begin = !model.begin && i ? periods.dec(max_begin, 1).format(options.ending_format) : max_begin;
        const max_end = model.end || (_.first(await promise)||{}).ending ||
            (i == models.length-1 && options.end ? maxDate(options.end, max_begin) : undefined);
        const end = !model.end && i <models.length-1 ? periods.inc(max_end, 1).format(options.ending_format) : max_end;
        const part = model.bars ? model.bars :
            await fetchModel(markets, fetch, asset, model, { ...options, begin, end });
        const result = await promise;
        if (_.isEmpty(result)) return part;
        else if (_.isEmpty(part)) return result;
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
    }, Promise.resolve([]));
}

function findAsset(assets, options) {
    return assets.find(asset => {
        if (asset.market != options.market) return false;
        else if (asset.intervals && !~asset.intervals.indexOf(options.interval)) return false;
        else if (asset.symbol && asset.symbol != options.symbol) return true;
        else if (asset.root && options.symbol.indexOf(asset.root) !== 0) return false;
        else if (asset.symbol_pattern && !options.symbol.match(new RegExp(asset.symbol_pattern))) return false;
        else return true;
    });
}

function sliceModelsAfter(models, begin) {
    const idx = models.reduceRight((idx, model, i) => {
        return idx || !model.end || begin.isAfter(model.end) ? idx : i;
    }, 0);
    return models.slice(idx);
}

async function readModel(asset, model, options) {
    if (model.bars) {
        const begin = maxDate(model.begin, _.first(model.bars).ending);
        const end = minDate(model.end, _.last(model.bars).ending);
        return {...model, begin, end};
    } else if (model.file_csv_gz) {
        const bars = await readTable(config.resolve(asset.base, model.file_csv_gz));
        const begin = maxDate(model.begin, _.first(bars).ending);
        const end = minDate(model.end, _.last(bars).ending);
        return {...model, bars, begin, end};
    } else {
        return model;
    }
}

async function fetchModel(markets, fetch, asset, model, options) {
    const marketOptions = [
        'symbol', 'market', 'name',
        'currency', 'security_type', 'security_tz',
        'liquid_hours', 'open_time', 'trading_hours'
    ];
    const bar_one = {
        open: 1, high: 1, low: 1, close: 1, volume: 1, adj_close: 1
    };
    const market_opts = {
        ...options,
        ..._.pick(asset, marketOptions),
        interval: model.interval || options.interval
    };
    const periods = new Periods(market_opts);
    const pad_begin = (+model.regression_length||0) + (+model.pad_begin||0);
    const pad_end = (+model.end_begin||0);
    const begin = periods.dec(periods.floor(options.begin), pad_begin).format(options.ending_format);
    const end = periods.inc(periods.ceil(options.end), pad_end).format(options.ending_format);
    const opts = {
        ...market_opts,
        begin, end
    };
    const bars = await fetchModelBars(markets, fetch, asset, model, opts);
    if (!model.interval || model.interval == options.interval) return bars;
    else return rollBars(bars, options);
}

async function fetchModelBars(markets, fetch, asset, model, options) {
    const check = interrupt();
    const input_data = await Promise.all(Object.values(model.input).map(async(term) => {
        if (term.bars) return term.bars;
        else if (term.file_csv_gz) return (await readModel(asset, term, options)).bars;
        else if (term.output) return fetchModel(markets, fetch, asset, term, options);
        else return fetch(_.defaults(
            term.symbol_replacement ? {
                symbol: options.symbol.replace(new RegExp(asset.symbol_pattern), term.symbol_replacement)
            } : {},
            _.pick(term, 'symbol', 'market', 'interval'),
            _.omit(options, [
                'name',
                'currency', 'security_type', 'security_tz',
                'liquid_hours', 'open_time', 'trading_hours'
            ])
        ));
    }));
    const security_variables = _.pick(options, [
        'symbol', 'market', 'name',
        'currency', 'security_type', 'security_tz',
        'liquid_hours', 'open_time', 'trading_hours'
    ]);
    const input = _.object(Object.keys(model.input), input_data);
    const points = [];
    const eval_variables = parseVariablesUsedInRolling(model, options);
    const eval_coefficients = parseCoefficientVariables(model, options);
    const eval_output = parseOutputExpressions(model, options);
    const iterators = _.mapObject(input, array => createIterator(array));
    if (_.some(iterators, iter => !iter.hasNext())) return [];
    const earliest = _.last(_.map(iterators, iter => iter.peek().ending).sort());
    _.forEach(iterators, iter => {
        while (iter.hasNext() && iter.peek().ending < earliest) iter.next();
    });
    const result = [];
    while (_.some(iterators, iter => iter.hasNext())) {
        await check();
        const ending = nextBarEnding(Object.values(iterators), options);
        const input_bars = _.mapObject(iterators, iter => iter.review());
        const input_variables = merge.apply(null, _.map(input_bars, (bar, left) => {
            const term = {..._.pick(options, 'symbol', 'market', 'interval'), ...model.input[left]};
            const keys = Object.keys(bar)
                .concat('symbol', 'market', 'interval')
                .map(name => `${left}.${name}`);
            const values = Object.values(bar)
                .concat(term.symbol, term.market, term.interval);
            return _.object(keys, values);
        }).concat(security_variables));
        points.push({variables: input_variables});
        const variables = {...input_variables, ...eval_coefficients(points), ...eval_variables(points)};
        points[points.length-1] = {variables};
        result.push(_.defaults(eval_output(points), {ending}));
    }
    return result;
}

async function rollBars(bars, options) {
    const check = interrupt();
    const periods = new Periods(options);
    const all_day = periods.session_length * periods.millis >= 24 *60 *60 *1000;
    return bars.reduce(async(rolled_promise, bar) => {
        await check();
        const rolled = await rolled_promise;
        const merging = rolled.length && _.last(rolled).ending >= bar.ending; // before close
        if (!merging && !all_day && bar.ending <= periods.floor(bar.ending).format(options.ending_format))
            return rolled; // at or before open
        const today = merging ? rolled.pop() : {};
        rolled.push({
            ...bar,
            ending: today.ending || periods.ceil(bar.ending).format(options.ending_format),
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: bar.close,
            volume: (+today.volume||0) + +bar.volume
        });
        return rolled;
    }, []);
}

function parseVariablesUsedInRolling(model, options) {
    var var_parser = Parser({
        constant(value) {
            return [];
        },
        variable(name) {
            return [];
        },
        expression(expr, name, args) {
            if (!rolling.has(name)) return _.flatten(args);
            return rolling.getVariables(expr, options).filter(name => model.variables[name]);
        }
    });
    const names = _.flatten(_.map(model.variables, expr => var_parser.parse(expr)));
    var parser = Parser({
        constant(value) {
            return () => value;
        },
        variable(name) {
            if ((model.variables||{})[name] && !~names.indexOf(name))
                return parser.parse(model.variables[name]);
            else return points => {
                const key = _.last(_.keys(_.last(points)));
                return _.last(points)[key][name];
            };
        },
        expression(expr, name, args) {
            return common(name, args, options) || rolling(expr, name, args, options) || (() => {
                throw Error("Only common and rolling functions can be used in models: " + expr);
            });
        }
    });
    const expressions = _.object(names, names.map(name => parser.parse(model.variables[name])));
    return points => _.mapObject(expressions, expr => expr(points));
}

function parseOutputExpressions(model, options) {
    var parser = Parser({
        constant(value) {
            return () => value;
        },
        variable(name) {
            if ((model.variables||{})[name]) return parser.parse(model.variables[name]);
            else return points => {
                const key = _.last(_.keys(_.last(points)));
                return _.last(points)[key][name];
            };
        },
        expression(expr, name, args) {
            return common(name, args, options) || rolling(expr, name, args, options) || (() => {
                throw Error("Only common and rolling functions can be used in models: " + expr);
            });
        }
    });
    const output_expressions = _.mapObject(model.output, expr => parser.parse(expr));
    return points => _.mapObject(output_expressions, expr => expr(points));
}

function parseCoefficientVariables(model) {
    if (!model.independents) return input => {};
    var parser = Parser({
        constant(value) {
            return () => value;
        },
        variable(name) {
            if ((model.variables||{})[name]) return parser.parse(model.variables[name]);
            else return points => {
                const key = _.last(_.keys(_.last(points)));
                return _.last(points)[key][name];
            };
        },
        expression(expr, name, args) {
            return common(name, args, options) || rolling(expr, name, args, options) || (() => {
                throw Error("Only common and rolling functions can be used in models: " + expr);
            });
        }
    });
    const regression_size = +model.regression_length;
    const dependent_expression = parser.parse(model.dependent);
    const coefficient_variables = Object.keys(model.independents||{});
    const coefficient_expressions = Object.values(model.independents||{}).map(expr => parser.parse(expr));
    const regression_data = [];
    return input => {
        const dependent = dependent_expression(input);
        const independents = coefficient_expressions.map(expr => expr(input));
        regression_data.push({dependent, independents});
        while (regression_data.length > regression_size) regression_data.shift();
        const coefficient_values = calculateCoefficients(regression_data);
        return _.object(coefficient_variables, coefficient_values);
    }
}

function createIterator(array) {
    let i = 0;
    return {
        hasNext() {
            return i < array.length;
        },
        hasPrevious() {
            return i > 0;
        },
        peek() {
            return array[i];
        },
        next() {
            return array[i++];
        },
        review() {
            return array[i-1];
        },
        previous() {
            return array[--i];
        },
        size() {
            return array.length;
        }
    };
}

function calculateCoefficients(data) {
    var reg = new smr.Regression({numX: data[0].independents.length, numY: 1});
    data.forEach(datum => {
        reg.push({x: datum.independents, y: [datum.dependent]});
    });
    return reg.calculateCoefficients().map(_.first);
}

function nextBarEnding(iterators, options) {
    const periods = new Periods(options);
    const ending = iterators
        .filter(iter => iter.hasNext())
        .map(iter => iter.peek().ending)
        .sort()[0];
    const end = moment(ending);
    let next = periods.ceil(end);
    while (next.isBefore(end)) {
        next = periods.inc(next, 1);
    }
    const eod = next.format(options.ending_format);
    iterators.forEach(iter => {
        while (iter.hasNext() && iter.peek().ending <= eod) iter.next();
    });
    return eod;
}

function readTable(filename, size) {
    return new Promise((ready, error) => {
        const objects = _.isFinite(size) ? new Array(size) : new Array();
        objects.length = 0;
        const stream = fs.createReadStream(filename).on('error', error);
        const pipe = stream.pipe(zlib.createGunzip().on('error', error));
        csv.fromStream(pipe, {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
                    objects.push(_.mapObject(data, parseValue));
                } catch (e) {
                    this.emit('error', e);
                }
            })
            .on('end', () => ready(objects));
    });
}

function parseValue(value) {
    if (value == '') return null;
    if (!_.isString(value)) return value;
    const chr = value.charAt(0);
    if (chr == '"' || chr == '[' || chr == '{') return JSON.parse(value);
    const number = Number(value);
    if (!Number.isNaN(number) || value == 'NaN') return number;
    else return value;
}

function minDate(date1, date2) {
    const dates = Array.prototype.slice.call(arguments)
        .filter(date => date);
    if (!dates.length) return date1;
    else return dates.map(date => ({parsed: moment(date), text: date}))
        .reduce((a, b) => b.parsed.isBefore(a.parsed) ? b : a).text;
}

function maxDate(date1, date2) {
    const dates = Array.prototype.slice.call(arguments)
        .filter(date => date);
    if (!dates.length) return date1;
    else return dates.map(date => ({parsed: moment(date), text: date}))
        .reduce((a, b) => b.parsed.isAfter(a.parsed) ? b : a).text;
}

function trim(result, options) {
    expect(options).to.have.property('tz').that.is.a('string');
    return Promise.resolve(result).then(result => {
        const begin = moment.tz(options.begin, options.tz);
        const start = begin.format(options.ending_format);
        const first = _.sortedIndex(result, {ending: start}, 'ending');
        if (first < 1) return result;
        else return result.slice(first);
    }).then(result => {
        if (!options.end) return result;
        const end = moment.tz(options.end || now, options.tz);
        if (end.isAfter()) return result;
        const final = end.format(options.ending_format);
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    });
}
