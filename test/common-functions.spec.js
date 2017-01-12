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
const expressions = require('../src/expressions.js');
const expect = require('chai').expect;

describe("expressions", function(){
    var fields = {day:[]};
    describe("parser", function() {
        it("ADD", function() {
            expect(expressions.parse('1 + 1', fields)()).to.equal(2);
        });
        it("SUBTRACT", function() {
            expect(expressions.parse('2 - 1 - 1', fields)()).to.equal(0);
        });
        it("PRODUCT", function() {
            expect(expressions.parse('-4.2 * (2 + 3.5)', fields)()).to.equal(-23.1);
        });
        it("DIVIDE", function() {
            expect(expressions.parse('5 × 5 / (2 + 3) / 5', fields)()).to.equal(1);
        });
        it("MOD", function() {
            expect(expressions.parse('6 % 5', fields)()).to.equal(1);
        });
        it("NEGATIVE", function() {
            expect(expressions.parse('5 × -(2 + 3)', fields)()).to.equal(-25);
        });
        it("ABS", function() {
            expect(expressions.parse('ABS(5 × -(2 + 3))', fields)()).to.equal(25);
        });
        it("EQUALS", function() {
            expect(expressions.parse('2 = 2', fields)()).to.equal(1);
        });
        it("NOT_EQUALS", function() {
            expect(expressions.parse('2 != 2', fields)()).to.equal(0);
        });
        it("NOT", function() {
            expect(expressions.parse('!(2 = 2)', fields)()).to.equal(0);
        });
        it("NOT_EQUALS", function() {
            expect(expressions.parse('2 <> 2', fields)()).to.equal(0);
        });
        it("LESS_THAN", function() {
            expect(expressions.parse('1 < 2', fields)()).to.equal(1);
        });
        it("GREATER_THAN", function() {
            expect(expressions.parse('1 > 2', fields)()).to.equal(0);
        });
        it("NOT_LESS_THAN", function() {
            expect(expressions.parse('1 >= 2', fields)()).to.equal(0);
        });
        it("NOT_GREATER_THAN", function() {
            expect(expressions.parse('1 <= 2', fields)()).to.equal(1);
        });
        it("SIGN0", function() {
            expect(expressions.parse('SIGN(5)', fields)()).to.equal(1);
        });
        it("SIGN1", function() {
            expect(expressions.parse('SIGN(0)', fields)()).to.equal(0);
        });
        it("SIGN2", function() {
            expect(expressions.parse('SIGN(-5)', fields)()).to.equal(-1);
        });
        it("AND0", function() {
            expect(expressions.parse('1 and 1 and 0', fields)()).to.equal(0);
        });
        it("AND1", function() {
            expect(expressions.parse('AND(1, 1, 0)', fields)()).to.equal(0);
        });
        it("OR0", function() {
            expect(expressions.parse('1 or 1 or 0', fields)()).to.equal(1);
        });
        it("OR1", function() {
            expect(expressions.parse('OR(1, 1, 0)', fields)()).to.equal(1);
        });
        it("XOR0", function() {
            expect(expressions.parse('XOR(1, 1, 0)', fields)()).to.equal(0);
        });
        it("XOR1", function() {
            expect(expressions.parse('XOR(1, 1, 0, 1)', fields)()).to.equal(1);
        });
    });
    describe("DATE", function(){
        var day = {interval:'day', tz: 'America/New_York'};
        var DAY = expressions.parse('DAY(day.ending)', {day:['ending']}, day);
        var MONTH = expressions.parse('MONTH(day.ending)', {day:['ending']}, day);
        var YEAR = expressions.parse('YEAR(day.ending)', {day:['ending']}, day);
        var WORKDAY = expressions.parse('WORKDAY(day.ending)', {day:['ending']}, day);
        it("DAY0", function(){
            expect(
                DAY([{day:{ending:"2015-07-18T00:00:00-04:00"}}])
            ).to.equal(18);
        });
        it("MONTH0", function(){
            expect(
                MONTH([{day:{ending:"2015-07-18T00:00:00-04:00"}}])
            ).to.equal(7);
        });
        it("YEAR", function(){
            expect(
                YEAR([{day:{ending:"2015-07-18T00:00:00-04:00"}}])
            ).to.equal(2015);
        });
        it("WORKDAY0", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-18T00:00:00-04:00"}}])
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-19T00:00:00-04:00"}}])
            );
            expect(
                WORKDAY([{day:{ending:"2015-07-19T00:00:00-04:00"}}])
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-20T00:00:00-04:00"}}])
            );
            expect(
                WORKDAY([{day:{ending:"2015-07-18T00:00:00-04:00"}}])
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-20T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY1", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) + 1
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-17T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY-1", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) - 1
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-15T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY1.5", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) + 1.5
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-17T12:00:00-04:00"}}])
            );
        });
        it("WORKDAY-1.5", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) - 1.5
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-14T12:00:00-04:00"}}])
            );
        });
        it("WORKDAY2", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) + 2
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-20T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY-2", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) - 2
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-14T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY2.5", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) + 2.5
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-20T12:00:00-04:00"}}])
            );
        });
        it("WORKDAY-2.5", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) - 2.5
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-13T12:00:00-04:00"}}])
            );
        });
        it("WORKDAY4", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) + 4
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-22T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY-4", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) - 4
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-10T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY5", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) + 5
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-23T00:00:00-04:00"}}])
            );
        });
        it("WORKDAY-5", function(){
            expect(
                WORKDAY([{day:{ending:"2015-07-16T00:00:00-04:00"}}]) - 5
            ).to.equal(
                WORKDAY([{day:{ending:"2015-07-09T00:00:00-04:00"}}])
            );
        });
    });
});
