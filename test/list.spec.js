// list.spec.js
/*
 *  Copyright (c) 2016-2017 James Leigh, Some Rights Reserved
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
const List = require('../src/list.js');
const like = require('./should-be-like.js');
const expect = require('chai').expect;

describe("list", function() {
    describe("create", function() {
        it("from length", function() {
            var list = new List(2);
            list.length.should.eql(2);
            var largeArray = new List(Math.pow(2, 32) - 1);
            largeArray.length.should.eql(Math.pow(2, 32) - 1);
        });
        it("from array without copy", function() {
            var ar = [1,2,3];
            var list = new List(ar);
            list.item(0, "one");
            ar[0].should.eql("one");
            new List([1]).item(0).should.eql(1);
            new List([]).isEmpty().should.eql(true);
        });
        it("from list as copy", function() {
            var ar = [1,2,3];
            var list = new List(ar);
            var copy = new List(list);
            copy.item(0, "one");
            copy.item(0).should.eql("one");
            ar[0].should.eql(1);
            List.from(new List([1, 2, 3])).toArray().should.eql([1, 2, 3]);
            List.from(new List([1, 2, 3]), num => num * 2).toArray().should.eql([2, 4, 6]);
        });
        it("from elements", function() {
            var list = new List(1,2,3);
            list.length.should.eql(3);
            list.item(0, "one");
            list.item(0).should.eql("one");
        });
        it("from array map", function() {
            var ar = [1,2,3];
            var calls = 0;
            var list = List.from(ar, num => {
                calls++;
                return ''+num;
            });
            list.length.should.eql(3);
            list.item(0).should.eql("1");
            ar[0].should.eql(1);
            calls.should.eql(1);
            List.from([]).isEmpty().should.eql(true);
        });
        it("from array references", function() {
            var a = [1,2,3];
            var b = [4,5];
            var list = List.flatten([a, b], true);
            list.length.should.eql(5);
            list.item(0).should.eql(1);
            a[0] = "one";
            list.item(0).should.eql("one");
        });
        it("from flatten arrays", function() {
            var a = [1,2,3];
            var b = [4,5, [6,7, [8,9]]];
            var list = List.flatten([a, b]);
            list.length.should.eql(9);
            List.flatten([]).isEmpty().should.eql(true);
        });
    });
    describe("item", function() {
        it("throw TypeError", function() {
            var list = new List();
            list.item.bind(list).should.throw(TypeError);
        });
        it("out of range", function() {
            var list = new List();
            expect(list.item(-1)).to.be.undefined;
            expect(list.item(list.length)).to.be.undefined;
        });
        it("increase length", function() {
            var list = new List();
            list.item(1, 2);
            list.length.should.eql(2);
        });
        it("prior mutable", function() {
            var list = List.from([1,2,3,4]);
            list.item(0, "one");
            list.item(1, "two");
            list.length.should.eql(4);
            list.sources.length.should.eql(2);
        });
        it("prior mutable with cleanup", function() {
            var list = new List().concat([1,2],[3,4]);
            list.item(0, "one");
            list.item(1, "two");
            list.length.should.eql(4);
            list.sources.length.should.eql(2);
        });
        it("following mutable", function() {
            var list = List.from([1,2,3,4]);
            list.item(3, "four");
            list.item(2, "three");
            list.length.should.eql(4);
            list.sources.length.should.eql(2);
        });
        it("following mutable with cleanup", function() {
            var list = new List().concat([1,2],[3,4]);
            list.item(3, "four");
            list.item(2, "three");
            list.length.should.eql(4);
            list.sources.length.should.eql(2);
        });
        it("replace single", function() {
            var list = new List().concat([1,2],[3],[4]);
            list.item(2, "three");
            list.length.should.eql(4);
            list.sources.length.should.eql(3);
        });
        it("split", function() {
            var list = List.from([1,2,3,4]);
            list.item(2, "three");
            list.length.should.eql(4);
            list.sources.length.should.eql(3);
        });
    });
    it("empty", function() {
        new List().isEmpty().should.be.true;
    });
    it("first", function() {
        new List([1, 2, 3]).first().should.eql(1);
        new List([1, 2, 3]).first(0).length.should.eql(0);
        new List([1, 2, 3]).first(-1).length.should.eql(0);
        new List([1, 2, 3]).first(2).toArray().should.eql([1, 2]);
        new List([1, 2, 3]).first(5).toArray().should.eql([1, 2, 3]);
        expect(new List().first()).to.be.undefined;
        List.from([1,2], num => ''+num).first().should.eql("1");
    });
    it("last", function() {
        new List([1, 2, 3]).last().should.eql(3);
        new List([1, 2, 3]).last(0).length.should.eql(0);
        new List([1, 2, 3]).last(-1).length.should.eql(0);
        new List([1, 2, 3]).last(2).toArray().should.eql([2, 3]);
        new List([1, 2, 3]).last(5).toArray().should.eql([1, 2, 3]);
        expect(new List().last()).to.be.undefined;
        List.from([1,2], num => ''+num).last().should.eql("2");
    });
    it("sortedIndexOf", function() {
        var numbers = new List([10, 20, 30, 40, 50]);
        numbers.sortedIndexOf(35).should.eql(3);
        numbers.sortedIndexOf(30).should.eql(2);
        var objects = new List([{x: 10}, {x: 20}, {x: 30}, {x: 40}]);
        var iterator = function(obj){ return obj.x; };
        objects.sortedIndexOf({x: 25}, iterator).should.eql(2);
        objects.sortedIndexOf({x: 35}, 'x').should.eql(3);

        var values = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535, 131071, 262143, 524287,
            1048575, 2097151, 4194303, 8388607, 16777215, 33554431, 67108863, 134217727, 268435455, 536870911, 1073741823, 2147483647];
        var largeArray = new List(Math.pow(2, 32) - 1);
        var length = values.length;
        // Sparsely populate `array`
        while (length--) {
          largeArray.item(values[length], values[length]);
        }
        largeArray.sortedIndexOf(2147483648).should.eql(2147483648);
        largeArray.map(n=>n).sortedIndexOf(2147483648).should.eql(2147483648);
    });
    it("pluck", function() {
        new List([{id: '1'}, {id: '2'}]).pluck('id').toArray().should.eql(['1', '2']);
        var people = [{name: 'moe', age: 30}, {name: 'curly', age: 50}];
        new List(people).pluck('name').toArray().should.eql(['moe', 'curly']);
    });
    describe("length", function() {
        it("no change", function() {
            var list = new List([1, 2, 3]);
            list.length.should.eql(3);
            list.length = 3;
            list.length.should.eql(3);
        });
        it("clean", function() {
            var list = new List([1, 2, 3]);
            list.length.should.eql(3);
            list.length = 0;
            list.length.should.eql(0);
            list.toArray().should.eql([]);
        });
        it("truncate mutable", function() {
            var list = new List([1, 2, 3]);
            list.length.should.eql(3);
            list.length = 1;
            list.length.should.eql(1);
            list.toArray().should.eql([1]);
        });
        it("truncate", function() {
            var list = List.from([1, 2, 3]);
            list.length.should.eql(3);
            list.length = 1;
            list.length.should.eql(1);
            list.toArray().should.eql([1]);
        });
        it("grow", function() {
            var list = new List([1, 2, 3]);
            list.length.should.eql(3);
            list.length = 4;
            list.length.should.eql(4);
            list.toArray().should.eql([1, 2, 3, ]);
        });
    });
    it("pop", function() {
        var list = new List([1,2,3]);
        list.pop().should.eql(3);
        list.length.should.eql(2);
        list.toArray().should.eql([1,2]);
        expect(new List().pop()).to.be.undefined;
        List.from([1,2,3], n=>n*2).pop().should.eql(6);
        var l = List.from([1,2,3], n=>n*2);
        l.last().should.eql(6);
        l.length.should.eql(3);
        l.pop().should.eql(6);
        l.length.should.eql(2);
    });
    it("push mutable", function() {
        var list = new List([1,2,3]);
        list.push(4).should.eql(4);
        list.toArray().should.eql([1,2,3,4]);
    });
    it("push", function() {
        var list = List.from([1,2,3]);
        list.push(4).should.eql(4);
        list.toArray().should.eql([1,2,3,4]);
    });
    it("shift", function() {
        var list = new List([1,2,3]);
        list.shift().should.eql(1);
        list.length.should.eql(2);
        list.toArray().should.eql([2,3]);
        expect(new List().shift()).to.be.undefined;
        List.from([1,2,3], n=>n*2).shift().should.eql(2);
        var l = List.from([1,2,3], n=>n*2);
        l.first().should.eql(2);
        l.length.should.eql(3);
        l.shift().should.eql(2);
        l.length.should.eql(2);
    });
    it("unshift mutable", function() {
        var list = new List([1,2,3]);
        list.unshift(0).should.eql(4);
        list.toArray().should.eql([0,1,2,3]);
    });
    it("unshift", function() {
        var list = List.from([1,2,3]);
        list.unshift(0).should.eql(4);
        list.toArray().should.eql([0,1,2,3]);
    });
    it("concat", function() {
        var list = new List([1,2,3]);
        var concat = list.concat([4,5],new List(6,7),8,9);
        list.length.should.eql(3);
        concat.toArray().should.eql([1,2,3,4,5,6,7,8,9]);
        concat.length.should.eql(9);
        expect(new List().concat([],[1]).first()).to.eql(1);
    });
    it("map", function() {
        new List([1, 2, 3]).map(num => num * 2).toArray().should.eql([2, 4, 6]);
        new List([1, 2, 3]).map(function(num){
            return num * this.m;
        },{m: 3}).toArray().should.eql([3, 6, 9]);
        new List([1]).map(function() {
          return this.length;
        }, [5]).toArray().should.eql([1]);
        new List([1, 2, 3]).map(num => num *2).map(num => num +1).toArray().should.eql([3, 5, 7]);
        new List([1, 2, 3]).map((num, i, original) => {
            original.toArray().should.eql([1, 2, 3]);
            return num *2;
        }).toArray().should.eql([2, 4, 6]);
        new List([1,2,3]).concat(new List([1,2,3]).map((v,i) => i+4)).toArray().should.eql([1,2,3,4,5,6]);
    });
    it("slice", function() {
        new List([1,2,3]).slice().toArray().should.eql([1,2,3]);
        new List([1,2,3]).slice(-2).toArray().should.eql([2,3]);
        new List([1,2,3]).slice(-2,-1).toArray().should.eql([2]);
    });
    it("splice mutable", function() {
        new List([1,2,3]).splice(1).toArray().should.eql([2,3]);
        new List([1,2,3]).splice(-2).toArray().should.eql([2,3]);
        new List([1,2,3]).splice(-2,1).toArray().should.eql([2]);
        new List([1,2,3]).splice(3).toArray().should.eql([]);
        new List([1,2,3]).splice(-2,1, "two").toArray().should.eql([2]);
        var list = new List([1,2,3]);
        list.item(3,4);
        list.item(4,5);
        list.splice(0,1);
        list.length.should.eql(4);
    });
    it("splice", function() {
        List.from([1,2,3]).splice(1).toArray().should.eql([2,3]);
        List.from([1,2,3]).splice(-2).toArray().should.eql([2,3]);
        List.from([1,2,3]).splice(-2,1).toArray().should.eql([2]);
        List.from([1,2,3]).splice(3).toArray().should.eql([]);
        List.from([1,2,3]).splice(-2,1, "two").toArray().should.eql([2]);
        var list = List.from([1,2,3]);
        list.item(3,4);
        list.item(4,5);
        list.splice(0,1);
        list.length.should.eql(4);
    });
    it("toJSON", function() {
        JSON.parse(JSON.stringify(new List([1,2,3]))).should.eql([1,2,3]);
    });
    it("filter", function() {
        new List([1,2,3]).filter(n=>n%2).toArray().should.eql([1,3]);
        List.from([1,2,3]).filter(n=>n%2).toArray().should.eql([1,3]);
    });
    it("forEach", function() {
        new List([1, 2, 3]).forEach(function(num, i) {
          num.should.eql(i + 1);
        });
        var answers = [];
        new List([1, 2, 3]).forEach(function(num){ answers.push(num * this.multiplier); }, {multiplier: 5});
        answers.should.eql([5, 10, 15]);
        answers = [];
        new List([1, 2, 3]).forEach(function(num){ answers.push(num); });
        answers.should.eql([1, 2, 3]);
    });
    it("reduce mutable", function() {
        new List([1, 2, 3]).reduce((memo, num) => memo + num, 0).should.eql(6);
        new List([1, 2, 3]).reduce((memo, num) => memo + num).should.eql(6);
        new List([1, 2, 3, 4]).reduce((memo, num) => memo * num).should.eql(24);
        expect(new List().reduce(_.noop, void 0)).to.eql(void 0);
        new List([_]).reduce(_.noop).should.eql(_);
    });
    it("reduce", function() {
        List.from([1, 2, 3]).reduce((memo, num) => memo + num, 0).should.eql(6);
        List.from([1, 2, 3]).reduce((memo, num) => memo + num).should.eql(6);
        List.from([1, 2, 3, 4]).reduce((memo, num) => memo * num).should.eql(24);
        List.from([_]).reduce(_.noop).should.eql(_);
    });
    it("reduceRight mutable", function() {
        new List(['foo', 'bar', 'baz']).reduceRight((memo, str) => memo + str, '').should.eql('bazbarfoo');
        new List(['foo', 'bar', 'baz']).reduceRight((memo, str) => memo + str).should.eql('bazbarfoo');
        new List([_]).reduceRight(_.noop).should.eql(_);
        expect(new List().reduceRight(_.noop, void 0)).to.eql(void 0);
    });
    it("reduceRight", function() {
        List.from(['foo', 'bar', 'baz']).reduceRight((memo, str) => memo + str, '').should.eql('bazbarfoo');
        List.from(['foo', 'bar', 'baz']).reduceRight((memo, str) => memo + str).should.eql('bazbarfoo');
        List.from([_]).reduceRight(_.noop).should.eql(_);
    });
    it("array functions", function() {
        new List([1,2,3]).copyWithin();
        new List([1,2,3]).fill();
        new List([1,2,3]).reverse();
        new List([1,2,3]).sort();
        new List([1,2,3]).toLocaleString();
        new List([1,2,3]).toString();
        new List([1,2,3]).entries();
        new List([1,2,3]).every(n=>n>1).should.eql(false);
        new List([1,2,3]).find(n=>n>1).should.eql(2);
        new List([1,2,3]).findIndex(n=>n>1).should.eql(1);
        new List([1,2,3]).indexOf();
        new List([1,2,3]).join();
        new List([1,2,3]).keys();
        new List([1,2,3]).lastIndexOf();
        new List([1,2,3]).some(n=>n>1).should.eql(true);
    });
});
