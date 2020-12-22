// ib-client.spec.js
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
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const IB = require('../src/ib-client.js');

describe("ib-client", function() {
    this.timeout(60000);
    var tz = 'America/New_York';
    var client;
    before(async function() {
        client = await IB();
        return client.open().catch(err => {
            client = null;
            this.skip();
        });
    });
    after(function() {
        if (client) return client.close();
    });
    it("options SPY lookup", async() => {
        const details = await client.reqContractDetails({
            localSymbol:'SPY   211217C00280000',
            currency:'USD',
            secType:'OPT',
            exchange:'SMART'
        });
        details.should.be.like(results => _.some(results, like({
            contract: {
                symbol: 'SPY',
                secType: 'OPT',
                strike: '280.0',
                right: 'Call',
                exchange: 'SMART',
                currency: 'USD',
                localSymbol: 'SPY   211217C00280000',
                tradingClass: 'SPY',
                multiplier: '100'
            },
            marketName: 'SPY',
            minTick: 0.01,
            longName: 'SPDR S&P 500 ETF TRUST',
            contractMonth: '202112'
        })));
    });
    it("options SPX lookup", function() {
        return client.reqContractDetails({
            localSymbol:'SPX   211217C02800000',
            currency:'USD',
            secType:'OPT',
            exchange:'SMART'
        }).should.eventually.be.like(results => _.some(results, like({
            contract: {
                symbol: 'SPX',
                secType: 'OPT',
                strike: '2800.0',
                right: 'Call',
                exchange: 'SMART',
                currency: 'USD',
                localSymbol: 'SPX   211217C02800000',
                tradingClass: 'SPX',
                multiplier: '100'
            },
            minTick: 0.05,
            longName: 'S&P 500 Stock Index',
            contractMonth: '202112'
        })));
    });
    it("index NDX lookup", function() {
        return client.reqContractDetails({
            localSymbol:'NDX',
            currency:'USD',
            secType:'IND'
        }).should.eventually.be.like([{
            contract: {
                symbol: 'NDX',
                secType: 'IND',
                currency: 'USD',
                localSymbol: 'NDX'
            },
            minTick: 0.01,
            longName: 'NASDAQ 100 Stock Index'
        }]);
    });
    it.skip("options ES options lookup", function() {
        return client.reqContractDetails({
            localSymbol:'ESM9 P2625',
            strike:'2625',
            right:'P',
            currency:'USD',
            secType:'FOP',
            exchange:'GLOBEX'
        }).then(d=>d.forEach(d=>console.log(d))||d);
    });
    it("should find IBM", function() {
        return client.reqContractDetails({
            localSymbol:'IBM',
            primaryExch: 'NYSE',
            currency:'USD',
            secType:'STK',
            exchange:'SMART'
        }).should.eventually.be.like(results => _.some(results, like({
            contract: {
                symbol: 'IBM',
                secType: 'STK',
                currency: 'USD',
                localSymbol: 'IBM',
                primaryExch: 'NYSE'
            },
            marketName: 'IBM',
            longName: 'INTL BUSINESS MACHINES CORP',
            industry: 'Technology',
            category: 'Computers',
            subcategory: 'Computer Services'
        })));
    });
    it("should find USD.CAD", function() {
        return client.reqContractDetails({
            localSymbol: 'USD.CAD',
            secType: 'CASH'
        }).should.eventually.be.like(results => _.some(results, like({
            contract: {
                symbol: 'USD',
                secType: 'CASH',
                exchange: 'IDEALPRO',
                currency: 'CAD',
                localSymbol: 'USD.CAD',
                tradingClass: 'USD.CAD'
            },
            marketName: 'USD.CAD',
            minTick: 0.00005
        })));
    });
    it("should find USD.CAD contract", async function() {
        const conId = 15016062;
        return client.reqContract(conId).should.eventually.be.like({
            conid: conId,
            symbol: 'USD',
            secType: 'CASH',
            exchange: 'IDEALPRO',
            currency: 'CAD',
            localSymbol: 'USD.CAD',
            tradingClass: 'USD.CAD'
        });
    });
    it("should return daily", function() {
        return client.reqHistoricalData({
                localSymbol: 'USD.CAD',
                secType: 'CASH',
                exchange: 'IDEALPRO'
            },
            '20140201 17:00:00', // endDateTime
            '1 M', // durationString
            '1 day', // barSizeSetting
            'MIDPOINT', // whatToShow
            1, // useRTH
            1, // formatDate {1: yyyyMMdd HH:mm:ss, 2: epoc seconds}
        ).should.eventually.be.like([
            {time:"20140102",open:1.06471,high:1.067815,low:1.058845,close:1.066945},
            {time:"20140103",open:1.0649,high:1.06719,low:1.06026,close:1.063505},
            {time:"20140106",open:1.0636,high:1.06807,low:1.060885,close:1.065555},
            {time:"20140107",open:1.065725,high:1.078175,low:1.06526,close:1.076635},
            {time:"20140108",open:1.07656,high:1.08304,low:1.076205,close:1.082015},
            {time:"20140109",open:1.082325,high:1.087475,low:1.081915,close:1.084235},
            {time:"20140110",open:1.084495,high:1.094695,low:1.08375,close:1.089435},
            {time:"20140113",open:1.090725,high:1.092965,low:1.084275,close:1.08624},
            {time:"20140114",open:1.08611,high:1.09592,low:1.086005,close:1.094615},
            {time:"20140115",open:1.09502,high:1.09913,low:1.092035,close:1.093425},
            {time:"20140116",open:1.094115,high:1.09631,low:1.09051,close:1.09301},
            {time:"20140117",open:1.0931,high:1.09839,low:1.092625,close:1.096375},
            {time:"20140120",open:1.0966,high:1.097225,low:1.092985,close:1.0948},
            {time:"20140121",open:1.0944,high:1.101885,low:1.094285,close:1.09669},
            {time:"20140122",open:1.0966,high:1.10923,low:1.095375,close:1.10875},
            {time:"20140123",open:1.108955,high:1.117375,low:1.108295,close:1.110165},
            {time:"20140124",open:1.110385,high:1.113755,low:1.10519,close:1.10871},
            {time:"20140127",open:1.10675,high:1.111695,low:1.103185,close:1.11152},
            {time:"20140128",open:1.111825,high:1.117725,low:1.10786,close:1.115255},
            {time:"20140129",open:1.1146,high:1.118705,low:1.110275,close:1.11705},
            {time:"20140130",open:1.11682,high:1.119915,low:1.11508,close:1.11582},
            {time:"20140131",open:1.11623,high:1.122465,low:1.108795,close:1.112925}
        ]);
    });
    it("should return weekly", function() {
        return client.reqHistoricalData({
                localSymbol: 'USD.CAD',
                secType: 'CASH',
                exchange: 'IDEALPRO'
            },
            '20140201 17:00:00', // endDateTime
            '1 M', // durationString
            '1 week', // barSizeSetting
            'MIDPOINT', // whatToShow
            1, // useRTH
            1, // formatDate {1: yyyyMMdd HH:mm:ss, 2: epoc seconds}
        ).should.eventually.be.like([
            {time:"20140103",open:1.06471,high:1.067815,low:1.058845,close:1.063505},
            {time:"20140110",open:1.0636,high:1.094695,low:1.060885,close:1.089435},
            {time:"20140117",open:1.090725,high:1.09913,low:1.084275,close:1.096375},
            {time:"20140124",open:1.0966,high:1.117375,low:1.092985,close:1.10871},
            {time:"20140131",open:1.10675,high:1.122465,low:1.103185,close:1.112925}
        ]);
    });
    it("should find BRK.A symbol", function() {
        return client.reqContractDetails({
            localSymbol:'BRK A',
            primaryExch: 'NYSE',
            currency:'USD',
            secType:'STK',
            exchange:'SMART'
        }).should.eventually.be.like(results => _.some(results, like({
            contract: {
                symbol: 'BRK A',
                secType: 'STK',
                currency: 'USD',
                localSymbol: 'BRK A',
                primaryExch: 'NYSE'
            },
            marketName: 'BRK A',
            longName: 'BERKSHIRE HATHAWAY INC-CL A',
            industry: 'Financial',
            category: 'Insurance',
            subcategory: 'Property/Casualty Ins'
        })));
    });
    it("should return 30 minute intervals", function() {
        return client.reqHistoricalData({
                localSymbol: 'USD.CAD',
                secType: 'CASH',
                exchange: 'IDEALPRO'
            },
            '20140303 17:00:00', // endDateTime
            `${9*60*60} S`, // durationString
            '30 mins', // barSizeSetting
            'MIDPOINT', // whatToShow
            1, // useRTH
            1, // formatDate {1: yyyyMMdd HH:mm:ss, 2: epoc seconds}
        ).should.eventually.be.like([
            {time:"20140303  08:00:00",open:1.109775,high:1.110225,low:1.109365,close:1.110165},
            {time:"20140303  08:30:00",open:1.110165,high:1.110245,low:1.10876,close:1.108905},
            {time:"20140303  09:00:00",open:1.108905,high:1.1092175,low:1.1082225,close:1.108355},
            {time:"20140303  09:30:00",open:1.108355,high:1.1095975,low:1.108355,close:1.109455},
            {time:"20140303  10:00:00",open:1.109455,high:1.1100475,low:1.1080925,close:1.10828},
            {time:"20140303  10:30:00",open:1.10828,high:1.1083125,low:1.107045,close:1.1080075},
            {time:"20140303  11:00:00",open:1.1080075,high:1.1097475,low:1.107895,close:1.10864},
            {time:"20140303  11:30:00",open:1.10864,high:1.10941,low:1.1083725,close:1.1091275},
            {time:"20140303  12:00:00",open:1.1091275,high:1.109415,low:1.1080725,close:1.108525},
            {time:"20140303  12:30:00",open:1.108525,high:1.1100425,low:1.1079375,close:1.1100425},
            {time:"20140303  13:00:00",open:1.1100425,high:1.110115,low:1.1096175,close:1.10977},
            {time:"20140303  13:30:00",open:1.10977,high:1.109815,low:1.1087775,close:1.1095675},
            {time:"20140303  14:00:00",open:1.1095675,high:1.1095775,low:1.108185,close:1.10856},
            {time:"20140303  14:30:00",open:1.10856,high:1.108595,low:1.107575,close:1.10844},
            {time:"20140303  15:00:00",open:1.10844,high:1.108455,low:1.107795,close:1.108055},
            {time:"20140303  15:30:00",open:1.108055,high:1.1084425,low:1.10747,close:1.1084325},
            {time:"20140303  16:00:00",open:1.1084325,high:1.108545,low:1.10759,close:1.1076925},
            {time:"20140303  16:30:00",open:1.1076925,high:1.108015,low:1.1074225,close:1.1076275}
        ]);
    });
    it("should support reqMktData on USD.CAD", function() {
        return client.reqMktData({
            localSymbol: 'USD.CAD',
            secType: 'CASH',
            exchange: 'IDEALPRO'
        });
    });
    it.skip("should support reqRealTimeBars on USD.CAD", function() {
        return client.reqRealTimeBars({
                localSymbol: 'USD.CAD',
                secType: 'CASH',
                exchange: 'IDEALPRO'
            },
            'MIDPOINT'
        ).then(d=>console.log(d)||d);
    });
    it.skip("should support reqMktData for dividends", function() {
        return client.reqMktData({
            localSymbol: 'PNC',
            secType: 'STK',
            exchange: 'NYSE',
            currency: 'USD'
        }, ['ib_dividends']).should.eventually.have.property('ib_dividends');
    });
    it("should support reqManagedAccts", function() {
        return client.reqManagedAccts().should.eventually.be.like(_.isArray);
    });
    it("should support reqAccountUpdate", function() {
        return client.reqAccountUpdate('All').should.eventually.be.like({Currency:_.isArray});
    });
    it("should support reqPositions", function() {
        return client.reqPositions().should.eventually.be.an('object');
    });
    it("should support reqPositionsMulti", async() => {
        const accts = await client.reqManagedAccts();
        const acct = accts[accts.length-1];
        return client.reqPositionsMulti(acct).should.eventually.have.property(acct);
    });
    it("should support accountSummary", function() {
        return client.reqAccountSummary('All').should.eventually.be.like({All:{Currency:_.isArray}});
    });
    it.skip("should support reqMktData on option", function() {
        this.timeout(100000);
        return client.reqMktData({
            localSymbol: 'SPX   190719C02925000',
            secType: 'OPT',
            exchange: 'SMART',
            currency: 'USD'
        }).then(d=>console.log(d)||d);
    });
    it.skip("should support reqRealTimeBars on option", function() {
        this.timeout(100000);
        return client.reqRealTimeBars({
                localSymbol: 'SPX   190719C02925000',
                secType: 'OPT',
                exchange: 'SMART',
                currency: 'USD'
            },
            'MIDPOINT'
        ).then(d=>console.log(d)||d);
    });
    it.skip("should return 30 minute intervals on option", function() {
        return client.reqHistoricalData({
                localSymbol: 'SPX   190719C02925000',
                secType: 'OPT',
                exchange: 'SMART',
                currency: 'USD'
            },
            '', // endDateTime
            `${1*60*60} S`, // durationString
            '30 mins', // barSizeSetting
            'MIDPOINT', // whatToShow
            0, // useRTH
            1, // formatDate {1: yyyyMMdd HH:mm:ss, 2: epoc seconds}
        ).then(d=>console.log(d)||d);
    });
    it.skip("should calculateImpliedVolatility", function() {
        return client.calculateImpliedVolatility({
            localSymbol: 'SPX   190621C02900000',
            secType: 'OPT',
            exchange: 'SMART',
            currency: 'USD'
        }, 53.80, 2888.30).then(d=>console.log(d)||d);
    });
    it.skip("should calculateOptionPrice", function() {
        return client.calculateOptionPrice({
            localSymbol: 'SPX   190621C02900000',
            secType: 'OPT',
            exchange: 'SMART',
            currency: 'USD'
        }, 0.1152, 2888.30).then(d=>console.log(d)||d);
    });
    it("should reqExecutions", function() {
        return client.reqExecutions();
    });
    it("should reqCurrentTime", async() => {
        const time = await client.reqCurrentTime();
        (+time).should.be.closeTo(Math.round(new Date().getTime()/1000),5);
    });
    it.skip("should reqFundamentalData", function() {
        return client.reqFundamentalData({
            localSymbol: 'SPY',
            secType: 'STK',
            exchange: 'NYSE',
            currency: 'USD'
        }, 'ReportsFinSummary').should.eventually.have.property('FinancialSummary');
        //.then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:10,breakLength:100}))||d);
    });
    it.skip("should requestFA Groups", function() {
        return client.requestGroups().should.eventually.be.an('array');
    });
    it.skip("should requestFA Profiles", function() {
        return client.requestProfiles().should.eventually.be.an('array');
    });
    it.skip("should requestFA Aliases", function() {
        return client.requestAliases().should.eventually.be.an('array');
    });
    it.skip("should reqOpenOrders", function() {
        return client.reqOpenOrders().then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:10,breakLength:100}))||d).should.eventually.be.an('array');
    });
    it.skip("should placeOrder", async() => {
        const contract = {
            localSymbol: 'SPY',
            secType: 'STK',
            exchange: 'NYSE',
            currency: 'USD'
        };
        const order = {
            account: 'Hedged',
            action: 'BUY',
            tif: 'DAY',
            orderType: 'LMT',
            totalQuantity: 1,
            lmtPrice: 270,
            transmit: false
        };
        const placed = await client.placeOrder(await client.reqId(), contract, order).then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:10,breakLength:100}))||d);
        await client.cancelOrder(placed.orderId).then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:10,breakLength:100}))||d);
    });
});
