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

const _ = require('underscore');
const moment = require('moment-timezone');
const config = require('./config.js');
const logger = require('./logger.js');
const blended = require('./fetch-blended.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const files = require('./fetch-files.js');
const remote = require('./fetch-remote.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    var datasources;
    var self = function(options) {
        datasources = datasources || promiseDatasources();
        return datasources.then(datasources => {
            if (options.help || options.interval == 'help')
                return help(_.uniq(_.flatten(_.values(datasources).map(_.values))));
            var market = options.market;
            var markets = config('markets');
            if (market && !markets[market]) {
                var others = _.flatten(_.map(datasources, _.keys));
                expect(market).to.be.oneOf(_.uniq(_.union(_.keys(markets), others)));
            }
            var opt = market ? _.extend(
                _.omit(markets[market], 'datasources', 'label', 'description'),
                options
            ) : options;
            var interval = options.interval;
            switch(interval) {
                case 'lookup': return lookup(datasources.lookup, opt);
                case 'fundamental': return fundamental(datasources.fundamental, opt);
                case 'year': return interday(datasources.year, opt);
                case 'quarter': return interday(datasources.quarter, opt);
                case 'month': return interday(datasources.month, opt);
                case 'week': return interday(datasources.week, opt);
                case 'day': return interday(datasources.day, opt);
                default:
                    if (interval && interval.charAt(0) == 'm' && _.isFinite(interval.substring(1)))
                        return intraday(datasources[interval], opt);
                    else if (options.minutes && _.isFinite(options.minutes))
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
function promiseDatasources() {
    var sources = _.compact([
        config('fetch.files.enabled') && files(),
        config('fetch.blended.enabled') && blended(),
        config('fetch.remote.enabled') && remote(),
        config('fetch.iqfeed.enabled') && iqfeed(),
        config('fetch.yahoo.enabled') && yahoo()
    ]);
    return Promise.all(sources.map(source => source.help()))
      .then(result => result.reduce((datasources, help, i) => {
        return _.flatten(help).reduce((datasources, info) => {
            if (info.name == 'interday' && info.options.interval.values) {
                return info.options.interval.values.reduce((datasources, interval) => {
                    return addSource(datasources, interval, info.options.market.values, sources[i]);
                }, datasources);
            } else if (info.name == 'intraday' && info.options.minutes.values) {
                return info.options.minutes.values.reduce((datasources, minutes) => {
                    var interval = 'm' + minutes;
                    return addSource(datasources, interval, info.options.market.values, sources[i]);
                }, datasources);
            } else {
                expect(info).to.have.property('options');
                expect(info.options).to.have.property('market');
                if (!info.options.market.values) throw Error("Missing market values");
                return addSource(datasources, info.name, info.options.market.values, sources[i]);
            }
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
    return Promise.all(_.map(datasources, datasource => datasource.close()));
}

function help(datasources) {
    var marketOptions = _.uniq(_.flatten(_.map(config('markets'), _.keys), true));
    return Promise.all(_.map(datasources, datasource => {
        return datasource.help();
    })).then(helps => {
        var groups = _.values(_.groupBy(_.flatten(helps), 'name'));
        return groups.map(helps => helps.reduce((help, h) => {
            var lookupProperties = h.name == 'lookup' ? marketOptions : [];
            var options = _.extend({
                interval: {values: h.name == 'lookup' || h.name == 'fundamental' ? [h.name] : []}
            }, _.omit(h.options, marketOptions), help.options);
            return {
                name: help.name || h.name,
                usage: help.usage,
                description: help.description || h.description,
                properties: _.union(help.properties, h.properties, lookupProperties),
                options: _.mapObject(options, (option, name) => {
                    if (option.values && h.options[name] && h.options[name].values) return _.defaults({
                        values: _.compact(_.flatten([option.values, h.options[name].values], true))
                    }, option);
                    else if (option.values || h.options[name] && h.options[name].values) return _.defaults({
                        values: option.values || h.options[name] && h.options[name].values
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
    var market = options.market;
    if (market) expect(market).to.be.oneOf(_.keys(datasources));
    var symbol = options.symbol.toUpperCase();
    var same = new RegExp('^' + symbol.replace(/\W/g, '\\W') + '$');
    var almost = new RegExp('\\b' + symbol.replace(/\W/g, '.*') + '\\b');
    var sources = market ? datasources[market] : _.uniq(_.flatten(_.values(datasources)));
    var results = _.map(sources, datasource => {
        return datasource.lookup(_.defaults({
            symbol: symbol,
            market: market || undefined
        }, options)).then(list => list.map(item => {
            var same_item = item.symbol == symbol || item.symbol.match(same);
            return _.defaults({
                symbol: same_item ? symbol : item.symbol,
                market: item.market,
                name: item.name
            }, item);
        }));
    });
    var error;
    return results.reduce((promise, data) => promise.then(result => {
        return data.then(o => result.concat(o), err => {
            if (!error) error = err;
            else logger.debug("Fetch lookup failed", err);
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
        var keys = rows.reduce((keys, row) => _.union(keys, _.keys(row)), []);
        var nil = _.object(keys, keys.map(key => null));
        return rows.map(row => _.defaults(row, nil));
    }).then(rows => _.sortBy(rows, row => {
        var score = 0;
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
    var now = moment();
    var error;
    return datasources[options.market].map(datasource => {
        return datasource.fundamental(options);
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

function interday(datasources, options) {
    expect(options).to.be.like({
        interval: /^\S+$/,
        symbol: /^\S+$/,
        market: ex => expect(ex).to.be.oneOf(_.keys(datasources)),
        tz: _.isString
    });
    var now = moment().tz(options.tz);
    var begin = options.begin ? moment.tz(options.begin, options.tz) :
        moment(now).startOf('month').subtract(1, 'month');
    var early = begin.year() < now.year() - 5 ?
        moment(now).subtract(5,'years').format('Y-MM-DD') : // results okay if >5yrs
        moment(begin).add(1,'weeks').format('Y-MM-DD'); // or starts within a week
    var opts = _.defaults({
        begin: begin.format()
    }, options);
    return datasources[options.market].reduce((promise, datasource) => promise.catch(err => {
        return datasource.interday(opts).then(result => {
            if (err && !_.isArray(err)) logger.debug("Fetch", opts.interval, "failed", err.stack);
            if (_.isArray(err) && err.length >= result.length)
                return err;
            if (_.isEmpty(result) || _.first(result).ending > early)
                return Promise.reject(result); // not within a week of begin or >5yrs
            return result;
        }, err2 => {
            if (_.isEmpty(err)) throw err2;
            logger.debug("Fetch", opts.interval, "failed", err2);
            throw err;
        });
    }), Promise.reject()).catch(err => {
        if (_.isArray(err)) return err;
        else throw err;
    }).then(results => {
        var aWeek = 5 * 24 * 60 * 60 * 1000;
        var latest = _.last(results);
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
    var now = moment().tz(options.tz);
    var opts = options.begin ? options : _.defaults({
        begin: moment(now).startOf('day').format()
    }, options);
    var minutes = opts.minutes || +opts.interval.substring(1);
    return datasources[options.market].reduce((promise, datasource) => promise.catch(err => {
        return datasource.intraday(_.defaults({
            minutes: +minutes
        }, opts)).then(result => {
            if (err) logger.debug("Fetch", minutes, "minutes failed", err);
            return result;
        }, err2 => {
            if (!err) throw err2;
            logger.debug("Fetch intraday failed", err2);
            throw err;
        });
    }), Promise.reject()).then(results => {
        var aWeek = 5 * 24 * 60 * 60 * 1000;
        var latest = _.last(results);
        if (results.length && moment(latest.ending).valueOf() > now.valueOf() - aWeek) {
            // first line might yet be incomplete (or not yet finalized/adjusted)
            latest.asof = now.format();
            latest.incomplete = true;
        }
        return results;
    });
}

