// like.js
/*
 *  Copyright (c) 2016-2018 James Leigh, Some Rights Reserved
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

module.exports = function() {
    if (arguments[0].Assertion) return register.apply(this, arguments);
    else return like.apply(this, arguments);
};

function like(expected) {
    if (_.isNull(expected)) {
        return _.isNull;
    } else if (_.isUndefined(expected)) {
        return _.isUndefined;
    } else if (_.isFunction(expected)) {
        return expected;
    } else if (_.isFunction(expected.test)) { // like RegEx
        return expected.test.bind(expected);
    } else if (_.isNumber(expected)) {
        var str = expected.toFixed(20);
        if (!~str.indexOf('.')) return _.isEqual.bind(_, expected);
        var precision = 1;
        while (expected != expected.toFixed(precision) && precision < 20) precision++;
        var delta = Math.pow(10, -precision);
        return actual => Math.abs(actual - expected) <= delta;
    }
    var m = _.isArray(expected) ? _.map(expected, like) :
        _.isObject(expected) ? _.mapObject(expected, like) : undefined;
    if (!m) return _.isEqual.bind(_, expected);
    else return (actual, unexpected_path) => {
        if (_.isArray(m) && m.length != actual.length) return false;
        else return _.reduce(m, (truth, test, key) => {
            if (!truth) return truth;
            if (!_.has(actual, key)) return false;
            var result = test(actual[key], unexpected_path);
            if (!result && _.has(actual, key) && _.isArray(unexpected_path))
                unexpected_path.unshift(key);
            return result;
        }, true);
    };
}

function register(chai, utils) {
    chai.Assertion.addMethod('like', function(expected) {
        var unexpected_path = [];
        var truth = like(expected)(this._obj, unexpected_path);
        var act = unexpected_path.reduce((obj, prop) => obj[prop], this._obj);
        var exp = unexpected_path.reduce((obj, prop) => obj[prop], expected);
        var msg = _.isEmpty(unexpected_path) ?
            _.isFunction(exp) ? "expected #{act} to be like " + exp.toString() :
            "expected #{act} to be like #{exp}" :
            "expected " + ['#{this}'].concat(unexpected_path).join('.') +
                " of #{act} to be like #{exp}";
        this.assert(
            truth,
            msg,
            "expected #{act} to be not like " + (_.isFunction(exp) ? exp.toString() : '#{exp}'),
            _.isFunction(exp) ? exp.toString() : exp,
            act || this._obj,
            true // showDiff
        );
    });
}
