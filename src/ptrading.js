#!/usr/bin/env node
// vim: set filetype=javascript:
// ptrading.js
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

const net = require('net');
const _ = require('underscore');
const shell = require('shell');
const expect = require('chai').expect;
const logger = require('./logger.js');
const remote = require('./remote-process.js');
const replyTo = require('./promise-reply.js');
const config = require('./ptrading-config.js');
const shellError = require('./shell-error.js');

const WORKER_COUNT = require('os').cpus().length;

var program = require('commander').version(require('../package.json').version)
    .description(require('../package.json').description)
    .command('config <name> [value]', "View or change stored options")
    .command('fetch <interval> <symbol.exchange>', "Fetches remote data for the given symbol")
    .command('quote <symbol.exchange>', "Historic information of a security")
    .command('collect [identifier]', "Collects historic portfolio data")
    .command('optimize [identifier]', "Optimizes the parameter values in the given portfolio")
    .command('bestsignals [identifier]', "Determines the best signals for the given portfolio")
    .option('-v, --verbose', "Include more information about what the system is doing")
    .option('-s, --silent', "Include less information about what the system is doing")
    .option('--debug', "Include details about what the system is working on")
    .option('--prefix <dirname>', "Path where the program files are stored")
    .option('--load <identifier>', "Read the given session settings")
    .option('-o, --offline', "Disable data updates")
    .option('--workers <numOfWorkers>', 'Number of workers to spawn')
    .option('--remote-workers <host:port,..>', "List of host:port addresses to connect to")
    .option('--set <name=value>', "Name=Value pairs to be used in session")
    .option('--listen [address:port]', "Interface and TCP port to listen for jobs")
    .option('--stop', "Signals all remote workers to stop and shutdown");

if (require.main === module) {
    if (process.argv.length > 2) {
        // don't call an executable if no command given
        program.executables = false;
        program.addImplicitHelpCommand();
        program.executeSubCommand = _.wrap(program.executeSubCommand, (fn, argv, args, unknown) => {
            // include known options in sub-command
            var arg = [].concat(
                args,
                ['--prefix', config('prefix')],
                parseKnownOptions(program, argv)
            );
            return fn.call(program, argv, arg, unknown);
        });
        program.parse(process.argv);
    }
    if (config('stop')) {
        var remote_workers = _.flatten(_.compact(_.flatten([config('listen'), config('remote_workers')]))
            .map(addr => addr.split(',')));
        var remoteWorkers = remote_workers.map(address => {
            return replyTo(remote(address))
                .on('error', err => logger.error(err, err.stack));
        });
        Promise.all(remoteWorkers.map(worker => new Promise(stopped => {
            worker.handle('stop', stopped).request('stop');
        }).then(() => worker.disconnect()))).catch(err => logger.error(err, err.stack));
    } else if (config('listen')) {
        var ptrading = createInstance();
        var server = listen(config('listen'), ptrading);
        server.on('close', () => ptrading.close());
        process.on('SIGINT', () => {
            server.close();
            server.clients.forEach(client => client.end());
            ptrading.close();
        }).on('SIGTERM', () => {
            server.close();
            server.clients.forEach(client => client.end());
            ptrading.close();
        });
    } else if (_.isEmpty(program.args)) {
        var app = new shell({isShell: true});
        var settings = {shell: app, introduction: true};
        app.configure(function(){
            app.use(shell.history(settings));
            app.use(shell.completer(settings));
            app.use(shell.router(settings));
            app.use(shell.help(settings));
            app.use(shellError(settings));
        });
        settings.sensitive = null; // disable case insensitivity in commands
        var ptrading = createInstance();
        ptrading.shell(app);
        process.on('SIGINT', () => app.quit());
        process.on('SIGTERM', () => app.quit());
    }
} else {
    module.exports = createInstance();
}

function parseKnownOptions(program, argv) {
    return _.filter(argv, (arg, i) => {
        if (program.optionFor(arg)) return true;
        else if (i === 0) return false;
        var prior = program.optionFor(argv[i-1]);
        // if prior option is required or optional and not a flag
        return prior && prior.required && arg ||
            prior && prior.optional && ('-' != arg[0] || '-' == arg);
    });
}

function createInstance() {
    var fetch = require('./ptrading-fetch.js');
    var quote = require('./ptrading-quote.js');
    var collect = require('./ptrading-collect.js');
    var optimize = require('./ptrading-optimize.js');
    var bestsignals = require('./ptrading-bestsignals.js');
    return {
        config: config,
        lookup(options) {
            return fetch(_.defaults({
                interval: 'lookup'
            }, options));
        },
        fundamental(options) {
            return fetch(_.defaults({
                interval: 'fundamental'
            }, options)).then(_.first);
        },
        fetch: fetch,
        quote: quote,
        collect: collect,
        optimize: optimize,
        bestsignals: bestsignals,
        close() {
            return bestsignals.close();
        },
        shell(app) {
            Promise.all([
                config.shell(app),
                fetch.shell(app),
                quote.shell(app),
                collect.shell(app),
                optimize.shell(app),
                bestsignals.shell(app)
            ]).catch(err => console.error("Could not complete shell setup", err));
        }
    };
}

function listen(address, ptrading) {
    var clients = [];
    var server = net.createServer({pauseOnConnect: true}, socket => {
        clients.push(socket);
        logger.log("Client", socket.remoteAddress, socket.remotePort, "connected");
        var process = remote(socket).on('error', err => {
            logger.error(err, err.stack);
            socket.end();
        });
        replyTo(process)
            .handle('lookup', ptrading.lookup)
            .handle('fundamental', ptrading.fundamental)
            .handle('fetch', ptrading.fetch)
            .handle('quote', ptrading.quote)
            .handle('collect', ptrading.collect)
            .handle('optimize', ptrading.optimize)
            .handle('bestsignals', ptrading.bestsignals)
            .handle('worker_count', () => config('workers') != null ? config('workers') : WORKER_COUNT)
            .handle('stop', () => {
                server.close();
                clients.forEach(client => {
                    if (!client.destroyed) client.write(JSON.stringify({cmd:'stop'}) + '\r\n\r\n');
                });
          }).on('error', err => logger.error(err, err.stack))
            .on('disconnect', () => {
                clients.splice(clients.indexOf(socket), 1);
                logger.log("Client", socket.remoteAddress, socket.remotePort, "disconnected");
            });
        socket.resume();
    }).on('error', err => logger.error(err, err.stack))
      .on('listening', () => logger.info("Server listening on port", server.address().port));
    if (address && typeof address == 'boolean') {
        server.listen();
    } else {
        var addr = parseAddressPort(address);
        if (addr.address) {
            server.listen(addr.port, addr.address);
        } else {
            server.listen(addr.port);
        }
    }
    server.clients = clients;
    return server;
}

function parseAddressPort(addr) {
    expect(addr).to.be.a('string');
    var port = addr.match(/:\d+$/) ? parseInt(addr.substring(addr.lastIndexOf(':')+1)) :
        addr.match(/^\d+$/) ? parseInt(addr) : 0;
    var address = addr.match(/:\d+$/) ? addr.substring(0, addr.lastIndexOf(':')) :
        addr.match(/^\d+$/) ? null : addr;
    return {address, port};
}
