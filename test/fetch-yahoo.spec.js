// fetch-yahoo.spec.js
/*
 *  Copyright (c) 2016-2019 James Leigh, Some Rights Reserved
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
const like = require('./should-be-like.js');
const yahoo = require('../src/fetch-yahoo.js');

describe("fetch-yahoo", function() {
    this.timeout(10000);
    var tz = 'America/New_York';
    var client = yahoo();
    after(function() {
        return client.close();
    });
    describe("lookup", function() {
        it("should find IBM", function() {
            return client({
                interval:'lookup',
                symbol:'IBM',
                marketLang:'en-US',
                exch:'NYQ'
            }).then(_.first).should.eventually.be.like({
                symbol: 'IBM',
                name: "International Business Machines Corporation"
            });
        });
        it("should find ITA", function() {
            return client({interval:'lookup',symbol:'ITA', market:"BATS"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([{
                symbol: 'ITA',
                name: /SHARES .* AEROSPACE & DEF/i
            }]);
        });
        it("should find NVDA", function() {
            return client({interval:'lookup',symbol:'NVDA', market:"NASDAQ"})
              .should.eventually.be.like(results => _.some(results, like({
                symbol: 'NVDA',
                name: /NVIDIA/i
            })));
        });
        it.skip("should find GLOW", function() {
            return client({interval:'lookup',symbol:'GLOW', market:"AMEX"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([{
                symbol: 'GLOW',
                name: /GLOWPOINT/i
            }]);
        });
        it("should find 88E", function() {
            return client({interval:'lookup',symbol:'88E', market:"LSE"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([{
                symbol: '88E',
                name: /88 ENERGY/i,
                currency: "GBP"
            }]);
        });
        it.skip("should find BBD.B", function() {
            return client({interval:'lookup',symbol:'BBD.B', market:"TSE"})
              .then(array => array.filter(item => item.symbol == 'BBD.B'))
              .should.eventually.be.like([{
                symbol: 'BBD.B',
                name: /BOMBARDIER/i,
                currency: "CAD"
            }]);
        });
        it.skip("should find any BRK.A symbol", function() {
            return client({
                interval:'lookup',
                symbol: 'BRK.A'
            }).should.eventually.be.like(results => _.some(results, like(
                {symbol: 'BRK.A', name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
            )));
        });
        it.skip("should find BRK.A symbol", function() {
            return client({interval:'lookup', symbol:'BRK.A', market:"NYSE"})
              .should.eventually.be.like(results => _.some(results, like(
                {symbol: 'BRK.A', name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
            )));
        });
        it.skip("should find BF.B symbol", function() {
            return client({interval:'lookup', symbol:'BF.B', market:"NYSE"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([
                {symbol: 'BF.B', name: /BROWN-FORMAN/}
            ]);
        });
        describe.skip("should find TSE listing", function() {
            [
                "ATD.B", "BBD.B", "BAM.A",
                "CCL.B", "GIB.A", "CTC.A",
                "RCI.B", "SJR.B", "TECK.B"
            ].forEach(symbol => {
                it(symbol, function() {
                    return client({interval:'lookup', symbol, market:"TSE"})
                      .then(array => array.filter(item => item.symbol == symbol))
                      .should.eventually.be.like([{symbol, currency: 'CAD'}]);
                });
            });
        });
        it.skip("should find N symbol", function() {
            return client({interval:'lookup', symbol:'N', market:"VENTURE"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([
                {symbol: 'N', name: /NAMASTE TECHNOLOGIES/}
            ]);
        });
    });
    it("should find BRK.A symbol", function() {
        return client({
            interval:'lookup',
            symbol: 'BRK.A',
            marketLang: 'en-US'
        }).should.eventually.be.like(results => _.some(results, like(
            {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
        )));
    });
    it("should adjust first dividend", function() {
        return client({
            interval: 'day',
            symbol: 'SPY',
            yahoo_symbol: 'SPY',
            begin: moment.tz('2017-03-15', tz),
            end: moment.tz('2017-03-21', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.defaults({adj_close: datum.adj_close * scale}, datum));
        }).should.eventually.be.like([
            {ending:'2017-03-15T16:00:00-04:00',open:237.56,close:238.95,adj_close:237.91},
            {ending:'2017-03-16T16:00:00-04:00',open:239.11,close:238.48,adj_close:237.45},
            {ending:'2017-03-17T16:00:00-04:00',open:237.75,close:237.03,adj_close:237.03},
            {ending:'2017-03-20T16:00:00-04:00',open:237.03,close:236.77,adj_close:236.77},
            {ending:'2017-03-21T16:00:00-04:00',open:237.47,close:233.73,adj_close:233.73}
        ]);
    });
    it("should adjust second dividend", function() {
        return client({
            interval: 'day',
            symbol: 'SPY',
            yahoo_symbol: 'SPY',
            begin: moment.tz('2016-12-01', tz),
            end: moment.tz('2016-12-31', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.defaults({adj_close: datum.adj_close * scale}, datum));
        }).should.eventually.be.like([
            {ending:'2016-12-01T16:00:00-05:00',open:220.73,close:219.57,adj_close:218.29},
            {ending:'2016-12-02T16:00:00-05:00',open:219.67,close:219.68,adj_close:218.40},
            {ending:'2016-12-05T16:00:00-05:00',open:220.65,close:221.00,adj_close:219.70},
            {ending:'2016-12-06T16:00:00-05:00',open:221.22,close:221.70,adj_close:220.41},
            {ending:'2016-12-07T16:00:00-05:00',open:221.52,close:224.60,adj_close:223.29},
            {ending:'2016-12-08T16:00:00-05:00',open:224.57,close:225.15,adj_close:223.83},
            {ending:'2016-12-09T16:00:00-05:00',open:225.41,close:226.51,adj_close:225.19},
            {ending:'2016-12-12T16:00:00-05:00',open:226.40,close:226.25,adj_close:224.93},
            {ending:'2016-12-13T16:00:00-05:00',open:227.02,close:227.76,adj_close:226.42},
            {ending:'2016-12-14T16:00:00-05:00',open:227.41,close:225.88,adj_close:224.55},
            {ending:'2016-12-15T16:00:00-05:00',open:226.16,close:226.81,adj_close:225.48},
            {ending:'2016-12-16T16:00:00-05:00',open:226.01,close:225.04,adj_close:225.04},
            {ending:'2016-12-19T16:00:00-05:00',open:225.25,close:225.53,adj_close:225.53},
            {ending:'2016-12-20T16:00:00-05:00',open:226.15,close:226.40,adj_close:226.40},
            {ending:'2016-12-21T16:00:00-05:00',open:226.25,close:225.77,adj_close:225.77},
            {ending:'2016-12-22T16:00:00-05:00',open:225.60,close:225.38,adj_close:225.38},
            {ending:'2016-12-23T16:00:00-05:00',open:225.43,close:225.71,adj_close:225.71},
            {ending:'2016-12-27T16:00:00-05:00',open:226.02,close:226.27,adj_close:226.27},
            {ending:'2016-12-28T16:00:00-05:00',open:226.57,close:224.40,adj_close:224.40},
            {ending:'2016-12-29T16:00:00-05:00',open:224.48,close:224.35,adj_close:224.35},
            {ending:'2016-12-30T16:00:00-05:00',open:224.73,close:223.53,adj_close:223.53}
        ]);
    });
    it("should handle ignore peudo split entry", function() {
        return client({
            interval: 'day',
            symbol: 'XLF',
            yahoo_symbol: 'XLF',
            begin: moment.tz('2016-09-14', tz),
            end: moment.tz('2016-09-21', tz),
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-09-14T16:00:00-04:00',open:23.88,close:23.82,adj_close:19.2},
            {ending:'2016-09-15T16:00:00-04:00',open:23.77,close:23.96,adj_close:19.3},
            {ending:'2016-09-16T16:00:00-04:00',open:23.75,close:23.62,adj_close:19.18},
            {ending:'2016-09-19T16:00:00-04:00',open:19.18,close:19.31,adj_close:19.31},
            {ending:'2016-09-20T16:00:00-04:00',open:19.45,close:19.32,adj_close:19.32},
            {ending:'2016-09-21T16:00:00-04:00',open:19.41,close:19.44,adj_close:19.44}
        ]);
    });
    it("should adjust for REM splits", function() {
        return client({
            interval: 'day',
            symbol: 'REM',
            market: 'BATS',
            begin: '2016-11-01',
            end: '2016-11-30',
            marketOpensAt: '09:30:00', marketClosesAt: "16:00:00", tz: tz
        }).then(data => {
            var scale = _.last(data).close / _.last(data).adj_close;
            return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
        }).should.eventually.be.like([
            {ending:'2016-11-01T16:00:00-04:00',close:10.32,adj_close:41.28},
            {ending:'2016-11-02T16:00:00-04:00',close:10.30,adj_close:41.20},
            {ending:'2016-11-03T16:00:00-04:00',close:10.35,adj_close:41.40},
            {ending:'2016-11-04T16:00:00-04:00',close:10.43,adj_close:41.72},
            {ending:'2016-11-07T16:00:00-05:00',close:42.02,adj_close:42.02},
            {ending:'2016-11-08T16:00:00-05:00',close:42.22,adj_close:42.22},
            {ending:'2016-11-09T16:00:00-05:00',close:41.95,adj_close:41.95},
            {ending:'2016-11-10T16:00:00-05:00',close:41.39,adj_close:41.39},
            {ending:'2016-11-11T16:00:00-05:00',close:41.71,adj_close:41.71},
            {ending:'2016-11-14T16:00:00-05:00',close:41.43,adj_close:41.43},
            {ending:'2016-11-15T16:00:00-05:00',close:41.74,adj_close:41.74},
            {ending:'2016-11-16T16:00:00-05:00',close:41.75,adj_close:41.75},
            {ending:'2016-11-17T16:00:00-05:00',close:41.85,adj_close:41.85},
            {ending:'2016-11-18T16:00:00-05:00',close:42.02,adj_close:42.02},
            {ending:'2016-11-21T16:00:00-05:00',close:42.42,adj_close:42.42},
            {ending:'2016-11-22T16:00:00-05:00',close:42.79,adj_close:42.79},
            {ending:'2016-11-23T16:00:00-05:00',close:42.3,adj_close:42.30},
            {ending:'2016-11-25T16:00:00-05:00',close:42.6,adj_close:42.60},
            {ending:'2016-11-28T16:00:00-05:00',close:42.82,adj_close:42.82},
            {ending:'2016-11-29T16:00:00-05:00',close:43.22,adj_close:43.22},
            {ending:'2016-11-30T16:00:00-05:00',close:42.63,adj_close:42.63}
        ]);
    });
    it.skip("should return daily CLX", function() {
        return client({
            interval: 'day',
            symbol: 'CLX', market: 'NYSE',
            begin: '2019-04-18', end: '2019-04-24',
            marketOpensAt: '09:30:00', marketClosesAt: '16:00:00', tz: tz
        })
         .then(d=>d.forEach(d=>console.log(require('util').inspect(_.pick(d,'ending','close','adj_close'),{breakLength:1000})))||d)
         .should.eventually.be.like([
            { ending: '2019-04-18T16:00:00-04:00', close: 153.48, adj_close: 152.53 },
            { ending: '2019-04-22T16:00:00-04:00', close: 154.51, adj_close: 153.55 },
            { ending: '2019-04-23T16:00:00-04:00', close: 153.7, adj_close: 153.7 }
        ]);
    });
});
