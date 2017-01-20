// fetch.js
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

const _ = require('underscore');
const moment = require('moment-timezone');
const config = require('./config.js');
const logger = require('./logger.js');
const yahoo = require('./fetch-yahoo.js');
const iqfeed = require('./fetch-iqfeed.js');
const files = require('./fetch-files.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = function() {
    var datasources = _.extend(
        config(['files','enabled']) ? {files: files()} : {},
        config(['yahoo','enabled']) ? {yahoo: yahoo()} : {},
        config(['iqfeed','enabled']) ? {iqfeed: iqfeed()} : {}
    );
    var self = function(options) {
        expect(options).to.be.like({
            interval: /^\S+$/
        });
        var exchange = options.exchange;
        var exchanges = config('exchanges');
        if (exchange) expect(exchange).to.be.oneOf(_.keys(exchanges));
        var opt = exchange ? _.extend(
            _.omit(exchanges[exchange], 'datasources', 'label', 'description'),
            options
        ) : options;
        var interval = options.interval;
        switch(interval) {
            case 'lookup': return lookup(datasources, opt);
            case 'fundamental': return fundamental(datasources, opt);
            case 'year': return interday(datasources, opt);
            case 'quarter': return interday(datasources, opt);
            case 'month': return interday(datasources, opt);
            case 'week': return interday(datasources, opt);
            case 'day': return interday(datasources, opt);
            default:
                if (interval.charAt(0) == 'm' && _.isFinite(interval.substring(1)))
                    return intraday(datasources, opt);
                else
                    return Promise.reject(Error("Unknown interval " + interval));
        }
    };
    self.close = close.bind(self, datasources);
    return self;
};

function close(datasources) {
    return Promise.all(_.map(datasources, datasource => datasource.close()));
}

function lookup(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S+$/
    });
    var exchanges = _.keys(config('exchanges'));
    var exchange = options.exchange;
    if (exchange) expect(exchange).to.be.oneOf(exchanges);
    var symbol = options.symbol.toUpperCase();
    var same = new RegExp('^' + symbol.replace(/\W/g, '\\W') + '$');
    var almost = new RegExp('\\b' + symbol.replace(/\W/g, '.*') + '\\b');
    var sources = exchange ? getDatasources(datasources, exchange, 'lookup') :
        _.object(_.uniq(_.flatten(exchanges.map(exchange =>
            _.keys(getDatasources(datasources, exchange, 'lookup'))
        ))), []);
    var results = _.map(sources, (source, id) => {
        return datasources[id].lookup(_.defaults({
            symbol: symbol,
            exchange: exchange || undefined
        }, options, source)).then(list => list.map(item => {
            var same_item = item.symbol == symbol || item.symbol.match(same);
            return _.defaults({
                symbol: same_item ? symbol : item.symbol,
                exchange: item.exchange,
                name: item.name
            }, item);
        }));
    });
    var error;
    return results.reduce((promise, data) => promise.then(result => {
        return data.then(o => result.concat(o), err => {
            if (!error) error = err;
            else logger.warn("Fetch lookup failed", err);
            return result;
        });
    }), Promise.resolve([])).then(result => {
        if (error && _.isEmpty(result)) throw error;
        else if (error) logger.warn("Fetch fundamental failed", error);
        return result;
    }).then(rows => _.map(
        _.groupBy(rows, row => row.symbol + ':' + row.exchange),
        group => _.defaults.apply(_, group)
    )).then(rows => {
        var keys = rows.reduce((keys, row) => _.union(keys, _.keys(row)), []);
        var nil = _.object(keys, keys.map(key => null));
        return rows.map(row => _.defaults(row, nil));
    }).then(rows => _.sortBy(rows, row => {
        var score = 0;
        if (row.symbol != symbol) score++;
        if (!row.symbol.match(almost)) score+= 3;
        if (row.symbol.indexOf(symbol) !== 0) score+= 5;
        return score + row.symbol;
    }));
}

function fundamental(datasources, options) {
    expect(options).to.be.like({
        symbol: /^\S+$/,
        exchange: ex => expect(ex).to.be.oneOf(_.keys(config('exchanges')))
    });
    var now = moment();
    var error;
    return _.map(getDatasources(datasources, options.exchange, 'fundamental'), (source, id) => {
        return datasources[id].fundamental(_.defaults({}, source, options));
    }).reduce((promise, data) => promise.then(result => {
        return data.then(a => a.reduce((result,o) => _.defaults(result, o), result), err => {
            if (!error) error = err;
            else logger.warn("Fetch fundamental failed", err);
            return result;
        });
    }), Promise.resolve({})).then(result => {
        if (error && _.isEmpty(result)) throw error;
        else if (error) logger.warn("Fetch fundamental failed", error);
        return result;
    }).then(result => {
        return [_.defaults({
            symbol: options.symbol,
            exchange: options.exchange,
            name: result.name,
            asof: now.format()
        }, result)];
    });
}

function interday(datasources, options) {
    expect(options).to.be.like({
        interval: /^\S+$/,
        symbol: /^\S+$/,
        exchange: ex => expect(ex).to.be.oneOf(_.keys(config('exchanges'))),
        tz: _.isString
    });
    var now = moment().tz(options.tz);
    var opts = options.begin ? options : _.defaults({
        begin: moment(now).startOf('month').subtract(1, 'month').format()
    }, options);
    var sources = getDatasources(datasources, opts.exchange, opts.interval);
    if (_.isEmpty(sources)) throw Error("No datasources available for " + opts.interval);
    return _.reduce(sources, (promise, source, id) => promise.catch(err => {
        return datasources[id].interday(_.defaults({}, source, opts)).then(result => {
            if (err) logger.warn("Fetch", opts.interval, "failed", err);
            return result;
        }, err2 => {
            if (!err) throw err2;
            logger.warn("Fetch", opts.interval, "failed", err2);
            throw err;
        });
    }), Promise.reject()).then(results => {
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
        interval: /^m\d+$/,
        symbol: /^\S+$/,
        exchange: ex => expect(ex).to.be.oneOf(_.keys(config('exchanges'))),
        tz: _.isString
    });
    var now = moment().tz(options.tz);
    var opts = options.begin ? options : _.defaults({
        begin: moment(now).startOf('day').format()
    }, options);
    var minutes = +opts.interval.substring(1);
    var sources = getDatasources(datasources, opts.exchange, opts.interval);
    if (_.isEmpty(sources)) throw Error("No datasources available for " + opts.interval);
    return _.reduce(sources, (promise, source, id) => promise.catch(err => {
        return datasources[id].intraday(_.defaults({
            minutes: minutes
        }, source, opts)).then(result => {
            if (err) logger.warn("Fetch", minutes, "minutes failed", err);
            return result;
        }, err2 => {
            if (!err) throw err2;
            logger.warn("Fetch intraday failed", err2);
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

function getDatasources(datasources, exchange, interval) {
    return _.mapObject(_.pick(config(['exchanges', exchange, 'datasources']), (source, id) => {
        return _.contains(source.fetch, interval) && _.has(datasources, id);
    }), source => _.omit(source, 'fetch'));
}

