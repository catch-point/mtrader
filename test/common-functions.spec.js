// common-functions.spec.js
/*
 *  Copyright (c) 2014-2017 James Leigh, Some Rights Reserved
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
const common = require('../src/common-functions.js');
const Parser = require('../src/parser.js');
const expect = require('chai').expect;

describe("common-functions", function(){
    describe("parser", function() {
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        it("ADD", function() {
            expect(parser.parse('1 + 1')()).to.equal(2);
        });
        it("SUBTRACT", function() {
            expect(parser.parse('2 - 1 - 1')()).to.equal(0);
        });
        it("PRODUCT", function() {
            expect(parser.parse('-4.2 * (2 + 3.5)')()).to.equal(-23.1);
        });
        it("DIVIDE", function() {
            expect(parser.parse('5 × 5 / (2 + 3) / 5')()).to.equal(1);
        });
        it("MOD", function() {
            expect(parser.parse('6 % 5')()).to.equal(1);
        });
        it("NEGATIVE", function() {
            expect(parser.parse('5 × -(2 + 3)')()).to.equal(-25);
        });
        it("ABS", function() {
            expect(parser.parse('ABS(5 × -(2 + 3))')()).to.equal(25);
        });
        it("EQUALS", function() {
            expect(parser.parse('2 = 2')()).to.equal(1);
        });
        it("NOT_EQUALS", function() {
            expect(parser.parse('2 != 2')()).to.equal(0);
        });
        it("NOT", function() {
            expect(parser.parse('!(2 = 2)')()).to.equal(0);
        });
        it("NOT_EQUALS", function() {
            expect(parser.parse('2 <> 2')()).to.equal(0);
        });
        it("LESS_THAN", function() {
            expect(parser.parse('1 < 2')()).to.equal(1);
        });
        it("GREATER_THAN", function() {
            expect(parser.parse('1 > 2')()).to.equal(0);
        });
        it("NOT_LESS_THAN", function() {
            expect(parser.parse('1 >= 2')()).to.equal(0);
        });
        it("NOT_GREATER_THAN", function() {
            expect(parser.parse('1 <= 2')()).to.equal(1);
        });
        it("SIGN0", function() {
            expect(parser.parse('SIGN(5)')()).to.equal(1);
        });
        it("SIGN1", function() {
            expect(parser.parse('SIGN(0)')()).to.equal(0);
        });
        it("SIGN2", function() {
            expect(parser.parse('SIGN(-5)')()).to.equal(-1);
        });
        it("AND0", function() {
            expect(parser.parse('1 and 1 and 0')()).to.equal(0);
        });
        it("AND1", function() {
            expect(parser.parse('AND(1, 1, 0)')()).to.equal(0);
        });
        it("OR0", function() {
            expect(parser.parse('1 or 1 or 0')()).to.equal(1);
        });
        it("OR1", function() {
            expect(parser.parse('OR(1, 1, 0)')()).to.equal(1);
        });
        it("XOR0", function() {
            expect(parser.parse('XOR(1, 1, 0)')()).to.equal(0);
        });
        it("XOR1", function() {
            expect(parser.parse('XOR(1, 1, 0, 1)')()).to.equal(1);
        });
    });
    describe("WORKDATE", function(){
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var DAY = parser.parse('DAY(day.ending)');
        var MONTH = parser.parse('MONTH(day.ending)');
        var YEAR = parser.parse('YEAR(day.ending)');
        var WORKDAY0 = parser.parse('WORKDAY(day.ending,0)');
        var WORKDAY1 = parser.parse('WORKDAY(day.ending,1)');
        var WORKDAY2 = parser.parse('WORKDAY(day.ending,2)');
        var WORKDAY4 = parser.parse('WORKDAY(day.ending,4)');
        var WORKDAY5 = parser.parse('WORKDAY(day.ending,5)');
        var WORKDAY_1 = parser.parse('WORKDAY(day.ending,-1)');
        var WORKDAY_2 = parser.parse('WORKDAY(day.ending,-2)');
        var WORKDAY_4 = parser.parse('WORKDAY(day.ending,-4)');
        var WORKDAY_5 = parser.parse('WORKDAY(day.ending,-5)');
        var WORKDAY_6 = parser.parse('WORKDAY(day.ending,-6)');
        it("DAY0", function(){
            expect(
                DAY({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(18);
        });
        it("MONTH0", function(){
            expect(
                MONTH({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(7);
        });
        it("YEAR", function(){
            expect(
                YEAR({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(2015);
        });
        it("WORKDAY0", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-19T00:00:00-04:00"})
            );
            expect(
                WORKDAY0({"day.ending":"2015-07-19T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-17T00:00:00-04:00"})
            );
            expect(
                WORKDAY0({"day.ending":"2015-07-18T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-17T00:00:00-04:00"})
            );
        });
        it("WORKDAY1", function(){
            expect(
                WORKDAY1({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-17T00:00:00-04:00"})
            );
        });
        it("WORKDAY-1", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY1({"day.ending":"2015-07-15T00:00:00-04:00"})
            );
        });
        it("WORKDAY_1", function(){
            expect(
                WORKDAY_1({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-15T00:00:00-04:00"})
            );
        });
        it("WORKDAY2", function(){
            expect(
                WORKDAY2({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-20T00:00:00-04:00"})
            );
        });
        it("WORKDAY-2", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY2({"day.ending":"2015-07-14T00:00:00-04:00"})
            );
        });
        it("WORKDAY_2", function(){
            expect(
                WORKDAY_2({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-14T00:00:00-04:00"})
            );
        });
        it("WORKDAY4", function(){
            expect(
                WORKDAY4({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-22T00:00:00-04:00"})
            );
        });
        it("WORKDAY-4", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY4({"day.ending":"2015-07-10T00:00:00-04:00"})
            );
        });
        it("WORKDAY_4", function(){
            expect(
                WORKDAY_4({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-10T00:00:00-04:00"})
            );
        });
        it("WORKDAY5", function(){
            expect(
                WORKDAY5({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-23T00:00:00-04:00"})
            );
        });
        it("WORKDAY-5", function(){
            expect(
                WORKDAY0({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY5({"day.ending":"2015-07-09T00:00:00-04:00"})
            );
        });
        it("WORKDAY_5", function(){
            expect(
                WORKDAY_5({"day.ending":"2015-07-16T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-09T00:00:00-04:00"})
            );
        });
        it("WORKDAY_6", function(){
            expect(
                WORKDAY_6({"day.ending":"2015-07-17T00:00:00-04:00"})
            ).to.equal(
                WORKDAY0({"day.ending":"2015-07-09T00:00:00-04:00"})
            );
        });
    });
    describe("NETWORKDAYS", function(){
        var parser = Parser({
            constant(value) {
                return () => value;
            },
            variable(name) {
                return context => context[name];
            },
            expression(expr, name, args) {
                return common(name, args, {tz: 'America/New_York'});
            }
        });
        var NETWORKDAYS = parser.parse('NETWORKDAYS(from, to)');
        it("NETWORKDAYS", function() {
            expect(NETWORKDAYS({
                from: "2012-10-01",
                to: "2013-03-01"
            })).to.equal(110);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-01"
            })).to.equal(1);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-02"
            })).to.equal(1);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-03"
            })).to.equal(1);
            expect(NETWORKDAYS({
                from: "2016-01-01",
                to: "2016-01-04"
            })).to.equal(2);
        });
        it("NETWORKDAYS0", function() {
            expect(NETWORKDAYS({
                from: "2015-07-18T00:00:00-04:00",
                to: "2015-07-19T00:00:00-04:00"
            })).to.equal(0);
        });
        it("NETWORKDAYS2", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-17T00:00:00-04:00"
            })).to.equal(2);
        });
        it("NETWORKDAYS3", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-20T00:00:00-04:00"
            })).to.equal(3);
        });
        it("NETWORKDAYS5", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-22T00:00:00-04:00"
            })).to.equal(5);
        });
        it("NETWORKDAYS6", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-23T00:00:00-04:00"
            })).to.equal(6);
        });
        it("NETWORKDAYS-1", function() {
            expect(NETWORKDAYS({
                from: "2015-07-19T00:00:00-04:00",
                to: "2015-07-17T00:00:00-04:00"
            })).to.equal(-1);
            expect(NETWORKDAYS({
                from: "2015-07-18T00:00:00-04:00",
                to: "2015-07-17T00:00:00-04:00"
            })).to.equal(-1);
        });
        it("NETWORKDAYS-2", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-15T00:00:00-04:00"
            })).to.equal(-2);
        });
        it("NETWORKDAYS-3", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-14T00:00:00-04:00"
            })).to.equal(-3);
        });
        it("NETWORKDAYS-5", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-10T00:00:00-04:00"
            })).to.equal(-5);
        });
        it("NETWORKDAYS-6", function(){
            expect(NETWORKDAYS({
                from: "2015-07-16T00:00:00-04:00",
                to: "2015-07-09T00:00:00-04:00"
            })).to.equal(-6);
        });
    });
});
