// expressions.js
/* 
 *  Copyright (c) 2014-2016 James Leigh, Some Rights Reserved
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
const moment = require('moment-timezone');
const periods = require('./periods.js');
const common = require('./common-functions.js');
const lookback = require('./lookback-functions.js');
const indicators = require('./indicator-functions.js');
const like = require('./like.js');
const expect = require('chai').use(like).expect;

module.exports = {
    /**
     * @returns function of expr
     */
    parse(expr, fields, options) {
        expect(expr).to.be.ok.and.a('string');
        var list = parseExpressions(expr);
        if (!list.length) throw Error("No input: " + expr);
        if (list.length > 1) throw Error("Did not expect multiple expressions: " + expr);
        var interval = _.first(periods.sort(_.uniq(_.flatten(list.map(getIntervals), true))));
        var opts = _.defaults({interval: interval}, options);
        return createCalculation(_.first(list), fields, opts);
    },
    /**
     * Produces functions keyed by their smallest interval. All functions must
     * resolve to truthy for the criteria to be considered passing.
     */
    parseCriteriaMap(exprs, fields, options) {
        if (!exprs) return {};
        expect(exprs).to.be.a('string');
        var list = parseAndExpressions(exprs);
        var intervals = periods.sort(_.uniq(_.flatten(list.map(getIntervals), true)));
        var lists = _.groupBy(list, expr => _.first(getIntervals(expr)));
        var functions = _.mapObject(lists, (exprs, interval) => exprs.map(expr => {
            return createCalculation(expr, fields, _.defaults({
                interval: interval
            }, options));
        }));
        var map = _.object(intervals, []);
        _.reduceRight(intervals, (af, interval) => {
            if (!functions[interval]) return af;
            var exprs = functions[interval].concat(af);
            map[interval] = exprs;
            return exprs;
        }, []);
        return _.mapObject(_.pick(map, ar => !_.isEmpty(ar)), exprs => {
            return _.extend(bars => {
                return _.every(exprs, expr => expr(bars));
            }, {
                fields: _.union.apply(_, exprs.map(expr => expr.fields)),
                warmUpLength: Math.max.apply(Math, exprs.map(expr => expr.warmUpLength))
            });
        });
    },
    /**
     * @returns Object, keyed by column names, of functions
     */
    parseColumnsMap(exprs, fields, options) {
        expect(exprs).to.be.ok.and.a('string');
        var list = parseAsExpressions(exprs);
        var intervals = periods.sort(_.uniq(_.flatten(list.map(getIntervals), true)));
        var interval = _.first(intervals);
        var regex = intervals.length == 1 ?
            new RegExp('^' + interval + '\\.(\\w+)$') : new RegExp(/^$/);
        var opts = _.defaults({interval: interval}, options);
        return list.reduce((map, expr) => {
            var name = _.first(expr) == 'AS' ? text(_.last(expr))() :
                serialize(expr).replace(regex, '$1');
            var value = _.first(expr) == 'AS' ? expr[1] : expr;
            return _.extend(map, {[name]: createCalculation(value, fields, opts)});
        }, {});
    },
    /**
     * Produces functions keyed by their serialized expr and grouped by their
     * interval. Only expr that operate within a single interval and require
     * historic bars are included. However, all intervals used by any exprs are
     * included as primary keys, even if there are no warmUp functions for them.
     */
    parseWarmUpMap(exprs, fields, options) {
        expect(exprs).to.be.ok.and.a('string');
        var list = parseExpressions(exprs);
        var intervals = periods.sort(_.uniq(_.flatten(list.map(getIntervals), true)));
        var map = _.object(intervals, intervals.map(() => ({})));
        return list.reduce((map, expr) => {
            return merge(map, createWarmUpMap(expr, fields, options));
        }, map);
    }
};

function parseAndExpressions(str) {
    var list = parseExpressions(str);
    var i=0;
    while (i<list.length) {
        var expr = list[i];
        if (_.first(expr) != 'AND') i++;
        else list.splice(i, 1, expr[1], expr[2]);
    }
    return list;
}

function parseExpressions(str) {
    var list = parseAsExpressions(str);
    return list.map(expr => _.first(expr) == 'AS' ? expr[1] : expr);
}

function parseAsExpressions(str) {
    try {
        var index = 0;
        var list = parseAsExpressionList();
        if (peek()) expect("end of input");
        return list;
    } catch (e) {
        throw Error("Could not parse \"" + str + "\". " + e.stack);
    }

    function parseAsExpressionList() {
        var expressions = [parseAsExpression()];
        while (peek() == ',') {
            index++;
            expressions.push(parseAsExpression());
        };
        return expressions;
    }
    function parseAsExpression() {
        var expr = parseExpression();
        if (peek() != 'A' && peek() != 'a') return expr;
        var as = str.substring(index, index+2);
        if ('AS' != as && 'as' != as || isWord(str[index+2])) return expr;
        index+= 2;
        var name = isQuote(peek()) ? parseString() : JSON.stringify(parseWord());
        return ['AS', expr, name];
    }
    function parseExpression() {
        return parseConditionalOrExpression();
    }
    function parseConditionalOrExpression() {
        var lhs = parseConditionalAndExpression();
        if (peek() != 'O' && peek() != 'o') return lhs;
        var or = str.substring(index,index+2);
        if ('OR' != or && 'or' != or || isWord(str[index+2])) return lhs;
        index+= 2;
        return ['OR', lhs, parseConditionalOrExpression()];
    }
    function parseConditionalAndExpression() {
        var lhs = parseLogicalExpression();
        if (peek() != 'A' && peek() != 'a') return lhs;
        var and = str.substring(index,index+3);
        if ('AND' != and && 'and' != and || isWord(str[index+3])) return lhs;
        index+= 3;
        return ['AND', lhs, parseConditionalAndExpression()];
    }
    function parseLogicalExpression() {
        var lhs = parseNumericExpression();
        if (peek() == '=') {
            index++;
            return ['EQUALS', lhs, parseLogicalExpression()];
        } else if (peek() == '!' && str[index+1] == '=') {
            index+= 2;
            return ['NOT_EQUAL', lhs, parseLogicalExpression()];
        } else if (peek() == '<' && str[index+1] == '>') {
            index+= 2;
            return ['NOT_EQUAL', lhs, parseLogicalExpression()];
        } else if (peek() == '<' && str[index+1] == '=') {
            index+= 2;
            return ['NOT_GREATER_THAN', lhs, parseLogicalExpression()];
        } else if (peek() == '>' && str[index+1] == '=') {
            index+= 2;
            return ['NOT_LESS_THAN', lhs, parseLogicalExpression()];
        } else if (peek() == '<') {
            index++;
            return ['LESS_THAN', lhs, parseLogicalExpression()];
        } else if (peek() == '>') {
            index++;
            return ['GREATER_THAN', lhs, parseLogicalExpression()];
        } else {
            return lhs;
        }
    }
    function parseNumericExpression() {
        return parseAdditiveExpression();
    }
    function parseAdditiveExpression() {
        var lhs = parseMultiplicativeExpression();
        while(peek() == '+' || peek() == '-') {
            if (peek() == '+') {
                index++;
                lhs = ['ADD', lhs, parseMultiplicativeExpression()];
            } else if (peek() == '-') {
                index++;
                lhs = ['SUBTRACT', lhs, parseMultiplicativeExpression()];
            }
        }
        return lhs;
    }
    function parseMultiplicativeExpression() {
        var lhs = parseUnaryExpression();
        while(peek() == '*' || peek() == '×' || peek() == '/' || peek() == '%') {
            if (peek() == '*' || peek() == '×') {
                index++;
                lhs = ['PRODUCT', lhs, parseUnaryExpression()];
            } else if (peek() == '/') {
                index++;
                lhs = ['DIVIDE', lhs, parseUnaryExpression()];
            } else if (peek() == '%') {
                index++;
                lhs = ['MOD', lhs, parseUnaryExpression()];
            }
        }
        return lhs;
    }
    function parseUnaryExpression() {
        if (peek() == '!') {
            index++;
            return ['NOT', parseBrackettedExpression()];
        } else if (peek() == '+') {
            index++;
            return parseBrackettedExpression();
        } else if (peek() == '-' && isNumber(str[index+1])) {
            return parseNumber();
        } else if (peek() == '-') {
            index++;
            return ['NEGATIVE', parseBrackettedExpression()];
        } else {
            return parseBrackettedExpression();
        }
    }
    function parseBrackettedExpression() {
        if (peek() == '(') {
            expect('(');
            var expr = parseExpression();
            expect(')');
            return expr;
        } else if (isLetter(peek())) {
            return parseVariableOrCall();
        } else if (isNumber(peek()) || peek() == '-') {
            return parseNumber();
        } else if (peek() == '"' || peek() == "'") {
            return parseString();
        } else {
            expect("letter, number, or bracket");
        }
    }
    function parseVariableOrCall() {
        var word = parseWord();
        var indicator = peek() == '.';
        if (indicator) {
            index++;
            // fields and indicator functions maybe prefixed with interval
            word = word + '.' + parseWord();
        }
        if (peek() != '(') return word;
        expect('(');
        var args = [parseExpression()];
        while (peek() == ',') {
            index++;
            // indicator functions can only accept numbers
            args.push(indicator ? parseNumber() : parseExpression());
        };
        expect(')');
        return [word].concat(args);
    }
    function parseWord() {
        if (!isWord(peek())) expect("word");
        var start = index;
        while (index < str.length && isWord(str[index]))
            index++;
        return str.substring(start, index);
    }
    function parseString() {
        var quote = peek();
        var start = index;
        if (!isQuote(quote)) expect("quote");
        else expect(quote);
        while (index < str.length && str[index] != quote) {
            if (str[index] == '\\') index+= 2;
            else index++;
        }
        expect(quote);
        return JSON.stringify(JSON.parse(str.substring(start, index)));
    }
    function parseNumber() {
        if (!isNumber(peek()) && peek() != '-') expect("number");
        var start = index;
        if (peek() == '-') index++;
        if (!isNumber(str[index])) expect("number");
        while(isNumber(str[index])) index++;
        if (str[index] != '.')
            return parseInt(str.substring(start, index));
        index++
        if (!isNumber(str[index])) expect("number after decimal point");
        while(isNumber(str[index])) index++;
        if (str[index] == 'E' || str[index] == 'e') {
            index++;
            if (str[index] == '+' || str[index] == '-') index++;
            if (!isNumber(str[index])) expect("number after exponent");
            while(isNumber(str[index])) index++;
        }
        return parseFloat(str.substring(start, index));
    }
    function peek() {
        while (isWhiteSpace(str[index])) index++;
        return str[index];
    }
    function isWhiteSpace(chr) {
        return /\s/.test(chr);
    }
    function isQuote(chr) {
        return chr == '"' || chr == "'";
    }
    function isWord(chr) {
        return isNumber(chr) || isLetter(chr) || '_' == chr;
    }
    function isLetter(chr) {
        return 'a' <= chr && chr <= 'z' || 'A' <= chr && chr <= 'Z';
    }
    function isNumber(chr) {
        return '0' <= chr && chr <= '9';
    }
    function expect(chr) {
        if (peek() != chr && index < str.length)
            throw Error("Expected " + chr + ", but got " + str.substring(index, index + 10) + "...");
        if (peek() != chr)
            throw Error("Expected " + chr + ", but no more input");
        return expect[index++];
    }
}

function serialize(expr) {
    if (_.isString(expr) || _.isFinite(expr)) return expr; // number, string literal, or field
    else if (_.isArray(expr)) return _.first(expr) + '(' + _.rest(expr).map(serialize).join(',') + ')';
    else throw Error("Unknown expression: " + expr);
}

function getIntervals(expr) {
    if (_.isString(expr) && expr.match(/^\w+\./)) {
        return [expr.substring(0, expr.indexOf('.'))];
    } else if (_.isArray(expr) && _.first(expr).indexOf('.') > 0) {
        return getIntervals(_.first(expr));
    } else if (_.isArray(expr)) {
        return periods.sort(_.uniq(_.flatten(_.rest(expr).map(getIntervals), true)));
    } else {
        return [];
    }
}

function createCalculation(expr, fields, options) {
    expect(fields).not.to.be.empty;
    _.keys(fields).forEach(key => expect(fields[key], key).to.be.an('array'));
    if (_.isFinite(expr)) return finite(+expr);
    else if (!_.isArray(expr)) {
        if (expr.charAt(0) == '"') return text(expr);
        var m = expr.match(/^(\w+)\.(\w+.*)/);
        var interval = m ? m[1] : '';
        var name = m ? m[2] : expr;
        if (_.contains(fields[interval], name)) return field(interval, name);
        else if (_.has(fields, interval)) throw Error("Unknown field: " + expr + " should be one of: " + fields[interval].join(', '));
        else throw Error("Unknown interval: " + interval + " should be one of: " + _.keys(fields).join(', '));
    }
    var key = serialize(expr);
    var intervals = getIntervals(expr);
    var interval = _.first(intervals);
    if (intervals.length == 1 && _.has(fields, interval) && _.contains(fields[interval], key))
        return field(interval, key);
    var opts = _.has(fields, interval) ? _.defaults({interval: interval}, options) : options;
    var args = _.rest(expr).map(expr => createCalculation(expr, fields, opts));
    return build(_.first(expr), args, intervals, fields[interval], opts);
}

function createWarmUpMap(expr, fields, options) {
    if (!_.isArray(expr)) {};
    var map = _.rest(expr).reduce((m, expr) => merge(m, createWarmUpMap(expr, fields, options)), {});
    var intervals = getIntervals(expr);
    if (intervals.length != 1) return map;
    var opts = _.defaults({interval: _.first(intervals)}, options);
    var withMap = createCalculation(expr, merge(_.mapObject(map, _.keys), fields), opts);
    if (!_.isFinite(withMap.warmUpLength) || withMap.warmUpLength < 1) return map;
    else return {[_.first(intervals)]: {[serialize(expr)]: createCalculation(expr, fields, opts)}};
}

function merge(a, b) {
    return _.extend(a, _.mapObject(b, (value, key) => {
        if (!a[key]) {
            return value;
        } else if (_.isArray(a[key])) {
            return _.union(a[key], value);
        } else {
            return _.extend(a[key], value);
        }
    }));
}

function build(name, args, intervals, fields, options) {
    if (common[name]) {
        var calc = common[name].apply(this, [options].concat(args));
        return _.extend(bars => calc(bars), {
            fields: _.union.apply(_, _.pluck(args, 'fields')),
            warmUpLength: Math.max.apply(Math, _.pluck(args, 'warmUpLength'))
        });
    } else if (lookback[name]) {
        if (intervals.length > 1 && _.isFinite(lookback[name].warmUpLength))
            throw Error("The function " + name + " can only be used with a single interval, not " + intervals.join(' and '));
        if (intervals.length < 1)
            throw Error("The function " + name + " must be used with fields");
        var calc = lookback[name].apply(this, [options].concat(args));
        var length = Math.max.apply(Math, [calc.warmUpLength || 0].concat(_.pluck(args, 'warmUpLength')));
        var n = length +1;
        return _.extend(bars => {
            if (bars.length <= n) return calc(bars);
            else return calc(bars.slice(bars.length - n));
        }, {
            fields: _.union.apply(_, _.pluck(args, 'fields')),
            warmUpLength: length
        });
    } else if (name.indexOf('.') > 0 && indicators[name.substring(name.indexOf('.')+1)]) {
        var interval = name.substring(0, name.indexOf('.'));
        expect(options.interval).to.eql(interval);
        var fn = name.substring(name.indexOf('.')+1);
        var fargs = [options].concat(args.map(f => {
            try {
                return f();
            } catch (e) {
                throw Error("The function " + name + " can only be used with literal parameters (not fields)");
            }
        })); // args must be finite
        var calc = indicators[fn].apply(this, fargs);
        var missing = _.difference(calc.fields, fields);
        if (!_.isEmpty(missing))
            throw Error("The function " + name + " requires the indicator(s) " + missing.join(" and ") + " to be present and cannot be used here");
        var n = calc.warmUpLength +1;
        return _.extend(bars => {
            // indicator functions operate on a specific period of bars
            if (bars.length <= n) return calc(_.pluck(bars, interval));
            else return calc(_.pluck(bars.slice(bars.length - n), interval));
        }, {
            fields: calc.fields,
            warmUpLength: calc.warmUpLength
        });
    } else {
        var functions = _.flatten(_.keys(indicators).map(fn => _.keys(fields).map(i => i + '.' + fn)));
        var names = _.keys(common).concat(_.keys(lookback), functions).sort();
        var idx = _.sortedIndex(names, name);
        var similar = names.slice(Math.max(idx -5,0), idx +5);
        throw Error("Unknown function: " + name + ", but these might work: " + names.join(','));
    }
}

function field(interval, name) {
    if (!_.isString(name) || name.match(/\s/))
        throw Error("Must be a field: " + name);
    var geti = interval ? _.property(interval) : _.identity;
    var getp = _.property(name);
    return _.extend(bars => {
        return getp(geti(_.last(bars)));
    }, {
        fields: [name],
        warmUpLength: 0
    });
}

function finite(number) {
    if (!_.isFinite(number))
        throw Error("Must be a number: " + number);
    return _.extend(() => +number, {
        fields: [],
        warmUpLength: 0
    });
}

function text(string) {
    if (!_.isString(string) || string.match(/\s/) && string.replace(' ','_').match(/\s/))
        throw Error("Must be a single line string: " + string);
    var text = JSON.parse(string);
    return _.extend(() => text, {
        fields: [],
        warmUpLength: 0
    });
}
