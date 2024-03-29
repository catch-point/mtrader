// fetch-iqfeed.spec.js
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
const d3 = require('d3-format');
const config = require('../src/config.js');
const like = require('./should-be-like.js');
const iqfeed = require('../src/fetch-iqfeed.js');

describe("fetch-iqfeed", function() {
    this.timeout(30000);
    var tz = 'America/New_York';
    var client = iqfeed(config('fetch.iqfeed'));
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
    describe("lookup stocks", function() {
        it("should find IBM", function() {
            return client({interval:'lookup',symbol:'IBM', listed_market:"NYSE"})
              .should.eventually.be.like(results => _.some(results, like({
                symbol: 'IBM',
                name: "INTERNATIONAL BUSINESS MACHINE"
            })));
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
        it("should find BRK.A symbol", function() {
            return client({interval:'lookup', symbol:'BRK.A', listed_market:"NYSE"})
              .should.eventually.be.like(results => _.some(results, like(
                {symbol: /^BRK.A/, name: name => name.toLowerCase().indexOf("berkshire hathaway") === 0}
            )));
        });
        it("should find ITA", function() {
            return client({interval:'lookup',symbol:'ITA', market:"NYSE"})
              .should.eventually.be.like(results => _.some(results, like({
                symbol: 'ITA',
                name: /SHARES .* AEROSPACE & DEF/
            })));
        });
        it("should find NVDA", function() {
            return client({interval:'lookup',symbol:'NVDA', market:"NASDAQ"})
              .should.eventually.be.like(results => _.some(results, like({
                symbol: 'NVDA',
                name: /NVIDIA/
            })));
        });
        it.skip("should find GLOW", function() {
            return client({interval:'lookup',symbol:'OBLG', market:"AMEX"})
              .should.eventually.be.like([{
                symbol: 'OBLG',
                name: /Oblong/i
            }]);
        });
        it("should find 88E", function() {
            return client({interval:'lookup',symbol:'88E', market:"LSE"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([{
                symbol: '88E',
                name: /88 ENERGY/,
                currency: "GBP"
            }]);
        });
        it("should find BBD.B", function() {
            return client({interval:'lookup',symbol:'BBD.B', market:"TSE"})
              .then(array => array.filter(item => item.symbol == 'BBD.B'))
              .should.eventually.be.like([{
                symbol: 'BBD.B',
                name: /BOMBARDIER/,
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
              .then(array => array.slice(0,1))
              .should.eventually.be.like([
                {symbol: 'BF.B', name: /BROWN-FORMAN/}
            ]);
        });
        describe("should find TSE listing", function() {
            [
                "CGL.C", "BBD.B", "BAM.A",
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
        });
    });
    describe("lookup futures", function() {
        describe("should lookup CME futures symbols", function() {
            _.range((moment().year()+1)%100,(moment().year()+5)%100).map(year => ['H','M','U','Z'].map(mo => {
                it(`6E${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `6E${mo}${year}`,
                        market: "CME"
                    })
                      .then(array => array.filter(item => item.symbol == `6E${mo}${year}`))
                      .should.eventually.be.like([{symbol: `6E${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup COMEX futures symbols", function() {
            _.range((moment().year()+1)%100,(moment().year()+5)%100).map(year => ['M','Z'].map(mo => {
                it(`GC${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `GC${mo}${year}`,
                        market: "COMEX"
                    })
                      .then(array => array.filter(item => item.symbol == `GC${mo}${year}`))
                      .should.eventually.be.like([{symbol: `GC${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup NYMEX futures symbols", function() {
            _.range((moment().year()+1)%100,(moment().year()+5)%100).map(year => ['M','Z'].map(mo => {
                it(`QM${mo}${year}`, function() {
                    return client({
                        interval:'lookup',
                        symbol: `QM${mo}${year}`,
                        market: "NYMEX"
                    })
                      .then(array => array.filter(item => item.symbol == `QM${mo}${year}`))
                      .should.eventually.be.like([{symbol: `QM${mo}${year}`}]);
                });
            }));
        });
        describe("should lookup CBOT quarterly futures symbols", function() {
            _.range((moment().year()+1)%100,(moment().year()+1)%100).map(year => ['H','M','U','Z'].map(mo => {
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
        describe("should lookup CFE monthly futures symbols", function() {
            const month_code = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
            const year = (moment().year())%100;
            ['H', 'J', 'K', 'M', 'N'].filter(mo => month_code.indexOf(mo) > moment().month()).map(mo => {
                it(`VX${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
            const mo = ['F', 'J', 'M', 'V'].find(mo => month_code.indexOf(mo) > moment().month()) || 'V';
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CME"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
        describe("should lookup Feb NYME future options symbols", function() {
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.tradingClass}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
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
                it(`${c.underlying}${mo}${year}`, function() {
                    return client({
                        interval:'contract',
                        symbol: `${c.underlying}${mo}${year} P${k}`,
                        market: "CBOT"
                    }).should.eventually.be.like([{symbol: `${c.underlying}${mo}${year} P${k}`}]);
                });
            });
        });
    });
    describe("lookup indexes", function() {
        it("should find SPX symbol", function() {
            return client({interval:'lookup', symbol:'SPX', market:"CBOE"})
              .should.eventually.be.like([
                {symbol: 'SPX', name: /S&P 500/}
            ]);
        });
        it("should find RUT symbol", function() {
            return client({interval:'lookup', symbol:'RUT', market:"X"})
              .then(array => array.slice(0,1))
              .should.eventually.be.like([
                {symbol: 'RUT', name: /Russell 2000/i}
            ]);
        });
    });
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
            {ending:'2016-09-14T16:00:00-04:00',open:23.88,close:23.82,adj_close:19.2},
            {ending:'2016-09-15T16:00:00-04:00',open:23.77,close:23.96,adj_close:19.3},
            {ending:'2016-09-16T16:00:00-04:00',open:23.75,close:23.62,adj_close:19.18},
            {ending:'2016-09-19T16:00:00-04:00',open:19.35,close:19.31,adj_close:19.31},
            {ending:'2016-09-20T16:00:00-04:00',open:19.45,close:19.32,adj_close:19.32},
            {ending:'2016-09-21T16:00:00-04:00',open:19.41,close:19.44,adj_close:19.44}
        ]);
    });
    it("should adjust splits and dividends on intraday", function() {
        return client({
            interval: 'm30',
            minutes: 30,
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
            { ending: '2014-06-06T09:30:00-04:00', close: 650.21, adj_close: 92.89 },
            { ending: '2014-06-06T10:00:00-04:00', close: 647.86, adj_close: 92.55 },
            { ending: '2014-06-06T10:30:00-04:00', close: 647.9, adj_close: 92.56 },
            { ending: '2014-06-06T11:00:00-04:00', close: 647.43, adj_close: 92.49 },
            { ending: '2014-06-06T11:30:00-04:00', close: 648.12, adj_close: 92.59 },
            { ending: '2014-06-06T12:00:00-04:00', close: 649.69, adj_close: 92.81 },
            { ending: '2014-06-06T12:30:00-04:00', close: 650.491, adj_close: 92.93 },
            { ending: '2014-06-06T13:00:00-04:00', close: 649.73, adj_close: 92.82 },
            { ending: '2014-06-06T13:30:00-04:00', close: 646.46, adj_close: 92.35 },
            { ending: '2014-06-06T14:00:00-04:00', close: 645.7, adj_close: 92.24 },
            { ending: '2014-06-06T14:30:00-04:00', close: 647.98, adj_close: 92.57 },
            { ending: '2014-06-06T15:00:00-04:00', close: 648.41, adj_close: 92.63 },
            { ending: '2014-06-06T15:30:00-04:00', close: 647.8, adj_close: 92.54 },
            { ending: '2014-06-06T16:00:00-04:00', close: 645.57, adj_close: 92.22 },
            { ending: '2014-06-06T16:30:00-04:00', close: 645.21, adj_close: 92.17 },
            { ending: '2014-06-06T17:00:00-04:00', close: 645.79, adj_close: 92.26 },
            { ending: '2014-06-06T17:30:00-04:00', close: 645.84, adj_close: 92.26 },
            { ending: '2014-06-06T18:00:00-04:00', close: 645.86, adj_close: 92.27 },
            { ending: '2014-06-06T18:30:00-04:00', close: 646, adj_close: 92.29 },
            { ending: '2014-06-06T19:00:00-04:00', close: 645.8, adj_close: 92.26 },
            { ending: '2014-06-06T19:30:00-04:00', close: 645.7, adj_close: 92.24 },
            { ending: '2014-06-06T20:00:00-04:00', close: 645.65, adj_close: 92.24 },
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
            { ending: '2014-06-09T10:00:00-04:00', close: 92.3101, adj_close: 92.3101 },
            { ending: '2014-06-09T10:30:00-04:00', close: 92.34, adj_close: 92.34 },
            { ending: '2014-06-09T11:00:00-04:00', close: 92.62, adj_close: 92.62 },
            { ending: '2014-06-09T11:30:00-04:00', close: 92.85, adj_close: 92.85 },
            { ending: '2014-06-09T12:00:00-04:00', close: 93.01, adj_close: 93.01 },
            { ending: '2014-06-09T12:30:00-04:00', close: 93.32, adj_close: 93.32 },
            { ending: '2014-06-09T13:00:00-04:00', close: 93.695, adj_close: 93.695 },
            { ending: '2014-06-09T13:30:00-04:00', close: 93.4495, adj_close: 93.4495 },
            { ending: '2014-06-09T14:00:00-04:00', close: 93.76, adj_close: 93.76 },
            { ending: '2014-06-09T14:30:00-04:00', close: 93.35, adj_close: 93.35 },
            { ending: '2014-06-09T15:00:00-04:00', close: 93.69, adj_close: 93.69 },
            { ending: '2014-06-09T15:30:00-04:00', close: 93.84, adj_close: 93.84 },
            { ending: '2014-06-09T16:00:00-04:00', close: 93.7, adj_close: 93.7 }
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
    it.skip("should find USD/CAD details", function() {
        return client({
            interval:'fundamental',
            symbol:'USDCAD.FXCM', 
            trading_hours: "00:00:00 - 24:00:00",
            liquid_hours: "17:00:00 - 17:00:00",
            open_time: "17:00:00",
            security_tz: "America/New_York", tz: tz
        }).should.eventually.be.like([{
            symbol: 'USDCAD.FXCM',
            listed_market: "FXCM",
            company_name: /FXCM USD CAD/
        }]);
    });
    it.skip("should return daily FX", function() {
        return client({
            interval: 'day',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2014-02-01',
            trading_hours: "00:00:00 - 24:00:00",
            liquid_hours: "17:00:00 - 17:00:00",
            open_time: "17:00:00",
            security_tz: "America/New_York", tz: tz
        }).should.eventually.be.like([
        {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680,adj_close:1.06680},
        {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312,adj_close:1.06312},
        {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543,adj_close:1.06543},
        {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658,adj_close:1.07658},
        {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169,adj_close:1.08169},
        {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429,adj_close:1.08429},
        {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947,adj_close:1.08947},
        {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611,adj_close:1.08611},
        {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466,adj_close:1.09466},
        {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351,adj_close:1.09351},
        {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301,adj_close:1.09301},
        {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617,adj_close:1.09617},
        {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434,adj_close:1.09434},
        {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651,adj_close:1.09651},
        {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866,adj_close:1.10866},
        {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996,adj_close:1.10996},
        {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788,adj_close:1.10788},
        {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136,adj_close:1.11136},
        {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507,adj_close:1.11507},
        {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668,adj_close:1.11668},
        {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578,adj_close:1.11578},
        {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251,adj_close:1.11251}
        ]);
    });
    it.skip("should return minutes", function() {
        return client({
            interval: 'm1',
            minutes: 1,
            symbol: 'USDCAD.FXCM',
            begin: '2014-03-03T10:01:00-0500',
            end: '2014-03-03T10:30:00-0500',
            trading_hours: "00:00:00 - 24:00:00",
            liquid_hours: "17:00:00 - 17:00:00",
            open_time: "17:00:00",
            security_tz: "America/New_York", tz: tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T10:01:00-05:00',high:1.10981,low:1.10923,open:1.10923,close:1.10981},
            {ending:'2014-03-03T10:02:00-05:00',high:1.10993,low:1.10941,open:1.10981,close:1.10955},
            {ending:'2014-03-03T10:03:00-05:00',high:1.10967,low:1.10950,open:1.10955,close:1.10956},
            {ending:'2014-03-03T10:04:00-05:00',high:1.10956,low:1.10950,open:1.10956,close:1.10953},
            {ending:'2014-03-03T10:05:00-05:00',high:1.10957,low:1.10945,open:1.10952,close:1.10957},
            {ending:'2014-03-03T10:06:00-05:00',high:1.10956,low:1.10951,open:1.10956,close:1.10952},
            {ending:'2014-03-03T10:07:00-05:00',high:1.10951,low:1.10943,open:1.10951,close:1.10943},
            {ending:'2014-03-03T10:08:00-05:00',high:1.10944,low:1.10932,open:1.10944,close:1.10932},
            {ending:'2014-03-03T10:09:00-05:00',high:1.10933,low:1.10876,open:1.10932,close:1.10877},
            {ending:'2014-03-03T10:10:00-05:00',high:1.10905,low:1.10877,open:1.10878,close:1.10905},
            {ending:'2014-03-03T10:11:00-05:00',high:1.10905,low:1.10883,open:1.10905,close:1.10883},
            {ending:'2014-03-03T10:12:00-05:00',high:1.10905,low:1.10881,open:1.10883,close:1.10902},
            {ending:'2014-03-03T10:13:00-05:00',high:1.10925,low:1.10894,open:1.10905,close:1.10894},
            {ending:'2014-03-03T10:14:00-05:00',high:1.10905,low:1.10879,open:1.10897,close:1.10879},
            {ending:'2014-03-03T10:15:00-05:00',high:1.10907,low:1.10879,open:1.10879,close:1.10890},
            {ending:'2014-03-03T10:16:00-05:00',high:1.10909,low:1.10891,open:1.10891,close:1.10901},
            {ending:'2014-03-03T10:17:00-05:00',high:1.10915,low:1.10899,open:1.10904,close:1.10909},
            {ending:'2014-03-03T10:18:00-05:00',high:1.10944,low:1.10909,open:1.10910,close:1.10939},
            {ending:'2014-03-03T10:19:00-05:00',high:1.10939,low:1.10903,open:1.10939,close:1.10905},
            {ending:'2014-03-03T10:20:00-05:00',high:1.10905,low:1.10879,open:1.10905,close:1.10880},
            {ending:'2014-03-03T10:21:00-05:00',high:1.10889,low:1.10875,open:1.10880,close:1.10889},
            {ending:'2014-03-03T10:22:00-05:00',high:1.10903,low:1.10889,open:1.10889,close:1.10901},
            {ending:'2014-03-03T10:23:00-05:00',high:1.10905,low:1.10845,open:1.10902,close:1.10847},
            {ending:'2014-03-03T10:24:00-05:00',high:1.10865,low:1.10837,open:1.10848,close:1.10844},
            {ending:'2014-03-03T10:25:00-05:00',high:1.10855,low:1.10799,open:1.10848,close:1.10826},
            {ending:'2014-03-03T10:26:00-05:00',high:1.10844,low:1.10808,open:1.10826,close:1.10808},
            {ending:'2014-03-03T10:27:00-05:00',high:1.10847,low:1.10800,open:1.10809,close:1.10843},
            {ending:'2014-03-03T10:28:00-05:00',high:1.10859,low:1.10843,open:1.10843,close:1.10857},
            {ending:'2014-03-03T10:29:00-05:00',high:1.10860,low:1.10815,open:1.10859,close:1.10815},
            {ending:'2014-03-03T10:30:00-05:00',high:1.10825,low:1.10805,open:1.10819,close:1.10819}
        ]);
    });
    it.skip("should return 10 minute intervals", function() {
        return client({
            interval: 'm10',
            minutes: 10,
            symbol: 'USDCAD.FXCM',
            begin: '2014-03-03T10:10:00-0500',
            end: '2014-03-03T11:00:00-0500',
            trading_hours: "00:00:00 - 24:00:00",
            liquid_hours: "17:00:00 - 17:00:00",
            open_time: "17:00:00",
            security_tz: "America/New_York", tz: tz
        }).should.eventually.be.like([
            {ending:'2014-03-03T10:10:00-05:00',high:1.10993,low:1.10876,open:1.10923,close:1.10905},
            {ending:'2014-03-03T10:20:00-05:00',high:1.10944,low:1.10879,open:1.10905,close:1.10880},
            {ending:'2014-03-03T10:30:00-05:00',high:1.10905,low:1.10799,open:1.10880,close:1.10819},
            {ending:'2014-03-03T10:40:00-05:00',high:1.10824,low:1.10718,open:1.10819,close:1.10755},
            {ending:'2014-03-03T10:50:00-05:00',high:1.10814,low:1.10755,open:1.10755,close:1.10794},
            {ending:'2014-03-03T11:00:00-05:00',high:1.10798,low:1.10694,open:1.10793,close:1.10789}
        ]);
    });
    it.skip("should estimate daily", function() {
        return client({
            rollday: true,
            minutes: 30,
            interval: 'day',
            symbol: 'USDCAD.FXCM',
            begin: '2014-01-01', end: '2014-02-01',
            trading_hours: "00:00:00 - 24:00:00",
            liquid_hours: "17:00:00 - 17:00:00",
            open_time: "17:00:00",
            security_tz: "America/New_York", tz: tz
        }).should.eventually.be.like([
            {ending:'2014-01-02T17:00:00-05:00',high:1.06770,low:1.05874,open:1.06321,close:1.06680},
            {ending:'2014-01-03T17:00:00-05:00',high:1.06709,low:1.06013,open:1.06676,close:1.06312},
            {ending:'2014-01-06T17:00:00-05:00',high:1.06798,low:1.06076,open:1.06313,close:1.06543},
            {ending:'2014-01-07T17:00:00-05:00',high:1.07805,low:1.06467,open:1.06541,close:1.07658},
            {ending:'2014-01-08T17:00:00-05:00',high:1.08292,low:1.07600,open:1.07658,close:1.08169},
            {ending:'2014-01-09T17:00:00-05:00',high:1.08736,low:1.08159,open:1.08169,close:1.08429},
            {ending:'2014-01-10T17:00:00-05:00',high:1.09451,low:1.08361,open:1.08429,close:1.08947},
            {ending:'2014-01-13T17:00:00-05:00',high:1.09283,low:1.08416,open:1.08996,close:1.08611},
            {ending:'2014-01-14T17:00:00-05:00',high:1.09578,low:1.08577,open:1.08615,close:1.09466},
            {ending:'2014-01-15T17:00:00-05:00',high:1.09904,low:1.09193,open:1.09466,close:1.09351},
            {ending:'2014-01-16T17:00:00-05:00',high:1.09618,low:1.09041,open:1.09351,close:1.09301},
            {ending:'2014-01-17T17:00:00-05:00',high:1.09829,low:1.09251,open:1.09301,close:1.09617},
            {ending:'2014-01-20T17:00:00-05:00',high:1.09712,low:1.09285,open:1.09597,close:1.09434},
            {ending:'2014-01-21T17:00:00-05:00',high:1.10179,low:1.09382,open:1.09436,close:1.09651},
            {ending:'2014-01-22T17:00:00-05:00',high:1.10909,low:1.09525,open:1.09651,close:1.10866},
            {ending:'2014-01-23T17:00:00-05:00',high:1.11729,low:1.10811,open:1.10866,close:1.10996},
            {ending:'2014-01-24T17:00:00-05:00',high:1.11364,low:1.10498,open:1.10999,close:1.10788},
            {ending:'2014-01-27T17:00:00-05:00',high:1.11165,low:1.10308,open:1.10600,close:1.11136},
            {ending:'2014-01-28T17:00:00-05:00',high:1.11761,low:1.10773,open:1.11140,close:1.11507},
            {ending:'2014-01-29T17:00:00-05:00',high:1.11860,low:1.11014,open:1.11507,close:1.11668},
            {ending:'2014-01-30T17:00:00-05:00',high:1.11994,low:1.11498,open:1.11666,close:1.11578},
            {ending:'2014-01-31T17:00:00-05:00',high:1.12234,low:1.10867,open:1.11578,close:1.11251}
        ]);
    });
    it.skip("should lookup many iqfeed futures symbols", function() {
        return Promise.all(_.flatten(_.range(10,19).map(year => ['H','M','U','Z'].map(mo => {
            return client({
                interval:'lookup',
                symbol: `6E${mo}${year}`,
                market: "CME"
            }).catch(err => err);
        }))))
          .then(array => array.filter(item => !_.isArray(item)))
          .then(d=>d.forEach(d=>console.log(d))||d)
          .should.eventually.be.empty;
    });
    it.skip("should lookup many local futures symbols", function() {
        this.timeout(100000);
        var config = require('../src/config.js');
        config('fetch.remote.location', "ws://localhost:8081");
        config('fetch.iqfeed.enabled', true);
        var mtrader = require('../src/mtrader.js');
        var server = mtrader.listen('ws://localhost:8081');
        var remote = require('../src/fetch-remote.js')();
        return Promise.all(_.flatten(_.range(10,19).map(year => ['H','M','U','Z'].map(mo => {
            return remote.lookup({
                interval: 'lookup',
                symbol: `6E${mo}${year}`,
                market: "CME"
            }).catch(err => err);
        }))))
          .then(array => array.filter(item => !_.isArray(item)))
          .then(d=>d.forEach(d=>console.log(d))||d)
          .should.eventually.be.empty;
    });
    it.skip("should use summary info for OPRA intraday", function() {
        return client({
            interval: 'day',
            symbol: 'SPX   190418C02675000',
            market: 'OPRA',
            begin: '2019-03-01',
            trading_hours: "02:00:00 - 15:15:00",
            liquid_hours: "08:30:00 - 15:15:00",
            open_time: "08:30:00",
            security_tz: "America/Chicago", tz: tz
        }).then(d=>d.forEach(d=>console.log(d))||d);
    });
    it.skip("should return daily ATD.B", function() {
        return client({
            interval: 'day',
            symbol: 'ATD.B', market: 'TSE',
            begin: '2012-07-01', end: '2012-10-01',
            trading_hours: "04:00:00 - 20:00:00",
            liquid_hours: "09:30:00 - 16:00:00",
            open_time: "09:30:00",
            security_tz: "America/New_York", tz: tz
        })
         .then(d=>d.forEach(d=>console.log(JSON.stringify(d).replace(/"(\w+)":/g,'$1:')))||d)
         .should.eventually.be.like([
        ]);
    });
    it.skip("should return daily TRI", function() {
        return client({
            interval: 'day',
            symbol: 'TRI', market: 'TSE',
            begin: '2018-11-01', end: '2018-12-01',
            trading_hours: "04:00:00 - 20:00:00",
            liquid_hours: "09:30:00 - 16:00:00",
            open_time: "09:30:00",
            security_tz: "America/New_York", tz: tz
        })
         .then(d=>d.forEach(d=>console.log(JSON.stringify(d).replace(/"(\w+)":/g,'$1:')))||d)
         .should.eventually.be.like([
        ]);
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
