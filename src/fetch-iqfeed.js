// fetch-iqfeed.js
/*
 *  Copyright (c) 2016-2020 James Leigh, Some Rights Reserved
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
const merge = require('./merge.js');
const autoRestart = require('./auto-restart.js');
const logger = require('./logger.js');
const version = require('./version.js').toString();
const config = require('./config.js');
const Periods = require('./periods.js');
const iqfeed = require('./iqfeed-client.js');
const Fetch = require('./fetch.js');
const cache = require('./memoize-cache.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

function help(settings = {}) {
    const commonOptions = {
        symbol: {
            description: "Ticker symbol used by the market"
        },
        market: {
            description: "Exchange market acronym",
            values: settings.markets
        },
        iqfeed_symbol: {
            description: "Symbol used in the DTN network"
        }
    };
    const tzOptions = {
        open_time: {
            description: "The time of day that the open value of the daily bar in recorded"
        },
        liquid_hours: {
            description: "Regular trading hours in the format 'hh:mm:00 - hh:mm:00'"
        },
        trading_hours: {
            description: "Trading hours in the format 'hh:mm:00 - hh:mm:00'"
        },
        security_tz: {
            description: "Timezone of liquid_hours using the identifier in the tz database"
        },
        tz: {
            description: "Timezone used to format the ending field, using the identifier in the tz database"
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
    const contract = {
        name: "contract",
        usage: "contract(options)",
        description: "Looks up existing symbol/market using the given symbol using the local IQFeed client",
        properties: ['symbol', 'iqfeed_symbol', 'market', 'name', 'security_type', 'currency', 'open_time', 'trading_hours', 'liquid_hours', 'security_tz'],
        options: _.extend({}, commonOptions, {
            interval: {
                values: ["contract"]
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
                values: _.intersection(["day"],settings.intervals)
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
                values: (settings.intervals||[])
                    .filter(interval => /^m\d+$/.test(interval))
            }
        })
    };
    return _.compact([
        ~(settings.intervals||[]).indexOf('lookup') && lookup,
        ~(settings.intervals||[]).indexOf('contract') && contract,
        ~(settings.intervals||[]).indexOf('fundamental') && fundamental,
        interday.options.interval.values.length && interday,
        intraday.options.interval.values.length && intraday
    ]);
}

module.exports = function(settings = {}) {
    const self = async(options) => {
        if (self.closed) throw Error("IQFeed has closed");
        return sharedInstance(options, settings);
    };
    self.open = () => sharedInstance({open:true}, settings);
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
function sharedInstance(options, settings) {
    last_used = elapsed_time;
    if (shared_instance) return shared_instance(options);
    instance_lock = instance_lock.catch(_.noop).then(() => {
        if (shared_instance) return shared_instance;
        shared_instance = createInstance(settings);
        instance_timer = setInterval(() => {
            if (last_used < elapsed_time++) {
                instance_lock = instance_lock.catch(_.noop).then(() => {
                    if (last_used < elapsed_time) {
                        return releaseInstance().catch(logger.error);
                    }
                });
            }
        }, settings.timeout || 600000).unref();
        return shared_instance;
    });
    return instance_lock.then(instance => instance(options));
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
function createInstance(settings = {}) {
    const helpInfo = help(settings);
    const markets = _.pick(config('markets'), settings.markets);
    const symbol = iqfeed_symbol.bind(this, markets);
    const launch = settings.command;
    const timeout = settings && settings.timeout || 600000;
    const Client = autoRestart(iqfeed, timeout, 'iqfeed');
    const iqclient = new Client(
        _.isArray(launch) ? launch : launch && launch.split(' '),
        settings.env,
        settings.productId,
        config('version')
    );
    const fetch = new Fetch(merge(config('fetch'), {iqfeed:{enabled:false}}, settings.fetch));
    const adjustments = options => {
        const opt_now = moment.tz(options.now, options.tz).format(options.ending_format);
        const opt_end = moment.tz(options.end || opt_now, options.tz).format(options.ending_format);
        const end = opt_now < opt_end ? opt_now : opt_end;
        return fetch({...options, interval: 'adjustments', end});
    };
    const call_contract_cached = function() {return contract_cached.apply(this, arguments);};
    const contract_cached = cache(contract.bind(this, iqclient, symbol, call_contract_cached), (exchs, listed_markets, options) => {
        return `${options.symbol} ${options.market}`;
    }, 10);
    return Object.assign(async(options) => {
        if (options.open) {
            return iqclient.open();
        } else if (options.info=='help') {
            return helpInfo;
        } else if (options.info=='pending') {
            return iqclient.pending().map(item => ({cmd: 'fetch', label: item.label, options: item.args[0]}));
        } else if (options.info=='version') {
            return iqclient.version().then(client_version => {
                return [{version: client_version, name: 'IQFeed'}];
            }, err => {
                return [{version: null, name: 'IQFeed', message: err.message}];
            });
        } else if (options.info) {
            return [];
        }
        await iqclient.open();
        if (options.rollday) {
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
            ), exch => exch && (!options.currency || options.currency == exch.currency) && (
                !options.security_type ||
                ~exch.security_types.map(t => security_types_map[t]).indexOf(options.security_type)
            ));
            const listed_markets = options.listed_market ? [options.listed_market] :
                _.compact(_.flatten(_.map(exchs, exch => exch.listed_markets)));
            if (_.isEmpty(exchs)) return Promise.resolve([]);
            else return lookup(iqclient, exchs, symbol(options), listed_markets);
        } else if (options.interval == 'contract') {
            const exchs = _.pick(_.mapObject(
                options.market ? _.pick(markets, [options.market]) : markets,
                exch => ({...exch, ...exch.datasources.iqfeed})
            ), val => val);
            const listed_markets = options.listed_market ? [options.listed_market] :
                _.compact(_.flatten(_.map(exchs, exch => exch.listed_markets)));
            if (_.isEmpty(exchs)) return Promise.resolve([]);
            else return contract_cached(exchs, listed_markets, options);
        } else if (options.interval == 'fundamental') {
            expect(options).to.be.like({
                symbol: /^(\S| )+$/,
                open_time: /^\d\d:\d\d:00$/,
                liquid_hours: /^\d\d:\d\d:00 - \d\d:\d\d:00$/,
                trading_hours: /^\d\d:\d\d:00 - \d\d:\d\d:00$/,
                security_tz: /^\S+\/\S+$/,
                tz: /^\S+\/\S+$/
            });
            const close_time = options.liquid_hours.substring(options.liquid_hours.length - 8);
            return iqclient.fundamental(symbol(options),
                close_time, options.tz
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
                open_time: /^\d\d:\d\d:00$/,
                liquid_hours: /^\d\d:\d\d:00 - \d\d:\d\d:00$/,
                trading_hours: /^\d\d:\d\d:00 - \d\d:\d\d:00$/,
                security_tz: /^\S+\/\S+$/,
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
                contract_cached.close(),
                iqclient.close(),
                fetch.close()
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
    } else if (isFOption(security_types, options)) {
        return iqfeed_foption(markets, options);
    } else if (isFuture(security_types, options)) {
        return iqfeed_future(markets, options);
    } else if (isFutureAdjusted(security_types, options)) {
        return iqfeed_backadj(markets, options);
    } else if (source && source.week_of_month && isWeekOfYearExpiration(options.symbol)) {
        return weekOfYearToWeekOfMonth(markets, options);
    } else if (source) {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        const prefix = source.dtnPrefix || '';
        const suffix = source.dtnSuffix || '';
        const map = source.dtnPrefixMap || {};
        const symbol = options.symbol;
        const three = symbol.substring(0, 3);
        if (map[symbol])
            return map[symbol];
        else if (map[three])
            return map[three] + symbol.substring(3);
        else if (prefix || suffix)
            return prefix + symbol + suffix;
        else
            return symbol;
    } else {
        expect(options).to.be.like({
            symbol: /^\S+$/
        });
        return options.symbol;
    }
}

function isIEOption(security_types, options) {
    return options.symbol.length == 21 && (!security_types || ~security_types.indexOf('IEOPTION'));
}

function isFOption(security_types, options) {
    return (!security_types || ~security_types.indexOf('FOPTION')) && options.symbol.match(/[F-Z]\d\d [CP]\d+$/);
}

function isFuture(security_types, options) {
    return (!security_types || ~security_types.indexOf('FUTURE')) && options.symbol.match(/([F-Z])(\d\d)$/);
}

function isFutureAdjusted(security_types, options) {
    return (!security_types || ~security_types.indexOf('FUTURE')) && options.symbol.match(/#C?$/);
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
    if (!right_month_alpha[right]) throw Error(`Option symbol must have right '${symbol}'`);
    const mo = right_month_alpha[right][month];
    const strike = +dollar + +decimal / 1000;
    return `${underlying.substring(0,5).trim()}${year}${day}${mo}${strike}`;
}

function iqfeed_foption(markets, options) {
    const symbol = options.symbol;
    const source = ((markets[options.market]||{}).datasources||{}).iqfeed||{};
    const right_pad = (source.right_pad_foptions||{});
    const [, root, month, yy, right, strike] = symbol.match(/^(.*)([F-Z])(\d\d) ([CP])(\d+)$/);
    const k = strike * Math.pow(10, right_pad[root]||0);
    return `${iqfeed_symbol(markets, {...options, symbol: root})}${month}${yy}${right}${k}`;
}

function iqfeed_future(markets, options) {
    const symbol = options.symbol;
    const [, root, month, yy] = symbol.match(/^(.*)([F-Z])(\d\d)$/);
    return `${iqfeed_symbol(markets, {...options, symbol: root})}${month}${yy}`;
}

function iqfeed_backadj(markets, options) {
    const symbol = options.symbol;
    const [, root, suffix] = symbol.match(/^(.*)(#C?)$/);
    return `${iqfeed_symbol(markets, {...options, symbol: root})}${suffix}`;
}

const months = {
    A: '01', B: '02', C: '03', D: '04', E: '05', F: '06',
    G: '07', H: '08', I: '09', J: '10', K: '11', L: '12',
    M: '01', N: '02', O: '03', P: '04', Q: '05', R: '06',
    S: '07', T: '08', U: '09', V: '10', W: '11', X: '12'
};
const occ_strike_format = d3.format("08d");
function occ_symbol(symbol) {
    const m = symbol.match(/^(\w*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return symbol;
    const [, underlying, year, day, mo, strike] = m;
    const space = '      '.substring(0, 6 - underlying.length);
    const right = mo < 'M' ? 'C' : 'P';
    const dollar_decimal = ooc_strike_format(strike * 1000);
    return `${underlying}${space}${year}${months[mo]}${day}${right}${dollar_decimal}`;
}

const d4 = d3.format('04');
function fop_symbol(ds, symbol) {
    const m = symbol.match(/^(.*)([PC])(\d+)$/);
    if (!m) return symbol;
    const right_pad = (ds.right_pad_foptions||{});
    const [, fut, right, strike] = m;
    const future = fut_symbol(ds, fut);
    const [, root, month, yy] = future.match(/^(.+)([F-Z])(\d\d)$/);
    const k = strike / Math.pow(10, right_pad[root]||0);
    const suffix = ds.left_pad_foptions == false ? k : d4(k);
    return `${future} ${right}${suffix}`;
}

function fut_symbol(ds, symbol) {
    if (ds && ds.week_of_month && isWeekOfMonthExpiration(symbol))
        return weekOfMonthToWeekOfYear(ds, symbol);
    const [, root, month, yy] = symbol.match(/^(@?\w+)([F-Z])(\d\d)$/);
    return `${map_symbol(ds, root)}${month}${yy}`;
}

function backadj_symbol(ds, symbol) {
    if (ds && ds.week_of_month && isWeekOfMonthExpiration(symbol))
        return weekOfMonthToWeekOfYear(ds, symbol);
    const [, root, suffix] = symbol.match(/^(@?\w+)(#C?)$/);
    return `${map_symbol(ds, root)}${suffix}`;
}

function map_symbol(ds, sym) {
    const prefix = ds && ds.dtnPrefix || '';
    const suffix = ds && ds.dtnSuffix || '';
    const four = sym.substring(0, 4);
    const startsWith = prefix && sym.indexOf(prefix) === 0;
    const endsWith = suffix && sym.indexOf(suffix) == sym.length - suffix.length;
    const map = _.invert(ds && ds.dtnPrefixMap || {});
    return map[sym] ? map[sym] :
        map[four] ? map[four] + sym.substring(4) :
        startsWith && endsWith ?
            sym.substring(prefix.length, sym.length - prefix.length - suffix.length) :
        startsWith ? sym.substring(prefix.length) :
        endsWith ? sym.substring(0, sym.length - suffix.length) : sym;
}

function isWeekOfYearExpiration(symbol) {
    return symbol.match(/^(\w+)([0-5]\d)([A-Z])(\d\d)$/);
}

function isWeekOfMonthExpiration(symbol) {
    return symbol.match(/^@(\w+)([0-5])([A-Z])(\d\d)$/);
}

const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
function weekOfYearToWeekOfMonth(markets, options) {
    const symbol = options.symbol;
    const [, root, week, month, yy] = symbol.match(/^(\w+)([0-5]\d)([F-Z])(\d\d)$/);
    const mm = (101 + month_code.indexOf(month)).toString().substring(1);
    const year = yy < '80' ? moment(`20${yy}-01-01`) : moment(`19${yy}-01-01`);
    const one = year.add((10 - year.isoWeekday()) % 7, 'days');
    const first = moment(`${year.year()}-${mm}-01`);
    const wednesday = first.add((10 - first.isoWeekday()) % 7, 'days');
    const expiry = one.add(+week - 1, 'weeks');
    const w = expiry.isoWeek() - wednesday.isoWeek() + 1;
    return `${iqfeed_symbol(markets, {...options, symbol:root})}${w}${month}${yy}`;
}

function weekOfMonthToWeekOfYear(ds, symbol) {
    const [, root, w, month, yy] = symbol.match(/^(@\w+)([0-5])([F-Z])(\d\d)$/);
    const mm = (101 + month_code.indexOf(month)).toString().substring(1);
    const year = yy < '80' ? moment(`20${yy}-01-01`) : moment(`19${yy}-01-01`);
    const one = year.add((10 - year.isoWeekday()) % 7, 'days');
    const first = moment(`${year.year()}-${mm}-01`);
    const wednesday = first.add((10 - first.isoWeekday()) % 7, 'days');
    const expiry = wednesday.add(+w - 1, 'weeks');
    const ww = expiry.isoWeek() - one.isoWeek() + 1;
    return `${map_symbol(ds,root)}${ww}${month}${yy}`;
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
    const yy = m[2];
    const day = m[3];
    const mo = months[m[4]];
    const expiration_date = yy < '80' ? `20${yy}-${mo}-${day}` : `19${yy}-${mo}-${day}`;
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

async function contract(iqclient, symbol_fn, cache, exchs, listed_markets, options) {
    const source = exchs[options.market] || {};
    const security_types = source.security_types;
    const listed_markets_ar = _.compact(_.flatten([listed_markets]));
    const listed_market = listed_markets_ar.length == 1 ? listed_markets_ar[0] : null;
    const cache_fn = cache.bind(this, exchs, listed_markets);
    const rows = isIEOption(security_types, options) ? await contractForOption(source, cache_fn, options) :
        isFuture(security_types, options) ? await contractForFutures(source, cache_fn, options) :
        isFOption(security_types, options) ? await contractForFOption(iqclient, symbol_fn, cache, exchs, listed_markets, options) :
        await lookup(iqclient, exchs, symbol_fn(options), listed_markets);
    return rows.filter(row => {
        return row.symbol == options.symbol && row.market == options.market;
    }).map(row => _.omit({
        ...row,
        currency: source.currency,
        security_tz: source.security_tz,
        open_time: source.open_time,
        trading_hours: source.trading_hours,
        liquid_hours: source.liquid_hours
    }, v => !v));
}

async function lookup(iqclient, exchs, symbol, listed_markets) {
    const rows = await iqclient.lookup(symbol, listed_markets);
    return rows.map(row => {
        const sym = row.symbol;
        const sources = _.pick(exchs, ds => {
            if (!ds.listed_markets) return false;
            if (!~ds.listed_markets.indexOf(row.listed_market)) return false;
            const prefix = ds && ds.dtnPrefix || '';
            const suffix = ds && ds.dtnSuffix || '';
            const map = _.invert(ds && ds.dtnPrefixMap || {});
            const three = sym.substring(0, 3);
            const two = sym.substring(0, 2);
            if (map[sym] || map[three] || map[two]) return true;
            const startsWith = !prefix || sym.indexOf(prefix) === 0;
            const endsWith = !suffix || sym.indexOf(suffix) == sym.length - suffix.length;
            return startsWith && endsWith;
        });
        const ds = _.find(sources);
        const symbol =
            row.security_type == 'IEOPTION' ? occ_symbol(row.symbol) :
            row.security_type == 'FOPTION' && row.symbol.match(/^@?\w+[F-Z]\d\d[CP]\d+$/) ? fop_symbol(ds, row.symbol) :
            row.security_type == 'FUTURE' && row.symbol.match(/^@?\w+[F-Z]\d\d$/) ? fut_symbol(ds, row.symbol) :
            row.security_type == 'FUTURE' && row.symbol.match(/^@?\w+#C?$/) ? backadj_symbol(ds, row.symbol) :
            map_symbol(ds, row.symbol);
        return {
            symbol: symbol,
            iqfeed_symbol: row.symbol,
            market: _.first(_.keys(sources)),
            name: row.name,
            security_type: security_types_map[row.security_type],
            currency: (ds||{}).currency
        };
    }).filter(row => row.market);
}

const month_names = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];
function contractForOption(source, cache, options) {
    const symbol = options.symbol;
    if (symbol.length != 21) throw Error(`Option symbol must have 21 bytes ${symbol}`);
    const underlying = symbol.substring(0, 6);
    const year = symbol.substring(6, 8);
    const month = symbol.substring(8, 10);
    const day = symbol.substring(10, 12);
    const right = symbol.charAt(12);
    const dollar = symbol.substring(13, 18);
    const decimal = symbol.substring(18, 21);
    const pc = right == 'C' ? 'Call' : 'Put';
    const strike = +dollar + +decimal / 1000;
    return [{
        symbol,
        market: options.market,
        name: `${underlying} ${month_names[month - 1]} '${year} ${pc} ${strike}`,
        security_type: 'OPT',
        currency: source.currency
    }];
}

async function contractForFOption(iqclient, symbol_fn, cache, exchs, listed_markets, options) {
    const now = moment.tz(options.now, options.tz);
    const symbol = options.symbol;
    const source = exchs[options.market] || {};
    const right_pad = (source.right_pad_foptions||{});
    const [, root, month, yy, right, strike] = symbol.match(/^(.*)([F-Z])(\d\d) ([CP])(\d+)$/);
    const midx = month_code.indexOf(month);
    const pc = right == 'C' ? 'Call' : 'Put';
    const k = strike * Math.pow(10, right_pad[root]||0);
    const next = (100+Math.max((now.year()%100)+(now.month() < midx ? 0 : 1),+yy)).toString().substring(1);
    const opt = {...options, symbol: `${root}${month}${next} ${right}${strike}`};
    const iqfeed_symbol = symbol_fn(opt);
    const current = await lookup(iqclient, exchs, iqfeed_symbol, listed_markets);
    return current.filter(cur => cur.symbol == symbol).map(cur => ({
        symbol,
        market: cur.market,
        name: `${root} ${month_names[month_code.indexOf(month)]} '${yy} ${pc}`,
        security_type: 'FOP',
        currency: cur.currency
    }));
}

async function contractForFutures(source, cache, options) {
    const symbol = options.symbol;
    const right_pad = (source.right_pad_foptions||{});
    const [, root, month, yy] = symbol.match(/^(.*)([F-Z])(\d\d)$/);
    const back = await cache({...options, symbol: `${root}#C`});
    return back.map(fut => ({
        symbol,
        market: options.market,
        name: `${root} ${month_names[month_code.indexOf(month)]} '${yy}`,
        security_type: 'FUT',
        currency: source.currency
    }));
}

async function interday(iqclient, adjustments, symbol, options) {
    if (options.end) expect(options.begin).not.to.be.above(options.end);
    expect(options.tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    if (isOptionExpired(symbol, options.begin, options.end, options.tz)) return [];
    const periods = new Periods(options);
    const now = moment().tz(options.tz);
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
        const end = periods.ceil(options.end || options.now);
        if (end.isAfter()) return result;
        const final = end.format(options.ending_format);
        let last = _.sortedIndex(result, {ending: final}, 'ending');
        if (result[last] && result[last].ending == final) last++;
        if (last == result.length) return result;
        else return result.slice(0, last);
    }).then(bars => includeIntraday(iqclient, adjustments, bars, symbol, options))
      .then(results => {
        const latest = _.last(results);
        if (results.length && now.diff(latest.ending, 'hours') < 1) {
            // today's session might not be over yet or data might be delayed
            latest.asof = now.format(options.ending_format);
        }
        return results;
    });
}

async function intraday(iqclient, adjustments, symbol, options) {
    if (options.end) expect(options.begin).not.to.be.above(options.end);
    expect(options.tz).to.be.a('string').and.match(/^\S+\/\S+$/);
    if (isOptionExpired(symbol, options.begin, options.end, options.tz)) return [];
    const periods = new Periods(options);
    const minutes = +options.interval.substring(1);
    expect(minutes).to.be.finite;
    const now = moment().tz(options.tz);
    const [prices, adjusts] = await Promise.all([
        iqclient.minute(minutes, symbol, options.begin, options.end, options.tz),
        adjustments && adjustments(options)
    ]);
    const result = adjRight(prices, adjusts, options, (datum, adj, adj_split_only) => ({
        ending: periods.ceil(moment.tz(datum.Time_Stamp, 'America/New_York')).format(options.ending_format),
        open: parseFloat(datum.Open),
        high: parseFloat(datum.High),
        low: parseFloat(datum.Low),
        close: parseFloat(datum.Close),
        volume: parseFloat(datum.Period_Volume) || 0,
        total_volume: parseFloat(datum.Total_Volume),
        adj_close: +Big(datum.Close).times(adj)
    }))
      // iqfeed SPX.CBOE has after hours bars, but options' hours might not
      .filter((bar, i, bars) => !i || bars[i].ending != bars[i-1].ending);
    if (_.last(result) && !_.last(result).close) result.pop();
    if (!options.end) return result;
    const end = moment.tz(options.end, options.tz);
    if (end.isAfter()) return result;
    const final = end.format(options.ending_format);
    let last = _.sortedIndex(result, {ending: final}, 'ending');
    if (result[last] && result[last].ending == final) last++;
    const results = last == result.length ? result : result.slice(0, last);
    const latest = _.last(results);
    if (results.length && now.diff(latest.ending, 'hours') < 1) {
        // latest bar might yet be incomplete (or not yet finalized/adjusted)
        latest.asof = now.format(options.ending_format);
    }
    return results;
}

function isOptionExpired(symbol, begin, end, tz) {
    const m = symbol.match(/^(.*)(\d\d)(\d\d)([A-X])(\d+(\.\d+)?)$/);
    if (!m) return false;
    const year = m[2];
    const mo = months[m[4]];
    const day = m[3];
    const century = year < '80' ? '20' : '19';
    const exdate = moment.tz(`${century}${year}-${mo}-${day}`,tz);
    const issued = mo == '01' ?
        moment(exdate).subtract(3, 'years') :
        moment(exdate).subtract(9, 'months');
    if (exdate.endOf('day').isBefore(begin))
        return true;
    else if (end && issued.isAfter(end))
        return true;
    else
        return false;
}

async function includeIntraday(iqclient, adjustments, bars, symbol, options) {
    const tz = options.security_tz;
    const now = moment.tz(options.now, tz);
    if (now.days() === 6) return bars;
    const close_time = options.liquid_hours.substring(options.liquid_hours.length - 8);
    const opensAt = moment.tz(`${now.format('YYYY-MM-DD')}T${options.open_time}`, tz);
    const closesAt = moment.tz(`${now.format('YYYY-MM-DD')}T${close_time}`, tz);
    if (!opensAt.isBefore(closesAt)) opensAt.subtract(1, 'day');
    if (now.isAfter(closesAt)) {
        const last = bars.length && moment.tz(_.last(bars).ending, options.tz);
        if (last && !last.isBefore(closesAt)) {
            opensAt.add(1, 'day');
            closesAt.add(1, 'day');
        }
    }
    if (now.isBefore(opensAt)) return bars;
    if (opensAt.isAfter(options.end)) return bars;
    if (!bars.length) return mostRecentTrade(iqclient, adjustments, symbol, _.defaults({
        begin: moment.tz(options.begin, options.tz).format(options.ending_format),
        end: moment.tz(options.end || now, options.tz).format(options.ending_format)
    }, options));
    if (!closesAt.isAfter(_.last(bars).ending)) return bars;
    const end = moment.tz(options.end || now, options.tz);
    if (end.isBefore(opensAt)) return bars;
    const test_size = bars.length;
    const intraday = await mostRecentTrade(iqclient, adjustments, symbol, _.defaults({
        begin: _.last(bars).ending,
        end: end.format(options.ending_format)
    }, options));
    return intraday.reduce((bars, bar) => {
        if (_.last(bars).asof && _.last(bars).asof < bar.ending)
            bars.pop(); // remove incomplete (holi)days
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
        if (!today || today.ending < options.begin) return m30;
        else if (!bar) return currently;
        else if (bar.ending == options.begin && today.ending > options.begin) return currently;
        else if (bar.ending != today.ending) return m30;
        return _.initial(m30).concat(Object.assign({
            ending: today.ending,
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: today.close,
            volume: today.total_volume || bar.total_volume || bar.volume,
            asof: today.asof
        }));
    }
}

async function rollday(iqclient, adjustments, interval, symbol, options) {
    expect(options).to.have.property('minutes').that.is.finite;
    const asof = moment().tz(options.tz).format(options.ending_format);
    const bars = await intraday(iqclient, adjustments, symbol, _.defaults({
        interval: 'm' + options.minutes
    }, options));
    const close_time = options.liquid_hours.substring(options.liquid_hours.length - 8);
    const date = moment.tz((_.first(bars)||{}).ending, options.security_tz);
    const opens = moment.tz(`${date.format('Y-MM-DD')}T${options.open_time}`, options.security_tz);
    const closes = moment.tz(`${date.format('Y-MM-DD')}T${close_time}`, options.security_tz);
    const marketOpensAt = opens.tz(options.tz).format(options.ending_format).substring(11, 19);
    const marketClosesAt = closes.tz(options.tz).format(options.ending_format).substring(11, 19);
    return bars.reduce((days, bar) => {
        const merging = days.length && _.last(days).ending >= bar.ending;
        if (!merging && isBeforeOpen(bar.ending.substring(11, 19), marketOpensAt, marketClosesAt)) return days;
        const today = merging ? days.pop() : {};
        days.push({
            ending: today.ending || endOf(interval, bar.ending, options),
            open: today.open || bar.open,
            high: Math.max(today.high || 0, bar.high),
            low: today.low && today.low < bar.low ? today.low : bar.low,
            close: bar.close,
            volume: bar.total_volume,
            asof: asof
        });
        return days;
    }, []);
}

async function summarize(iqclient, symbol, options) {
    const now = moment();
    const asof = moment(now).tz(options.tz).format(options.ending_foramt);
    const summary = await iqclient.summary(symbol).catch(err => ({}));
    const use_mid = summary.decimal_precision && summary.ask && summary.bid &&
        summary.bid_timems && summary.ask_timems;
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
        open: +summary.open || close,
        high: Math.max(summary.high, close),
        low: +summary.low || close,
        close: close,
        volume: +summary.total_volume,
        asof: asof
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
    const start = moment.tz(date, options.security_tz);
    if (!start.isValid()) throw Error("Invalid date " + date);
    const close_time = options.liquid_hours.substring(options.liquid_hours.length - 8);
    let ending = moment(start).endOf(unit);
    let closes, days = 0;
    do {
        if (ending.days() === 0) ending.subtract(2, 'days');
        else if (ending.days() == 6) ending.subtract(1, 'days');
        closes = moment.tz(`${ending.format('YYYY-MM-DD')}T${close_time}`, options.security_tz);
        if (!closes.isValid()) throw Error("Invalid marketClosesAt " + options.marketClosesAt);
        if (closes.isBefore(start)) ending = moment(start).add(++days, 'days').endOf(unit);
    } while (closes.isBefore(start));
    return closes.tz(options.tz).format(options.ending_format);
}

function isBeforeOpen(time, marketOpensAt, marketClosesAt) {
    if (marketOpensAt < marketClosesAt) {
        return time > marketClosesAt || time < marketOpensAt;
    } else if (marketClosesAt < marketOpensAt) {
        return time > marketClosesAt && time < marketOpensAt;
    } else {
        return false; // 24 hour market
    }
}
