// fetch.js
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

const _ = require('underscore');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const version = require('./version.js');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function(settings = {}) {
    let datasources;
    const markets = config('markets');
    const self = function(options) {
        datasources = datasources || promiseDatasources(settings||{});
        return datasources.then(async(datasources) => {
            if (options.info=='help' || options.interval == 'help')
                return help(_.uniq(_.flatten(_.values(datasources).map(_.values))));
            if (options.info=='version') {
                const sources = _.uniq(_.flatten(_.values(datasources).map(_.values)));
                return _.flatten(await Promise.all(sources.map(ds => {
                    return ds(options).catch(err => {
                        return [{message:err.message}];
                    });
                })));
            }
            const market = options.market;
            if (market && !markets[market]) {
                const others = _.uniq(_.flatten(_.map(datasources, _.keys)));
                expect(market, options.symbol)
                    .to.be.oneOf(_.uniq(_.union(_.keys(markets), others)));
            }
            const opt = options.security_tz || options.interval == 'contract' || options.interval == 'lookup' ?
                {...options, ending_format: moment.defaultFormat} :
                {
                    ..._.first(await contract(markets, datasources.contract, options)),
                    ...options,
                    ending_format: moment.defaultFormat
                };
            const interval = options.interval;
            if (interval == 'lookup') return lookup(markets, datasources.lookup, opt);
            if (interval == 'contract') return contract(markets, datasources.contract, opt);
            if (interval == 'fundamental') return fundamental(datasources.fundamental, opt);
            expect(options).to.have.property('tz').that.is.a('string');
            if (options.end) expect(options).to.have.property('begin');
            if (options.end) expect(options.begin).not.to.be.above(options.end);
            switch(interval) {
                case 'year':
                case 'quarter':
                case 'month':
                case 'week':
                case 'day': return interday(datasources[interval], opt);
                default:
                    if (interval && interval.charAt(0) == 'm' && _.isFinite(interval.substring(1)))
                        return intraday(datasources[interval], opt);
                    else
                        return Promise.reject(Error("Unknown interval " + interval));
            }
        });
    };
    self.close = () => Promise.resolve(datasources).then(datasources => {
        return close(_.uniq(_.flatten(_.values(datasources).map(_.values))));
    });
    return self;
};

/**
 * hash of intervals -> market -> source
 */
async function promiseDatasources(settings = {}) {
    const yahoo = require('./fetch-yahoo.js');
    const all_factories = [
        {name: 'files', fn: require('./fetch-files.js')},
        {name: 'ib', fn: require('./fetch-ib.js')},
        {name: 'ivolatility', fn: require('./fetch-ivolatility.js')},
        {name: 'iqfeed', fn: require('./fetch-iqfeed.js')},
        {name: 'yahoo', fn: yahoo},
        {name: 'remote', fn: require('./fetch-remote.js')}
    ];
    const disabled = all_factories.reduce((disabled, factory) => {
        if (!settings[factory.name] || settings[factory.name].enabled) return disabled;
        else return Object.assign(disabled, {[factory.name]: {enabled: false}});
    }, {});
    const enabled_factories = all_factories.filter(factory => (settings[factory.name]||{}).enabled);
    const factories = enabled_factories.length ? enabled_factories : [{name:'yahoo', fn: yahoo}];
    const sources = factories.map(factory => {
        const name = factory.name;
        const settings_loop_disabled = factory.name == 'remote' ? settings[name] :
            merge(settings[name], {fetch: disabled}, settings[name]);
        const source = factory.fn(settings_loop_disabled);
        return Object.assign(opts => {
            logger.trace("Fetch", name, opts.info || opts.interval,
                opts.symbol || '', opts.market || '', opts.begin || '');
            return source(opts);
        }, {close: source.close.bind(source)});
    });
    const result = await Promise.all(sources.map(source => source({info:'help'})));
    return result.reduce((datasources, help, i) => {
        return _.flatten(help).reduce((datasources, info) => {
            const intervals = ['options', 'interval', 'values'].reduce(_.result, info) || [];
            const markets = ['options', 'market', 'values'].reduce(_.result, info) || [];
            if (!markets.length) throw Error("Missing market values: " + JSON.stringify(info, null, ' '));
            if (~intervals.indexOf('day')) {
                // add synthetic intervals
                _.forEach({year, quarter, month, week}, (fn, interval) => {
                    if (!~intervals.indexOf(interval)) {
                        addSource(datasources, interval, markets, fn.bind(this, sources[i]));
                    }
                });
            }
            return info.options.interval.values.reduce((datasources, interval) => {
                return addSource(datasources, interval, markets, sources[i]);
            }, datasources);
        }, datasources);
    }, {});
}

function addSource(datasources, interval, markets, source) {
    datasources[interval] = markets.reduce((sources, exch) => {
        if (!sources[exch]) sources[exch] = [];
        sources[exch].push(source);
        return sources;
    }, datasources[interval] || {});
    return datasources;
}

function close(datasources) {
    return Promise.all(_.map(datasources, datasource => datasource.close && datasource.close()));
}

function help(datasources) {
    const markets = config('markets');
    const marketOptions = [
        'currency', 'security_type', 'security_tz',
        'liquid_hours', 'open_time', 'trading_hours'
    ];
    return Promise.all(_.map(datasources, datasource => {
        return datasource({info:'help'});
    })).then(helps => {
        const groups = _.values(_.groupBy(_.flatten(helps), 'name'));
        return groups.map(helps => helps.reduce((help, h) => {
            const options = _.extend({
                interval: {values: h.name == 'lookup' || h.name == 'fundamental' ? [h.name] : []}
            }, _.omit(h.options, marketOptions), help.options);
            const known_markets = _.union((options.market||{}).values||[], _.keys(markets));
            const lookupProperties = h.name == 'lookup' && known_markets.length ? marketOptions : [];
            return {
                name: help.name || h.name,
                usage: help.usage,
                description: help.description || h.description,
                properties: _.union(help.properties, h.properties, lookupProperties),
                options: _.mapObject(options, (option, name) => {
                    if (option.values || (h.options[name]||{}).values) return _.defaults({
                        values: _.uniq(_.compact(_.flatten([
                            option.values || [],
                            (h.options[name]||{}).values || [],
                            ~((h.options[name]||{}).values||[]).indexOf('day') ?
                                ['year', 'quarter', 'month', 'week'] : []
                        ], true)))
                    }, option);
                    else return option;
                })
            };
        }, {
            usage: 'fetch(options)',
            options:{
                label: {
                    usage: '<name>',
                    description: "Identifier used in logging messages"
                }
            }
        }));
    });
}

function lookup(markets, datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S(\S| )*$/
    });
    const market = options.market;
    if (market && !datasources[market]) {
        logger.warn(`No ${options.market} market source configured`);
        return [];
    }
    const symbol = options.symbol;
    const same = new RegExp('^' + symbol.replace(/\W/g, '\\W') + '$', 'i');
    const almost = new RegExp('\\b' + symbol.replace(/\W/g, '.*') + '\\b', 'i');
    const sources = market ? datasources[market] : _.uniq(_.flatten(_.values(datasources)));
    const results = _.map(sources, datasource => {
        return datasource(_.defaults({
            interval: 'lookup',
            symbol: symbol,
            market: market || undefined
        }, options)).then(list => list.map(item => {
            const same_item = item.symbol == symbol || item.symbol.match(same);
            return _.defaults({
                symbol: same_item ? symbol : item.symbol,
                market: item.market,
                name: item.name
            }, item);
        }));
    });
    let error;
    return results.reduce((promise, data) => promise.then(result => {
        return data.then(o => o ? result.concat(o) : result, err => {
            if (!error) error = err;
            else logger.debug("Fetch lookup failed for ", symbol + '.' + market, err);
            return result;
        });
    }), Promise.resolve([])).then(result => {
        if (error && _.isEmpty(result)) throw error;
        else if (error) logger.debug("Fetch lookup failed", error);
        return result;
    }).then(rows => _.map(
        _.groupBy(rows, row => row.symbol + ':' + row.market),
        group => _.defaults.apply(_, group)
    )).then(rows => _.sortBy(rows, row => {
        let score = 0;
        if (row.symbol != symbol) score++;
        if (!row.symbol.match(almost)) score+= 2;
        if (market && row.market != market) score+= 3;
        if (row.symbol.indexOf(symbol) !== 0) score+= 3;
        return score + row.symbol;
    })).then(rows => rows.length > 12 ? rows.slice(0, 12) : rows)
      .then(rows => rows.map(row => {
        const market = row.market;
        return _.defaults({},
            row,
            markets[market] && {
                currency: markets[market].currency,
                security_type: markets[market].default_security_type,
                ..._.pick(markets[market], 'security_tz', 'liquid_hours', 'trading_hours', 'open_time')
            }
        );
    })).then(rows => {
        const keys = rows.reduce((keys, row) => _.union(keys, _.keys(row)), []);
        const nil = _.object(keys, keys.map(key => null));
        return rows.map(row => _.defaults(row, nil));
    });
}

async function contract(markets, datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S(\S| )*$/,
        market: /^\w+$/
    });
    if (!datasources[options.market]) {
        logger.warn(`No ${options.market} market source configured`);
        return [];
    }
    const opts = options.interval == 'contract' ? options : {...options, interval: 'contract'};
    const symbol = options.symbol;
    const market = options.market;
    const rows = await datasources[options.market].reduce((promise, datasource) => promise.catch(err => {
        return datasource(opts).catch(err2 => {
            if (!err) throw err2;
            logger.debug("Fetch", opts.interval, "failed", err2);
            throw err;
        });
    }), Promise.reject());
    if (rows.length) return rows.map(row => {
        const market = row.market;
        return _.defaults({},
            row,
            markets[market] && {
                currency: markets[market].currency,
                security_type: markets[market].default_security_type,
                ..._.pick(markets[market], 'security_tz', 'liquid_hours', 'trading_hours', 'open_time')
            }
        );
    });
    else if (markets[options.market]) return [{
        symbol: options.symbol,
        market: options.market,
        name: `${options.symbol}.${options.market}`,
        currency: markets[market].currency,
        security_type: markets[market].default_security_type,
        ..._.pick(markets[market], 'security_tz', 'liquid_hours', 'trading_hours', 'open_time')
    }];
    else return [];
}

function fundamental(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S(\S| )*$/,
        market: /^\w+$/
    });
    if (!datasources[options.market]) {
        logger.warn(`No ${options.market} market source configured`);
        return [];
    }
    const now = moment();
    let error;
    return datasources[options.market].map(datasource => {
        return datasource(options);
    }).reduce((promise, data) => promise.then(result => {
        return data.then(a => a.reduce((result,o) => _.defaults(result, o), result), err => {
            if (!error) error = err;
            else logger.debug("Fetch fundamental failed", err);
            return result;
        });
    }), Promise.resolve({})).then(result => {
        if (error && _.isEmpty(result)) throw error;
        else if (error) logger.debug("Fetch fundamental failed", error);
        return result;
    }).then(result => {
        return [_.defaults({
            symbol: options.symbol,
            market: options.market,
            name: result.name,
            asof: now.format(options.ending_format)
        }, result)];
    });
}

async function year(day, options) {
    if (options.info) return day(options);
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        interval: 'month',
        begin: moment.tz(options.begin, options.tz).startOf('year').format(options.ending_format),
        end: end && (end.isAfter(moment(end).startOf('year')) ?
            end.endOf('year') : end).format(options.ending_format)
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
    if (options.info) return day(options);
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        interval: 'month',
        begin: moment.tz(options.begin, options.tz).startOf('quarter').format(options.ending_format),
        end: end && (end.isAfter(moment(end).startOf('quarter')) ?
            end.endOf('quarter') : end).format(options.ending_format)
    }, options));
    const quarters = _.groupBy(bars, bar => moment.tz(bar.ending, options.tz).format('Y-Q'));
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
    if (options.info) return day(options);
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await day(_.defaults({
        interval: 'day',
        begin: moment.tz(options.begin, options.tz).startOf('month').format(options.ending_format),
        end: end && (end.isAfter(moment(end).startOf('month')) ?
            end.endOf('month') : end).format(options.ending_format)
    }, options));
    const months = _.groupBy(bars, bar => moment.tz(bar.ending, options.tz).format('Y-MM'));
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
    if (options.info) return day(options);
    const begin = moment.tz(options.begin, options.tz);
    const bars = await day(_.defaults({
        interval: 'day',
        begin: begin.day() === 0 || begin.day() == 6 ? begin.startOf('day').format(options.ending_format) :
            begin.startOf('isoWeek').subtract(1, 'days').format(options.ending_format),
        end: options.end && moment.tz(options.end, options.tz).endOf('isoWeek').subtract(2, 'days').format(options.ending_format)
    }, options));
    const weeks = _.groupBy(bars, bar => moment.tz(bar.ending, options.tz).format('gggg-WW'));
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

function interday(datasources, options) {
    expect(options).to.be.like({
        interval: /^\S+$/,
        symbol: /^\S(\S| )*$/,
        market: ex => expect(ex).to.be.oneOf(_.keys(datasources)),
        tz: _.isString
    });
    const begin = options.begin ? moment.tz(options.begin, options.tz) :
        moment().tz(options.tz).startOf('month').subtract(1, 'month');
    const opts = _.defaults({
        begin: begin.format(options.ending_format)
    }, options);
    return datasources[options.market].reduce((promise, datasource) => promise.catch(err => {
        return datasource(opts).then(result => {
            if (err && !_.isArray(err)) logger.debug("Fetch", opts.interval, "failed", err.stack);
            if (_.isArray(err) && err.length >= result.length)
                return err;
            if (_.isEmpty(result))
                return Promise.reject(result); // empty result error is an array
            return result;
        }, err2 => {
            if (!err) throw err2;
            else if (_.isArray(err)) return err;
            logger.debug("Fetch", opts.interval, "failed", err2);
            throw err;
        });
    }), Promise.reject()).catch(err => {
        if (_.isArray(err)) return err;
        else throw err;
    });
}

function intraday(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S(\S| )*$/,
        market: ex => expect(ex).to.be.oneOf(_.keys(datasources)),
        tz: _.isString
    });
    const opts = options.begin ? options : _.defaults({
        begin: moment().tz(options.tz).startOf('day').format(options.ending_format)
    }, options);
    return datasources[options.market].reduce((promise, datasource) => promise.catch(err => {
        return datasource(opts).then(result => {
            if (err) logger.debug("Fetch", options.interval, "intraday failed", err);
            return result;
        }, err2 => {
            if (!err) throw err2;
            logger.debug("Fetch intraday failed", err2);
            throw err;
        });
    }), Promise.reject());
}

function adjustment(base, bar) {
    if (!bar.adj_close || bar.adj_close == bar.close) return _.identity;
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
        closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + start.format('HH:mm:ss'), options.tz);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.format(options.ending_format);
}

