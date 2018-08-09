// adjustments.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
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
const logger = require('./logger.js');
const config = require('./config.js');
const storage = require('./storage.js');
const Yahoo = require('./yahoo-client.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;
const minor_version = require('./version.js').minor_version;

function help() {
    return [{
        symbol: {
            description: "Ticker symbol used by the exchange"
        },
        exchange: {
            description: "Exchange market acronym",
            values: config('fetch.yahoo.exchanges')
        },
        yahoo_symbol: {
            description: "Symbol for security as used by The Yahoo! Network"
        },
        begin: {
            example: "YYYY-MM-DD",
            description: "Sets the earliest date to retrieve"
        },
        end: {
            example: "YYYY-MM-DD",
            description: "Sets the latest date to retrieve"
        },
        tz: {
            description: "Timezone of the exchange formatted using the identifier in the tz database"
        },
        now: {
            usage: '<timestamp>',
            description: "The current date/time this request is started"
        },
        offline: {
            usage: 'true',
            description: "If only the local data should be used in the computation"
        }
    }];
}

module.exports = function(yahooClient) {
    var helpInfo = help();
    var dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    var store = storage(dir);
    var exchanges = _.pick(config('exchanges'), config('fetch.yahoo.exchanges'));
    var symbol = yahoo_symbol.bind(this, exchanges);
    var yahoo = yahooClient || Yahoo();
    return _.extend(options => {
        if (options.help) return Promise.resolve(helpInfo);
        else if (options.exchange && !exchanges[options.exchange]) return Promise.resolve([]);
        var name = options.exchange ? options.symbol + '.' + options.exchange :
            options.yahoo_symbol ? options.yahoo_symbol : options.symbol;
        return store.open(name, (err, db) => {
            if (err) throw err;
            else return adjustments(yahoo, db, symbol(options), options)
              .then(data => filterAdj(data, options));
        });
    }, {
        close() {
            return Promise.all([store.close(), !yahooClient && yahoo.close()]);
        }
    });
};

function yahoo_symbol(exchanges, options) {
    if (options.yahoo_symbol) {
        expect(options).to.be.like({
            yahoo_symbol: /^\S+$/
        });
        return options.yahoo_symbol;
    } else if (exchanges[options.exchange] && exchanges[options.exchange].datasources.yahoo) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        var source = exchanges[options.exchange].datasources.yahoo;
        var suffix = source.yahooSuffix || '';
        if (!suffix && options.symbol.match(/^\w+$/))
            return options.symbol;
        else
            return options.symbol
                .replace(/\^/, '-P')
                .replace(/[\.\-\/]/, '-')
                .replace(/-PR./, '-P')
                .replace(/\./g, '') +
                suffix;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        return options.symbol;
    }
}

function yahoo_adjustments(yahoo, db, symbol, options) {
    expect(options).to.have.property('begin');
    expect(options).to.have.property('tz');
    var mbegin = moment.tz(options.begin, options.tz);
    var since = Math.floor(mbegin.year()/10)+'0-01-01';
    var begin = mbegin.format('YYYY-MM-DD');
    return db.collection('adjustments')
      .then(col => col.lockWith([since], () => {
        if (options.offline && col.exists(since))
            return col.readFrom(since);
        else if (options.offline)
            throw Error(`Could not read adjustments, try again without the offline flag ${err.message}`);
        else if (fresh(col, since, options))
            return col.readFrom(since);
        var asof = moment().tz(options.tz);
        return yahoo.split(symbol, since, options.tz)
          .then(splits => yahoo.dividend(symbol, since, options.tz)
          .then(divs => splits.concat(divs)))
          .then(data => _.sortBy(data, 'Date'))
          .then(data => writeAdjPrice(yahoo, symbol, col, since, data, options))
          .then(data => {
            col.propertyOf(since, 'version', minor_version);
            col.propertyOf(since, 'asof', asof);
            return data;
          }).catch(err => {
            if (!col.exists(since)) throw err;
            else return col.readFrom(since).then(data => {
                logger.warn("Could not load adjustments", err.message);
                return data;
            }, e2 => Promise.reject(err));
          });
    }));
}

function fresh(collection, since, options) {
    if (!compatible(collection, since)) return false;
    var mend = moment.tz(options.end || options.now, options.tz);
    var asof = moment.tz(collection.propertyOf(since, 'asof'), options.tz);
    return mend.diff(asof, 'hours') < 4;
}

function writeAdjPrice(yahoo, symbol, col, since, data, options) {
    if (compatible(col, since) && col.sizeOf(since) == data.length) return col.readFrom(since);
    else return yahoo.day(symbol, since, options.tz)
      .then(prices => data.map(datum => {
        var prior = prices[_.sortedIndex(prices, datum, 'Date')-1];
        return _.extend(datum, {
            Dividends: datum.Dividends || null,
            'Stock Splits': datum['Stock Splits'] || null,
            cum_close: prior ? +prior.Close : undefined
        });
    })).then(data => col.writeTo(data, since));
}

function compatible(collection, since) {
    if (!collection.exists(since)) return false;
    return collection.propertyOf(since, 'version') == minor_version;
}

function adjustments(yahoo, db, symbol, options) {
    return yahoo_adjustments(yahoo, db, symbol, options)
      .then(data => {
        var adj = 1, adj_dividend_only = 1, adj_split_only = 1;
        var adj_yahoo_divs = 1, adj_yahoo_price = 1;
        return data.reduceRight((adjustments, datum) => {
            var exdate = datum.Date;
            var dividend = +datum.Dividends * adj_yahoo_divs;
            var split = parseSplit(datum['Stock Splits']);
            if (adjustments.length && _.last(adjustments).exdate == exdate) {
                var last = adjustments.pop();
                dividend += last.dividend;
                split *= last.split;
                // check if split is a manual adjustment for a big dividend
                if (dividend && split > 1 && split <= 2) { // XLF.ARCA 2016-09-19
                    adj_yahoo_divs *= split;
                    adj_yahoo_price *= split;
                    split = 1;
                    if (adjustments.length) {
                        adj_dividend_only = _.last(adjustments).adj_dividend_only;
                        adj_split_only = _.last(adjustments).adj_split_only;
                        adj = _.last(adjustments).adj;
                    } else {
                        adj_dividend_only = 1;
                        adj_split_only = 1;
                        adj = 1;
                    }
                }
            }
            if (split != 1) {
                adj_split_only /= split;
                adj /= split;
            }
            // heuristic to test if the split has been applied REM.NYSE 2016-11-07
            if (split != 1 && adjustments.length &&
                    Math.abs(+datum.cum_close - _.last(adjustments).cum_close) >
                    Math.abs(+datum.cum_close * adj_split_only - _.last(adjustments).cum_close)) {
                adj_yahoo_price /= split;
            }
            var cum_close = +datum.cum_close / adj_split_only * adj_yahoo_price;
            if (dividend && +datum.cum_close) {
                adj_dividend_only *= (cum_close - dividend)/cum_close;
                adj *= (cum_close - dividend)/cum_close;
            }
            adjustments.push({exdate, adj, adj_dividend_only, adj_split_only, cum_close, split, dividend});
            return adjustments;
        }, []).reverse();
    });
}

function parseSplit(stock_splits) {
    if (!stock_splits) return 1;
    var splits = stock_splits.split('/');
    return +splits[0] / +splits[1];
}

function filterAdj(adjustments, options) {
    if (!adjustments.length) return adjustments;
    var begin = moment.tz(options.begin, options.tz).format('YYYY-MM-DD');
    if (_.first(adjustments).exdate >= begin) return adjustments;
    else return adjustments.filter(datum => datum.exdate >= begin);
}

