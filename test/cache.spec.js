// cache.spec.js
/*
 *  Copyright (c) 2018 James Leigh, Some Rights Reserved
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

const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const Cache = require('../src/disk-cache.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("cache", function() {
    var dir = createTempDir('cache');
    it("entry", function() {
        var run = -1;
        var cache = Cache(dir, function(options){
            return _.extend({run: ++run}, options);
        }, 1);
        return cache({key:0}).should.eventually.be.like({key:0,run:0});
    });
    it("hit", function() {
        var run = 0;
        var cache = Cache(dir, function(options){
            return _.extend({run: ++run}, options);
        }, 1);
        return cache({key:1})
          .then(() => cache({key:1}))
          .should.eventually.be.like({key:1,run:1});
    });
    it("miss", function() {
        var run = 2;
        var cache = Cache(dir, function(options){
            return _.extend({run: ++run}, options);
        }, 10);
        return cache({key:3})
          .then(() => cache({key:4}))
          .should.eventually.be.like({key:4,run:4});
    });
    it("hit cycle", function() {
        var run = 4;
        var cache1 = Cache(dir, function(options){
            return _.extend({run: ++run}, options);
        }, 1);
        return cache1.flush()
          .then(() => cache1.flush())
          .then(() => cache1({key:5}))
          .then(() => cache1.close())
          .then(() => {
            var cache2 = Cache(dir, function(options){
                return _.extend({run: ++run}, options);
            }, 1);
            return cache2({key:5})
              .should.eventually.be.like({key:5,run:5});
        });
    });
    it("sweep", function() {
        var run = 6;
        var cache = Cache(dir, function(options){
            return _.extend({run: ++run}, options);
        }, 1);
        return cache.flush()
          .then(() => cache({key:7}))
          .then(() => cache({key:8}))
          .then(() => cache.flush())
          .then(() => cache.flush())
          .then(() => cache({key:7}))
          .should.eventually.be.like({key:7,run:9});
    });
    it("csv", function() {
        var run = 0;
        var cache = Cache(dir, function(options){
            return [_.extend({run: ++run}, options)];
        }, 1);
        return cache({key:1})
          .then(() => cache({key:1}))
          .should.eventually.be.like([{key:1,run:1}]);
    });
});

