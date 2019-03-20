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
const config = require('./config.js');
const logger = require('./logger.js');
const blended = require('./fetch-blended.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const files = require('./fetch-files.js');
const ivolatility = require('./fetch-ivolatility.js');
const remote = require('./fetch-remote.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    let datasources;
    const markets = config('markets');
    const self = function(options) {
        datasources = datasources || promiseDatasources();
        return datasources.then(datasources => {
            if (options.help || options.interval == 'help')
                return help(_.uniq(_.flatten(_.values(datasources).map(_.values))));
            const market = options.market;
            if (market && !markets[market]) {
                const others = _.flatten(_.map(datasources, _.keys));
                expect(market).to.be.oneOf(_.uniq(_.union(_.keys(markets), others)));
            }
            const opt = market ? _.extend(
                _.omit(markets[market], 'datasources', 'label', 'description'),
                markets[market] && options.tz && convertTime(markets[market], options.tz),
                options
            ) : options;
            const interval = options.interval;
            if (interval != 'lookup' && interval != 'fundamental')
                expect(options).to.have.property('tz').that.is.a('string');
            switch(interval) {
                case 'lookup': return lookup(datasources.lookup, opt);
                case 'fundamental': return fundamental(datasources.fundamental, opt);
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

function convertTime(market, tz) {
    const mtz2tz = time => moment.tz('2010-03-01T' + time, market.market_tz).tz(tz).format('HH:mm:ss');
    return {
        afterHoursClosesAt: mtz2tz(market.trading_hours.substring(market.trading_hours.length - 8)),
        marketClosesAt: mtz2tz(market.liquid_hours.substring(market.liquid_hours.length - 8)),
        marketOpensAt: mtz2tz(market.liquid_hours.substring(0, 8)),
        premarketOpensAt: mtz2tz(market.trading_hours.substring(0, 8))
    };
}

/**
 * hash of intervals -> market -> source
 */
function promiseDatasources() {
    const sources = _.compact([
        config('fetch.files.enabled') && files(),
        config('fetch.blended.enabled') && blended(),
        config('fetch.ivolatility.enabled') && ivolatility(),
        config('fetch.iqfeed.enabled') && iqfeed(),
        config('fetch.yahoo.enabled') && yahoo(),
        config('fetch.remote.enabled') && remote()
    ]);
    if (_.isEmpty(sources)) {
        sources.push(yahoo());
    }
    return Promise.all(sources.map(source => source({help:true})))
      .then(result => result.reduce((datasources, help, i) => {
        return _.flatten(help).reduce((datasources, info) => {
            const intervals = ['options', 'interval', 'values'].reduce(_.result, info) || [];
            const markets = ['options', 'market', 'values'].reduce(_.result, info) || [];
            if (!markets.length) throw Error("Missing market values");
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
    }, {}));
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
    const marketOptions = _.uniq(_.flatten(_.map(config('markets'), _.keys), true));
    return Promise.all(_.map(datasources, datasource => {
        return datasource({help:true});
    })).then(helps => {
        const groups = _.values(_.groupBy(_.flatten(helps), 'name'));
        return groups.map(helps => helps.reduce((help, h) => {
            const lookupProperties = h.name == 'lookup' ? marketOptions : [];
            const options = _.extend({
                interval: {values: h.name == 'lookup' || h.name == 'fundamental' ? [h.name] : []}
            }, _.omit(h.options, marketOptions), help.options);
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

function lookup(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S+$/
    });
    const market = options.market;
    if (market) expect(market).to.be.oneOf(_.keys(datasources));
    const symbol = options.symbol.toUpperCase();
    const same = new RegExp('^' + symbol.replace(/\W/g, '\\W') + '$');
    const almost = new RegExp('\\b' + symbol.replace(/\W/g, '.*') + '\\b');
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
        else if (error) logger.debug("Fetch fundamental failed", error);
        return result;
    }).then(rows => _.map(
        _.groupBy(rows, row => row.symbol + ':' + row.market),
        group => _.defaults.apply(_, group)
    )).then(rows => {
        const keys = rows.reduce((keys, row) => _.union(keys, _.keys(row)), []);
        const nil = _.object(keys, keys.map(key => null));
        return rows.map(row => _.defaults(row, nil));
    }).then(rows => _.sortBy(rows, row => {
        let score = 0;
        if (row.symbol != symbol) score++;
        if (!row.symbol.match(almost)) score+= 2;
        if (market && row.market != market) score+= 3;
        if (row.symbol.indexOf(symbol) !== 0) score+= 3;
        return score + row.symbol;
    }));
}

function fundamental(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S+$/,
        market: ex => expect(ex).to.be.oneOf(_.keys(datasources))
    });
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
            asof: now.format()
        }, result)];
    });
}

async function year(day, options) {
    const end = options.end && moment.tz(options.end, options.tz);
    const bars = await month(day, _.defaults({
        interval: 'month',
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
        interval: 'month',
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
        interval: 'day',
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
        interval: 'day',
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

function interday(datasources, options) {
    expect(options).to.be.like({
        interval: /^\S+$/,
        symbol: /^\S+$/,
        market: ex => expect(ex).to.be.oneOf(_.keys(datasources)),
        tz: _.isString
    });
    const now = moment().tz(options.tz);
    const begin = options.begin ? moment.tz(options.begin, options.tz) :
        moment(now).startOf('month').subtract(1, 'month');
    const early = begin.year() < now.year() - 5 ?
        moment(now).subtract(5,'years').format('Y-MM-DD') : // results okay if >5yrs
        moment(begin).add(1,'weeks').format('Y-MM-DD'); // or starts within a week
    const opts = _.defaults({
        begin: begin.format()
    }, options);
    return datasources[options.market].reduce((promise, datasource) => promise.catch(err => {
        return datasource(opts).then(result => {
            if (err && !_.isArray(err)) logger.debug("Fetch", opts.interval, "failed", err.stack);
            if (_.isArray(err) && err.length >= result.length)
                return err;
            if (_.isEmpty(result) || _.first(result).ending > early)
                return Promise.reject(result); // not within a week of begin or >5yrs
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
    }).then(results => {
        const aWeek = 5 * 24 * 60 * 60 * 1000;
        const latest = _.last(results);
        if (results.length && moment(latest.ending).valueOf() > now.valueOf() - aWeek) {
            // latest line might yet be incomplete (or not yet finalized/adjusted)
            latest.asof = now.format();
            latest.incomplete = true;
        }
        return results;
    });
}

function intraday(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S+$/,
        market: ex => expect(ex).to.be.oneOf(_.keys(datasources)),
        tz: _.isString
    });
    const now = moment().tz(options.tz);
    const opts = options.begin ? options : _.defaults({
        begin: moment(now).startOf('day').format()
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
    }), Promise.reject()).then(results => {
        const aWeek = 5 * 24 * 60 * 60 * 1000;
        const latest = _.last(results);
        if (results.length && moment(latest.ending).valueOf() > now.valueOf() - aWeek) {
            // first line might yet be incomplete (or not yet finalized/adjusted)
            latest.asof = now.format();
            latest.incomplete = true;
        }
        return results;
    });
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
    return closes.format();
}

