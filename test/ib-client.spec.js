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
        client = await IB({port:7496});
        return client.open().catch(err => {
            client = null;
            this.skip();
        });
    });
    after(function() {
        if (client) return client.close();
    });
    it.skip("options SPY lookup", async() => {
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
    it.skip("options SPX lookup", function() {
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
            moment.tz('2014-02-01 17:00:00', tz).utc().format('YYYYMMDD-HH:mm:ss'), // endDateTime
            '1 M', // durationString
            '1 day', // barSizeSetting
            'MIDPOINT', // whatToShow
            1, // useRTH
            1, // formatDate {1: yyyyMMdd HH:mm:ss, 2: epoc seconds}
        ).should.eventually.be.like([
            {time:"20140102",open:1.0647,high:1.0678,low:1.05885,close:1.06695},
            {time:"20140103",open:1.0649,high:1.0672,low:1.0603,close:1.0635},
            {time:"20140106",open:1.0636,high:1.0681,low:1.0609,close:1.06555},
            {time:"20140107",open:1.0657,high:1.0782,low:1.06526,close:1.0766},
            {time:"20140108",open:1.0766,high:1.083,low:1.0762,close:1.082},
            {time:"20140109",open:1.0823,high:1.0875,low:1.0819,close:1.0842},
            {time:"20140110",open:1.0845,high:1.0947,low:1.08375,close:1.0894},
            {time:"20140113",open:1.0907,high:1.09296,low:1.0843,close:1.0862},
            {time:"20140114",open:1.0861,high:1.0959,low:1.086,close:1.0946},
            {time:"20140115",open:1.095,high:1.0991,low:1.092,close:1.0934},
            {time:"20140116",open:1.0941,high:1.0963,low:1.0905,close:1.093},
            {time:"20140117",open:1.0931,high:1.0984,low:1.0926,close:1.0964},
            {time:"20140120",open:1.0966,high:1.0972,low:1.093,close:1.0948},
            {time:"20140121",open:1.0944,high:1.1019,low:1.0943,close:1.0967},
            {time:"20140122",open:1.0966,high:1.1092,low:1.0954,close:1.10875},
            {time:"20140123",open:1.10895,high:1.1174,low:1.1083,close:1.1102},
            {time:"20140124",open:1.1104,high:1.11375,low:1.1052,close:1.1087},
            {time:"20140127",open:1.10675,high:1.1117,low:1.1032,close:1.1115},
            {time:"20140128",open:1.1118,high:1.1177,low:1.1079,close:1.11525},
            {time:"20140129",open:1.1146,high:1.1187,low:1.1102,close:1.11705},
            {time:"20140130",open:1.1168,high:1.1199,low:1.1151,close:1.1158},
            {time:"20140131",open:1.1162,high:1.1224,low:1.1088,close:1.1129}
        ]);
    });
    it("should return weekly", function() {
        return client.reqHistoricalData({
                localSymbol: 'USD.CAD',
                secType: 'CASH',
                exchange: 'IDEALPRO'
            },
            moment.tz('2014-02-01 17:00:00', tz).utc().format('YYYYMMDD-HH:mm:ss'), // endDateTime
            '1 M', // durationString
            '1 week', // barSizeSetting
            'MIDPOINT', // whatToShow
            1, // useRTH
            1, // formatDate {1: yyyyMMdd HH:mm:ss, 2: epoc seconds}
        ).should.eventually.be.like([
            {time:"20140103",open:1.0647,high:1.0678,low:1.05885,close:1.0635},
            {time:"20140110",open:1.0636,high:1.0947,low:1.0609,close:1.0894},
            {time:"20140117",open:1.0907,high:1.0991,low:1.0843,close:1.0964},
            {time:"20140124",open:1.0966,high:1.1174,low:1.093,close:1.1087},
            {time:"20140131",open:1.10675,high:1.1225,low:1.1032,close:1.1129}
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
            moment.tz('2014-03-03 17:00:00', tz).utc().format('YYYYMMDD-HH:mm:ss'), // endDateTime
            `${9*60*60} S`, // durationString
            '30 mins', // barSizeSetting
            'MIDPOINT', // whatToShow
            1, // useRTH
            2, // formatDate {1: yyyyMMdd HH:mm:ss {TMZ}, 2: epoc seconds}
        ).should.eventually.be.like([
            {time:1393851600,open:1.1098,high:1.1102,low:1.1093,close:1.1102},
            {time:1393853400,open:1.1102,high:1.1102,low:1.1088,close:1.1089},
            {time:1393855200,open:1.1089,high:1.1092,low:1.1082,close:1.10835},
            {time:1393857000,open:1.10835,high:1.1096,low:1.10835,close:1.10945},
            {time:1393858800,open:1.10945,high:1.11005,low:1.1081,close:1.1083},
            {time:1393860600,open:1.1083,high:1.1083,low:1.10705,close:1.108},
            {time:1393862400,open:1.108,high:1.10975,low:1.1079,close:1.10865},
            {time:1393864200,open:1.10865,high:1.1094,low:1.1084,close:1.1091},
            {time:1393866000,open:1.1091,high:1.1094,low:1.1081,close:1.1085},
            {time:1393867800,open:1.1085,high:1.11005,low:1.1079,close:1.11005},
            {time:1393869600,open:1.11005,high:1.1101,low:1.1096,close:1.1098},
            {time:1393871400,open:1.1098,high:1.1098,low:1.1088,close:1.1096},
            {time:1393873200,open:1.1096,high:1.1096,low:1.1082,close:1.1086},
            {time:1393875000,open:1.1086,high:1.1086,low:1.1076,close:1.10845},
            {time:1393876800,open:1.10845,high:1.10845,low:1.1078,close:1.10805},
            {time:1393878600,open:1.10805,high:1.10845,low:1.1075,close:1.1084},
            {time:1393880400,open:1.1084,high:1.10855,low:1.1076,close:1.1077},
            {time:1393882200,open:1.1077,high:1.108,low:1.1074,close:1.1076}
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
