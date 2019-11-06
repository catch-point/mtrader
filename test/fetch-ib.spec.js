// fetch-ib.spec.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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
const Big = require('big.js');
const moment = require('moment-timezone');
const config = require('../src/config.js');
const like = require('./should-be-like.js');
const IB = require('../src/fetch-ib.js');
const version = require('../src/version.js').toString();

describe("fetch-ib", function() {
    this.timeout(100000);
    var tz = 'America/New_York';
    var client = new IB(config('fetch.ib'));
    before(function() {
        return client.open().catch(err => {
            client = null;
            this.skip();
        });
    });
    beforeEach(function() {
        if (client == null) this.skip();
    });
    after(function() {
        if (client) return client.close();
    });
    describe("info", function() {
        it("help", function() {
            return client({info:'help'})
              .should.eventually.be.like([{
                "name": "lookup",
                "options": {
                  "interval": {
                    "values": [
                      "lookup"
                    ]
                  }
                }
            }, {
                "name": "fundamental",
                "options": {
                  "interval": {
                    "values": [
                      "fundamental"
                    ]
                  }
                }
            }, {
                "name": "interday",
                "options": {
                  "interval": {
                    "values": [
                      "day"
                    ]
                  }
                }
            }, {
                "name": "intraday",
                "options": {
                  "interval": {
                    "values": [
                      "m240",
                      "m120",
                      "m60",
                      "m30",
                      "m15",
                      "m10",
                      "m5",
                      "m2",
                      "m1"
                    ]
                  }
                }
            }]);
        });
        it("version", function() {
            return client({info:'version'})
              .then(d=>d.forEach(d=>console.log(d))||d)
              .then(data => data.filter((datum,i,data) => {
                const string = JSON.stringify(datum);
                return i == data.findIndex(d => JSON.stringify(d) == string);
             })).should.eventually.be.like([{
                name: "TWS API"
            }]);
        });
    });
    describe("lookup", function() {
        it("should find IBM", function() {
            return client({interval:'lookup',symbol:'IBM', market:"NYSE"})
              .should.eventually.be.like([{
                symbol: 'IBM',
                name: "INTL BUSINESS MACHINES CORP"
            }]);
        });
        it("should find ITA", function() {
            return client({interval:'lookup',symbol:'ITA', market:"BATS"})
              .should.eventually.be.like([{
                symbol: 'ITA',
                name: "ISHARES U.S. AEROSPACE & DEF"
            }]);
        });
        it("should find NVDA", function() {
            return client({interval:'lookup',symbol:'NVDA', market:"NASDAQ"})
              .should.eventually.be.like([{
                symbol: 'NVDA',
                name: "NVIDIA CORP"
            }]);
        });
        it("should find GLOW", function() {
            return client({interval:'lookup',symbol:'GLOW', market:"AMEX"})
              .should.eventually.be.like([{
                symbol: 'GLOW',
                name: "GLOWPOINT INC"
            }]);
        });
        it("should find 88E", function() {
            return client({interval:'lookup',symbol:'88E', market:"LSE"})
              .should.eventually.be.like([{
                symbol: '88E',
                name: "88 ENERGY LTD",
                currency: "GBP"
            }]);
        });
        it("should find BBD.B", function() {
            return client({interval:'lookup',symbol:'BBD.B', market:"TSE"})
              .should.eventually.be.like([{
                symbol: 'BBD.B',
                name: "BOMBARDIER INC-B",
                currency: "CAD"
            }]);
        });
        it("should find any BRK.A symbol", function() {
            return client({
                interval:'lookup',
                symbol: 'BRK.A'
            }).should.eventually.be.like(results => _.some(results, like(
                {symbol: 'BRK.A', name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
            )));
        });
        it("should find BRK.A symbol", function() {
            return client({interval:'lookup', symbol:'BRK.A', market:"NYSE"})
              .should.eventually.be.like(results => _.some(results, like(
                {symbol: 'BRK.A', name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
            )));
        });
        it("should find BF.B symbol", function() {
            return client({interval:'lookup', symbol:'BF.B', market:"NYSE"})
              .should.eventually.be.like(results => _.some(results, like(
                {symbol: 'BF.B', name: 'BROWN-FORMAN CORP-CLASS B'}
            )));
        });
        describe("should find TSE listing", function() {
            [
                "ATD.B", "BBD.B", "BAM.A",
                "CCL.B", "GIB.A", "CTC.A",
                "RCI.B", "SJR.B", "TECK.B"
            ].forEach(symbol => {
                it(symbol, function() {
                    return client({interval:'lookup', symbol, market:"TSE"})
                      .should.eventually.be.like([{symbol, currency: 'CAD'}]);
                });
            });
        });
        it("should find N symbol", function() {
            return client({interval:'lookup', symbol:'N', market:"VENTURE"})
              .should.eventually.be.like([
                {symbol: 'N', name: 'NAMASTE TECHNOLOGIES INC'}
            ]);
        });
        describe("should find cross currencies", function() {
            const currencies = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
            currencies.forEach((base, c) => {
                currencies.slice(c+1).forEach(quote => {
                    it(base + '.' + quote, function() {
                        return client({interval:'lookup', symbol: base, market:quote})
                          .should.eventually.be.like([{symbol: base, currency: quote}]);
                    });
                });
            });
            ['NOK', 'SEK', 'CNH'].forEach(quote => {
                it('USD.' + quote, function() {
                    return client({interval:'lookup', symbol: 'USD', market:quote})
                      .should.eventually.be.like([{symbol: 'USD', currency: quote}]);
                });
            });
        });
        describe("should lookup CME futures symbols", function() {
            _.range((moment().year()-1)%100,(moment().year()+5)%100).map(year => ['H','M','U','Z'].map(mo => {
                it(`6E${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `6E${mo}${year}`,
                        market: "CME"
                    }).should.eventually.be.like([{symbol: `6E${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup NYMEX futures symbols", function() {
            _.range((moment().year()-1)%100,(moment().year()+5)%100).map(year => ['M','Z'].map(mo => {
                it(`GC${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `GC${mo}${year}`,
                        market: "NYMEX"
                    }).should.eventually.be.like([{symbol: `GC${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup CBOT quarterly futures symbols", function() {
            _.range((moment().year())%100,(moment().year()+1)%100).map(year => ['H','M','U','Z'].map(mo => {
                it(`ZN${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `ZN${mo}${year}`,
                        market: "CBOT"
                    })
                      .then(array => array.filter(item => item.symbol == `ZN${mo}${year}`))
                      .should.eventually.be.like([{symbol: `ZN${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup NYMEX futures symbols", function() {
            _.range((moment().year()-1)%100,(moment().year()+5)%100).map(year => ['M','Z'].map(mo => {
                it(`QM${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `QM${mo}${year}`,
                        market: "NYMEX"
                    }).should.eventually.be.like([{symbol: `QM${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup CFE monthly futures symbols", function() {
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            ['H', 'J', 'K', 'M', 'N'].filter(mo => month_code.indexOf(mo) > moment().month()).map(mo => {
                it(`VX${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `VX${mo}${year}`,
                        market: "CFE"
                    })
                      //.then(array => array.filter(item => item.symbol == `VX${mo}${year}`))
                      .should.eventually.be.like([{symbol: `VX${mo}${year}`}]);
                });
            });
        });
        describe.skip("should lookup CFE weekly futures symbols", function() {
            const week = moment().isoWeek() + 3;
            const year = moment(`${moment().year()}-01-01`);
            const one = year.add((10 - year.isoWeekday()) % 7, 'days');
            const expiry = moment(one).add(week - 1, 'weeks');
            const next_month = moment(expiry).date(1).add(1, 'months');
            const friday = moment(next_month).add((12 - year.isoWeekday()) % 7, 'days').add(2, 'weeks');
            const monthly_expiry = moment(friday).subtract(30, 'days');
            const ww = expiry.isSame(monthly_expiry) ? '' : (week+100).toString().substring(1);
            const yy = expiry.year().toString().substring(2);
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const symbol = `VX${ww}${month_code[expiry.month()]}${yy}`;
            it(symbol, function() {
                return client({
                    interval:'lookup',
                    symbol: symbol,
                    market: "CFE"
                })
                  .then(array => array.filter(item => item.symbol == symbol))
                  .should.eventually.be.like([{symbol: symbol}]);
            });
        });
        it("should find SPX symbol", function() {
            return client({interval:'lookup', symbol:'SPX', market:"CBOE"})
              .should.eventually.be.like([
                {symbol: 'SPX', name: 'S&P 500 Stock Index'}
            ]);
        });
        it("should find RUT symbol", function() {
            return client({interval:'lookup', symbol:'RUT', market:"X"})
              .should.eventually.be.like([
                {symbol: 'RUT', name: 'Russell 2000 Stock Index'}
            ]);
        });
    });
    describe("fundamental", function() {
        it("should show IBM", function() {
            return client({interval:'fundamental',symbol:'IBM', market:"NYSE"})
              .should.eventually.be.like([{
                symbol: 'IBM',
                name: "INTL BUSINESS MACHINES CORP",
                industry: 'Technology',
                category: 'Computers',
                subcategory: 'Computer Services',
                minTick: 0.01
            }]);
        });
        it("should show ITA", function() {
            return client({interval:'fundamental',symbol:'ITA', market:"BATS"})
              .should.eventually.be.like([{
                symbol: 'ITA',
                name: "ISHARES U.S. AEROSPACE & DEF",
                minTick: 0.01
            }]);
        });
    });
    describe("interday", function() {
        it("should adjust first dividend", function() {
            return client({
                interval: 'day',
                symbol: 'SPY',
                market: 'ARCA',
                begin: '2017-03-15',
                end: '2017-03-22',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: "16:00:00", tz: tz
            }).then(data => {
                var scale = Big(_.last(data).close).div(_.last(data).adj_close);
                return data.map(datum => _.defaults({adj_close: +Big(datum.adj_close).times(scale)}, datum));
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
                market: 'ARCA',
                begin: '2016-12-01',
                end: '2016-12-31',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: "16:00:00", tz: tz
            }).then(data => {
                var scale = _.last(data).close / _.last(data).adj_close;
                return data.map(datum => _.defaults({adj_close: datum.adj_close * scale}, datum));
            }).should.eventually.be.like([
                {ending:'2016-12-01T16:00:00-05:00',close:219.57,adj_close:218.29},
                {ending:'2016-12-02T16:00:00-05:00',close:219.68,adj_close:218.40},
                {ending:'2016-12-05T16:00:00-05:00',close:221.00,adj_close:219.70},
                {ending:'2016-12-06T16:00:00-05:00',close:221.70,adj_close:220.41},
                {ending:'2016-12-07T16:00:00-05:00',close:224.60,adj_close:223.29},
                {ending:'2016-12-08T16:00:00-05:00',close:225.15,adj_close:223.83},
                {ending:'2016-12-09T16:00:00-05:00',close:226.51,adj_close:225.19},
                {ending:'2016-12-12T16:00:00-05:00',close:226.25,adj_close:224.93},
                {ending:'2016-12-13T16:00:00-05:00',close:227.76,adj_close:226.42},
                {ending:'2016-12-14T16:00:00-05:00',close:225.88,adj_close:224.55},
                {ending:'2016-12-15T16:00:00-05:00',close:226.81,adj_close:225.48},
                {ending:'2016-12-16T16:00:00-05:00',close:225.04,adj_close:225.04},
                {ending:'2016-12-19T16:00:00-05:00',close:225.53,adj_close:225.53},
                {ending:'2016-12-20T16:00:00-05:00',close:226.40,adj_close:226.40},
                {ending:'2016-12-21T16:00:00-05:00',close:225.77,adj_close:225.77},
                {ending:'2016-12-22T16:00:00-05:00',close:225.38,adj_close:225.38},
                {ending:'2016-12-23T16:00:00-05:00',close:225.71,adj_close:225.71},
                {ending:'2016-12-27T16:00:00-05:00',close:226.27,adj_close:226.27},
                {ending:'2016-12-28T16:00:00-05:00',close:224.40,adj_close:224.40},
                {ending:'2016-12-29T16:00:00-05:00',close:224.35,adj_close:224.35},
                {ending:'2016-12-30T16:00:00-05:00',close:223.53,adj_close:223.53}
            ]);
        });
        it("should handle ignore peudo split entry", function() {
            return client({
                interval: 'day',
                symbol: 'XLF',
                market: 'ARCA',
                begin: '2016-09-14',
                end: '2016-09-22',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: "16:00:00", tz: tz
            }).then(data => {
                var scale = _.last(data).close / _.last(data).adj_close;
                return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
            }).should.eventually.be.like([
                {ending:'2016-09-14T16:00:00-04:00',open:23.9,close:23.8,adj_close:19.2},
                {ending:'2016-09-15T16:00:00-04:00',open:23.76,close:23.95,adj_close:19.3},
                {ending:'2016-09-16T16:00:00-04:00',open:23.74,close:23.6,adj_close:19.17},
                {ending:'2016-09-19T16:00:00-04:00',close:19.31,adj_close:19.31},
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
                end: '2016-12-01',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: "16:00:00", tz: tz
            }).then(data => {
                var scale = _.last(data).close / _.last(data).adj_close;
                return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
            }).should.eventually.be.like([
                {ending:'2016-11-01T16:00:00-04:00',close:10.32,adj_close:41.28},
                {ending:'2016-11-02T16:00:00-04:00',close:10.3,adj_close:41.20},
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
        it("should return daily FX", function() {
            return client({
                interval: 'day',
                symbol: 'USD', market: 'CAD',
                begin: '2014-01-01', end: '2014-02-01',
                premarketOpensAt: '17:00:00', marketOpensAt: '17:00:00',
                afterHoursClosesAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
            }).should.eventually.be.like([
                {ending:'2014-01-02T17:00:00-05:00',close:1.067},
                {ending:'2014-01-03T17:00:00-05:00',close:1.063},
                {ending:'2014-01-06T17:00:00-05:00',close:1.065},
                {ending:'2014-01-07T17:00:00-05:00',close:1.077},
                {ending:'2014-01-08T17:00:00-05:00',close:1.082},
                {ending:'2014-01-09T17:00:00-05:00',close:1.084},
                {ending:'2014-01-10T17:00:00-05:00',close:1.089},
                {ending:'2014-01-13T17:00:00-05:00',close:1.086},
                {ending:'2014-01-14T17:00:00-05:00',close:1.095},
                {ending:'2014-01-15T17:00:00-05:00',close:1.094},
                {ending:'2014-01-16T17:00:00-05:00',close:1.093},
                {ending:'2014-01-17T17:00:00-05:00',close:1.096},
                {ending:'2014-01-20T17:00:00-05:00',close:1.094},
                {ending:'2014-01-21T17:00:00-05:00',close:1.097},
                {ending:'2014-01-22T17:00:00-05:00',close:1.109},
                {ending:'2014-01-23T17:00:00-05:00',close:1.110},
                {ending:'2014-01-24T17:00:00-05:00',close:1.108},
                {ending:'2014-01-27T17:00:00-05:00',close:1.111},
                {ending:'2014-01-28T17:00:00-05:00',close:1.115},
                {ending:'2014-01-29T17:00:00-05:00',close:1.117},
                {ending:'2014-01-30T17:00:00-05:00',close:1.116},
                {ending:'2014-01-31T17:00:00-05:00',close:1.113}
            ]);
        });
        it("should fetch SPX.CBOE", function() {
            return client({
                interval: 'day',
                symbol: 'SPX',
                market: 'CBOE',
                begin: '2016-11-01',
                end: '2016-12-01',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: "16:00:00", tz: tz
            }).should.eventually.be.like([
        {ending:"2016-11-01T16:00:00-04:00",open:2128.68,high:2131.45,low:2097.85,close:2111.72,adj_close:2111.72},
        {ending:"2016-11-02T16:00:00-04:00",open:2109.43,high:2111.76,low:2094,close:2097.94,adj_close:2097.94},
        {ending:"2016-11-03T16:00:00-04:00",open:2098.8,high:2102.56,low:2085.23,close:2088.66,adj_close:2088.66},
        {ending:"2016-11-04T16:00:00-04:00",open:2083.79,high:2099.07,low:2083.79,close:2085.18,adj_close:2085.18},
        {ending:"2016-11-07T16:00:00-05:00",open:2100.59,high:2132,low:2100.59,close:2131.52,adj_close:2131.52},
        {ending:"2016-11-08T16:00:00-05:00",open:2129.92,high:2146.87,low:2123.56,close:2139.56,adj_close:2139.56},
        {ending:"2016-11-09T16:00:00-05:00",open:2131.56,high:2170.1,low:2125.35,close:2163.26,adj_close:2163.26},
        {ending:"2016-11-10T16:00:00-05:00",open:2167.49,high:2182.3,low:2151.17,close:2167.48,adj_close:2167.48},
        {ending:"2016-11-11T16:00:00-05:00",open:2162.71,high:2165.92,low:2152.49,close:2164.45,adj_close:2164.45},
        {ending:"2016-11-14T16:00:00-05:00",open:2165.64,high:2171.36,low:2156.08,close:2164.2,adj_close:2164.2},
        {ending:"2016-11-15T16:00:00-05:00",open:2168.29,high:2180.84,low:2166.38,close:2180.39,adj_close:2180.39},
        {ending:"2016-11-16T16:00:00-05:00",open:2177.53,high:2179.22,low:2172.2,close:2176.94,adj_close:2176.94},
        {ending:"2016-11-17T16:00:00-05:00",open:2178.61,high:2188.06,low:2176.65,close:2187.12,adj_close:2187.12},
        {ending:"2016-11-18T16:00:00-05:00",open:2186.85,high:2189.89,low:2180.38,close:2181.9,adj_close:2181.9},
        {ending:"2016-11-21T16:00:00-05:00",open:2186.43,high:2198.7,low:2186.43,close:2198.18,adj_close:2198.18},
        {ending:"2016-11-22T16:00:00-05:00",open:2201.56,high:2204.8,low:2194.51,close:2202.94,adj_close:2202.94},
        {ending:"2016-11-23T16:00:00-05:00",open:2198.55,high:2204.72,low:2194.51,close:2204.72,adj_close:2204.72},
        {ending:"2016-11-25T16:00:00-05:00",open:2206.27,high:2213.35,low:2206.27,close:2213.35,adj_close:2213.35},
        {ending:"2016-11-28T16:00:00-05:00",open:2210.21,high:2211.14,low:2200.36,close:2201.72,adj_close:2201.72},
        {ending:"2016-11-29T16:00:00-05:00",open:2200.76,high:2210.46,low:2198.15,close:2204.66,adj_close:2204.66},
        {ending:"2016-11-30T16:00:00-05:00",open:2204.97,high:2214.1,low:2198.81,close:2198.81,adj_close:2198.81}
            ]);
        });
    });
    describe("intraday", function() {
        it("should adjust splits and dividends on intraday", function() {
            return client({
                interval: 'm30',
                symbol: 'AAPL',
                market: 'NASDAQ',
                begin: '2014-06-06T09:30:00-04:00',
                end: '2014-06-09T16:00:00-04:00',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: "16:00:00", tz: tz
            }).then(data => {
                var scale = _.last(data).close / _.last(data).adj_close;
                return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
            }).should.eventually.be.like([
                { ending: '2014-06-06T09:30:00-04:00', close: 650.2, adj_close: 92.89 },
                { ending: '2014-06-06T10:00:00-04:00', close: 647.8, adj_close: 92.55 },
                { ending: '2014-06-06T10:30:00-04:00', close: 647.9, adj_close: 92.56 },
                { ending: '2014-06-06T11:00:00-04:00', close: 647.4, adj_close: 92.49 },
                { ending: '2014-06-06T11:30:00-04:00', close: 648.1, adj_close: 92.59 },
                { ending: '2014-06-06T12:00:00-04:00', close: 649.6, adj_close: 92.81 },
                { ending: '2014-06-06T12:30:00-04:00', close: 650.5, adj_close: 92.93 },
                { ending: '2014-06-06T13:00:00-04:00', close: 649.7, adj_close: 92.82 },
                { ending: '2014-06-06T13:30:00-04:00', close: 646.46, adj_close: 92.35 },
                { ending: '2014-06-06T14:00:00-04:00', close: 645.7, adj_close: 92.24 },
                { ending: '2014-06-06T14:30:00-04:00', close: 647.98, adj_close: 92.57 },
                { ending: '2014-06-06T15:00:00-04:00', close: 648.41, adj_close: 92.63 },
                { ending: '2014-06-06T15:30:00-04:00', close: 647.8, adj_close: 92.54 },
                { ending: '2014-06-06T16:00:00-04:00', close: 645.5, adj_close: 92.22 },
                { ending: '2014-06-06T16:30:00-04:00', close: 645.3, adj_close: 92.2 },
                { ending: '2014-06-06T17:00:00-04:00', close: 645.8, adj_close: 92.26 },
                { ending: '2014-06-06T17:30:00-04:00', close: 645.8, adj_close: 92.26 },
                { ending: '2014-06-06T18:00:00-04:00', close: 645.8, adj_close: 92.27 },
                { ending: '2014-06-06T18:30:00-04:00', close: 646, adj_close: 92.29 },
                { ending: '2014-06-06T19:00:00-04:00', close: 645.8, adj_close: 92.26 },
                { ending: '2014-06-06T19:30:00-04:00', close: 645.7, adj_close: 92.24 },
                { ending: '2014-06-06T20:00:00-04:00', close: 645.7, adj_close: 92.24 },
                { ending: '2014-06-09T04:30:00-04:00', close: 92.4, adj_close: 92.40 },
                { ending: '2014-06-09T05:00:00-04:00', close: 92.64, adj_close: 92.64 },
                { ending: '2014-06-09T05:30:00-04:00', close: 92.56, adj_close: 92.56 },
                { ending: '2014-06-09T06:00:00-04:00', close: 92.4, adj_close: 92.4 },
                { ending: '2014-06-09T06:30:00-04:00', close: 92.4, adj_close: 92.4 },
                { ending: '2014-06-09T07:00:00-04:00', close: 92.2, adj_close: 92.2 },
                { ending: '2014-06-09T07:30:00-04:00', close: 92.08, adj_close: 92.08 },
                { ending: '2014-06-09T08:00:00-04:00', close: 92.05, adj_close: 92.05 },
                { ending: '2014-06-09T08:30:00-04:00', close: 92.1, adj_close: 92.1 },
                { ending: '2014-06-09T09:00:00-04:00', close: 92.05, adj_close: 92.05 },
                { ending: '2014-06-09T09:30:00-04:00', close: 92.66, adj_close: 92.66 },
                { ending: '2014-06-09T10:00:00-04:00', close: 92.31, adj_close: 92.31 },
                { ending: '2014-06-09T10:30:00-04:00', close: 92.34, adj_close: 92.34 },
                { ending: '2014-06-09T11:00:00-04:00', close: 92.62, adj_close: 92.62 },
                { ending: '2014-06-09T11:30:00-04:00', close: 92.85, adj_close: 92.85 },
                { ending: '2014-06-09T12:00:00-04:00', close: 93.01, adj_close: 93.01 },
                { ending: '2014-06-09T12:30:00-04:00', close: 93.32, adj_close: 93.32 },
                { ending: '2014-06-09T13:00:00-04:00', close: 93.70, adj_close: 93.70 },
                { ending: '2014-06-09T13:30:00-04:00', close: 93.45, adj_close: 93.45 },
                { ending: '2014-06-09T14:00:00-04:00', close: 93.76, adj_close: 93.76 },
                { ending: '2014-06-09T14:30:00-04:00', close: 93.35, adj_close: 93.35 },
                { ending: '2014-06-09T15:00:00-04:00', close: 93.69, adj_close: 93.69 },
                { ending: '2014-06-09T15:30:00-04:00', close: 93.84, adj_close: 93.84 },
                { ending: '2014-06-09T16:00:00-04:00', close: 93.7, adj_close: 93.7 }
            ]);
        });
        it("should adjust splits and dividends on m60", function() {
            return client({
                interval: 'm60',
                symbol: 'SPX',
                market: 'CBOE',
                begin: '2014-06-06T09:30:00-04:00',
                end: '2014-06-09T16:00:00-04:00',
                premarketOpensAt: '09:30:00', marketOpensAt: '09:30:00',
                afterHoursClosesAt: '16:00:00', marketClosesAt: '16:00:00', tz: tz
            }).then(data => {
                var scale = _.last(data).close / _.last(data).adj_close;
                return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
            }).should.eventually.be.like([
                { ending: '2014-06-06T10:00:00-04:00', close: 1946.91, adj_close: 1946.91 },
                { ending: '2014-06-06T11:00:00-04:00', close: 1947.94, adj_close: 1947.94 },
                { ending: '2014-06-06T12:00:00-04:00', close: 1947.78, adj_close: 1947.78 },
                { ending: '2014-06-06T13:00:00-04:00', close: 1948.66, adj_close: 1948.66 },
                { ending: '2014-06-06T14:00:00-04:00', close: 1948.54, adj_close: 1948.54 },
                { ending: '2014-06-06T15:00:00-04:00', close: 1947.78, adj_close: 1947.78 },
                { ending: '2014-06-06T16:00:00-04:00', close: 1949.05, adj_close: 1949.05 },
                { ending: '2014-06-09T10:00:00-04:00', close: 1951.13, adj_close: 1951.13 },
                { ending: '2014-06-09T11:00:00-04:00', close: 1952.31, adj_close: 1952.31 },
                { ending: '2014-06-09T12:00:00-04:00', close: 1954.73, adj_close: 1954.73 },
                { ending: '2014-06-09T13:00:00-04:00', close: 1952.74, adj_close: 1952.74 },
                { ending: '2014-06-09T14:00:00-04:00', close: 1951.28, adj_close: 1951.28 },
                { ending: '2014-06-09T15:00:00-04:00', close: 1949.74, adj_close: 1949.74 },
                { ending: '2014-06-09T16:00:00-04:00', close: 1951.07, adj_close: 1951.07 }
            ]);
        });
        it("should return minutes", function() {
            return client({
                interval: 'm1',
                symbol: 'USD', market: 'CAD',
                begin: '2014-03-03T10:01:00-0500',
                end: '2014-03-03T10:30:00-0500',
                premarketOpensAt: '17:00:00', marketOpensAt: '17:00:00',
                afterHoursClosesAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
            }).should.eventually.be.like([
                {ending:"2014-03-03T10:01:00-05:00",high:1.1099,low:1.1094,open:1.1094,close:1.1099},
                {ending:"2014-03-03T10:02:00-05:00",high:1.1100,low:1.1095,open:1.1099,close:1.1096},
                {ending:"2014-03-03T10:03:00-05:00",high:1.1097,low:1.1096,open:1.1096,close:1.1096},
                {ending:"2014-03-03T10:04:00-05:00",high:1.1096,low:1.1095,open:1.1096,close:1.1096},
                {ending:"2014-03-03T10:05:00-05:00",high:1.1096,low:1.1095,open:1.1096,close:1.1096},
                {ending:"2014-03-03T10:06:00-05:00",high:1.1096,low:1.1095,open:1.1096,close:1.1096},
                {ending:"2014-03-03T10:07:00-05:00",high:1.1096,low:1.1095,open:1.1096,close:1.1095},
                {ending:"2014-03-03T10:08:00-05:00",high:1.1095,low:1.1094,open:1.1095,close:1.1094},
                {ending:"2014-03-03T10:09:00-05:00",high:1.1094,low:1.1088,open:1.1094,close:1.1088},
                {ending:"2014-03-03T10:10:00-05:00",high:1.1091,low:1.1088,open:1.1088,close:1.1091},
                {ending:"2014-03-03T10:11:00-05:00",high:1.1091,low:1.1089,open:1.1091,close:1.1089},
                {ending:"2014-03-03T10:12:00-05:00",high:1.1091,low:1.1089,open:1.1089,close:1.1091},
                {ending:"2014-03-03T10:13:00-05:00",high:1.1093,low:1.1090,open:1.1091,close:1.1090},
                {ending:"2014-03-03T10:14:00-05:00",high:1.1091,low:1.1088,open:1.1090,close:1.1088},
                {ending:"2014-03-03T10:15:00-05:00",high:1.1091,low:1.1088,open:1.1088,close:1.1090},
                {ending:"2014-03-03T10:16:00-05:00",high:1.1091,low:1.1090,open:1.1090,close:1.1091},
                {ending:"2014-03-03T10:17:00-05:00",high:1.1092,low:1.1090,open:1.1091,close:1.1091},
                {ending:"2014-03-03T10:18:00-05:00",high:1.1095,low:1.1091,open:1.1091,close:1.1095},
                {ending:"2014-03-03T10:19:00-05:00",high:1.1095,low:1.1091,open:1.1095,close:1.1091},
                {ending:"2014-03-03T10:20:00-05:00",high:1.1091,low:1.1088,open:1.1091,close:1.1089},
                {ending:"2014-03-03T10:21:00-05:00",high:1.1089,low:1.1088,open:1.1089,close:1.1089},
                {ending:"2014-03-03T10:22:00-05:00",high:1.1091,low:1.1089,open:1.1089,close:1.1091},
                {ending:"2014-03-03T10:23:00-05:00",high:1.1091,low:1.1085,open:1.1091,close:1.1085},
                {ending:"2014-03-03T10:24:00-05:00",high:1.1087,low:1.1084,open:1.1085,close:1.1085},
                {ending:"2014-03-03T10:25:00-05:00",high:1.1086,low:1.1080,open:1.1085,close:1.1083},
                {ending:"2014-03-03T10:26:00-05:00",high:1.1085,low:1.1081,open:1.1083,close:1.1081},
                {ending:"2014-03-03T10:27:00-05:00",high:1.1085,low:1.1081,open:1.1081,close:1.1085},
                {ending:"2014-03-03T10:28:00-05:00",high:1.1087,low:1.1085,open:1.1085,close:1.1086},
                {ending:"2014-03-03T10:29:00-05:00",high:1.1087,low:1.1082,open:1.1086,close:1.1082},
                {ending:"2014-03-03T10:30:00-05:00",high:1.1083,low:1.1081,open:1.1082,close:1.1082}
            ]);
        });
        it("should return 10 minute intervals", function() {
            return client({
                interval: 'm10',
                symbol: 'USD', market: 'CAD',
                begin: '2014-03-03T10:10:00-0500',
                end: '2014-03-03T11:00:00-0500',
                premarketOpensAt: '17:00:00', marketOpensAt: '17:00:00',
                afterHoursClosesAt: '17:00:00', marketClosesAt: '17:00:00', tz: tz
            }).should.eventually.be.like([
                {ending:"2014-03-03T10:10:00-05:00",high:1.1100,low:1.1088,open:1.1094,close:1.1091},
                {ending:"2014-03-03T10:20:00-05:00",high:1.1095,low:1.1088,open:1.1091,close:1.1089},
                {ending:"2014-03-03T10:30:00-05:00",high:1.1091,low:1.1080,open:1.1089,close:1.1082},
                {ending:"2014-03-03T10:40:00-05:00",high:1.1083,low:1.1072,open:1.1082,close:1.1076},
                {ending:"2014-03-03T10:50:00-05:00",high:1.1082,low:1.1076,open:1.1076,close:1.1080},
                {ending:"2014-03-03T11:00:00-05:00",high:1.1081,low:1.1070,open:1.1080,close:1.1080}
            ]);
        });
    });
    it.skip("should use summary info for OPRA intraday", function() {
        return client({
            conId: 347347237,
            interval: 'm60',
            symbol: 'SPX   190418C02900000',
            market: 'OPRA',
            begin: '2019-03-22T09:30:00-04:00',
            marketOpensAt: '02:00:00', marketClosesAt: '16:15:00', tz: tz
        }).then(d=>d.forEach(d=>console.log(JSON.stringify(d).replace(/"(\w+)":/g,'$1:')))||d);
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
