// storage.spec.js
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
const storage = require('../src/storage.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

describe("storage", function() {
    this.timeout(60000);
    var dir = createTempDir('storage');
    it("mergeMetadata", function() {
        var data1 = {tables:[{id:'a',updatedAt:'earlier'},{id:'c'}]};
        var data2 = {tables:[{id:'a',updatedAt:'today'},{id:'b'},{id:'d'}]};
        var data = JSON.parse(JSON.stringify(data2));
        var expected = {tables:[{id:'a',updatedAt:'today'},{id:'c'},{id:'d'}]};
        var index = path.resolve(dir, 'index.json');
        var part = path.resolve(dir, 'part.json');
        var a = path.resolve(dir, 'a.csv');
        var b = path.resolve(dir, 'b.csv');
        var c = path.resolve(dir, 'c.csv');
        var d = path.resolve(dir, 'd.csv');
        fs.writeFileSync(a, '');
        // b is absent
        fs.writeFileSync(c, '');
        fs.writeFileSync(d, '');
        fs.writeFileSync(index, JSON.stringify(data1));
        fs.writeFileSync(part, JSON.stringify(data2));
        return storage._mergeMetadata(part, index, data).then(() => {
            var actual = JSON.parse(fs.readFileSync(part));
            data.tables.should.have.length(3);
            data.should.be.like(expected);
            actual.tables.should.have.length(3);
            actual.should.be.like(expected);
        });
    });
    it("renameMetadata", function() {
        var data0 = {tables:[{id:'a',updatedAt:'earlier'},{id:'b'}]};
        var data1 = {tables:[{id:'a',updatedAt:'earlier'},{id:'c'}]};
        var data2 = {tables:[{id:'a',updatedAt:'today'},{id:'b'},{id:'d'}]};
        var data = JSON.parse(JSON.stringify(data2));
        var expected = {tables:[{id:'a',updatedAt:'today'},{id:'c'},{id:'d'}]};
        var index = path.resolve(dir, 'index.json');
        var part = path.resolve(dir, 'part.json');
        var a = path.resolve(dir, 'a.csv');
        var b = path.resolve(dir, 'b.csv');
        var c = path.resolve(dir, 'c.csv');
        var d = path.resolve(dir, 'd.csv');
        fs.writeFileSync(a, '');
        // b is absent
        fs.writeFileSync(c, '');
        fs.writeFileSync(d, '');
        fs.writeFileSync(index, JSON.stringify(data0));
        return storage._readMetadata(dir).then(metadata => {
            _.extend(data, metadata, JSON.parse(JSON.stringify(data2)));
            _.extend(data2, metadata, JSON.parse(JSON.stringify(data2)));
        }).then(() => new Promise(cb => setTimeout(cb, 100)).then(() => {
            fs.writeFileSync(index, JSON.stringify(data1));
            fs.writeFileSync(part, JSON.stringify(data2));
            return storage._renameMetadata(part, index, data);
        })).then(() => {
            var actual = JSON.parse(fs.readFileSync(index));
            data.tables.should.have.length(3);
            data.should.be.like(expected);
            actual.tables.should.have.length(3);
            actual.should.be.like(expected);
        });
    });
});

