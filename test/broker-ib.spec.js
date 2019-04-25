// broker-ib.spec.js
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

const path = require('path');
const _ = require('underscore');
const moment = require('moment-timezone');
const like = require('./should-be-like.js');
const config = require('../src/config.js');
const IB = require('../src/broker-ib.js');

describe("broker-ib", function() {
    this.timeout(100000);
    var client = new IB({account: 'All', clientId:0});
    before(function() {
        return client.open().catch(err => {
            client = null;
            this.skip();
        });
    });
    beforeEach(function() {
        if (client == null) this.skip();
    });
    after(function() {
        if (client) return client.close();
    });
    before(function() {
        config('fetch.ib.enabled', true);
        config('fetch.yahoo.enabled', true);
    });
    after(function() {
        config.unset('fetch.ib.enabled');
        config.unset('fetch.yahoo.enabled');
    });
    it("should list balances", function() {
        return client({action: 'balances'}).then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:20,breakLength:100}))||d);
    });
    it.skip("should list positions", function() {
        return client({action: 'positions'}).then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:20,breakLength:100}))||d);
    });
    it("should list open orders", function() {
        return client({action: 'orders'}).then(d=>console.log(require('util').inspect(d,{depth:null,colors:true,maxArrayLength:20,breakLength:100}))||d);
    });
});
