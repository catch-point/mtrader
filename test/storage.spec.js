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
const util = require('util');
const path = require('path');
const zlib = require('zlib');
const _ = require('underscore');
const storage = require('../src/storage.js');
const like = require('./should-be-like.js');
const createTempDir = require('./create-temp-dir.js');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

describe("storage", function() {
    this.timeout(60000);
    const dir = createTempDir('storage');
    it("mergeMetadata", async() => {
        const data1 = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'earlier'},{id:'c'}]};
        const data2 = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'today'},{id:'b'},{id:'d'}]};
        const data = JSON.parse(JSON.stringify(data2));
        const expected = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'today'},{id:'c'},{id:'d'}]};
        const index = path.resolve(dir, 'index.json.gz');
        const part = path.resolve(dir, 'part.json.gz');
        const a = path.resolve(dir, 'a.csv.gz');
        const b = path.resolve(dir, 'b.csv.gz');
        const c = path.resolve(dir, 'c.csv.gz');
        const d = path.resolve(dir, 'd.csv.gz');
        await writeFile(a, '');
        // b is absent
        await writeFile(c, '');
        await writeFile(d, '');
        await writeFile(index, await gzip(JSON.stringify(data1)));
        await writeFile(part, await gzip(JSON.stringify(data2)));
        await storage._mergeMetadata(part, index, data);
        const compressed = await readFile(part);
        const decompressed = await gunzip(compressed);
        const actual = JSON.parse(decompressed.toString());
        data.tables.should.have.length(3);
        data.should.be.like(expected);
        actual.tables.should.have.length(3);
        actual.should.be.like(expected);
    });
    it("renameMetadata", async() => {
        const data0 = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'earlier'},{id:'b'}]};
        const data1 = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'earlier'},{id:'c'}]};
        const data2 = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'today'},{id:'b'},{id:'d'}]};
        const data = JSON.parse(JSON.stringify(data2));
        const expected = {tables:[{id:'a',file:'a.csv.gz',updatedAt:'today'},{id:'c'},{id:'d'}]};
        const index = path.resolve(dir, 'index.json.gz');
        const part = path.resolve(dir, 'part.json.gz');
        const a = path.resolve(dir, 'a.csv.gz');
        const b = path.resolve(dir, 'b.csv.gz');
        const c = path.resolve(dir, 'c.csv.gz');
        const d = path.resolve(dir, 'd.csv.gz');
        await writeFile(a, '');
        // b is absent
        await writeFile(c, '');
        await writeFile(d, '');
        await writeFile(index, await gzip(JSON.stringify(data0)));
        const metadata = await storage._readMetadata(dir);
        _.extend(data, metadata, JSON.parse(JSON.stringify(data2)));
        _.extend(data2, metadata, JSON.parse(JSON.stringify(data2)));
        await new Promise(cb => setTimeout(cb, 100));
        await writeFile(index, await gzip(JSON.stringify(data1)));
        await writeFile(part, await gzip(JSON.stringify(data2)));
        await storage._renameMetadata(part, index, data);
        const compressed = await readFile(index);
        const decompressed = await gunzip(compressed);
        const actual = JSON.parse(decompressed.toString());
        data.tables.should.have.length(3);
        data.should.be.like(expected);
        actual.tables.should.have.length(3);
        actual.should.be.like(expected);
    });
});

