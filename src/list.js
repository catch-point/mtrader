// list.js
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

const assert = require('assert');
const _ = require('underscore');

var List = module.exports = function(array) {
    if (!arguments.length || _.isArray(array) && !array.length) {
        this.sources = [];
    } else if (arguments.length == 1 && _.isArray(array)) {
        this.sources = [{
            firstIndex: 0,
            lastIndex: array.length -1,
            offset: 0,
            array: array,
            mutable: true
        }];
    } else if (arguments.length == 1 && List.isList(array)) {
        array.sources.forEach(source => source.mutable = false);
        this.sources = array.sources.map(_.clone);
    } else if (arguments.length == 1 && _.isFinite(array) && array >= 0) {
        this.sources = [];
        this.length = array;
    } else if (arguments.length) {
        var dest = List.of.apply(List, arguments);
        this.sources = dest.sources;
    }
};

List.from = function(arrayLike, mapFn, thisArg) {
    if (List.isList(arrayLike)) {
        if (mapFn) return new List(arrayLike).map(mapFn, thisArg);
        else return new List(arrayLike);
    }
    var array = Array.isArray(arrayLike) ? arrayLike : Array.from(arrayLike);
    var dest = new List();
    if (array.length > 0) {
        dest.sources = [{
            firstIndex: 0,
            lastIndex: array.length -1,
            offset: 0,
            array: array,
            map: mapFn ? mapFn.bind(thisArg) : undefined,
            mapOffset: 0,
            mutable: false
        }];
    }
    return dest;
};

List.isList = function(list) {
    return list instanceof List;
};

List.of = function() {
    var dest = List.from(arguments);
    dest.sources[0].mutable = true;
    return dest;
};

List.flatten = function(arrays, shallow) {
    var dest = List.prototype.concat.apply(new List(), arrays);
    if (shallow) return dest;
    else return new List(_.flatten(dest.toArray()));
};

List.prototype = {
    item(index, value) {
        if (!arguments.length) {
            throw new TypeError("No index provided");
        } else if (!(index >= 0)) {
            return undefined; // out of range
        } else if (arguments.length < 2) { // getter
            var i = index === 0 ? 0 : _.sortedIndex(this.sources, {lastIndex: index}, 'lastIndex');
            var block = this.sources[i];
            if (!block) return undefined;
            var val = block.array[block.offset + index - block.firstIndex];
            if (!block.map) return val;
            else return this.item(index, block.map(val, index + block.mapOffset));
        } else { // setter
            if (this.length <= index) {
                this.length = index +1;
            }
            var i = _.sortedIndex(this.sources, {lastIndex: index}, 'lastIndex');
            var prior = this.sources[i-1];
            var block = this.sources[i];
            var follow = this.sources[i+1];
            assert(block);
            if (block.mutable) {
                assert(block.firstIndex <= index);
                block.array[block.offset + index - block.firstIndex] = value;
            } else if (prior && prior.mutable && prior.lastIndex == index -1) {
                block.firstIndex++;
                block.offset++;
                if (block.firstIndex > block.lastIndex) this.sources.splice(i, 1);
                prior.lastIndex++;
                prior.array[index - prior.firstIndex] = value;
            } else if (follow && follow.mutable && follow.firstIndex == index +1) {
                block.lastIndex--;
                if (block.firstIndex > block.lastIndex) this.sources.splice(i, 1);
                follow.firstIndex--;
                follow.array.splice(follow.offset, 0, value);
            } else if (block.firstIndex == index && block.lastIndex == index) {
                this.sources.splice(i, 1, single(index, value));
            } else if (block.firstIndex == index) {
                block.firstIndex++;
                block.offset++;
                this.sources.splice(i, 0, single(index, value));
            } else if (block.lastIndex == index) {
                block.lastIndex--;
                this.sources.splice(i+1, 0, single(index, value));
            } else {
                this.sources.splice(i, 1, {
                    firstIndex: block.firstIndex,
                    lastIndex: index -1,
                    offset: block.offset,
                    array: block.array,
                    map: block.map,
                    mapOffset: block.mapOffset,
                    mutable: false
                }, single(index, value), {
                    firstIndex: index +1,
                    lastIndex: block.lastIndex,
                    offset: block.offset + index +1 - block.firstIndex,
                    array: block.array,
                    map: block.map,
                    mapOffset: block.mapOffset + index +1 - block.firstIndex,
                    mutable: false
                });
            }
            return value;
        }
    },
    isEmpty() {
        return !this.sources.length;
    },
    first(n) {
        if (n == null) return this.item(0);
        else return this.slice(0, Math.max(0, n));
    },
    last(n) {
        if (n == null) return this.item(this.length -1);
        else return this.slice(Math.max(0, this.length - n));
    },
    sortedIndexOf(obj, iteratee, ctx) {
        iteratee = _.iteratee(iteratee, ctx);
        var value = iteratee(obj);
        var low = 0, high = this.length;
        while (low < high) {
            var mid = Math.floor((low + high) / 2);
            var i = _.sortedIndex(this.sources, {lastIndex: mid}, 'lastIndex');
            var block = this.sources[i];
            var val = block.array[block.offset - block.firstIndex + mid];
            var item = block.map ? block.map(val, mid + block.mapOffset) : val;
            if (iteratee(item) < value) low = mid + 1; else high = mid;
        }
        return low;
    },
    pluck(key) {
        return this.map(_.property(key));
    },
    get length() {
        var last = _.last(this.sources);
        return last ? last.lastIndex +1 : 0;
    },
    set length(ln) {
        if (ln == this.length) {
            return; // no change
        } else if (ln === 0) { // clear
            this.sources = [];
        } else {
            var i = _.sortedIndex(this.sources, {lastIndex: ln}, 'lastIndex');
            if (this.sources[i]) { // truncate
                var before = this.sources[i];
                if (before.mutable) before.array.length = before.offset + ln - before.firstIndex;
                this.sources.splice(i, this.sources.length, {
                    firstIndex: before.firstIndex,
                    lastIndex: ln -1,
                    offset: before.offset,
                    array: before.array,
                    map: before.map,
                    mapOffset: before.mapOffset,
                    mutable: before.mutable
                });
            } else { // grow
                var last = _.last(this.sources);
                if (last && last.mutable) {
                    last.lastIndex = ln -1;
                    last.array.length = ln - last.firstIndex;
                } else { // append
                    var start = this.length;
                    this.sources.push({
                        firstIndex: start,
                        lastIndex: ln -1,
                        offset: 0,
                        array: new Array(ln - start),
                        mutable: true
                    });
                }
            }
        }
    },
    pop() {
        return this.splice(-1, 1).first();
    },
    push() {
        var start = this.length;
        for (var i=0; i<arguments.length; i++) {
            this.item(start + i, arguments[i]);
        }
        return this.length;
    },
    shift() {
        return this.splice(0, 1).first();
    },
    unshift() {
        var args = _.toArray(arguments);
        args.unshift(0, 0);
        this.splice.apply(this, args);
        return this.length;
    },
    concat() {
        var dest = new List();
        this.sources.forEach(source => source.mutable = false);
        dest.sources = this.sources.map(_.clone);
        for (var i=0; i<arguments.length; i++) {
            if (Array.isArray(arguments[i]) && arguments[i].length) {
                var start = dest.length;
                dest.sources.push({
                    firstIndex: start,
                    lastIndex: start + arguments[i].length -1,
                    offset: 0,
                    array: arguments[i],
                    mutable: false
                });
            } else if (arguments[i] instanceof List) {
                var start = dest.length;
                arguments[i].sources.forEach(source => {
                    source.mutable = false;
                    dest.sources.push({
                        firstIndex: start + source.firstIndex,
                        lastIndex: start + source.lastIndex,
                        offset: source.offset,
                        array: source.array,
                        map: source.map,
                        mapOffset: source.mapOffset - start,
                        mutable: false
                    });
                }, this);
            } else if (!Array.isArray(arguments[i])) {
                var last = _.last(dest.sources);
                if (last && last.mutable) {
                    last.lastIndex++;
                    last.array.push(arguments[i]);
                } else {
                    var firstIndex = dest.length;
                    dest.sources.push(single(firstIndex, arguments[i]));
                }
            }
        }
        return dest;
    },
    map(cb, ctx) {
        var map = (value, index) => cb.call(ctx, value, index, this);
        var dest = new List(this);
        dest.sources.forEach(source => {
            source.mutable = false;
            if (source.map) {
                var delta = source.firstIndex - source.mapOffset;
                source.map = _.wrap(source.map, (fn, value, index) => {
                    return map(fn(value, index + delta), index);
                });
                source.mapOffset = 0;
            } else {
                source.map = map;
                source.mapOffset = 0;
            }
        });
        return dest;
    },
    slice(b, e) {
        var len = this.length;
        if (b >= len) return new List();
        var begin = b >= 0 ? b : b < 0 ? Math.max(len + b, 0) : 0;
        var end = e >= 0 ? Math.min(e, len) : e < 0 ? Math.max(len + e, 0) : len;
        if (begin >= end) return new List();
        var start = _.sortedIndex(this.sources, {lastIndex: begin}, 'lastIndex');
        var stop = _.sortedIndex(this.sources, {lastIndex: end-1}, 'lastIndex');
        var dest = new List();
        for (var i=start; i<=stop; i++) {
            var source = this.sources[i];
            source.mutable = false;
            var offset = Math.max(begin - source.firstIndex, 0);
            dest.sources.push({
                firstIndex: source.firstIndex - begin + offset,
                lastIndex: Math.min(source.lastIndex - begin, end -1 - begin),
                offset: source.offset + offset,
                array: source.array,
                map: source.map,
                mapOffset: source.mapOffset + begin - offset,
                mutable: false
            });
        }
        return dest;
    },
    splice(b, deleteCount) {
        var len = this.length;
        if (b >= len) return new List();
        var begin = b < 0 ? Math.max(len + b, 0) : b;
        var del = arguments.length < 2 ? len - begin : Math.min(deleteCount, len - begin);
        assert(del >= 0);
        var start = _.sortedIndex(this.sources, {lastIndex: begin}, 'lastIndex');
        var stop = _.sortedIndex(this.sources, {lastIndex: begin + del -1}, 'lastIndex');
        var dest = this.slice(begin, begin + del);
        var before = this.sources[start];
        var after = this.sources[stop];
        var args = [start, start - stop +1];
        if (before && before.firstIndex < begin) {
            args.push({
                firstIndex: before.firstIndex,
                lastIndex: begin -1,
                offset: before.offset,
                array: before.array,
                map: before.map,
                mapOffset: before.mapOffset,
                mutable: false
            });
        }
        if (arguments.length > 2) {
            args.push({
                firstIndex: begin,
                lastIndex: begin + del -1 + arguments.length -2,
                offset: 0,
                array: _.rest(arguments, 2),
                mutable: true
            });
        }
        if (after && after.lastIndex >= begin + del) {
            var ins = arguments.length -2;
            args.push({
                firstIndex: begin + ins,
                lastIndex: after.lastIndex - del + ins,
                offset: after.offset + begin + del - after.firstIndex,
                array: after.array,
                map: after.map,
                mapOffset: after.mapOffset + after.firstIndex - begin - ins,
                mutable: false
            });
        }
        for (var i=stop+1; i<this.sources.length; i++) {
            this.sources[i].firstIndex += arguments.length -2 -del;
            this.sources[i].lastIndex += arguments.length -2 -del;
        }
        this.sources.splice.apply(this.sources, args);
        return dest;
    },
    toJSON() {
        return this.toArray();
    },
    toArray() {
        if (isArrayBacked(this)) return this.sources[0].array;
        var dest = new Array(this.length);
        this.forEach((value, index, list) => {
            dest[index] = value;
        });
        this.sources = new List(dest).sources;
        return dest;
    },
    filter(fn, thisArg) {
        if (isArrayBacked(this)) return new List(apply(Array.prototype.filter, this, arguments));
        var dest = [];
        this.forEach((value, index, list) => {
            if (fn.call(thisArg, value, index, list)) dest.push(value);
        });
        return new List(dest);
    },
    forEach(cb, thisArg) {
        if (isArrayBacked(this)) return apply(Array.prototype.forEach, this, arguments);
        for (var i=0,n=this.length; i<n; i++) {
            var value = this.item(i);
            cb.call(thisArg, value, i, this);
        }
    },
    reduce(cb, initialValue) {
        if (isArrayBacked(this)) return apply(Array.prototype.reduce, this, arguments);
        var memo = initialValue;
        this.forEach((value, index, list) => {
            if (index === 0 && arguments.length < 2) memo = value;
            else memo = cb.call(cb, memo, value, index, list);
        });
        return memo;
    },
    reduceRight(cb, initialValue) {
        if (isArrayBacked(this)) return apply(Array.prototype.reduceRight, this, arguments);
        var memo = initialValue;
        var len = this.length;
        for(var i=len -1; i>= 0; i--) {
            var value = this.item(i);
            if (i == len -1 && arguments.length < 2) memo = value;
            else memo = cb.call(cb, memo, value, i, this);
        }
        return memo;
    },
    copyWithin() {
        apply(Array.prototype.copyWithin, this, arguments);
        return this;
    },
    fill() {
        apply(Array.prototype.fill, this, arguments);
        return this;
    },
    reverse() {
        apply(Array.prototype.reverse, this, arguments);
        return this;
    },
    sort() {
        apply(Array.prototype.sort, this, arguments);
        return this;
    },
    toLocaleString() {
        return apply(Array.prototype.toLocaleString, this, arguments);
    },
    toString() {
        return apply(Array.prototype.toString, this, arguments);
    },
    entries() {
        return apply(Array.prototype.entries, this, arguments);
    },
    every() {
        return apply(Array.prototype.every, this, arguments);
    },
    find() {
        return apply(Array.prototype.find, this, arguments);
    },
    findIndex() {
        return apply(Array.prototype.findIndex, this, arguments);
    },
    indexOf() {
        return apply(Array.prototype.indexOf, this, arguments);
    },
    join() {
        return apply(Array.prototype.join, this, arguments);
    },
    keys() {
        return apply(Array.prototype.keys, this, arguments);
    },
    lastIndexOf() {
        return apply(Array.prototype.lastIndexOf, this, arguments);
    },
    some() {
        return apply(Array.prototype.some, this, arguments);
    }
};

function single(index, value) {
    return {
        firstIndex: index,
        lastIndex: index,
        offset: 0,
        array: [value],
        mutable: true
    };
}

function isArrayBacked(list) {
    var first = list.sources[0];
    return list.sources.length == 1 && first.mutable && first.offset === 0 &&
        first.lastIndex >= first.array.length -1;
}

function apply(fn, list, arguments) {
    var ar = list.toArray();
    try {
        return fn.apply(ar, arguments);
    } finally {
        list.length = ar.length;
    }
}
