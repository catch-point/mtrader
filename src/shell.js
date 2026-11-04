// shell.js
/*
 *  Copyright (c) 2026 James Leigh, Some Rights Reserved
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

import readline from 'node:readline';
import EventEmitter from 'node:events';

const COLORS = {black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37};

/**
 * Interactive command shell used when mtrader runs without arguments.
 * Commands are registered with cmd(pattern, description, handler), where a
 * pattern such as 'quote :symbol' or 'set :option :value([\\S\\s]+)' names
 * space separated parameters, optionally with their own regular expression.
 * A handler is called with (cmd, sh, next): cmd.params holds the matched
 * parameters, sh writes styled output and sh.prompt() asks for the next
 * command, and next(err) reports a failure to the error handler.
 * Emits 'quit' when the user leaves and 'exit' before the process exits.
 */
class Shell extends EventEmitter {
    constructor(settings = {}) {
        super();
        this.settings = {prompt: '>> ', stdin: process.stdin, stdout: process.stdout, ...settings};
        this.routes = [];
        this.errorHandlers = [];
        this.closed = false;
        this.waiting = false; // prompt shown and waiting for a line
        this.ending = false; // input has ended
        this.lines = []; // lines received while a command is running
        this.color = this.settings.stdout.isTTY && !process.env.NO_COLOR;
        this.interface = readline.createInterface({
            input: this.settings.stdin,
            output: this.settings.stdout,
            completer: line => [this.routes.map(route => route.command)
                .filter(command => command && command.startsWith(line)), line]
        });
        this.interface.on('line', line => {
            if (!this.waiting) return this.lines.push(line);
            this.waiting = false;
            this.run(line);
        }).on('close', () => {
            this.ending = true;
            if (this.waiting) this.quit();
        });
        process.on('beforeExit', () => this.emit('exit'));
        this.cmd('quit', "Exit this shell", () => this.quit());
        this.cmd('help', "Show this message", (cmd, sh) => this.help(sh));
        this.cmd('', (cmd, sh) => this.help(sh));
        if (this.settings.introduction) {
            const text = typeof this.settings.introduction == 'string' ? this.settings.introduction :
                'Type "help" or press enter for a list of commands';
            this.settings.stdout.write(text + '\n');
        }
        process.nextTick(() => this.prompt());
    }

    /** Registers a command; earlier registrations take precedence */
    cmd(command, description, handler) {
        if (typeof description == 'function') return this.cmd(command, null, description);
        const keys = [];
        const regexp = command instanceof RegExp ? command : toRegExp(command, keys);
        this.routes.push({command, description, handler, regexp, keys});
        return this;
    }

    /** Adds a handler called as (err, cmd, sh, next) when a command fails */
    use(errorHandler) {
        this.errorHandlers.push(errorHandler);
        return this;
    }

    help(sh) {
        sh.cyan('Available commands:').ln();
        this.routes.filter(route => route.description).forEach(route => {
            sh.cyan(String(route.command).padEnd(19) + ' ').white(route.description).ln();
        });
        sh.prompt();
    }

    prompt() {
        if (this.closed) return;
        if (this.lines.length) return setImmediate(() => this.run(this.lines.shift()));
        if (this.ending) return this.quit();
        this.waiting = true;
        this.interface.setPrompt(this.style('green', this.settings.prompt));
        this.interface.prompt();
    }

    run(line) {
        const command = line.trim();
        const sh = new Response(this);
        const route = this.routes.find(route => route.regexp.test(command));
        const fail = err => this.fail(err, {command, params: {}}, sh);
        if (!route) {
            sh.red(`Command failed to execute ${command}`).ln();
            return sh.prompt();
        }
        const captures = route.regexp.exec(command);
        const params = {};
        captures.slice(1).forEach((value, i) => {
            params[route.keys[i] || i] = typeof value == 'string' ? unescape(value) : value;
        });
        const cmd = {command, params};
        try {
            const result = route.handler(cmd, sh, err => err ? this.fail(err, cmd, sh) : sh.prompt());
            if (result && typeof result.catch == 'function') result.catch(fail);
        } catch (err) {
            fail(err);
        }
    }

    fail(err, cmd, sh) {
        if (this.listenerCount('error')) this.emit('error', err);
        const handlers = this.errorHandlers.slice();
        const next = () => {
            const handler = handlers.shift();
            if (handler) handler(err, cmd, sh, next);
            else sh.prompt();
        };
        next();
    }

    style(color, text) {
        return this.color && COLORS[color] ? `\x1b[${COLORS[color]}m${text}\x1b[39m` : text;
    }

    quit() {
        if (this.closed) return;
        this.closed = true;
        this.emit('quit');
        this.interface.close();
        if (this.settings.stdin.destroy) this.settings.stdin.destroy();
    }
}

/** Styled output for a command; each colour method writes its text and chains */
class Response {
    constructor(shell) {
        this.shell = shell;
        Object.keys(COLORS).forEach(color => {
            this[color] = text => this.print(this.shell.style(color, text == null ? '' : text));
        });
    }
    print(text) {
        this.shell.settings.stdout.write(String(text));
        return this;
    }
    println(text) {
        return this.print(`${text}\n`);
    }
    ln() {
        return this.print('\n');
    }
    prompt() {
        return this.shell.prompt();
    }
}

/**
 * Converts a command pattern to a regular expression. ':name' matches one
 * word and ':name(regexp)' matches the given regular expression.
 */
function toRegExp(command, keys) {
    const source = command.replace(/:(\w+)(\((?:[^()]|\([^()]*\))*\))?(\?)?|([.\\/*+?^${}|[\]])/g,
        (match, key, format, optional, special) => {
            if (special) return special == '*' ? '(.+)' : '\\' + special;
            keys.push(key);
            return (format || '([^ ]+)') + (optional || '');
        });
    return new RegExp(`^${source}/?$`);
}

function unescape(value) {
    try {
        return decodeURIComponent(value);
    } catch (err) {
        return value;
    }
}

export default Shell;
