// fetch-iqfeed.js
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
const Big = require('big.js');
const d3 = require('d3-format');
const logger = require('./logger.js');
const config = require('./config.js');
const periods = require('./periods.js');
const iqfeed = require('./iqfeed-client.js');
const Adjustments = require('./adjustments.js');
const cache = require('./memoize-cache.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

function help() {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: config('fetch.iqfeed.markets')
        },
        iqfeed_symbol: {
            description: "Symbol used in the DTN network"
        }
    };
    const tzOptions = {
        marketOpensAt: {
            description: "Time of day that the market options"
        },
        marketClosesAt: {
            description: "Time of day that the market closes"
        },
        tz: {
            description: "Timezone of the market formatted using the identifier in the tz database"
        },
        ending_format: {
            description: "Date and time format of the resulting ending field"
        }
    };
    const durationOptions = {
        begin: {
            example: "YYYY-MM-DD",
            description: "Sets the earliest date (or dateTime) to retrieve"
        },
        end: {
            example: "YYYY-MM-DD HH:MM:SS",
            description: "Sets the latest dateTime to retrieve"
        }
    };
    const lookup = {
        name: "lookup",
        usage: "lookup(options)",
        description: "Looks up existing symbol/market using the given symbol prefix using the local IQFeed client",
        properties: ['symbol', 'iqfeed_symbol', 'market', 'name', 'security_type', 'currency'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["lookup"]
            },
        })
    };
    const fundamental = {
        name: "fundamental",
        usage: "fundamental(options)",
        description: "Details of a security on the local IQFeed client",
        properties: ['type', 'symbol', 'market_id', 'pe', 'average_volume', '52_week_high', '52_week_low', 'calendar_year_high', 'calendar_year_low', 'dividend_yield', 'dividend_amount', 'dividend_rate', 'pay_date', 'exdividend_date', 'reserved', 'reserved', 'reserved', 'short_interest', 'reserved', 'current_year_earnings_per_share', 'next_year_earnings_per_share', 'five_year_growth_percentage', 'fiscal_year_end', 'reserved', 'company_name', 'root_option_symbol', 'percent_held_by_institutions', 'beta', 'leaps', 'current_assets', 'current_liabilities', 'balance_sheet_date', 'long_term_debt', 'common_shares_outstanding', 'reserved', 'split_factor_1', 'split_factor_2', 'reserved', 'reserved', 'format_code', 'precision', 'sic', 'historical_volatility', 'security_type', 'listed_market', '52_week_high_date', '52_week_low_date', 'calendar_year_high_date', 'calendar_year_low_date', 'year_end_close', 'maturity_date', 'coupon_rate', 'expiration_date', 'strike_price', 'naics', 'market_root'],
        options: _.extend({}, commonOptions, tzOptions, {
            interval: {
                values: ["fundamental"]
            },
        })
    };
    const interday = {
        name: "interday",
        usage: "interday(options)",
        description: "Historic interday data for a security on the local IQFeed client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "day",
                description: "The bar timeframe for the results",
                values: _.intersection(["day"],config('fetch.iqfeed.intervals'))
            },
        })
    };
    const intraday = {
        name: "intraday",
        usage: "intraday(options)",
        description: "Historic intraday data for a security on the local IQFeed client",
        properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'total_volume', 'adj_close'],
        options: _.extend({}, commonOptions, durationOptions, tzOptions, {
            interval: {
                usage: "m<minutes>",
                description: "Number of minutes in a single bar length, prefixed by the letter 'm'",
                values: (config('fetch.iqfeed.intervals')||[])
                    .filter(interval => /^m\d+$/.test(interval))
            }
        })
    };
    return _.compact([
        ~(config('fetch.iqfeed.intervals')||[]).indexOf('lookup') && lookup,
        ~(config('fetch.iqfeed.intervals')||[]).indexOf('fundamental') && fundamental,
        interday.options.interval.values.length && interday,
        intraday.options.interval.values.length && intraday
    ]);
}

module.exports = function() {
    const self = options => {
        if (self.closed) throw Error("IQFeed has closed");
        else return sharedInstance(options);
    };
    self.open = () => sharedInstance({open:true});
    self.close = () => unregister(self);
    return register(self);
};

let shared_instance, instance_timer;
let last_used = 0, elapsed_time = 0;
const references = [];
let instance_lock = Promise.resolve();

/** Track the references to this model */
function register(self) {
    references.push(self);
    return self;
}

/** If this is the last reference, release shared instance */
function unregister(self) {
    self.closed = true;
    const idx = references.indexOf(self);
    if (idx < 0) return Promise.resolve();
    references.splice(idx, 1)
    return instance_lock = instance_lock.catch(_.noop).then(() => {
        if (references.length) return Promise.resolve();
        else return releaseInstance();
    });
}

/** Use the shared instance, creating a new one if needed */
function sharedInstance(options) {
    last_used = elapsed_time;
    if (shared_instance) return shared_instance(options);
    else return instance_lock = instance_lock.catch(_.noop).then(() => {
        if (shared_instance) return shared_instance(options);
        shared_instance = createInstance();
        instance_timer = setInterval(() => {
            if (last_used < elapsed_time++) {
                releaseInstance().catch(logger.error);
            }
        }, config('fetch.iqfeed.timeout') || 600000).unref();
        return shared_instance(options);
    });
}

/** Free up shared instance */
function releaseInstance() {
    if (instance_timer) clearInterval(instance_timer);
    const instance = shared_instance;
    shared_instance = null;
    instance_timer = null;
    return instance ? instance.close() : Promise.resolve();
}

/** Create a new instance */
function createInstance() {
    const helpInfo = help();
    const markets = _.pick(config('markets'), config('fetch.iqfeed.markets'));
    const symbol = iqfeed_symbol.bind(this, markets);
    const launch = config('fetch.iqfeed.command');
    const iqclient = iqfeed(
        _.isArray(launch) ? launch : launch && launch.split(' '),
        config('fetch.iqfeed.env'),
        config('fetch.iqfeed.productId'),
        config('version')
    );
    const adjustments = Adjustments();
    const lookupCached = cache(lookup.bind(this, iqclient), (exchs, symbol, listed_markets) => {
        return symbol + ' ' + _.compact(_.flatten([listed_markets])).join(' ');
    }, 10);
    return Object.assign(options => {
        if (options.open) {
            return iqclient.open();
        } else if (options.help) {
            return Promise.resolve(helpInfo);
        } else if (options.rollday) {
            expect(options).to.be.like({
                interval: _.isString,
                minutes: _.isFinite,
                symbol: /^(\S| )+$/,
                begin: Boolean,
                tz: _.isString
            });
            expect(options.tz).to.match(/^\S+\/\S+$/);
            const adj = isNotEquity(markets, options) ? null : adjustments;
            return rollday(iqclient, adj, options.interval, symbol(options), options);
        } else if (options.interval == 'lookup') {
            const exchs = _.pick(_.mapObject(
                options.market ? _.pick(markets, [options.market]) : markets,
                exch => Object.assign({currency: exch.currency}, exch.datasources.iqfeed)
            ), val => val);
            const listed_markets = options.listed_market ? [options.listed_market] :
                _.compact(_.flatten(_.map(exchs, exch => exch.listed_markets)));
            if (_.isEmpty(exchs)) return Promise.resolve([]);
            else return lookupCached(exchs, symbol(options), listed_markets);
        } else if (options.interval == 'fundamental') {
            expect(options).to.be.like({
                symbol: /^(\S| )+$/,
                marketClosesAt: _.isString,
                tz: _.isString
            });
            return iqclient.fundamental(symbol(options),
                options.marketClosesAt, options.tz
            ).then(fundamental => [{
                ...fundamental,
                name: fundamental.company_name,
                security_type: security_types_map[fundamental.security_type]
            }]);
        } else if ('day' == options.interval) {
            expect(options).to.be.like({
                interval: _.isString,
                symbol: /^(\S| )+$/,
                begin: Boolean,
                marketOpensAt: /^\d\d:\d\d(:00)?$/,
                marketClosesAt: /^\d\d:\d\d(:00)?$/,
                tz: /^\S+\/\S+$/
            });
            expect(options.interval).to.be.oneOf(['day']);
            const adj = isNotEquity(markets, options) ? null : adjustments;
            return interday(iqclient, adj, symbol(options), options);
        } else {
            expect(options).to.be.like({
                interval: str => _.isString(str) && _.isFinite(str.substring(1)),
                symbol: /^(\S| )+$/,
                begin: Boolean,
                tz: _.isString
            });
            expect(options.tz).to.match(/^\S+\/\S+$/);
            const adj = isNotEquity(markets, options) ? null : adjustments;
            return intraday(iqclient, adj, symbol(options), options);
        }
    }, {
        close() {
            return Promise.all([
                lookupCached.close(),
                iqclient.close(),
                adjustments.close()
            ]);
        }
    });
}

function iqfeed_symbol(markets, options) {
    const source = ((markets[options.market]||{}).datasources||{}).iqfeed;
    const security_types = (source||{}).security_types;
    if (options.iqfeed_symbol) {
        expect(options).to.be.like({
            iqfeed_symbol: /^\S+$/
        });
        return options.iqfeed_symbol;
    } else if (source && source.dtnSymbolMap && source.dtnSymbolMap[options.symbol]) {
        return source.dtnSymbolMap[options.symbol];
    } else if (isIEOption(security_types, options)) {
        return iqfeed_ieoption(markets, options);
    } else if (source && source.week_of_month && isWeekOfYearExpiration(options.symbol)) {
        return weekOfYearToWeekOfMonth(options.symbol);
    } else if (source) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        const prefix = source.dtnPrefix || '';
        const suffix = source.dtnSuffix || '';
        const map = source.dtnPrefixMap || {};
        const three = options.symbol.substring(0, 3);
        const two = options.symbol.substring(0, 2);
        if (map[three])
            return map[three] + options.symbol.substring(3);
        else if (map[two])
            return map[two] + options.symbol.substring(2);
        else if (prefix || suffix)
            return prefix + options.symbol + suffix;
        else
            return options.symbol;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        return options.symbol;
    }
}

function isIEOption(security_types, options) {
    return options.symbol.length == 21 && security_types && ~security_types.indexOf('IEOPTION');
}

const right_month_alpha = {
    'C': {
        '01': 'A', '02': 'B', '03': 'C', '04': 'D', '05': 'E', '06': 'F',
        '07': 'G', '08': 'H', '09': 'I', '10': 'J', '11': 'K', '12': 'L'
    },
    'P': {
        '01': 'M', '02': 'N', '03': 'O', '04': 'P', '05': 'Q', '06': 'R',
        '07': 'S', '08': 'T', '09': 'U', '10': 'V', '11': 'W', '12': 'X'
    }
};
function iqfeed_ieoption(markets, options) {
    const symbol = options.symbol;
    if (symbol.length != 21) throw Error(`Option symbol must have 21 bytes ${symbol}`);
    const underlying = symbol.substring(0, 6);
    const year = symbol.substring(6, 8);
    const month = symbol.substring(8, 10);
    const day = symbol.substring(10, 12);
    const right = symbol.charAt(12);
    const dollar = symbol.substring(13, 18);
    const decimal = symbol.substring(18, 21);
    const mo = right_month_alpha[right][month];
    const strike = +dollar + +decimal / 1000;
    return `${underlying.substring(0,5).trim()}${year}${day}${mo}${strike}`;
}
const months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
const strike_format = d3.format("08d");
function occ_symbol(symbol) {
    const m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return symbol;
    const [, underlying, year, day, mo, strike] = m;
    const space = '      '.substring(0, 6 - underlying.length);
    const right = mo < 'M' ? 'C' : 'P';
    const dollar_decimal = strike_format(strike * 1000);
    return `${underlying}${space}${year}${months[mo]}${day}${right}${dollar_decimal}`;
}

function isWeekOfYearExpiration(symbol) {
    return symbol.match(/^(\w+)([0-5]\d)([A-Z])(\d\d)$/);
}

function isWeekOfMonthExpiration(symbol) {
    return symbol.match(/^@(\w+)([0-5])([A-Z])(\d\d)$/);
}

const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
function weekOfYearToWeekOfMonth(symbol) {
    const [, root, week, month, yy] = symbol.match(/^(\w+)([0-5]\d)([A-Z])(\d\d)$/);
    const mm = (101 + month_code.indexOf(month)).toString().substring(1);
    const year = moment(`20${yy}-01-01`);
    const one = year.add((10 - year.isoWeekday()) % 7, 'days');
    const first = moment(`20${yy}-${mm}-01`);
    const wednesday = first.add((10 - first.isoWeekday()) % 7, 'days');
    const expiry = one.add(+week - 1, 'weeks');
    const w = expiry.isoWeek() - wednesday.isoWeek() + 1;
    return `@${root}${w}${month}${yy}`;
}

function weekOfMonthToWeekOfYear(symbol) {
    const [, root, w, month, yy] = symbol.match(/^@(\w+)([0-5])([A-Z])(\d\d)$/);
    const mm = (101 + month_code.indexOf(month)).toString().substring(1);
    const year = moment(`20${yy}-01-01`);
    const one = year.add((10 - year.isoWeekday()) % 7, 'days');
    const first = moment(`20${yy}-${mm}-01`);
    const wednesday = first.add((10 - first.isoWeekday()) % 7, 'days');
    const expiry = wednesday.add(+w - 1, 'weeks');
    const ww = expiry.isoWeek() - one.isoWeek() + 1;
    return `${root}${ww}${month}${yy}`;
}

function isNotEquity(markets, options) {
    if (markets[options.market] && markets[options.market].datasources.iqfeed) {
        const source = markets[options.market].datasources.iqfeed;
        if (source.security_types) {
            return source.security_types.indexOf('EQUITY') < 0;
        }
    }
}

function isOptionExpired(symbol) {
    const m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return null;
    const year = m[2];
    const day = m[3];
    const mo = months[m[4]];
    const expiration_date = `20${year}-${mo}-${day}`;
    const exdate = moment(expiration_date).endOf('day');
    return exdate.isValid() && exdate.isBefore();
}

const security_types_map = {
    EQUITY: "STK",
    IEOPTION: "OPT",
    MUTUAL: "FUND",
    BONDS: "BOND",
    INDEX: "IND",
    FUTURE: "FUT",
    FOPTION: "FOP",
    SPREAD: "BAG",
    SPOT: "CASH",
    FOREX: "CASH",
    PRECMTL: "CMDTY"
};

function lookup(iqclient, exchs, symbol, listed_markets) {
    const map = _.reduce(exchs, (map, ds) => {
        if (!_.isEmpty(listed_markets) && !_.intersection(ds.listed_markets, listed_markets).length)
            return map;
        return _.extend(ds && ds.dtnPrefixMap || ds && ds.dtnSymbolMap || {}, map);
    }, {});
    const three = symbol.substring(0, 3);
    const two = symbol.substring(0, 2);
    const mapped_symbol = isWeekOfYearExpiration(symbol) ? weekOfYearToWeekOfMonth(symbol) :
        map[three] ? map[three] + symbol.substring(3) :
        map[two] ? map[two] + symbol.substring(2) : symbol;
    return iqclient.lookup(mapped_symbol, listed_markets).then(rows => rows.map(row => {
        const sym = row.symbol;
        const sources = _.pick(exchs, ds => {
            if (!~ds.listed_markets.indexOf(row.listed_market)) return false;
            const prefix = ds && ds.dtnPrefix || '';
            const suffix = ds && ds.dtnSuffix || '';
            const map = _.invert(ds && ds.dtnPrefixMap || {});
            const three = sym.substring(0, 3);
            const two = sym.substring(0, 2);
            if (map[three] || map[two]) return true;
            const startsWith = !prefix || sym.indexOf(prefix) === 0;
            const endsWith = !suffix || sym.indexOf(suffix) == sym.length - suffix.length;
            return startsWith && endsWith;
        });
        const ds = _.find(sources);
        const prefix = ds && ds.dtnPrefix || '';
        const suffix = ds && ds.dtnSuffix || '';
        const map = _.invert(ds && ds.dtnPrefixMap || {});
        const four = sym.substring(0, 4);
        const three = sym.substring(0, 3);
        const startsWith = prefix && sym.indexOf(prefix) === 0;
        const endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
        const symbol = map[sym] ? map[sym] :
            row.security_type == 'EIOPTION' ? occ_symbol(row.symbol) :
            ds && ds.week_of_month && row.security_type == 'FUTURE' && isWeekOfMonthExpiration(row.symbol) ?
                weekOfMonthToWeekOfYear(row.symbol) :
            map[four] ? map[four] + sym.substring(4) :
            map[three] ? map[three] + sym.substring(3) :
            startsWith && endsWith ?
                sym.substring(prefix.length, sym.length - prefix.length - suffix.length) :
            startsWith ? sym.substring(prefix.length) :
            endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
        return {
            symbol: symbol,
            iqfeed_symbol: row.symbol,
            market: _.first(_.keys(sources)),
            name: row.name,
            security_type: security_types_map[row.security_type],
            currency: (ds||{}).currency
        };
    })).then(rows => rows.filter(row => row.market));
}

async function interday(iqclient, adjustments, symbol, options) {
    const [prices, adjusts] = await Promise.all([
        iqclient.day(symbol, options.begin, options.end, options.tz),
        adjustments && adjustments(options)
    ]);
    const result = adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: endOf('day', datum.Date_Stamp, options),
        open: +parseCurrency(datum.Open, adj_split_only),
        high: +parseCurrency(datum.High, adj_split_only),
        low: +parseCurrency(datum.Low, adj_split_only),
        close: +parseCurrency(datum.Close, adj_split_only),
        volume: parseFloat(datum.Period_Volume) || 0,
        adj_close: +parseCurrency(datum.Close, adj_split_only).times(adj)
    }));
    return Promise.resolve(result).then(result => {
        if (_.last(result) && !_.last(result).close) result.pop();
        if (!options.end) return result;
        const end = moment.tz(options.end || options.now, options.tz);
        if (end.isAfter()) return result;
        const final = end.format(options.ending_format);
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    }).then(bars => includeIntraday(iqclient, adjustments, bars, symbol, options));
}

async function intraday(iqclient, adjustments, symbol, options) {
    const minutes = +options.interval.substring(1);
    expect(minutes).to.be.finite;
    const [prices, adjusts] = await Promise.all([
        iqclient.minute(minutes, symbol, options.begin, options.end, options.tz),
        adjustments && adjustments(options)
    ]);
    const result = adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: moment.tz(datum.Time_Stamp, 'America/New_York').tz(options.tz).format(options.ending_format),
        open: parseFloat(datum.Open),
        high: parseFloat(datum.High),
        low: parseFloat(datum.Low),
        close: parseFloat(datum.Close),
        volume: parseFloat(datum.Period_Volume) || 0,
        total_volume: parseFloat(datum.Total_Volume),
        adj_close: +Big(datum.Close).times(adj)
    })).filter(bar => bar.volume);
    if (_.last(result) && !_.last(result).close) result.pop();
    if (!options.end) return result;
    const end = moment.tz(options.end, options.tz);
    if (end.isAfter()) return result;
    const final = end.format(options.ending_format);
    let last = _.sortedIndex(result, {ending: final}, 'ending');
    if (result[last] && result[last].ending == final) last++;
    if (last == result.length) return result;
    else return result.slice(0, last);
}

async function includeIntraday(iqclient, adjustments, bars, symbol, options) {
    const now = moment.tz(options.now, options.tz);
    if (now.days() === 6 || !bars.length) return bars;
    const tz = options.tz;
    const opensAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketOpensAt, tz);
    const closesAt = moment.tz(now.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, tz);
    if (!opensAt.isBefore(closesAt)) opensAt.subtract(1, 'day');
    if (now.isBefore(opensAt)) return bars;
    if (!closesAt.isAfter(_.last(bars).ending)) return bars;
    const end = moment.tz(options.end || now, options.tz);
    if (end.isBefore(opensAt)) return bars;
    let adj = _.last(bars).adj_close / _.last(bars).close;
    const test_size = bars.length;
    const intraday = await mostRecentTrade(iqclient, adjustments, symbol, _.defaults({
        begin: _.last(bars).ending,
        end: end.format(),
        tz: tz
    }, options));
    return intraday.reduce((bars, bar) => {
        if (_.last(bars).incomplete) bars.pop(); // remove incomplete (holi)days
        if (bar.ending > _.last(bars).ending) {
            bars.push(_.extend({}, bar, {adj_close: bar.close}));
        }
        return bars;
    }, bars);
}

async function mostRecentTrade(iqclient, adjustments, symbol, options) {
    if (options.market == 'OPRA' && isOptionExpired(symbol)) {
        return [];
    } else {
        const [m30, currently] = await Promise.all([
            rollday(iqclient, adjustments, 'day', symbol, _.defaults({
                minutes: 30
            }, options)),
            summarize(iqclient, symbol, options)
        ]);
        const bar = _.last(m30);
        const today = _.last(currently);
        if (!bar) return currently;
        else if (!today) return m30;
        else if (bar.ending == options.begin && today.ending > options.begin) return currently;
        else if (bar.ending != today.ending) return m30;
        return _.initial(m30).concat(Object.assign({
            ending: today.ending,
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: today.close,
            volume: today.total_volume || bar.total_volume,
            asof: today.asof,
            incomplete: true
        }));
    }
}

async function rollday(iqclient, adjustments, interval, symbol, options) {
    expect(options).to.have.property('minutes').that.is.finite;
    const asof = moment().tz(options.tz).format(options.ending_format);
    const bars = await intraday(iqclient, adjustments, symbol, _.defaults({
        interval: 'm' + options.minutes
    }, options));
    return bars.reduce((days, bar) => {
        const merging = days.length && _.last(days).ending >= bar.ending;
        if (!merging && isBeforeOpen(bar.ending, options)) return days;
        const today = merging ? days.pop() : {};
        days.push({
            ending: today.ending || endOf(interval, bar.ending, options),
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: bar.close,
            volume: bar.total_volume,
            asof: asof,
            incomplete: true
        });
        return days;
    }, []);
}

async function summarize(iqclient, symbol, options) {
    const now = moment();
    const asof = moment(now).tz(options.tz).format(options.ending_foramt);
    const summary = await iqclient.summary(symbol).catch(err => ({}));
    const use_mid = summary.decimal_precision && summary.ask && summary.bid;
    if (!use_mid && !summary.most_recent_trade_date) return [];
    const date = use_mid ? now.tz('America/New_York') :
        moment.tz(summary.most_recent_trade_date, 'MM/DD/YYYY', 'America/New_York');
    const time = use_mid ? _.last(_.sortBy([summary.bid_timems, summary.ask_timems])) :
        summary.most_recent_trade_timems;
    const ending = moment.tz(date.format('YYYY-MM-DD') + ' ' + time, 'America/New_York').tz(options.tz);
    const ten = use_mid && Math.pow(10, +summary.decimal_precision);
    const close = use_mid ? Math.round((+summary.ask + +summary.bid)/2 * ten)/ten :
        summary.most_recent_trade;
    if (!close || !ending.isValid() || ending.isAfter(now)) return [];
    else return [{
        ending: endOf('day', ending, options),
        open: +summary.open,
        high: +summary.high,
        low: +summary.low,
        close: close,
        volume: +summary.total_volume,
        asof: asof,
        incomplete: true
    }];
}

function parseCurrency(string, adj_split_only) {
    return Big(string).div(adj_split_only);
}

function adjRight(bars, adjustments, options, cb) {
    const parseDate = bar => bar.Date_Stamp || bar.Time_Stamp.substring(0, 10);
    const result = [];
    let adj;
    let a = adjustments && adjustments.length;
    for (let i=bars.length -1; i>=0; i--) {
        if (adjustments && adjustments.length) {
            while (a > 0 && adjustments[a-1].exdate > parseDate(bars[i])) {
                adj = adjustments[--a];
            }
        }
        result[i] = cb(bars[i], Big(adj && adj.adj || 1), Big(adj && adj.adj_split_only || 1));
    }
    return result;
}

function endOf(unit, date, options) {
    const start = moment.tz(date, options.tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    let ending = moment(start).endOf(unit);
    let closes, days = 0;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        closes = moment.tz(ending.format('YYYY-MM-DD') + ' ' + options.marketClosesAt, options.tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.format(options.ending_format);
}

function isBeforeOpen(ending, options) {
    const time = ending.substring(11, 19);
    if (options.marketOpensAt < options.marketClosesAt) {
        return time > options.marketClosesAt || time < options.marketOpensAt;
    } else if (options.marketClosesAt < options.marketOpensAt) {
        return time > options.marketClosesAt && time < options.marketOpensAt;
    } else {
        return false; // 24 hour market
    }
}
