// lookup.js
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

const fs = require('graceful-fs');
const path = require('path');
const _ = require('underscore');
const awriter = require('./atomic-write.js');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

/**
 * @returns a function that returns an object about the security in the given options
 */
module.exports = function(fetch) {
    var fetchOnline = fetchOptionsFactory(fetch, false, false);
    var fetchReadOnly = fetchOptionsFactory(fetch, false, true);
    var fetchOffline = fetchOptionsFactory(fetch, true, true);
    var self = function(options) {
        return options.offline ? fetchOffline(options) :
            options.read_only ? fetchReadOnly(options) : fetchOnline(options);
    };
    self.close = () => store.close();
    return self;
};

/**
 * @returns a function that returns an object about the security in the given options
 */
function fetchOptionsFactory(fetch, offline, read_only) {
    var dir = config('cache_dir') || path.resolve(config('prefix'), config('default_cache_dir'));
    var memoizeFirstLookup = _.memoize((symbol, market) => {
        return readInfo(dir, symbol, market, offline).catch(err => {
            if (offline) throw err;
            else return fetch({
                interval: 'lookup',
                symbol: symbol,
                market: market
            }).then(matches => _.first(matches)).then(security => {
                if (_.isEmpty(security))
                    throw Error("Unknown symbol: " + (market ? symbol + '.' + market:market));
                else if (security.symbol == symbol) return security;
                else throw Error("Unknown symbol: " + symbol + ", but " + security.symbol + " is known");
            }).then(info => {
                if (read_only) return info;
                else return saveInfo(dir, symbol, market, info);
            });
        });
    }, (symbol, market) => {
        return market ? symbol + ' ' + market : symbol;
    });
    return function(options) {
        expect(options).to.have.property('symbol');
        var symbol = options.symbol.toUpperCase();
        var market = options.market;
        var markets = config('markets');
        var args = _.toArray(arguments);
        return memoizeFirstLookup(symbol, market).then(security => {
            return _.defaults(
                _.omit(markets[security.market] || {}, 'datasources', 'label', 'description'),
                security,
                options
            );
        }, err => {
            memoizeFirstLookup.cache = {};
            if (!market) throw err;
            logger.debug("Fetch lookup failed on ", symbol + '.' + market, err);
            return _.defaults(
                _.omit(markets[market] || {}, 'datasources', 'label', 'description'),
                options,
                {symbol: symbol}
            );
        });
    };
}

function readInfo(dir, symbol, market, offline) {
    var yesterday = offline ? 0 : Date.now() - 24 *60 * 60 *1000;
    var file = getInfoFileName(dir, symbol, market);
    return new Promise((cb, fail) => {
        fs.stat(file, (err, stats) => err ? fail(err) : cb(stats));
    }).then(stats => {
        if (stats.mtime.valueOf() > yesterday) return file;
        else throw {file: file, mtime: stats.mtime, message: "too old"};
    }).then(file => new Promise((cb, fail) => {
        fs.readFile(file, 'utf-8', (err, data) => err ? fail(err) : cb(data));
    })).then(data => JSON.parse(data));
}

function saveInfo(dir, symbol, market, info) {
    var file = getInfoFileName(dir, symbol, market);
    var data = JSON.stringify(info, null, '  ') + '\n';
    return awriter.writeFile(file, data).then(() => info);
}

function getInfoFileName(dir, symbol, market) {
    var name = market ? symbol + '.' + market : symbol;
    return path.resolve(dir, safe(name), 'info.json');
}

function safe(segment) {
    expect(segment).is.ok.and.not.be.a('object').and.not.be.a('function');
    if (!_.isString(segment)) return safe('' + segment);
    else if (segment.match(/^[\w._-]+$/)) return segment;
    else return segment.replace(/[^\w.-]+/g,'_');
}
