// lookup.js
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

const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const config = require('./config.js');
const logger = require('./logger.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

/**
 * @returns a function that returns an object about the security in the given options
 */
module.exports = function(fetch) {
    var fetchOnline = fetchOptionsFactory(fetch, false);
    var fetchOffline = fetchOptionsFactory(fetch, true);
    var self = function(options) {
        return options.offline ? fetchOffline(options) : fetchOnline(options);
    };
    self.close = () => store.close();
    return self;
};

/**
 * @returns a function that returns an object about the security in the given options
 */
function fetchOptionsFactory(fetch, offline) {
    var memoizeFirstLookup = _.memoize((symbol, exchange) => {
        return readInfo(symbol, exchange, offline).catch(err => {
            if (offline) throw err;
            else return fetch({
                interval: 'lookup',
                symbol: symbol,
                exchange: exchange,
                offline: offline
            }).then(matches => _.first(matches)).then(security => {
                if (_.isEmpty(security)) throw Error("Unknown symbol: " + symbol);
                else if (security.symbol == symbol) return security;
                else throw Error("Unknown symbol: " + symbol + ", but " + security.symbol + " is known");
            }).then(info => saveInfo(symbol, exchange, info));
        });
    }, (symbol, exchange) => {
        return exchange ? symbol + ' ' + exchange : symbol;
    });
    return function(options) {
        expect(options).to.have.property('symbol');
        var symbol = options.symbol.toUpperCase();
        var exchange = options.exchange;
        var exchanges = config('exchanges');
        if (exchange) expect(exchange).to.be.oneOf(_.keys(exchanges));
        var args = _.toArray(arguments);
        return memoizeFirstLookup(symbol, exchange).then(security => {
            return _.defaults(
                _.omit(exchanges[security.exchange], 'datasources', 'label', 'description'),
                security,
                options
            );
        }, err => {
            if (!exchange) throw err;
            expect(exchanges[exchange]).to.have.property('tz');
            logger.warn("Fetch lookup failed", err);
            return _.defaults(
                _.omit(exchanges[exchange], 'datasources', 'label', 'description'),
                options,
                {symbol: symbol}
            );
        });
    };
}

function readInfo(symbol, exchange, offline) {
    var yesterday = offline ? 0 : Date.now() - 24 *60 * 60 *1000;
    var file = getInfoFileName(symbol, exchange);
    return new Promise((cb, fail) => {
        fs.stat(file, (err, stats) => err ? fail(err) : cb(stats));
    }).then(stats => {
        if (stats.mtime.valueOf() > yesterday) return file;
        else throw {file: file, mtime: stats.mtime, message: "too old"};
    }).then(file => new Promise((cb, fail) => {
        fs.readFile(file, 'utf-8', (err, data) => err ? fail(err) : cb(data));
    })).then(data => JSON.parse(data));
}

function saveInfo(symbol, exchange, info) {
    var file = getInfoFileName(symbol, exchange);
    var data = JSON.stringify(info, null, '  ') + '\n';
    return mkdirp(path.dirname(file)).then(dir => new Promise((cb, fail) => {
        var part = partFor(file);
        fs.writeFile(part, data, 'utf-8', (err, data) => err ? fail(err) : cb(part));
    })).then(part => new Promise((cb, fail) => {
        fs.rename(part, file, err => err ? fail(err) : cb(info));
    }));
}

function getInfoFileName(symbol, exchange) {
    var name = exchange ? symbol + '.' + exchange : symbol;
    return path.resolve(config('prefix'), 'var', safe(name), 'info.json');
}

function safe(segment) {
    expect(segment).is.ok.and.not.be.a('object').and.not.be.a('function');
    if (!_.isString(segment)) return safe('' + segment);
    else if (segment.match(/^[\w._-]+$/)) return segment;
    else return segment.replace(/[^\w.-]+/g,'_');
}

function mkdirp(dirname) {
    return new Promise((present, absent) => {
        fs.access(dirname, fs.F_OK, err => err ? absent(err) : present(dirname));
    }).catch(absent => {
        if (absent.code != 'ENOENT') throw absent;
        return mkdirp(path.dirname(dirname)).then(() => new Promise((ready, error) => {
            fs.mkdir(dirname, err => err ? error(err) : ready(dirname));
        })).catch(err => {
            if (err.code == 'EEXIST') return dirname;
            else throw err;
        });
    });
}

var seq = Date.now() % 32768;
function partFor(filename) {
    return filename + '.part' + (++seq).toString(16);
}