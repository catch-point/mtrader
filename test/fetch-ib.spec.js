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
const d3 = require('d3-format');
const config = require('../src/config.js');
const like = require('./should-be-like.js');
const IB = require('../src/fetch-ib.js');
const version = require('../src/version.js').toString();

describe("fetch-ib", function() {
    this.timeout(100000);
    var tz = 'America/New_York';
    var client;
    before(async function() {
        client = await IB({port: 7496, silence: true, ...config('fetch.ib')}).catch(err => {
            this.skip();
            return null;
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
                "name": "contract",
                "options": {
                  "interval": {
                    "values": [
                      "contract"
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
                "name": "adjustments",
                "options": {
                  "interval": {
                    "values": [
                      "adjustments"
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
        it("pending", function() {
            return client({info:'pending'}).then(array => array.should.be.like([]));
        });
    });
    describe("lookup stocks", function() {
        it("should find IBM", function() {
            return client({interval:'lookup',symbol:'IBM', market:"NYSE"})
              .should.eventually.be.like([{
                symbol: 'IBM',
                name: "INTL BUSINESS MACHINES CORP"
            }]);
        });
        it("should find ITA", function() {
            return client({interval:'lookup',symbol:'ITA', market:"NYSE"})
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
        it.skip("should find GLOW", function() {
            return client({interval:'lookup',symbol:'OBLG', market:"NYSE"})
              .should.eventually.be.like([{
                symbol: 'OBLG',
                name: /Oblong/i
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
                "CGL.C", "BBD.B",
                "CCL.B", "GIB.A", "CTC.A",
                "RCI.B", "SJR.B", "TECK.B"
            ].forEach(symbol => {
                it(symbol, function() {
                    return client({interval:'lookup', symbol, market:"TSE"})
                      .should.eventually.be.like([{symbol, currency: 'CAD'}]);
                });
            });
        });
        it.skip("should find N symbol", function() {
            return client({interval:'lookup', symbol:'N', market:"VENTURE"})
              .should.eventually.be.like([
                {symbol: 'N', name: 'NAMASTE TECHNOLOGIES INC'}
            ]);
        });
    });
    describe("lookup currencies", function() {
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
    });
    describe("lookup futures", function() {
        describe.skip("should lookup CME futures symbols", function() {
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
        describe("should lookup COMEX futures symbols", function() {
            _.range((moment().year()-1)%100,(moment().year()+5)%100).map(year => ['M','Z'].map(mo => {
                it(`GC${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `GC${mo}${year}`,
                        market: "COMEX"
                    }).should.eventually.be.like([{symbol: `GC${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup CBOT quarterly futures symbols", function() {
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = moment().subtract(1,'months').year();
            _.range(year%100,(year+1)%100).map(year => ['H','M','U','Z'].map(mo => {
                if (month_code.indexOf(mo) > moment().month() && month_code.indexOf(mo) < moment().month()+9)
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
                    }).should.eventually.be.like([{symbol: `VX${mo}${year}`}]);
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
    });
    describe("lookup future options", function() {
        describe("should lookup Jan CME future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['F', 'J', 'M', 'V'].find(mo => month_code.indexOf(mo) > moment().month()) || 'V';
            [
                {underlying: 'GF', tradingClass:'GF', strike: 163, ib_scale:10, iq_scale:1000}
            ].forEach(c => {
                const k = d4(c.strike*10).substring(0,4);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CME"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup Jan CBOT future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['H', 'K', 'N', 'U'].find(mo => month_code.indexOf(mo) > moment().month()) || 'V';
            [
                {underlying: 'ZS', tradingClass:'OZS', strike:1400,ib_scale:10,iq_scale:10,iq_root:'@S'}
            ].forEach(c => {
                const k = d4(c.strike*c.ib_scale);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CBOT"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup Feb CME future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['G', 'K', 'Q', 'X'].find(mo => month_code.indexOf(mo) > moment().month()) || 'X';
            [
                {underlying:'LE',tradingClass:'LE', strike: 142,ib_scale:10,iq_scale:1000},
                {underlying:'HE',tradingClass:'HE', strike: 95,ib_scale:10,iq_scale:1000}
            ].forEach(c => {
                const k = d4(c.strike*10).substring(0,4);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CME"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe.skip("should lookup Feb NYME future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['G', 'K', 'Q', 'X'].find(mo => month_code.indexOf(mo) > moment().month()) || 'X';
            [
                {underlying:'GC',tradingClass:'OG', strike: 1800,ib_scale:1,iq_scale:1,iq_root:'QGC'}
            ].forEach(c => {
                const k = d4(c.strike*c.ib_scale).substring(0,4);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "COMEX"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup Mar CME future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['H', 'M', 'U', 'Z'].find(mo => month_code.indexOf(mo) > moment().month()) || 'Z';
            [
                {underlying:'NQ',tradingClass:'NQ', strike: 14000,ib_scale:0.1,iq_scale:100},
                {underlying:'ES',tradingClass:'ES', strike: 4000,ib_scale:1,iq_scale:100},
                {underlying:'EUR',tradingClass:'EUU',strike: 1, ib_scale:1000,iq_scale:10000,iq_root:'@EUU'},
                {underlying:'AUD',tradingClass:'ADU',strike: 0.7, ib_scale:1000,iq_scale:10000,iq_root:'@ADU'},
                {underlying:'GBP',tradingClass:'GBU',strike: 1.3, ib_scale:10000,iq_scale:10000,iq_root:'@GBU'},
                {underlying:'CHF',tradingClass:'CHU',strike: 1, ib_scale:1000,iq_scale:1000,iq_root:'@CHU'},
                {underlying:'MXP',tradingClass:'6M', strike: 0.048, ib_scale:10000,iq_scale:1000000,iq_root:'@PX'},
                {underlying:'CAD',tradingClass:'CAU', strike: 0.79, ib_scale:1000,iq_scale:10000,iq_root:'@CAU'},
                {underlying:'NZD',tradingClass:'6N', strike: 0.7, ib_scale:1000,iq_scale:1000,iq_root:'@NE'},
                {underlying:'JPY',tradingClass:'JPU', strike: 0.0088, ib_scale:100000,iq_scale:1000000,iq_root:'@JPU'},
                {underlying:'GE',tradingClass:'GE', strike: 98, ib_scale:100,iq_scale:10000,iq_root:'@ED'}
            ].forEach(c => {
                const k = d4(c.strike*c.ib_scale);
                it(`${c.tradingClass}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.tradingClass}${mo}${year} P${k}`,
                        market: "CME"
                    }).should.eventually.be.like([{symbol: `${c.tradingClass}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup Mar COMEX future options symbols", function() {
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['H', 'M', 'U', 'Z'].find(mo => month_code.indexOf(mo) > moment().month()) || 'Z';
            [
                {underlying:'HG', tradingClass:'HXE', strike:4.5,ib_scale:100,iq_scale:100,iq_root:'QHG'}
            ].forEach(c => {
                const k = c.strike*c.ib_scale;
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "COMEX"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup monthly CME future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = month_code.find(mo => month_code.indexOf(mo) > moment().month()) || 'Z';
            [
                {underlying:'CB',tradingClass:'CB', strike:260,f:10,ib_scale:10,iq_scale:1000,iq_root:'@CB'},
                {underlying:'GDK',tradingClass:'GDK',strike:24,f:100,ib_scale:100,iq_scale:100,iq_root:'@DK'},
                {underlying:'DY',tradingClass:'DY', strike:75,f:10,ib_scale:10,iq_scale:10000,iq_root:'@DY'}
            ].forEach(c => {
                const k = d4(c.strike*c.f);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CME"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup monthly NYMEX future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const date = moment().startOf('month').add(2,'months');
            const year = (date.year())%100;
            const mo = month_code.find(mo => month_code.indexOf(mo) > date.month()) || 'Z';
            [
                {underlying:'BZ',tradingClass:'BE', strike: 80,ib_scale:100,iq_scale:100,iq_root:'QBE'},
                {underlying:'NG',tradingClass:'ON', strike: 4,ib_scale:1000,iq_scale:1000,iq_root:'QNG'},
                {underlying:'RB',tradingClass:'OB', strike: 2.4,ib_scale:10000,iq_scale:10000,iq_root:'QRB'}
            ].forEach(c => {
                const k = d4(c.strike*c.ib_scale);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "NYMEX"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup alternate month CBOT future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['F', 'H', 'K', 'N', 'U', 'X'].find(mo => month_code.indexOf(mo) > moment().month()) || 'X';
            [
                {underlying:'ZR',tradingClass:'OZR', strike:1400,ib_scale:10,iq_scale:10,iq_root:'@RR'}
            ].forEach(c => {
                const k = d4(c.strike*c.ib_scale);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CBOT"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup Mar CBOT future options symbols", function() {
            const d4 = d3.format('04');
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            const mo = ['H', 'M', 'U', 'Z'].find(mo => month_code.indexOf(mo) > moment().month()) || 'Z';
            [
                {underlying:'ZW',tradingClass:'OZW',strike:770,ib_scale:10,iq_scale:10,iq_root:'@W'},
                {underlying:'KE',tradingClass:'OKE', strike:750,ib_scale:10,iq_scale:10,iq_root:'@KW'},
                {underlying:'ZO',tradingClass:'OZO', strike: 600,ib_scale:10,iq_scale:10,iq_root:'@O'},
                {underlying:'ZT',tradingClass:'OZT',strike:108,ib_scale:100,iq_scale:100,iq_root:'@TU'},
                {underlying:'ZN',tradingClass:'OZN', strike:128,ib_scale:100,iq_scale:100,iq_root:'@TY'},
                {underlying:'ZB',tradingClass:'OZB', strike:155,ib_scale:100,iq_scale:100,iq_root:'@US'},
                {underlying:'UB',tradingClass:'OUB', strike:190,ib_scale:100,iq_scale:100,iq_root:'@UB'}
            ].forEach(c => {
                const k = d4(c.strike*c.ib_scale);
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CBOT"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
    });
    describe("lookup indexes", function() {
        it("should find SPX symbol", function() {
            return client({interval:'contract', symbol:'SPX', market:"CBOE"})
              .should.eventually.be.like([{
                symbol: 'SPX',
                name: 'S&P 500 Stock Index',
                market: 'CBOE',
                security_type: 'IND',
                currency: 'USD',
                trading_hours: '08:30:00 - 15:00:00',
                liquid_hours: '08:30:00 - 15:00:00'
            }]);
        });
        it("should find VIX symbol", function() {
            return client({interval:'contract', symbol:'VIX', market:"CBOE"})
              .should.eventually.be.like([{
                symbol: 'VIX',
                name: 'CBOE Volatility Index',
                market: 'CBOE',
                security_type: 'IND',
                currency: 'USD',
                trading_hours: '02:15:00 - 16:00:00',
                liquid_hours: '02:15:00 - 16:00:00'
            }]);
        });
        it("should find SPY symbol", function() {
            return client({interval:'contract', symbol:'SPY', market:"NYSE"})
              .should.eventually.be.like([{
                symbol: 'SPY',
                name: 'SPDR S&P 500 ETF TRUST',
                market: 'NYSE',
                security_type: 'STK',
                currency: 'USD',
                trading_hours: '04:00:00 - 20:00:00',
                liquid_hours: '09:30:00 - 16:00:00'
            }]);
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
            return client({interval:'fundamental',symbol:'ITA', market:"NYSE"})
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
                market: 'NYSE',
                begin: '2017-03-15',
                end: '2017-03-22',
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
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
                market: 'NYSE',
                begin: '2016-12-01',
                end: '2016-12-31',
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
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
                market: 'NYSE',
                begin: '2016-09-14',
                end: '2016-09-22',
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
            }).then(data => {
                var scale = _.last(data).close / _.last(data).adj_close;
                return data.map(datum => _.extend({}, datum, {adj_close: datum.adj_close * scale}));
            }).should.eventually.be.like([
                {ending:'2016-09-14T16:00:00-04:00',open:23.9,close:23.8,adj_close:19.2},
                {ending:'2016-09-15T16:00:00-04:00',open:23.76,close:23.96,adj_close:19.3},
                {ending:'2016-09-16T16:00:00-04:00',open:23.75,close:23.6,adj_close:19.18},
                {ending:'2016-09-19T16:00:00-04:00',close:19.31,adj_close:19.31},
                {ending:'2016-09-20T16:00:00-04:00',open:19.45,close:19.32,adj_close:19.32},
                {ending:'2016-09-21T16:00:00-04:00',open:19.41,close:19.44,adj_close:19.44}
            ]);
        });
        it("should adjust for REM splits", function() {
            return client({
                interval: 'day',
                symbol: 'REM',
                market: 'NYSE',
                begin: '2016-11-01',
                end: '2016-12-01',
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
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
                begin: '2014-01-01', end: '2014-01-31',
                trading_hours: "00:00:00 - 24:00:00",
                liquid_hours: "17:00:00 - 17:00:00",
                open_time: "17:00:00",
                security_tz: "America/New_York", tz: tz
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
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
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
        it.skip("should adjust splits and dividends on intraday", function() {
            return client({
                interval: 'm30',
                symbol: 'AAPL',
                market: 'NASDAQ',
                begin: '2014-06-06T09:30:00-04:00',
                end: '2014-06-09T16:00:00-04:00',
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
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
                trading_hours: "04:00:00 - 20:00:00",
                liquid_hours: "09:30:00 - 16:00:00",
                open_time: "09:30:00",
                security_tz: "America/New_York", tz: tz
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
                trading_hours: "00:00:00 - 24:00:00",
                liquid_hours: "17:00:00 - 17:00:00",
                open_time: "17:00:00",
                security_tz: "America/New_York", tz: tz
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
                trading_hours: "00:00:00 - 24:00:00",
                liquid_hours: "17:00:00 - 17:00:00",
                open_time: "17:00:00",
                security_tz: "America/New_York", tz: tz
            }).should.eventually.be.like([
                {ending:"2014-03-03T10:10:00-05:00",high:1.1100,low:1.1088,open:1.1094,close:1.1091},
                {ending:"2014-03-03T10:20:00-05:00",high:1.1095,low:1.1088,open:1.1091,close:1.1089},
                {ending:"2014-03-03T10:30:00-05:00",high:1.1091,low:1.1080,open:1.1089,close:1.1082},
                {ending:"2014-03-03T10:40:00-05:00",high:1.1083,low:1.1072,open:1.1082,close:1.1076},
                {ending:"2014-03-03T10:50:00-05:00",high:1.1082,low:1.1076,open:1.1076,close:1.1080},
                {ending:"2014-03-03T11:00:00-05:00",high:1.1081,low:1.1070,open:1.1080,close:1.1080}
            ]);
        });
        it("should return 15 minute intervals", function() {
            return client({
                interval: 'm15',
                symbol: 'VIX', market: 'CBOE',
                begin: '2020-01-22T00:00:00-0500',
                end: '2020-01-23T00:00:00-0500',
                trading_hours: "02:00:00 - 15:15:00",
                liquid_hours: "08:30:00 - 15:15:00",
                open_time: "08:30:00",
                security_tz: "America/Chicago", tz: tz
            }).should.eventually.be.like([
                { ending: '2020-01-22T03:30:00-05:00', open: 12.45, high: 12.46, low: 12.38, close: 12.4 } ,
                { ending: '2020-01-22T03:45:00-05:00', open: 12.41, high: 12.47, low: 12.41, close: 12.44 } ,
                { ending: '2020-01-22T04:00:00-05:00', open: 12.45, high: 12.5, low: 12.45, close: 12.49 } ,
                { ending: '2020-01-22T04:15:00-05:00', open: 12.51, high: 12.53, low: 12.42, close: 12.47 } ,
                { ending: '2020-01-22T04:30:00-05:00', open: 12.51, high: 12.54, low: 12.45, close: 12.52 } ,
                { ending: '2020-01-22T04:45:00-05:00', open: 12.51, high: 12.52, low: 12.48, close: 12.5 } ,
                { ending: '2020-01-22T05:00:00-05:00', open: 12.52, high: 12.52, low: 12.43, close: 12.47 } ,
                { ending: '2020-01-22T05:15:00-05:00', open: 12.46, high: 12.48, low: 12.45, close: 12.47 } ,
                { ending: '2020-01-22T05:30:00-05:00', open: 12.48, high: 12.48, low: 12.44, close: 12.44 } ,
                { ending: '2020-01-22T05:45:00-05:00', open: 12.45, high: 12.46, low: 12.41, close: 12.46 } ,
                { ending: '2020-01-22T06:00:00-05:00', open: 12.45, high: 12.47, low: 12.44, close: 12.45 } ,
                { ending: '2020-01-22T06:15:00-05:00', open: 12.46, high: 12.51, low: 12.46, close: 12.47 } ,
                { ending: '2020-01-22T06:30:00-05:00', open: 12.46, high: 12.5, low: 12.46, close: 12.5 } ,
                { ending: '2020-01-22T06:45:00-05:00', open: 12.51, high: 12.51, low: 12.43, close: 12.45 } ,
                { ending: '2020-01-22T07:00:00-05:00', open: 12.44, high: 12.44, low: 12.4, close: 12.4 } ,
                { ending: '2020-01-22T07:15:00-05:00', open: 12.42, high: 12.42, low: 12.36, close: 12.37 } ,
                { ending: '2020-01-22T07:30:00-05:00', open: 12.36, high: 12.41, low: 12.36, close: 12.38 } ,
                { ending: '2020-01-22T07:45:00-05:00', open: 12.39, high: 12.39, low: 12.35, close: 12.39 } ,
                { ending: '2020-01-22T08:00:00-05:00', open: 12.38, high: 12.43, low: 12.33, close: 12.43 } ,
                { ending: '2020-01-22T08:15:00-05:00', open: 12.44, high: 12.44, low: 12.39, close: 12.44 } ,
                { ending: '2020-01-22T08:30:00-05:00', open: 12.43, high: 12.48, low: 12.42, close: 12.45 } ,
                { ending: '2020-01-22T08:45:00-05:00', open: 12.49, high: 12.51, low: 12.47, close: 12.49 } ,
                { ending: '2020-01-22T09:00:00-05:00', open: 12.48, high: 12.48, low: 12.4, close: 12.46 } ,
                { ending: '2020-01-22T09:15:00-05:00', open: 12.47, high: 12.5, low: 12.44, close: 12.45 } ,
                { ending: '2020-01-22T09:45:00-05:00', open: 12.58, high: 12.58, low: 12.4, close: 12.44 } ,
                { ending: '2020-01-22T10:00:00-05:00', open: 12.42, high: 12.53, low: 12.41, close: 12.44 } ,
                { ending: '2020-01-22T10:15:00-05:00', open: 12.37, high: 12.54, low: 12.37, close: 12.49 } ,
                { ending: '2020-01-22T10:30:00-05:00', open: 12.53, high: 12.53, low: 12.37, close: 12.39 } ,
                { ending: '2020-01-22T10:45:00-05:00', open: 12.38, high: 12.41, low: 12.31, close: 12.36 } ,
                { ending: '2020-01-22T11:00:00-05:00', open: 12.35, high: 12.53, low: 12.34, close: 12.53 } ,
                { ending: '2020-01-22T11:15:00-05:00', open: 12.59, high: 12.79, low: 12.57, close: 12.79 } ,
                { ending: '2020-01-22T11:30:00-05:00', open: 12.78, high: 12.81, low: 12.69, close: 12.72 } ,
                { ending: '2020-01-22T11:45:00-05:00', open: 12.7, high: 12.7, low: 12.58, close: 12.65 } ,
                { ending: '2020-01-22T12:00:00-05:00', open: 12.64, high: 12.72, low: 12.6, close: 12.7 } ,
                { ending: '2020-01-22T12:15:00-05:00', open: 12.69, high: 12.75, low: 12.66, close: 12.72 } ,
                { ending: '2020-01-22T12:30:00-05:00', open: 12.75, high: 12.89, low: 12.7, close: 12.83 } ,
                { ending: '2020-01-22T12:45:00-05:00', open: 12.84, high: 12.84, low: 12.72, close: 12.76 } ,
                { ending: '2020-01-22T13:00:00-05:00', open: 12.75, high: 12.75, low: 12.64, close: 12.65 } ,
                { ending: '2020-01-22T13:15:00-05:00', open: 12.61, high: 12.67, low: 12.59, close: 12.59 } ,
                { ending: '2020-01-22T13:30:00-05:00', open: 12.58, high: 12.59, low: 12.5, close: 12.51 } ,
                { ending: '2020-01-22T13:45:00-05:00', open: 12.52, high: 12.53, low: 12.47, close: 12.5 } ,
                { ending: '2020-01-22T14:00:00-05:00', open: 12.51, high: 12.63, low: 12.5, close: 12.63 } ,
                { ending: '2020-01-22T14:15:00-05:00', open: 12.64, high: 12.64, low: 12.56, close: 12.57 } ,
                { ending: '2020-01-22T14:30:00-05:00', open: 12.6, high: 12.63, low: 12.58, close: 12.59 } ,
                { ending: '2020-01-22T14:45:00-05:00', open: 12.6, high: 12.63, low: 12.56, close: 12.6 } ,
                { ending: '2020-01-22T15:00:00-05:00', open: 12.61, high: 12.61, low: 12.55, close: 12.57 } ,
                { ending: '2020-01-22T15:15:00-05:00', open: 12.58, high: 12.78, low: 12.58, close: 12.78 } ,
                { ending: '2020-01-22T15:30:00-05:00', open: 12.8, high: 13.01, low: 12.78, close: 12.9 } ,
                { ending: '2020-01-22T15:45:00-05:00', open: 12.91, high: 12.91, low: 12.71, close: 12.85 } ,
                { ending: '2020-01-22T16:00:00-05:00', open: 12.86, high: 12.86, low: 12.68, close: 12.75 } ,
                { ending: '2020-01-22T16:15:00-05:00', open: 12.88, high: 12.91, low: 12.82, close: 12.91 }
            ]);
        });
        it("should return 1 minute intervals", function() {
            return client({
                interval: 'm1',
                symbol: 'VIX', market: 'CBOE',
                begin: '2020-01-22T00:00:00-0500',
                end: '2020-01-22T04:00:00-0500',
                trading_hours: "02:00:00 - 15:15:00",
                liquid_hours: "08:30:00 - 15:15:00",
                open_time: "08:30:00",
                security_tz: "America/Chicago", tz: tz
            }).should.eventually.be.like([
                { ending: '2020-01-22T03:16:00-05:00', open: 12.45, high: 12.46, low: 12.45, close: 12.45 } ,
                { ending: '2020-01-22T03:17:00-05:00', open: 12.46, high: 12.46, low: 12.44, close: 12.44 } ,
                { ending: '2020-01-22T03:18:00-05:00', open: 12.44, high: 12.44, low: 12.44, close: 12.44 } ,
                { ending: '2020-01-22T03:19:00-05:00', open: 12.44, high: 12.44, low: 12.44, close: 12.44 } ,
                { ending: '2020-01-22T03:20:00-05:00', open: 12.43, high: 12.43, low: 12.42, close: 12.42 } ,
                { ending: '2020-01-22T03:21:00-05:00', open: 12.43, high: 12.44, low: 12.43, close: 12.44 } ,
                { ending: '2020-01-22T03:22:00-05:00', open: 12.43, high: 12.43, low: 12.4, close: 12.4 } ,
                { ending: '2020-01-22T03:23:00-05:00', open: 12.39, high: 12.39, low: 12.39, close: 12.39 } ,
                { ending: '2020-01-22T03:24:00-05:00', open: 12.39, high: 12.39, low: 12.39, close: 12.39 } ,
                { ending: '2020-01-22T03:25:00-05:00', open: 12.38, high: 12.39, low: 12.38, close: 12.38 } ,
                { ending: '2020-01-22T03:26:00-05:00', open: 12.4, high: 12.4, low: 12.39, close: 12.4 } ,
                { ending: '2020-01-22T03:27:00-05:00', open: 12.42, high: 12.42, low: 12.41, close: 12.41 } ,
                { ending: '2020-01-22T03:28:00-05:00', open: 12.4, high: 12.41, low: 12.4, close: 12.4 } ,
                { ending: '2020-01-22T03:29:00-05:00', open: 12.41, high: 12.41, low: 12.41, close: 12.41 } ,
                { ending: '2020-01-22T03:30:00-05:00', open: 12.4, high: 12.4, low: 12.4, close: 12.4 } ,
                { ending: '2020-01-22T03:31:00-05:00', open: 12.41, high: 12.42, low: 12.41, close: 12.42 } ,
                { ending: '2020-01-22T03:32:00-05:00', open: 12.41, high: 12.42, low: 12.41, close: 12.42 } ,
                { ending: '2020-01-22T03:33:00-05:00', open: 12.43, high: 12.44, low: 12.43, close: 12.44 } ,
                { ending: '2020-01-22T03:34:00-05:00', open: 12.43, high: 12.44, low: 12.43, close: 12.44 } ,
                { ending: '2020-01-22T03:35:00-05:00', open: 12.45, high: 12.45, low: 12.44, close: 12.45 } ,
                { ending: '2020-01-22T03:36:00-05:00', open: 12.45, high: 12.45, low: 12.45, close: 12.45 } ,
                { ending: '2020-01-22T03:37:00-05:00', open: 12.45, high: 12.45, low: 12.45, close: 12.45 } ,
                { ending: '2020-01-22T03:38:00-05:00', open: 12.44, high: 12.44, low: 12.43, close: 12.43 } ,
                { ending: '2020-01-22T03:39:00-05:00', open: 12.44, high: 12.44, low: 12.42, close: 12.43 } ,
                { ending: '2020-01-22T03:40:00-05:00', open: 12.42, high: 12.43, low: 12.42, close: 12.43 } ,
                { ending: '2020-01-22T03:41:00-05:00', open: 12.42, high: 12.43, low: 12.42, close: 12.43 } ,
                { ending: '2020-01-22T03:42:00-05:00', open: 12.42, high: 12.42, low: 12.42, close: 12.42 } ,
                { ending: '2020-01-22T03:43:00-05:00', open: 12.43, high: 12.44, low: 12.43, close: 12.44 } ,
                { ending: '2020-01-22T03:44:00-05:00', open: 12.46, high: 12.47, low: 12.46, close: 12.47 } ,
                { ending: '2020-01-22T03:45:00-05:00', open: 12.46, high: 12.46, low: 12.44, close: 12.44 } ,
                { ending: '2020-01-22T03:46:00-05:00', open: 12.44, high: 12.44, low: 12.44, close: 12.44 } ,
                { ending: '2020-01-22T03:47:00-05:00', open: 12.45, high: 12.46, low: 12.45, close: 12.46 } ,
                { ending: '2020-01-22T03:48:00-05:00', open: 12.48, high: 12.48, low: 12.48, close: 12.48 } ,
                { ending: '2020-01-22T03:49:00-05:00', open: 12.49, high: 12.49, low: 12.48, close: 12.48 } ,
                { ending: '2020-01-22T03:50:00-05:00', open: 12.47, high: 12.47, low: 12.47, close: 12.47 } ,
                { ending: '2020-01-22T03:51:00-05:00', open: 12.48, high: 12.49, low: 12.48, close: 12.49 } ,
                { ending: '2020-01-22T03:52:00-05:00', open: 12.5, high: 12.5, low: 12.49, close: 12.49 } ,
                { ending: '2020-01-22T03:53:00-05:00', open: 12.48, high: 12.49, low: 12.48, close: 12.49 } ,
                { ending: '2020-01-22T03:54:00-05:00', open: 12.48, high: 12.48, low: 12.47, close: 12.47 } ,
                { ending: '2020-01-22T03:55:00-05:00', open: 12.48, high: 12.49, low: 12.48, close: 12.49 } ,
                { ending: '2020-01-22T03:56:00-05:00', open: 12.48, high: 12.48, low: 12.47, close: 12.48 } ,
                { ending: '2020-01-22T03:57:00-05:00', open: 12.47, high: 12.48, low: 12.47, close: 12.48 } ,
                { ending: '2020-01-22T03:58:00-05:00', open: 12.48, high: 12.48, low: 12.48, close: 12.48 } ,
                { ending: '2020-01-22T03:59:00-05:00', open: 12.48, high: 12.48, low: 12.48, close: 12.48 } ,
                { ending: '2020-01-22T04:00:00-05:00', open: 12.49, high: 12.49, low: 12.49, close: 12.49 }
            ]);
        });
    });
    it.skip("should use summary info for OPRA intraday", function() {
        return client({
            conid: 347347237,
            interval: 'm60',
            symbol: 'SPX   190418C02900000',
            market: 'OPRA',
            begin: '2019-03-22T09:30:00-04:00',
            trading_hours: "02:00:00 - 15:15:00",
            liquid_hours: "08:30:00 - 15:15:00",
            open_time: "08:30:00",
            security_tz: "America/Chicago", tz: tz
        }).then(d=>d.forEach(d=>console.log(JSON.stringify(d).replace(/"(\w+)":/g,'$1:')))||d);
    });
    it.skip("should return daily CLX", function() {
        return client({
            interval: 'day',
            symbol: 'CLX', market: 'NYSE',
            begin: '2019-04-18', end: '2019-04-24',
            trading_hours: "04:00:00 - 20:00:00",
            liquid_hours: "09:30:00 - 16:00:00",
            open_time: "09:30:00",
            security_tz: "America/New_York", tz: tz
        })
         .then(d=>d.forEach(d=>console.log(require('util').inspect(_.pick(d,'ending','close','adj_close'),{breakLength:1000})))||d)
         .should.eventually.be.like([
            { ending: '2019-04-18T16:00:00-04:00', close: 153.48, adj_close: 152.53 },
            { ending: '2019-04-22T16:00:00-04:00', close: 154.51, adj_close: 153.55 },
            { ending: '2019-04-23T16:00:00-04:00', close: 153.7, adj_close: 153.7 }
        ]);
    });
});

function printEach(d) {
    d.forEach(d=>console.log(require('util').inspect(d,{breakLength:Infinity}),','));
    return d;
}
