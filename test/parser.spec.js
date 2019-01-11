// parser.spec.js
/*
 *  Copyright (c) 2014-2019 James Leigh, Some Rights Reserved
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
    it("string", function() {
        expect(parser.parse('"Hello World!"')()).to.equal('Hello World!');
        expect(parser.parse('"Hello \\"World!\\""')()).to.equal('Hello "World!"');
        expect(parser.parse(`'Hello "World!"'`)()).to.equal('Hello "World!"');
        expect(parser.parse(`"Hello 'World!'"`)()).to.equal("Hello 'World!'");
        expect(parser.parse(`'Hello \\'World!\\''`)()).to.equal("Hello 'World!'");
    });
    it("template", function() {
        expect(parser.parse('`Hello World!`')()).to.equal('Hello World!');
        expect(parser.parse('`Hello "World!"`')()).to.equal('Hello "World!"');
        expect(parser.parse('`Hello \\`World!\\``')()).to.equal('Hello `World!`');
        expect(parser.parse("`Hello 'World!'`")()).to.equal("Hello 'World!'");
        expect(parser.parse('`Hello {{World!}}`')()).to.equal("Hello {World!}");
        expect(parser.parse('`Hello {"World!"}`')()).to.equal("Hello World!");
        expect(parser.parse('`{"Hello"} {"World"}!`')()).to.equal("Hello World!");
        expect(parser.parse('`Hello {"World"+"!"}`')()).to.equal("Hello World!");
        expect(parser.parse('`Hello {99+1}`')()).to.equal("Hello 100");
        expect(parser.parse('`Hello {`World!`}`')()).to.equal("Hello World!");
        expect(parser.parse('`Hello {`{"World"}!`}`')()).to.equal("Hello World!");
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
    it("should reformat", function() {
        expect(parser.parse("4/(1/2)*(1/2)")()).to.equal(4);
        expect(Parser().parse("4/(1/2)*(1/2)")).to.equal("4/(1/2)*1/2");
        expect(parser.parse(Parser().parse("4/(1/2)*(1/2)"))()).to.equal(4);
    });
});
