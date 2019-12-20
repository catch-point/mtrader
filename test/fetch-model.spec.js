// fetch-model.spec.js
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const merge = require('../src/merge.js');
const like = require('./should-be-like.js');
const config = require('../src/config.js');
const Fetch = require('../src/fetch.js');
const Quote = require('../src/quote.js');
const createTempDir = require('./create-temp-dir.js');

describe("fetch-model", function() {
    this.timeout(100000);
    var tz = 'America/New_York';
    var fetch, quote;
    before(function() {
        config('prefix', createTempDir('fetch-model'));
    });
    it("should blend XLC on June 18 (before inception)", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'XLC', market: 'ARCA', security_type: 'STK',
                    name: 'COMMUNICATION SERVICES SELECT SPDR FUND',
                    intervals: ['day'],
                    models: [{
                        bars: [
                            {ending:'2018-06-18T16:00:00-04:00', open:49.72, high:50.52, low:49.31, close:50.18, volume:131094, adj_close:50.09},
                            {ending:'2018-06-19T16:00:00-04:00', open:49.65, high:50.39, low:49.27, close:50.11, volume: 152086, adj_close:50.02}
                        ]
                    }, {
                        input: {
                            xlc: {symbol: 'XLC', market: 'ARCA'}
                        },
                        output: {
                            open: 'xlc.open',
                            high: 'xlc.high',
                            low: 'xlc.low',
                            close: 'xlc.close',
                            volume: 'xlc.volume',
                            adj_close: 'xlc.adj_close'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                interval: 'day',
                symbol: 'XLC', market: 'ARCA',
                begin: '2018-06-18', end: '2018-06-23', tz
            }).should.eventually.be.like([
                { ending: '2018-06-18T16:00:00-04:00', close: 50.18, adj_close: 49.41 },
                { ending: '2018-06-19T16:00:00-04:00', close: 50.11, adj_close: 49.34 },
                { ending: '2018-06-20T16:00:00-04:00', close: 50.58, adj_close: 49.95 },
                { ending: '2018-06-21T16:00:00-04:00', close: 50.27, adj_close: 49.65 },
                { ending: '2018-06-22T16:00:00-04:00', close: 50.49, adj_close: 49.87 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("should blend XLC using a different market name", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'XLC', market: 'ARCA2018', security_type: 'STK',
                    name: 'COMMUNICATION SERVICES SELECT SPDR FUND',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        bars: [
                            {ending:'2018-06-18T16:00:00-04:00', open:49.72, high:50.52, low:49.31, close:50.18, volume:131094, adj_close:50.09},
                            {ending:'2018-06-19T16:00:00-04:00', open:49.65, high:50.39, low:49.27, close:50.11, volume: 152086, adj_close:50.02}
                        ]
                    }, {
                        input: {
                            xlc: {symbol: 'XLC', market: 'ARCA'}
                        },
                        output: {
                            open: 'xlc.open',
                            high: 'xlc.high',
                            low: 'xlc.low',
                            close: 'xlc.close',
                            volume: 'xlc.volume',
                            adj_close: 'xlc.adj_close'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                interval: 'day',
                symbol: 'XLC', market: 'ARCA2018',
                begin: '2018-06-18', end: '2018-06-23', tz
            }).should.eventually.be.like([
                { ending: '2018-06-18T16:00:00-04:00', close: 50.18, adj_close: 49.41 },
                { ending: '2018-06-19T16:00:00-04:00', close: 50.11, adj_close: 49.34 },
                { ending: '2018-06-20T16:00:00-04:00', close: 50.58, adj_close: 49.95 },
                { ending: '2018-06-21T16:00:00-04:00', close: 50.27, adj_close: 49.65 },
                { ending: '2018-06-22T16:00:00-04:00', close: 50.49, adj_close: 49.87 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("should blend XLC using a different market name from quote", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'XLC', market: 'ARCA2018', security_type: 'STK',
                    name: 'COMMUNICATION SERVICES SELECT SPDR FUND',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        bars: [
                            {ending:'2018-06-18T16:00:00-04:00', open:49.72, high:50.52, low:49.31, close:50.18, volume:131094, adj_close:50.09},
                            {ending:'2018-06-19T16:00:00-04:00', open:49.65, high:50.39, low:49.27, close:50.11, volume: 152086, adj_close:50.02}
                        ]
                    }, {
                        input: {
                            xlc: {symbol: 'XLC', market: 'ARCA'}
                        },
                        output: {
                            open: 'xlc.open',
                            high: 'xlc.high',
                            low: 'xlc.low',
                            close: 'xlc.close',
                            volume: 'xlc.volume',
                            adj_close: 'xlc.adj_close'
                        }
                    }]
                }]
            }
        }));
        const quote = Quote(fetch);
        try {
            await quote({
                symbol: 'XLC', market: 'ARCA2018',
                columns: {ending:'ending', close: 'day.close', adj_close:'day.adj_close'},
                begin: '2018-06-18', end: '2018-06-23', tz
            }).should.eventually.be.like([
                { ending: '2018-06-18T16:00:00-04:00', close: 50.18, adj_close: 49.41 },
                { ending: '2018-06-19T16:00:00-04:00', close: 50.11, adj_close: 49.34 },
                { ending: '2018-06-20T16:00:00-04:00', close: 50.58, adj_close: 49.95 },
                { ending: '2018-06-21T16:00:00-04:00', close: 50.27, adj_close: 49.65 },
                { ending: '2018-06-22T16:00:00-04:00', close: 50.49, adj_close: 49.87 }
            ]);
        } finally {
            await quote.close();
            await fetch.close();
        }
    });
    it("should blend XLC using a model of stocks", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data')
                    }
                },
                assets:[{
                    symbol: 'XLC', market: 'ARCA2018', security_type: 'STK',
                    name: 'COMMUNICATION SERVICES SELECT SPDR FUND',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            fb:    {symbol:'FB',   market:'NASDAQ'},
                            goog:  {symbol:'GOOG', market:'NASDAQ'},
                            googl: {symbol:'GOOGL',market:'NASDAQ'},
                            dis:   {symbol:'DIS',  market:'NYSE'  },
                            chtr:  {symbol:'CHTR', market:'NASDAQ'},
                            nflx:  {symbol:'NFLX', market:'NASDAQ'},
                            t:     {symbol:'T',    market:'NYSE'  },
                            ea:    {symbol:'EA',   market:'NASDAQ'},
                            atvi:  {symbol:'ATVI', market:'NASDAQ'},
                            vz:    {symbol:'VZ',   market:'NYSE'  },
                            cmcsa: {symbol:'CMCSA',market:'NASDAQ'},
                            foxa:  {symbol:'FOXA', market:'NASDAQ'},
                            ctl:   {symbol:'CTL',  market:'NYSE'  },
                            twtr:  {symbol:'TWTR', market:'NYSE'  },
                            cbs:   {symbol:'CBS',  market:'NYSE'  },
                            omc:   {symbol:'OMC',  market:'NYSE'  },
                            ttwo:  {symbol:'TTWO', market:'NASDAQ'},
                            viab:  {symbol:'VIAB', market:'NASDAQ'},
                            fox:   {symbol:'FOX',  market:'NASDAQ'},
                            disck: {symbol:'DISCK',market:'NASDAQ'},
                            ipg:   {symbol:'IPG',  market:'NYSE'  },
                            dish:  {symbol:'DISH', market:'NASDAQ'},
                            trip:  {symbol:'TRIP', market:'NASDAQ'},
                            disca: {symbol:'DISCA',market:'NASDAQ'},
                            nwsa:  {symbol:'NWSA', market:'NASDAQ'},
                            nws:   {symbol:'NWS',  market:'NASDAQ'}
                        },
                        output: {
                            open: '(atvi.open*4.437133/80.6 + cbs.open*2.449919/56.58 + chtr.open*4.595426/327.04 + cmcsa.open*4.312410/35.63 + ctl.open*2.784001/22.9 + dis.open*4.616546/112.77 + disca.open*0.637655/31.91 + disck.open*1.339490/29.12 + dish.open*1.037675/35.42 + ea.open*4.493356/115.24 + fb.open*17.739346/165.41 + fox.open*1.412378/44.65 + foxa.open*3.081619/45.01 + goog.open*11.591048/1173.37 + googl.open*11.310616/1179.56 + ipg.open*1.129556/23.01 + nflx.open*4.536174/369.61 + nws.open*0.209698/13.25 + nwsa.open*0.625257/12.75 + omc.open*2.014114/70.17 + t.open*4.514606/33.91 + trip.open*0.669080/51.13 + ttwo.open*1.965050/134.88 + twtr.open*2.633648/28.6 + viab.open*1.473485/32.59 + vz.open*4.390714/53.54)*48.55/100',
                            high: '(atvi.high*4.437133/80.6 + cbs.high*2.449919/56.58 + chtr.high*4.595426/327.04 + cmcsa.high*4.312410/35.63 + ctl.high*2.784001/22.9 + dis.high*4.616546/112.77 + disca.high*0.637655/31.91 + disck.high*1.339490/29.12 + dish.high*1.037675/35.42 + ea.high*4.493356/115.24 + fb.high*17.739346/165.41 + fox.high*1.412378/44.65 + foxa.high*3.081619/45.01 + goog.high*11.591048/1173.37 + googl.high*11.310616/1179.56 + ipg.high*1.129556/23.01 + nflx.high*4.536174/369.61 + nws.high*0.209698/13.25 + nwsa.high*0.625257/12.75 + omc.high*2.014114/70.17 + t.high*4.514606/33.91 + trip.high*0.669080/51.13 + ttwo.high*1.965050/134.88 + twtr.high*2.633648/28.6 + viab.high*1.473485/32.59 + vz.high*4.390714/53.54)*48.55/100',
                            low: '(atvi.low*4.437133/80.6 + cbs.low*2.449919/56.58 + chtr.low*4.595426/327.04 + cmcsa.low*4.312410/35.63 + ctl.low*2.784001/22.9 + dis.low*4.616546/112.77 + disca.low*0.637655/31.91 + disck.low*1.339490/29.12 + dish.low*1.037675/35.42 + ea.low*4.493356/115.24 + fb.low*17.739346/165.41 + fox.low*1.412378/44.65 + foxa.low*3.081619/45.01 + goog.low*11.591048/1173.37 + googl.low*11.310616/1179.56 + ipg.low*1.129556/23.01 + nflx.low*4.536174/369.61 + nws.low*0.209698/13.25 + nwsa.low*0.625257/12.75 + omc.low*2.014114/70.17 + t.low*4.514606/33.91 + trip.low*0.669080/51.13 + ttwo.low*1.965050/134.88 + twtr.low*2.633648/28.6 + viab.low*1.473485/32.59 + vz.low*4.390714/53.54)*48.55/100',
                            close: '(atvi.close*4.437133/80.6 + cbs.close*2.449919/56.58 + chtr.close*4.595426/327.04 + cmcsa.close*4.312410/35.63 + ctl.close*2.784001/22.9 + dis.close*4.616546/112.77 + disca.close*0.637655/31.91 + disck.close*1.339490/29.12 + dish.close*1.037675/35.42 + ea.close*4.493356/115.24 + fb.close*17.739346/165.41 + fox.close*1.412378/44.65 + foxa.close*3.081619/45.01 + goog.close*11.591048/1173.37 + googl.close*11.310616/1179.56 + ipg.close*1.129556/23.01 + nflx.close*4.536174/369.61 + nws.close*0.209698/13.25 + nwsa.close*0.625257/12.75 + omc.close*2.014114/70.17 + t.close*4.514606/33.91 + trip.close*0.669080/51.13 + ttwo.close*1.965050/134.88 + twtr.close*2.633648/28.6 + viab.close*1.473485/32.59 + vz.close*4.390714/53.54)*48.55/100',
                            volume: '(atvi.volume + cbs.volume + chtr.volume + cmcsa.volume + ctl.volume + dis.volume + disca.volume + disck.volume + dish.volume + ea.volume + fb.volume + fox.volume + foxa.volume + goog.volume + googl.volume + ipg.volume + nflx.volume + nws.volume + nwsa.volume + omc.volume + t.volume + trip.volume + ttwo.volume + twtr.volume + viab.volume + vz.volume)*6769350/253757416',
                            adj_close: '(atvi.adj_close*4.437133/80.6 + cbs.adj_close*2.449919/56.58 + chtr.adj_close*4.595426/327.04 + cmcsa.adj_close*4.312410/35.63 + ctl.adj_close*2.784001/22.9 + dis.adj_close*4.616546/112.77 + disca.adj_close*0.637655/31.91 + disck.adj_close*1.339490/29.12 + dish.adj_close*1.037675/35.42 + ea.adj_close*4.493356/115.24 + fb.adj_close*17.739346/165.41 + fox.adj_close*1.412378/44.65 + foxa.adj_close*3.081619/45.01 + goog.adj_close*11.591048/1173.37 + googl.adj_close*11.310616/1179.56 + ipg.adj_close*1.129556/23.01 + nflx.adj_close*4.536174/369.61 + nws.adj_close*0.209698/13.25 + nwsa.adj_close*0.625257/12.75 + omc.adj_close*2.014114/70.17 + t.adj_close*4.514606/33.91 + trip.adj_close*0.669080/51.13 + ttwo.adj_close*1.965050/134.88 + twtr.adj_close*2.633648/28.6 + viab.adj_close*1.473485/32.59 + vz.adj_close*4.390714/53.54)*48.55/100'
                        }
                    }, {
                        begin: '2018-06-19',
                        input: {
                            xlc: {symbol: 'XLC', market: 'ARCA'}
                        },
                        output: {
                            open: 'xlc.open',
                            high: 'xlc.high',
                            low: 'xlc.low',
                            close: 'xlc.close',
                            volume: 'xlc.volume',
                            adj_close: 'xlc.adj_close'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                interval: 'day',
                symbol: 'XLC', market: 'ARCA2018',
                begin: '2018-06-18', end: '2018-06-23', tz
            }).should.eventually.be.like([
                { ending: '2018-06-18T16:00:00-04:00', close: 50.44, adj_close: 49.41 },
                { ending: '2018-06-19T16:00:00-04:00', close: 50.35, adj_close: 49.32 },
                { ending: '2018-06-20T16:00:00-04:00', close: 50.99, adj_close: 49.95 },
                { ending: '2018-06-21T16:00:00-04:00', close: 50.27, adj_close: 49.65 },
                { ending: '2018-06-22T16:00:00-04:00', close: 50.49, adj_close: 49.87 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("should compute ratio of SPY vs TLT", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'SPY_over_TLT', market: 'model19', security_type: 'STK',
                    name: 'SPY price over TLT price ratio',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            spy: {symbol: 'SPY', market: 'ARCA'},
                            tlt: {symbol: 'TLT', market: 'ARCA'}
                        },
                        output: {
                            open: 'spy.open / tlt.open',
                            high: 'spy.high / tlt.high',
                            low: 'spy.low / tlt.low',
                            close: 'spy.close / tlt.close',
                            volume: 'spy.volume / tlt.volume',
                            adj_close: 'spy.adj_close / tlt.adj_close'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                interval: 'day',
                symbol: 'SPY_over_TLT', market: 'model19',
                begin: '2019-08-01', end: '2019-09-01', tz
            }).should.eventually.be.like([
                { ending: '2019-08-01T16:00:00-04:00', adj_close: 2.18 },
                { ending: '2019-08-02T16:00:00-04:00', adj_close: 2.14 },
                { ending: '2019-08-05T16:00:00-04:00', adj_close: 2.05 },
                { ending: '2019-08-06T16:00:00-04:00', adj_close: 2.06 },
                { ending: '2019-08-07T16:00:00-04:00', adj_close: 2.06 },
                { ending: '2019-08-08T16:00:00-04:00', adj_close: 2.09 },
                { ending: '2019-08-09T16:00:00-04:00', adj_close: 2.08 },
                { ending: '2019-08-12T16:00:00-04:00', adj_close: 2.02 },
                { ending: '2019-08-13T16:00:00-04:00', adj_close: 2.05 },
                { ending: '2019-08-14T16:00:00-04:00', adj_close: 1.95 },
                { ending: '2019-08-15T16:00:00-04:00', adj_close: 1.93 },
                { ending: '2019-08-16T16:00:00-04:00', adj_close: 1.98 },
                { ending: '2019-08-19T16:00:00-04:00', adj_close: 2.03 },
                { ending: '2019-08-20T16:00:00-04:00', adj_close: 1.99 },
                { ending: '2019-08-21T16:00:00-04:00', adj_close: 2.02 },
                { ending: '2019-08-22T16:00:00-04:00', adj_close: 2.04 },
                { ending: '2019-08-23T16:00:00-04:00', adj_close: 1.95 },
                { ending: '2019-08-26T16:00:00-04:00', adj_close: 1.98 },
                { ending: '2019-08-27T16:00:00-04:00', adj_close: 1.94 },
                { ending: '2019-08-28T16:00:00-04:00', adj_close: 1.96 },
                { ending: '2019-08-29T16:00:00-04:00', adj_close: 1.99 },
                { ending: '2019-08-30T16:00:00-04:00', adj_close: 1.99 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("should compute SPY in CAD", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            },
                            ib: {
                                enabled: true,
                                markets: ["CAD"]
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'SPY_CAD', market: 'model19', security_type: 'STK',
                    name: 'SPY in CAD',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "CAD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            spy: {symbol: 'SPY', market: 'ARCA'},
                            usd: {symbol: 'USD', market: 'CAD', interval: 'm240'}
                        },
                        output: {
                            open: 'spy.open',
                            high: 'spy.high',
                            low: 'spy.low',
                            close: 'spy.close',
                            volume: 'spy.volume',
                            adj_close: 'spy.adj_close * usd.adj_close'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                interval: 'day',
                symbol: 'SPY_CAD', market: 'model19',
                begin: '2019-08-01', end: '2019-09-01', tz
            }).should.eventually.be.like([
                { ending: '2019-08-01T16:00:00-04:00', close: 294.84, adj_close: 387.94 },
                { ending: '2019-08-02T16:00:00-04:00', close: 292.62, adj_close: 384.90 },
                { ending: '2019-08-05T16:00:00-04:00', close: 283.82, adj_close: 373.28 },
                { ending: '2019-08-06T16:00:00-04:00', close: 287.80, adj_close: 380.24 },
                { ending: '2019-08-07T16:00:00-04:00', close: 287.97, adj_close: 381.39 },
                { ending: '2019-08-08T16:00:00-04:00', close: 293.62, adj_close: 386.60 },
                { ending: '2019-08-09T16:00:00-04:00', close: 291.62, adj_close: 383.40 },
                { ending: '2019-08-12T16:00:00-04:00', close: 288.07, adj_close: 379.65 },
                { ending: '2019-08-13T16:00:00-04:00', close: 292.55, adj_close: 385.19 },
                { ending: '2019-08-14T16:00:00-04:00', close: 283.90, adj_close: 376.27 },
                { ending: '2019-08-15T16:00:00-04:00', close: 284.65, adj_close: 377.31 },
                { ending: '2019-08-16T16:00:00-04:00', close: 288.85, adj_close: 381.56 },
                { ending: '2019-08-19T16:00:00-04:00', close: 292.33, adj_close: 388.08 },
                { ending: '2019-08-20T16:00:00-04:00', close: 290.09, adj_close: 384.50 },
                { ending: '2019-08-21T16:00:00-04:00', close: 292.45, adj_close: 386.93 },
                { ending: '2019-08-22T16:00:00-04:00', close: 292.36, adj_close: 387.10 },
                { ending: '2019-08-23T16:00:00-04:00', close: 284.85, adj_close: 376.92 },
                { ending: '2019-08-26T16:00:00-04:00', close: 288.00, adj_close: 380.04 },
                { ending: '2019-08-27T16:00:00-04:00', close: 286.87, adj_close: 379.76 },
                { ending: '2019-08-28T16:00:00-04:00', close: 288.89, adj_close: 382.58 },
                { ending: '2019-08-29T16:00:00-04:00', close: 292.58, adj_close: 387.23 },
                { ending: '2019-08-30T16:00:00-04:00', close: 292.45, adj_close: 387.55 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("estimate average weight of top holdings", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'XLC_WEIGHTS', market: 'basket19', security_type: 'STK',
                    name: 'COMMUNICATION SERVICES SELECT SPDR FUND',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            xlc:   {symbol:'XLC',  market:'ARCA'},
                            goog:  {symbol:'GOOG', market:'NASDAQ'},
                            fb:    {symbol:'FB',   market:'NASDAQ'},
                            dis:   {symbol:'DIS',  market:'NYSE'},
                            chtr:  {symbol:'CHTR', market:'NASDAQ'},
                            nflx:  {symbol:'NFLX', market:'NASDAQ'},
                            t:     {symbol:'T',    market:'NYSE'},
                            ea:    {symbol:'EA',   market:'NASDAQ'},
                            atvi:  {symbol:'ATVI', market:'NASDAQ'},
                            vz:    {symbol:'VZ',   market:'NYSE'},
                            cmcsa: {symbol:'CMCSA',market:'NASDAQ'}
                        },
                        pad_begin: 1,
                        regression_length: 50,
                        dependent: 'xlc.adj_close',
                        independents: {
                            constant_offset: '1',
                            goog_coefficient: 'goog.adj_close',
                            fb_coefficient: 'fb.adj_close',
                            dis_coefficient: 'dis.adj_close',
                            chtr_coefficient: 'chtr.adj_close',
                            nflx_coefficient: 'nflx.adj_close',
                            t_coefficient: 't.adj_close',
                            ea_coefficient: 'ea.adj_close',
                            atvi_coefficient: 'atvi.adj_close',
                            vz_coefficient: 'vz.adj_close',
                            cmcsa_coefficient: 'cmcsa.adj_close'
                        },
                        variables: {
                            offset: "PREV('constant_offset') / xlc_adj",
                            xlc_adj: "xlc.close/xlc.adj_close",
                            goog_co: "PREV('goog_coefficient') * goog.close/goog.adj_close / xlc_adj",
                            fb_co: "PREV('fb_coefficient') * fb.close/fb.adj_close / xlc_adj",
                            dis_co: "PREV('dis_coefficient') * dis.close/dis.adj_close / xlc_adj",
                            chtr_co: "PREV('chtr_coefficient') * chtr.close/chtr.adj_close / xlc_adj",
                            nflx_co: "PREV('nflx_coefficient') * nflx.close/nflx.adj_close / xlc_adj",
                            t_co: "PREV('t_coefficient') * t.close/t.adj_close / xlc_adj",
                            ea_co: "PREV('ea_coefficient') * ea.close/ea.adj_close / xlc_adj",
                            atvi_co: "PREV('atvi_coefficient') * atvi.close/atvi.adj_close / xlc_adj",
                            vz_co: "PREV('vz_coefficient') * vz.close/vz.adj_close / xlc_adj",
                            cmcsa_co: "PREV('cmcsa_coefficient') * cmcsa.close/cmcsa.adj_close / xlc_adj"
                        },
                        output: {
                            open: 'xlc.open - offset - goog.open*goog_co - fb.open*fb_co - dis.open*dis_co - chtr.open*chtr_co - nflx.open*nflx_co - t.open*t_co - ea.open*ea_co - atvi.open*atvi_co - vz.open*vz_co - cmcsa.open*cmcsa_co',
                            high: 'xlc.high - offset - goog.high*goog_co - fb.high*fb_co - dis.high*dis_co - chtr.high*chtr_co - nflx.high*nflx_co - t.high*t_co - ea.high*ea_co - atvi.high*atvi_co - vz.high*vz_co - cmcsa.high*cmcsa_co',
                            low: 'xlc.low - offset - goog.low*goog_co - fb.low*fb_co - dis.low*dis_co - chtr.low*chtr_co - nflx.low*nflx_co - t.low*t_co - ea.low*ea_co - atvi.low*atvi_co - vz.low*vz_co - cmcsa.low*cmcsa_co',
                            close: 'xlc.close - offset - goog.close*goog_co - fb.close*fb_co - dis.close*dis_co - chtr.close*chtr_co - nflx.close*nflx_co - t.close*t_co - ea.close*ea_co - atvi.close*atvi_co - vz.close*vz_co - cmcsa.close*cmcsa_co',
                            volume: 'xlc.volume - goog.volume - fb.volume - dis.volume - chtr.volume - nflx.volume - t.volume - ea.volume - atvi.volume - vz.volume - cmcsa.volume',
                            adj_close: 'xlc.adj_close - offset - goog.adj_close*goog_co - fb.adj_close*fb_co - dis.adj_close*dis_co - chtr.adj_close*chtr_co - nflx.adj_close*nflx_co - t.adj_close*t_co - ea.adj_close*ea_co - atvi.adj_close*atvi_co - vz.adj_close*vz_co - cmcsa.adj_close*cmcsa_co',
                            xlc_value: 'xlc.close',
                            goog_value: 'goog.close * goog_co',
                            fb_value: 'fb.close * fb_co',
                            dis_value: 'dis.close * dis_co',
                            chtr_value: 'chtr.close * chtr_co',
                            nflx_value: 'nflx.close * nflx_co',
                            t_value: 't.close * t_co',
                            ea_value: 'ea.close * ea_co',
                            atvi_value: 'atvi.close * atvi_co',
                            vz_value: 'vz.close * vz_co',
                            cmcsa_value: 'cmcsa.close * cmcsa_co'
                        }
                    }]
                }]
            }
        }));
        const quote = Quote(fetch);
        try {
            await quote({
                symbol: 'XLC_WEIGHTS', market: 'basket19',
                columns: {
                    date: 'DATE(ending)',
                    goog: 'ROUND(day.goog_value / day.xlc_value * 100)',
                    fb: 'ROUND(day.fb_value / day.xlc_value * 100)',
                    dis: 'ROUND(day.dis_value / day.xlc_value * 100)',
                    chtr: 'ROUND(day.chtr_value / day.xlc_value * 100)',
                    nflx: 'ROUND(day.nflx_value / day.xlc_value * 100)',
                    t: 'ROUND(day.t_value / day.xlc_value * 100)',
                    ea: 'ROUND(day.ea_value / day.xlc_value * 100)',
                    atvi: 'ROUND(day.atvi_value / day.xlc_value * 100)',
                    vz: 'ROUND(day.vz_value / day.xlc_value * 100)',
                    cmcsa: 'ROUND(day.cmcsa_value / day.xlc_value * 100)'
                },
                begin: '2019-06-01', end: '2019-07-01', tz
            }).should.eventually.be.like([
{ date: '2019-06-03', goog: 24, fb: 21, dis:  8, chtr: 2, nflx: 6, t: 11, ea:  2, atvi:  9, vz: 1, cmcsa: 11 },
{ date: '2019-06-04', goog: 23, fb: 19, dis:  8, chtr: 3, nflx: 6, t: 11, ea:  1, atvi: 10, vz: 1, cmcsa: 11 },
{ date: '2019-06-05', goog: 23, fb: 17, dis:  9, chtr: 5, nflx: 7, t: 11, ea:  1, atvi: 11, vz: 0, cmcsa: 11 },
{ date: '2019-06-06', goog: 23, fb: 17, dis:  9, chtr: 6, nflx: 8, t: 11, ea:  1, atvi: 11, vz: 1, cmcsa:  9 },
{ date: '2019-06-07', goog: 23, fb: 17, dis:  9, chtr: 5, nflx: 8, t: 11, ea:  1, atvi: 11, vz: 1, cmcsa:  9 },
{ date: '2019-06-10', goog: 23, fb: 17, dis:  9, chtr: 5, nflx: 8, t: 12, ea:  1, atvi: 11, vz: 0, cmcsa: 10 },
{ date: '2019-06-11', goog: 23, fb: 17, dis:  9, chtr: 4, nflx: 8, t: 11, ea:  1, atvi: 11, vz: 0, cmcsa: 10 },
{ date: '2019-06-12', goog: 23, fb: 17, dis:  9, chtr: 4, nflx: 8, t: 11, ea:  1, atvi: 11, vz: 1, cmcsa: 10 },
{ date: '2019-06-13', goog: 23, fb: 17, dis:  9, chtr: 5, nflx: 8, t: 10, ea:  1, atvi: 11, vz: 2, cmcsa: 10 },
{ date: '2019-06-14', goog: 23, fb: 17, dis:  9, chtr: 6, nflx: 7, t:  9, ea:  1, atvi: 11, vz: 3, cmcsa:  8 },
{ date: '2019-06-17', goog: 23, fb: 18, dis:  9, chtr: 6, nflx: 7, t:  8, ea:  1, atvi: 11, vz: 4, cmcsa:  8 },
{ date: '2019-06-18', goog: 23, fb: 18, dis:  9, chtr: 6, nflx: 7, t:  8, ea:  1, atvi: 11, vz: 4, cmcsa:  7 },
{ date: '2019-06-19', goog: 23, fb: 18, dis:  9, chtr: 5, nflx: 8, t: 10, ea:  1, atvi: 11, vz: 2, cmcsa:  8 },
{ date: '2019-06-20', goog: 23, fb: 18, dis:  9, chtr: 6, nflx: 8, t: 11, ea:  1, atvi: 11, vz: 2, cmcsa:  8 },
{ date: '2019-06-21', goog: 23, fb: 19, dis:  9, chtr: 5, nflx: 8, t: 11, ea:  1, atvi: 11, vz: 1, cmcsa:  9 },
{ date: '2019-06-24', goog: 23, fb: 19, dis:  9, chtr: 5, nflx: 8, t: 12, ea:  1, atvi: 11, vz: 1, cmcsa:  9 },
{ date: '2019-06-25', goog: 22, fb: 19, dis: 13, chtr: 3, nflx: 8, t: 11, ea:  1, atvi: 10, vz: 1, cmcsa:  9 },
{ date: '2019-06-26', goog: 23, fb: 18, dis: 13, chtr: 4, nflx: 8, t: 10, ea:  0, atvi: 10, vz: 1, cmcsa: 10 },
{ date: '2019-06-27', goog: 23, fb: 17, dis: 11, chtr: 7, nflx: 9, t:  9, ea: -1, atvi: 10, vz: 1, cmcsa: 12 },
{ date: '2019-06-28', goog: 23, fb: 17, dis: 12, chtr: 7, nflx: 9, t:  9, ea: -1, atvi: 10, vz: 1, cmcsa: 12 }
            ]);
        } finally {
            await quote.close();
            await fetch.close();
        }
    });
    it("should arbitrage XLC using top holdings", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'XLC', market: 'basket19', security_type: 'STK',
                    name: 'XLC Holdings Regression',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            xlc:   {symbol:'XLC',  market:'ARCA'},
                            goog:  {symbol:'GOOG', market:'NASDAQ'},
                            fb:    {symbol:'FB',   market:'NASDAQ'},
                            dis:   {symbol:'DIS',  market:'NYSE'},
                            nflx:  {symbol:'NFLX', market:'NASDAQ'},
                            t:     {symbol:'T',    market:'NYSE'}
                        },
                        pad_begin: 1,
                        regression_length: 200,
                        dependent: 'xlc.adj_close',
                        independents: {
                            constant_offset: '1',
                            goog_coefficient: 'goog.adj_close',
                            fb_coefficient: 'fb.adj_close',
                            dis_coefficient: 'dis.adj_close',
                            nflx_coefficient: 'nflx.adj_close',
                            t_coefficient: 't.adj_close'
                        },
                        variables: {
                            offset: "PREV('constant_offset') / xlc_adj",
                            xlc_adj: "xlc.close/xlc.adj_close",
                            goog_co: "PREV('goog_coefficient') * goog.close/goog.adj_close / xlc_adj",
                            fb_co: "PREV('fb_coefficient') * fb.close/fb.adj_close / xlc_adj",
                            dis_co: "PREV('dis_coefficient') * dis.close/dis.adj_close / xlc_adj",
                            nflx_co: "PREV('nflx_coefficient') * nflx.close/nflx.adj_close / xlc_adj",
                            t_co: "PREV('t_coefficient') * t.close/t.adj_close / xlc_adj"
                        },
                        output: {
                            open: 'xlc.open - offset - goog.open*goog_co - fb.open*fb_co - dis.open*dis_co - nflx.open*nflx_co - t.open*t_co',
                            high: 'xlc.high - offset - goog.high*goog_co - fb.high*fb_co - dis.high*dis_co - nflx.high*nflx_co - t.high*t_co',
                            low: 'xlc.low - offset - goog.low*goog_co - fb.low*fb_co - dis.low*dis_co - nflx.low*nflx_co - t.low*t_co',
                            close: 'xlc.close - offset - goog.close*goog_co - fb.close*fb_co - dis.close*dis_co - nflx.close*nflx_co - t.close*t_co',
                            volume: 'xlc.volume - goog.volume - fb.volume - dis.volume - nflx.volume - t.volume',
                            adj_close: 'xlc.adj_close - offset - goog.adj_close*goog_co - fb.adj_close*fb_co - dis.adj_close*dis_co - nflx.adj_close*nflx_co - t.adj_close*t_co',
                            xlc_coefficient: '1',
                            goog_coefficient: 'goog_co',
                            fb_coefficient: 'fb_co',
                            dis_coefficient: 'dis_co',
                            nflx_coefficient: 'nflx_co',
                            t_coefficient: 't_co'
                        }
                    }]
                }]
            }
        }));
        const quote = Quote(fetch);
        try {
            await quote({
                symbol: 'XLC', market: 'basket19',
                columns: {
                    date: 'DATE(ending)',
                    z_score: 'ROUND((day.adj_close - SMA(100,day.adj_close))/STDEV(100,day.adj_close),2)',
                    xlc: 'ROUND(-z_score/3 * day.xlc_coefficient*1000)',
                    goog: 'ROUND(z_score/3 * day.goog_coefficient*1000)',
                    fb: 'ROUND(z_score/3 * day.fb_coefficient*1000)',
                    dis: 'ROUND(z_score/3 * day.dis_coefficient*1000)',
                    nflx: 'ROUND(z_score/3 * day.nflx_coefficient*1000)',
                    t: 'ROUND(z_score/3 * day.t_coefficient*1000)'
                },
                begin: '2019-09-01', end: '2019-10-01', tz
            }).should.eventually.be.like([
                { date: '2019-09-03', z_score: 0.99, xlc: -330, goog: 4, fb: 16, dis: 19, nflx: 3, t: 55 },
                { date: '2019-09-04', z_score: 1.95, xlc: -650, goog: 7, fb: 33, dis: 37, nflx: 5, t: 109 },
                { date: '2019-09-05', z_score: 2.47, xlc: -823, goog: 9, fb: 42, dis: 46, nflx: 7, t: 142 },
                { date: '2019-09-06', z_score: 2.53, xlc: -843, goog: 10, fb: 43, dis: 46, nflx: 7, t: 152 },
                { date: '2019-09-09', z_score: 2.42, xlc: -807, goog: 9, fb: 42, dis: 42, nflx: 6, t: 152 },
                { date: '2019-09-10', z_score: 2.84, xlc: -947, goog: 11, fb: 51, dis: 48, nflx: 7, t: 184 },
                { date: '2019-09-11', z_score: 1.9, xlc: -633, goog: 7, fb: 34, dis: 31, nflx: 5, t: 131 },
                { date: '2019-09-12', z_score: 1.87, xlc: -623, goog: 7, fb: 34, dis: 29, nflx: 5, t: 135 },
                { date: '2019-09-13', z_score: 1.48, xlc: -493, goog: 6, fb: 27, dis: 23, nflx: 4, t: 111 },
                { date: '2019-09-16', z_score: 1.87, xlc: -623, goog: 7, fb: 34, dis: 28, nflx: 5, t: 145 },
                { date: '2019-09-17', z_score: 1.65, xlc: -550, goog: 6, fb: 31, dis: 24, nflx: 5, t: 131 },
                { date: '2019-09-18', z_score: 1.67, xlc: -557, goog: 6, fb: 33, dis: 23, nflx: 5, t: 136 },
                { date: '2019-09-19', z_score: 1.46, xlc: -487, goog: 5, fb: 30, dis: 18, nflx: 4, t: 122 },
                { date: '2019-09-20', z_score: 0.53, xlc: -177, goog: 2, fb: 11, dis: 6, nflx: 1, t: 45 },
                { date: '2019-09-23', z_score: 0.72, xlc: -240, goog: 3, fb: 15, dis: 8, nflx: 2, t: 61 },
                { date: '2019-09-24', z_score: 0.52, xlc: -173, goog: 2, fb: 11, dis: 6, nflx: 1, t: 44 },
                { date: '2019-09-25', z_score: 0.66, xlc: -220, goog: 2, fb: 15, dis: 7, nflx: 2, t: 57 },
                { date: '2019-09-26', z_score: 0.21, xlc: -70, goog: 1, fb: 5, dis: 2, nflx: 1, t: 18 },
                { date: '2019-09-27', z_score: -0.16, xlc: 53, goog: -1, fb: -4, dis: -2, nflx: -0, t: -14 },
                { date: '2019-09-30', z_score: 0.09, xlc: -30, goog: 0, fb: 2, dis: 1, nflx: 0, t: 8 }

            ]);
        } finally {
            await quote.close();
            await fetch.close();
        }
    });
    it("should arbitrage equity index ETFs", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'SPYQQQDIAIWM', market: 'basket19', security_type: 'STK',
                    name: 'SPY QQQ DIA IWM Regression Neutral',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            spy: {symbol:'SPY', market:'ARCA'},
                            qqq: {symbol:'QQQ', market:'ARCA'},
                            dia: {symbol:'DIA', market:'ARCA'},
                            iwm: {symbol:'IWM', market:'ARCA'}
                        },
                        pad_begin: 1,
                        regression_length: 200,
                        dependent: 'spy.adj_close',
                        independents: {
                            constant_offset: '1',
                            qqq_coefficient: 'qqq.adj_close',
                            dia_coefficient: 'dia.adj_close',
                            iwm_coefficient: 'iwm.adj_close'
                        },
                        variables: {
                            offset: "PREV('constant_offset') / spy_adj",
                            spy_adj: "spy.close/spy.adj_close",
                            qqq_co: "PREV('qqq_coefficient') * qqq.close/qqq.adj_close / spy_adj",
                            dia_co: "PREV('dia_coefficient') * dia.close/dia.adj_close / spy_adj",
                            iwm_co: "PREV('iwm_coefficient') * iwm.close/iwm.adj_close / spy_adj"
                        },
                        output: {
                            open: 'spy.open - offset - qqq.open*qqq_co - dia.open*dia_co - iwm.open*iwm_co',
                            high: 'spy.high - offset - qqq.high*qqq_co - dia.high*dia_co - iwm.high*iwm_co',
                            low: 'spy.low - offset - qqq.low*qqq_co - dia.low*dia_co - iwm.low*iwm_co',
                            close: 'spy.close - offset - qqq.close*qqq_co - dia.close*dia_co - iwm.close*iwm_co',

                            volume: 'spy.volume - qqq.volume - dia.volume - iwm.volume',
                            adj_close: 'spy.adj_close - offset - qqq.adj_close*qqq_co - dia.adj_close*dia_co - iwm.adj_close*iwm_co',
                            spy_coefficient: '1',
                            qqq_coefficient: 'qqq_co',
                            dia_coefficient: 'dia_co',
                            iwm_coefficient: 'iwm_co'
                        }
                    }]
                }]
            }
        }));
        const quote = Quote(fetch);
        try {
            await quote({
                symbol: 'SPYQQQDIAIWM', market: 'basket19',
                columns: {
                    ending:'ending',
                    z_score: 'ROUND((day.adj_close - SMA(100,day.adj_close))/STDEV(100,day.adj_close),2)',
                    spy: 'ROUND(-z_score/3 * day.spy_coefficient*100)',
                    qqq: 'ROUND(z_score/3 * day.qqq_coefficient*100)',
                    dia: 'ROUND(z_score/3 * day.dia_coefficient*100)',
                    iwm: 'ROUND(z_score/3 * day.iwm_coefficient*100)',
                },
                begin: '2019-06-01', end: '2019-07-01', tz
            }).should.eventually.be.like([
                { ending: '2019-06-03T16:00:00-04:00', z_score: 3.28, spy: -109, qqq: 75, dia: 55, iwm: 11 },
                { ending: '2019-06-04T16:00:00-04:00', z_score: 2.87, spy: -96, qqq: 65, dia: 48, iwm: 9 },
                { ending: '2019-06-05T16:00:00-04:00', z_score: 3.05, spy: -102, qqq: 69, dia: 51, iwm: 10 },
                { ending: '2019-06-06T16:00:00-04:00', z_score: 2.79, spy: -93, qqq: 64, dia: 47, iwm: 8 },
                { ending: '2019-06-07T16:00:00-04:00', z_score: 2, spy: -67, qqq: 45, dia: 34, iwm: 6 },
                { ending: '2019-06-10T16:00:00-04:00', z_score: 1.48, spy: -49, qqq: 34, dia: 26, iwm: 4 },
                { ending: '2019-06-11T16:00:00-04:00', z_score: 1.3, spy: -43, qqq: 30, dia: 23, iwm: 3 },
                { ending: '2019-06-12T16:00:00-04:00', z_score: 1.52, spy: -51, qqq: 35, dia: 27, iwm: 3 },
                { ending: '2019-06-13T16:00:00-04:00', z_score: 1.27, spy: -42, qqq: 29, dia: 23, iwm: 2 },
                { ending: '2019-06-14T16:00:00-04:00', z_score: 1.42, spy: -47, qqq: 33, dia: 25, iwm: 3 },
                { ending: '2019-06-17T16:00:00-04:00', z_score: 0.82, spy: -27, qqq: 19, dia: 15, iwm: 1 },
                { ending: '2019-06-18T16:00:00-04:00', z_score: 0.16, spy: -5, qqq: 4, dia: 3, iwm: 0 },
                { ending: '2019-06-19T16:00:00-04:00', z_score: 0.14, spy: -5, qqq: 3, dia: 3, iwm: 0 },
                { ending: '2019-06-20T16:00:00-04:00', z_score: 0.25, spy: -8, qqq: 6, dia: 5, iwm: 0 },
                { ending: '2019-06-21T16:00:00-04:00', z_score: -0.53, spy: 18, qqq: -12, dia: -10, iwm: -1 },
                { ending: '2019-06-24T16:00:00-04:00', z_score: -0.59, spy: 20, qqq: -14, dia: -11, iwm: -1 },
                { ending: '2019-06-25T16:00:00-04:00', z_score: -0.3, spy: 10, qqq: -7, dia: -6, iwm: -0 },
                { ending: '2019-06-26T16:00:00-04:00', z_score: -0.96, spy: 32, qqq: -22, dia: -18, iwm: -1 },
                { ending: '2019-06-27T16:00:00-04:00', z_score: -0.65, spy: 22, qqq: -15, dia: -12, iwm: -1 },
                { ending: '2019-06-28T16:00:00-04:00', z_score: -0.06, spy: 2, qqq: -1, dia: -1, iwm: -0 }
            ]);
        } finally {
            await quote.close();
            await fetch.close();
        }
    });
    it("should be consistent regression between interest dividends", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'PSACSAV', market: 'basket19', security_type: 'STK',
                    name: 'PSA CSAV Regression Neutral',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            psa: {symbol:'PSA', market:'TSE'},
                            csav: {symbol:'CSAV', market:'TSE'}
                        },
                        pad_begin: 1,
                        regression_length: 50,
                        dependent: 'psa.adj_close',
                        independents: {
                            constant_offset: '1',
                            csav_coefficient: 'csav.adj_close'
                        },
                        variables: {
                            offset: "PREV('consant_offset') / psa_adj",
                            psa_adj: "psa.close/psa.adj_close",
                            csav_co: "PREV('csav_coefficient') * csav.close/csav.adj_close / psa_adj"
                        },
                        output: {
                            open: 'psa.open - offset - csav.open*csav_co',
                            high: 'psa.high - offset - csav.high*csav_co',
                            low: 'psa.low - offset - csav.low*csav_co',
                            close: 'psa.close - offset - csav.close*csav_co',
                            volume: 'psa.volume - csav.volume',
                            adj_close: 'psa.adj_close - offset - csav.adj_close*csav_co',
                            csav_coefficient: 'csav_co'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                symbol: 'PSACSAV', market: 'basket19',
                interval: 'day',
                begin: '2019-10-01', end: '2019-11-01', tz
            }).should.eventually.be.like([
                { ending: '2019-10-01T16:00:00-04:00', csav_coefficient: 0.98 },
                { ending: '2019-10-02T16:00:00-04:00', csav_coefficient: 0.98 },
                { ending: '2019-10-03T16:00:00-04:00', csav_coefficient: 0.99 },
                { ending: '2019-10-04T16:00:00-04:00', csav_coefficient: 1.00 },
                { ending: '2019-10-07T16:00:00-04:00', csav_coefficient: 1.01 },
                { ending: '2019-10-08T16:00:00-04:00', csav_coefficient: 1.03 },
                { ending: '2019-10-09T16:00:00-04:00', csav_coefficient: 1.03 },
                { ending: '2019-10-10T16:00:00-04:00', csav_coefficient: 1.03 },
                { ending: '2019-10-11T16:00:00-04:00', csav_coefficient: 1.03 },
                { ending: '2019-10-15T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-16T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-17T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-18T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-21T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-22T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-23T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-24T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-25T16:00:00-04:00', csav_coefficient: 1.03 },
                { ending: '2019-10-28T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-29T16:00:00-04:00', csav_coefficient: 1.03 },
                { ending: '2019-10-30T16:00:00-04:00', csav_coefficient: 1.04 },
                { ending: '2019-10-31T16:00:00-04:00', csav_coefficient: 1.04 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("should support DIVIDEND and SPLIT functions", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data'),
                        fetch: {
                            yahoo: {
                                enabled: true
                            }
                        }
                    }
                },
                assets:[{
                    symbol: 'AAPL', market: 'dividends', security_type: 'STK',
                    name: 'AAPL with dividends',
                    trading_hours: "04:00:00 - 20:00:00",
                    liquid_hours: "09:30:00 - 16:00:00",
                    open_time: "09:30:00",
                    security_tz: "America/New_York",
                    currency: "USD",
                    intervals: ['day'],
                    models: [{
                        input: {
                            aapl: {symbol:'AAPL', market:'NASDAQ'}
                        },
                        variables: {
                            adj_price: 'aapl.close/split-dividend',
                            dividend: "DIVIDEND(symbol, 'NASDAQ', aapl.ending, 1, '2014-09-01')",
                            split: "SPLIT(symbol, 'NASDAQ', aapl.ending, '2015-01-01')"
                        },
                        output: {
                            ending: 'aapl.ending',
                            open: 'aapl.open',
                            high: 'aapl.high',
                            low: 'aapl.low',
                            close: 'aapl.close',
                            volume: 'aapl.volume',
                            adj_close: 'ROUND(adj_price,2)',
                            change: "CHANGE(adj_price,PREV('adj_price'))"
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                symbol: 'AAPL', market: 'dividends', interval: 'day',
                begin: '2014-05-01', end: '2014-07-01', tz
            }).should.eventually.be.like([
                { ending: '2014-05-01T16:00:00-04:00', close: 591.480029, adj_close: 83.67, change: 0.24 },
                { ending: '2014-05-02T16:00:00-04:00', close: 592.580023, adj_close: 83.83, change: 0.19 },
                { ending: '2014-05-05T16:00:00-04:00', close: 600.959975, adj_close: 85.02, change: 1.42 },
                { ending: '2014-05-06T16:00:00-04:00', close: 594.410026, adj_close: 84.08, change: -1.1 },
                { ending: '2014-05-07T16:00:00-04:00', close: 592.329976, adj_close: 83.78, change: -0.36 },
                { ending: '2014-05-08T16:00:00-04:00', close: 587.990011, adj_close: 83.63, change: -0.18 },
                { ending: '2014-05-09T16:00:00-04:00', close: 585.540025, adj_close: 83.28, change: -0.42 },
                { ending: '2014-05-12T16:00:00-04:00', close: 592.830014, adj_close: 84.32, change: 1.25 },
                { ending: '2014-05-13T16:00:00-04:00', close: 593.760027, adj_close: 84.45, change: 0.16 },
                { ending: '2014-05-14T16:00:00-04:00', close: 593.86999, adj_close: 84.47, change: 0.02 },
                { ending: '2014-05-15T16:00:00-04:00', close: 588.819994, adj_close: 83.74, change: -0.86 },
                { ending: '2014-05-16T16:00:00-04:00', close: 597.510018, adj_close: 84.98, change: 1.48 },
                { ending: '2014-05-19T16:00:00-04:00', close: 604.590021, adj_close: 85.99, change: 1.19 },
                { ending: '2014-05-20T16:00:00-04:00', close: 604.710022, adj_close: 86.01, change: 0.02 },
                { ending: '2014-05-21T16:00:00-04:00', close: 606.310005, adj_close: 86.24, change: 0.26 },
                { ending: '2014-05-22T16:00:00-04:00', close: 607.269971, adj_close: 86.37, change: 0.16 },
                { ending: '2014-05-23T16:00:00-04:00', close: 614.129999, adj_close: 87.35, change: 1.13 },
                { ending: '2014-05-27T16:00:00-04:00', close: 625.630019, adj_close: 88.99, change: 1.88 },
                { ending: '2014-05-28T16:00:00-04:00', close: 624.010009, adj_close: 88.76, change: -0.26 },
                { ending: '2014-05-29T16:00:00-04:00', close: 635.37999, adj_close: 90.38, change: 1.83 },
                { ending: '2014-05-30T16:00:00-04:00', close: 633.000018, adj_close: 90.04, change: -0.38 },
                { ending: '2014-06-02T16:00:00-04:00', close: 628.650008, adj_close: 89.41, change: -0.69 },
                { ending: '2014-06-03T16:00:00-04:00', close: 637.539987, adj_close: 90.68, change: 1.42 },
                { ending: '2014-06-04T16:00:00-04:00', close: 644.819994, adj_close: 91.72, change: 1.15 },
                { ending: '2014-06-05T16:00:00-04:00', close: 647.349983, adj_close: 92.08, change: 0.39 },
                { ending: '2014-06-06T16:00:00-04:00', close: 645.570023, adj_close: 91.83, change: -0.28 },
                { ending: '2014-06-09T16:00:00-04:00', close: 93.699997, adj_close: 93.3, change: 1.6 },
                { ending: '2014-06-10T16:00:00-04:00', close: 94.25, adj_close: 93.85, change: 0.59 },
                { ending: '2014-06-11T16:00:00-04:00', close: 93.860001, adj_close: 93.46, change: -0.42 },
                { ending: '2014-06-12T16:00:00-04:00', close: 92.290001, adj_close: 91.89, change: -1.68 },
                { ending: '2014-06-13T16:00:00-04:00', close: 91.279999, adj_close: 90.87, change: -1.1 },
                { ending: '2014-06-16T16:00:00-04:00', close: 92.199997, adj_close: 91.79, change: 1.01 },
                { ending: '2014-06-17T16:00:00-04:00', close: 92.080002, adj_close: 91.67, change: -0.13 },
                { ending: '2014-06-18T16:00:00-04:00', close: 92.18, adj_close: 91.77, change: 0.11 },
                { ending: '2014-06-19T16:00:00-04:00', close: 91.860001, adj_close: 91.45, change: -0.35 },
                { ending: '2014-06-20T16:00:00-04:00', close: 90.910004, adj_close: 90.5, change: -1.04 },
                { ending: '2014-06-23T16:00:00-04:00', close: 90.830002, adj_close: 90.41, change: -0.09 },
                { ending: '2014-06-24T16:00:00-04:00', close: 90.279999, adj_close: 89.86, change: -0.61 },
                { ending: '2014-06-25T16:00:00-04:00', close: 90.360001, adj_close: 89.94, change: 0.09 },
                { ending: '2014-06-26T16:00:00-04:00', close: 90.900002, adj_close: 90.48, change: 0.6 },
                { ending: '2014-06-27T16:00:00-04:00', close: 91.980003, adj_close: 91.56, change: 1.19 },
                { ending: '2014-06-30T16:00:00-04:00', close: 92.93, adj_close: 92.51, change: 1.03 }
            ]);
        } finally {
            await fetch.close();
        }
    });
    it("use previous implied volatility to estimate options prices based on underlying", async() => {
        const fetch = new Fetch(merge(config('fetch'), {
            model: {
                enabled: true,
                fetch: {
                    files: {
                        enabled: true,
                        dirname: path.resolve(__dirname, 'data')
                    }
                },
                assets:[{
                    symbol_pattern: '^(SPY|EEM)(   )(......)([CP])(........)$',
                    market: 'OPRA', security_type: 'OPT',
                    intervals: ['day', 'm240', 'm120', 'm60', 'm30'],
                    models: [{
                        input: {
                            call: {symbol_replacement: '$1$2$3C$5'},
                            put: {symbol_replacement: '$1$2$3P$5'},
                            etf: {symbol_replacement: '$1', market: 'ARCA' },
                            irx: {symbol: 'IRX', market: 'CBOE', interval: 'day' }
                        },
                        pad_begin: 80,
                        interval: 'm30',
                        variables: {
                            open: "ROUND(BS(etf.open/split-dividend, strike, dte, iv, rate, right),2)",
                            high: "MAX(IF(call_live,call.high, put_live,put.high), FLOOR(BS(etf.high/split-dividend, strike, dte, iv, rate, right),0.01))",
                            low: "MIN(IF(call_live,call.low, put_live,put.low, etf.high/split), CEILING(BS(etf.low/split-dividend, strike, dte, iv, rate, right),0.01))",
                            close: "live_close OR ROUND(BS(asset_price, strike, dte, iv, rate, right),2)",
                            volume: "IF(call_live,call.volume, put_live,put.volume, 0)",
                            iv: "IF(live_close,live_iv, alt_iv)",
                            live_close: "IF(call_live,call.close, put_live,put.close)",
                            live_iv: "BSIV(live_close, asset_price, strike, dte, rate, right)",
                            alt_iv: "IF(right='C',put_iv/skew, call_iv*skew)",
                            skew: "IF(call.ending!=put.ending OR call.ending!=etf.ending,PREV('skew')) OR put_iv/call_iv",
                            call_iv: "IF(call.ending!=etf.ending,PREV('call_iv')) OR live_call_iv",
                            put_iv: "IF(put.ending!=etf.ending,PREV('put_iv')) OR live_put_iv",
                            live_call_iv: "BSIV(call.close, asset_price, strike, dte, rate, 'C')",
                            live_put_iv: "BSIV(put.close, asset_price, strike, dte, rate, 'P')",
                            call_live: "right='C' AND call.ending=etf.ending",
                            put_live: "right='P' AND put.ending=etf.ending",
                            asset_price: "etf.close/split-dividend",
                            dividend: "DIVIDEND(asset, 'ARCA', etf.ending, rate, symbol, market)",
                            split: "SPLIT(asset, 'ARCA', etf.ending, symbol, market)",
                            asset: "LEFT(symbol,3)",
                            strike: "NUMBERVALUE(RIGHT(symbol,8))/1000",
                            expiry: "`20{LEFT(RIGHT(symbol,15),6)}`",
                            dte: "DAYS(expiry, MAX(call.ending,put.ending))",
                            rate: "irx.close/10",
                            right: "LEFT(RIGHT(symbol,9),1)"
                        },
                        output: {
                            ending: 'etf.ending',
                            open: 'open',
                            high: 'high',
                            low: 'low',
                            close: 'close',
                            volume: 'volume'
                        }
                    }]
                }]
            }
        }));
        try {
            await fetch({
                interval: 'day',
                symbol: 'SPY   200221C00280000', market: 'OPRA',
                begin: '2019-11-01', end: '2019-12-01', tz
            }).should.eventually.be.like([
        { ending: '2019-11-01T16:15:00-04:00', open: 28.78, high: 29.6, low: 28.56, close: 29.58, volume: 2 },
        { ending: '2019-11-04T16:15:00-05:00', open: 31.06, high: 31.19, low: 30.17, close: 30.51, volume: 4 },
        { ending: '2019-11-05T16:15:00-05:00', open: 30.74, high: 31.44, low: 29.98, close: 30.25, volume: 4 },
        { ending: '2019-11-06T16:15:00-05:00', open: 30.33, high: 30.64, low: 29.5, close: 30.39, volume: 13 },
        { ending: '2019-11-07T16:15:00-05:00', open: 31.46, high: 32.38, low: 30.69, close: 31.18, volume: 1 },
        { ending: '2019-11-08T16:15:00-05:00', open: 30.67, high: 31.79, low: 29.64, close: 31.79, volume: 9 },
        { ending: '2019-11-11T16:15:00-05:00', open: 30.35, high: 31.44, low: 30.23, close: 31.03, volume: 23 },
        { ending: '2019-11-12T16:15:00-05:00', open: 31.12, high: 32.6, low: 30.9, close: 31.62, volume: 6 },
        { ending: '2019-11-13T16:15:00-05:00', open: 30.53, high: 31.94, low: 30.32, close: 31.57, volume: 1 },
        { ending: '2019-11-14T16:15:00-05:00', open: 31.31, high: 32.19, low: 30.83, close: 32.1, volume: 7 },
        { ending: '2019-11-15T16:15:00-05:00', open: 33.34, high: 33.8, low: 32.67, close: 33.59, volume: 66 },
        { ending: '2019-11-18T16:15:00-05:00', open: 33.6, high: 34.38, low: 33.05, close: 33.88, volume: 15 },
        { ending: '2019-11-19T16:15:00-05:00', open: 35.01, high: 35.02, low: 33.77, close: 34.38, volume: 8 },
        { ending: '2019-11-20T16:15:00-05:00', open: 33.83, high: 34.32, low: 31.92, close: 33.14, volume: 10 },
        { ending: '2019-11-21T16:15:00-05:00', open: 33.23, high: 33.44, low: 32.03, close: 32.94, volume: 4 },
        { ending: '2019-11-22T16:15:00-05:00', open: 33.61, high: 33.72, low: 32.44, close: 32.82, volume: 22 },
        { ending: '2019-11-25T16:15:00-05:00', open: 33.65, high: 34.95, low: 33.65, close: 34.94, volume: 0 },
        { ending: '2019-11-26T16:15:00-05:00', open: 34.98, high: 35.65, low: 34.66, close: 35.22, volume: 9 },
        { ending: '2019-11-27T16:15:00-05:00', open: 35.79, high: 36.69, low: 35.56, close: 36.66, volume: 21 },
        { ending: '2019-11-29T16:15:00-05:00', open: 36.08, high: 36.34, low: 35.31, close: 35.71, volume: 0 }
            ]);
        } finally {
            await fetch.close();
        }
    });
});

function printEach(d) {
    d.forEach(d=>console.log(require('util').inspect(d,{breakLength:Infinity})));
    return d;
}
