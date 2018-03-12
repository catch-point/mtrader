// parser.js
/*
 *  Copyright (c) 2014-2017 James Leigh, Some Rights Reserved
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
const expect = require('chai').expect;

/**
 * Given a hash of methods: constant(value), variable(name),
 * expression(expr, name, args) and a substitutions string expression to pre-bind
 * variables with another expression. The methods are expected to return functions, but they
 * can return anything. The parameter args is an array of functions returned by
 * previous calls to one of the given methods.
 */
module.exports = function(handlers) {
    var subs = parseVariables(handlers && handlers.substitutions);
    var _handlers = {
        constant(value) {
            if (!handlers || !handlers.constant) return JSON.stringify(value);
            else return handlers.constant(value);
        },
        variable(name) {
            if (!handlers || !handlers.variable) return name;
            else return handlers.variable(name);
        },
        expression(expr, name, args) {
            if (!handlers || !handlers.expression) return expr;
            else return handlers.expression(expr, name, args);
        }
    };
    return {
        /**
         * @returns function of expr
         */
        parse(expr) {
            if (_.isNumber(expr))
                return _handlers.constant(expr);
            else if (_.isString(expr))
                return parseExpression(expr, subs, _handlers);
            else if (_.isNumber(expr))
                return parseExpression(expr.toString(), subs, _handlers);
            else if (_.isArray(expr))
                return expr.map(value => parseExpression(value, subs, _handlers));
            else if (_.isObject(expr) && !_.isFunction(expr) && _.allKeys(expr).every(k=>_.has(expr,k)))
                return _.mapObject(expr, (value, name) => {
                    try {
                        return parseExpression(value, subs, _handlers);
                    } catch(e) {
                        throw Error("Could not parse property " + name + ". " + e.message);
                    }
                });
            else
                expect(expr).to.be.ok.and.a('string');
        },
        /**
         * Produces Array of functions that must each resolve to truthy for the
         * criteria to be considered passing.
         */
        parseCriteriaList(exprs) {
            if (_.isEmpty(exprs)) return [];
            if (!_.isArray(exprs) && !_.isString(exprs)) expect(exprs).to.be.a('string');
            var list = _.isArray(exprs) ?
                _.flatten(exprs.map(val=>parseExpressions(val, subs)), true) :
                parseExpressions(exprs, subs);
            var i=0;
            while (i<list.length) {
                var expr = list[i];
                if (_.first(expr) != 'AND') i++;
                else list.splice(i, 1, expr[1], expr[2]);
            }
            return list.map(expr => {
                return invokeHandler(expr, _handlers);
            });
        }
    };
};

/**
 * Indexes the expressions by their variable names, if they have one
 */
function parseVariables(exprs) {
    if (!exprs) return {};
    var variables = _.mapObject(_.pick(exprs, (val,key)=>val!=key), val => parseExpression(val));
    var handlers = {
        constant(value) {
            return [];
        },
        variable(name) {
            if (variables[name]) return [name];
            else return [];
        },
        expression(expr, name, args) {
            return _.uniq(_.flatten(args, true));
        }
    };
    var references = _.mapObject(variables, (expr, name) => {
        var reference = invokeHandler(expr, handlers);
        if (!_.contains(reference, name)) return reference;
        else throw Error("Expression cannot reference itself: " + name);
    });
    while (_.reduce(references, (more, reference, name) => {
        if (!reference.length) return more;
        var second = _.uniq(_.flatten(reference.map(ref => references[ref]), true));
        if (_.contains(second, name)) throw Error("Circular Reference " + name);
        variables[name] = inline(variables[name], variables);
        references[name] = second;
        return more || second.length;
    }, false));
    return variables;
}

function parseExpression(str, substitutions, handlers) {
    var list = parseExpressions(str, substitutions);
    if (!list.length) throw Error("No input: " + str);
    if (list.length > 1) throw Error("Did not expect multiple expressions: " + str);
    try {
        if (handlers) return invokeHandler(_.first(list), handlers);
        else return _.first(list);
    } catch (e) {
        throw Error(e.message + " in " + str, e);
    }
}

function parseExpressions(str, substitutions) {
    var expressions = parseExpressionList(str.toString());
    if (_.isEmpty(substitutions)) return expressions;
    else return expressions.map(expr => inline(expr, substitutions));
}

function inline(expr, substitutions) {
    if (_.isArray(expr)) {
        return expr.map((expr, i) => i === 0 ? expr : inline(expr, substitutions));
    } else if (_.isString(expr) && _.has(substitutions, expr)) {
        return substitutions[expr];
    } else {
        return expr;
    }
}

function invokeHandler(expr, handlers) {
    if (_.isArray(expr)) {
        var args = _.rest(expr).map(expr => invokeHandler(expr, handlers));
        var fn = handlers.expression(serialize(expr), _.first(expr), args);
        if (!_.isUndefined(fn)) return fn;
        else throw Error("Unknown function: " + _.first(expr));
    } else if (_.isString(expr) && expr.charAt(0) == '"') {
        return handlers.constant(JSON.parse(expr));
    } else if (_.isNumber(expr) && _.isFinite(expr)) {
        return handlers.constant(+expr);
    } else {
        return handlers.variable(expr);
    }
}

const operators = {
    NEGATIVE: {op: '-', priority: 1},
    NOT: {op: '!', priority: 1},
    MOD: {op: '%', priority: 2},
    DIVIDE: {op: '/', priority: 2, associative: false},
    PRODUCT: {op: '*', priority: 2, associative: true},
    SUBTRACT: {op: '-', priority: 3, associative: false},
    ADD: {op: '+', priority: 3, associative: true},
    GREATER_THAN: {op: '>', priority: 4},
    LESS_THAN: {op: '<', priority: 4},
    NOT_LESS_THAN: {op: '>=', priority: 4},
    NOT_GREATER_THAN: {op: '<=', priority: 4},
    NOT_EQUAL: {op: '!=', priority: 4},
    EQUALS: {op: '=', priority: 4},
    AND: {op: ' AND ', priority: 5, associative: true},
    OR: {op: ' OR ', priority: 6, associative: true}
};

function serialize(expr) {
    if (_.isArray(expr) && operators[_.first(expr)]) {
        var operator = operators[_.first(expr)];
        var exprs = _.rest(expr).map((arg, i) => {
            var aop = operators[_.first(arg)];
            if (!_.isArray(arg) || !aop || aop.priority < operator.priority)
                return serialize(arg);
            else if (aop.priority == operator.priority && operator.associative)
                return serialize(arg); // 1 * 2 / 3 or 1 + 2 - 3
            else if (aop == operator && operator.associative)
                return serialize(arg); // 1 != 2 AND 3 != 4 AND 5
            else return '(' + serialize(arg) + ')';
        });
        if (exprs.length == 1) return operator.op + exprs[0];
        else return exprs.join(operator.op);
    } else if (_.isArray(expr)) {
        return _.first(expr) + '(' + _.rest(expr).map(serialize).join(',') + ')';
    } else if (_.isString(expr) || _.isFinite(expr)) {
        return expr; // string literal, number or variable
    } else {
        throw Error("Unknown expression: " + expr);
    }
}

function parseExpressionList(str) {
    try {
        var index = 0;
        var expressions = [parseExpression()];
        while (peek() == ',') {
            index++;
            expressions.push(parseExpression());
        };
        if (peek()) expect("end of input");
        return expressions;
    } catch (e) {
        throw Error("Could not parse \"" + str + "\". " + e.message);
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
        } else if (isLetter(peek()) || peek() == '_') {
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
        var args = peek() == ')' ? [] : [parseExpression()];
        while (peek() == ',') {
            index++;
            args.push(parseExpression());
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
        var buf = ['"'];
        while (index < str.length && str[index] != quote) {
            if (str[index] == '"' || str[index] == '\\') buf.push('\\');
            if (str[index] == '\\') index+= 2;
            else index++;
            buf.push(str[index -1]);
        }
        buf.push('"');
        expect(quote);
        return JSON.stringify(JSON.parse(buf.join('')));
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
