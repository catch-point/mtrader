// ivolatility-client.js
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

const fs = require('graceful-fs');
const path = require('path');
const _ = require('underscore');
const csv = require('fast-csv');
const logger = require('./logger.js');
const interrupt = require('./interrupt.js');
const storage = require('./storage.js');
const expect = require('chai').expect;

module.exports = function(dir) {
    return options => {
        expect(options).to.have.property('iv_symbol');
        var symbol = options.iv_symbol;
        expect(symbol).to.be.like(/^(\w+)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
        var m = symbol.match(/^(\w+)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
        var [, underlying, yy, month, day] = m;
        var cc = +yy<50 ? 2000 : 1900;
        var year = cc + +yy;
        var expiry_date = `${year}-${month}-${day}`;
        var file = path.resolve(dir, underlying, expiry_date, symbol + '.csv');
        return Promise.resolve(new Promise((present, absent) => {
            fs.access(file, fs.R_OK, err => err ? absent(err) : present(file));
        }).then(present => readTable(file), absent => {
            throw Error(`Could not read ${file} ${absent.message}`);
        }));
    };
};

function readTable(filename) {
    var check = interrupt();
    return new Promise((ready, error) => {
        var objects = new Array();
        csv.fromStream(fs.createReadStream(filename), {headers : true, ignoreEmpty: true})
            .on('error', error)
            .on('data', function(data) {
                try {
                    check();
                    objects.push(_.mapObject(data, value => _.isFinite(value) ? +value : value));
                } catch (e) {
                    this.emit('error', e);
                }
            })
            .on('end', () => ready(objects));
    });
}
