// config.js
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
'use strict';

const _ = require('underscore');
const fs = require('graceful-fs');
const path = require('path');
const process = require('process');
const child_process = require('child_process');
const moment = require('moment-timezone');
const merge = require('./merge.js');
const awriter = require('./atomic-write.js');
const commander = require('commander');
const commander_options = commander.options;
const commander_emit = commander.Command.prototype.emit.bind(commander);

const session = {};

process.argv.forEach((arg, i, args) => {
    if (arg == '--set' && i < args.length -1) {
        const pair = args[i+1].split('=');
        const name = _.first(pair);
        const str = _.rest(pair).join('=');
        if (name && str) {
            assign(session, name.split('.'), parse(str));
        }
    } else if (arg.startsWith('--add-') && i < args.length -1) {
        const map = arg.substring('--add-'.length).replace(/s?$/,'s');
        const pair = args[i+1].split('=');
        const name = _.first(pair);
        const str = pair.length == 1 ? name : _.rest(pair).join('=');
        if (map && name) {
            if (!session[map]) {
                session[map] = {};
            }
            session[map][name] = parse(str);
        }
    }
});

module.exports = createInstance(session);
module.exports.load();
if (!moment.defaultZone) moment.tz.setDefault(moment.tz.guess());

if (process.send) {
    process.on('message', msg => {
        if (msg.cmd == 'config' && msg.payload.loadFile) {
            if (_.isString(msg.payload.loadFile))
                module.exports.load(msg.payload.loadFile);
        } else if (msg.cmd == 'config' && msg.payload.unset) {
            module.exports.unset(msg.payload.name);
        } else if (msg.cmd == 'config' && _.isObject(msg.payload)) {
            module.exports(msg.payload.name, msg.payload.value);
        }
    });
}

process.on('SIGHUP', () => {
    module.exports.load();
});

function createInstance(session) {
    const listeners = [];
    let defaults = {}, stored = {};
    let loadedFrom, loaded = {};

    const config = function(name, value) {
        if (_.isUndefined(value)) {
            const jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
            return get(merge(defaults, stored, loaded, commander_opts(), session), jpath);
        } else {
            config.options(name, value);
        }
    };

    config.load = function(filename) {
        defaults = _.extend({
            prefix: opt('prefix', process.argv[1] ? path.resolve(process.argv[1], '../..') : '')
        }, loadConfigFile(path.resolve(__dirname, '../etc/mtrader.json')));
        stored = loadConfigFile(path.resolve(defaults.prefix, 'etc/mtrader.json'));
        if (stored.tz) moment.tz.setDefault(stored.tz);
        loadedFrom = filename || loadedFrom || opt('load');
        loaded = loadedFrom ? loadConfigFile(config.resolve(loadedFrom)) : {};
        if (loadedFrom && _.isEmpty(loaded))
            console.error("Could not load anything from", loadedFrom);
        listeners.forEach(listener => listener(null, null, filename || true));
    };

    config.fork = function(modulePath, program) {
        const pairs = program.options.filter(o => o.required || o.optional).map(o => o.name().replace('-', '_'));
        const bools = _.reject(program.options, o => o.required || o.optional).map(o => o.name().replace('-', '_'));
        const opts = commander_opts();
        const cfg = _.omit(config(), value => value == null);
        const cfg_pairs = _.pick(_.pick(cfg, pairs), _.isString);
        const cfg_bools = _.without(_.intersection(bools, _.keys(cfg)), 'version').filter(b => cfg[b]);
        const cfg_other = _.difference(_.keys(cfg), pairs, bools)
            .filter(key => _.has(session, key) || _.has(opts, key));
        const arg_pairs = _.flatten(_.zip(
            _.keys(cfg_pairs).map(option => '--' + option.replace('_', '-')),
            _.values(cfg_pairs)
        ));
        const arg_bools = cfg_bools.map(option => option.replace('_', '-'))
            .map(opt => (opt.charAt(0) == '-' ? '' : '--') + opt);
        const arg_other = _.flatten(cfg_other.map(name => ['--set', name + '=' + JSON.stringify(cfg[name])]));
        const args = arg_pairs.concat(arg_bools, arg_other);
        const child = child_process.fork(modulePath, args, {
            // Pass all current node process arguments to the child process,
            // except the debug-related arguments
            execArgv: process.execArgv.slice(0).filter(function(param) {
                return !param.match(/(--debug|--inspect)(-brk=[0-9]+)?/);
            })
        });
        const fn = (name, value, loadFile) => child.connected && child.send({
            cmd: 'config',
            payload: {name, value, unset: value === undefined, loadFile}
        });
        listeners.push(fn);
        child.on('disconnect', () => {
            const idx = listeners.indexOf(fn);
            if (idx >= 0)
                listeners.splice(idx, 1);
        });
        return child;
    };

    config.configFilename = function() {
        return path.resolve(config('prefix'), 'etc/mtrader.json');
    };

    config.configDirname = function() {
        return opt('config_dir') || config('config_dir') || path.resolve(config('prefix'), config('default_config_dir'));
    };

    config.options = function(name, value) {
        const jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
        if (_.isUndefined(value)) {
            return get(merge(loaded, commander_opts(), session), jpath);
        } else if (assign(session, jpath, value)) {
            listeners.forEach(listener => listener(name, value));
        }
    };

    config.session = function(name, value) {
        const jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
        if (_.isUndefined(value)) {
            return get(session, jpath);
        } else if (assign(session, jpath, value)) {
            listeners.forEach(listener => listener(name, value));
        }
    };

    config.list = function() {
        const dir = config.configDirname();
        try {
            fs.accessSync(dir, fs.R_OK);
        } catch(e) {
            return [];
        }
        const l = '.json'.length;
        return fs.readdirSync(dir)
            .filter(name => name != 'mtrader.json' && name.lastIndexOf('.json') == name.length - l)
            .map(name => name.substring(0, name.length - l));
    };

    config.save = function(name, cfg) {
        if (!name) throw Error("No name given");
        const file = config.resolve(name);
        writeConfigFile(file, _.omit(cfg || session, _.isNull));
    };

    config.resolve = function(name) {
        const args = _.toArray(arguments);
        const filename = _.last(args) + '.json';
        const loc = path.resolve(config.configDirname(), filename);
        try {
            fs.accessSync(loc, fs.R_OK);
            return loc;
        } catch(e) {
            // not a config name, maybe a file?
        }
        try {
            const file = path.resolve.apply(path, args);
            fs.accessSync(file, fs.R_OK);
            return file;
        } catch(e) {
            // couldn't find it
        }
        return args.length == 1 && !~args[0].lastIndexOf('.json') ? loc : filename;
    };

    config.read = function(name) {
        const file = config.resolve.apply(this, arguments);
        try {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch(e) {
            throw Error("Could not parse " + file + ": " + e.message);
        }
    };

    config.store = function(name, value) {
        const jpath = _.isArray(name) ? name : name.split('.');
        if (assign(session, jpath, _.isUndefined(value) ? null : value)) {
            listeners.forEach(listener => listener(name, value));
        }
        const filename = config.configFilename();
        const json = loadConfigFile(filename);
        if (assign(json, jpath, value))
            writeConfigFile(filename, json);
    };

    config.unset = function(name) {
        const jpath = _.isArray(name) ? name : name.split('.');
        if (unset(session, jpath)) {
            listeners.forEach(listener => listener(name, undefined));
        }
    };

    config.add = function(name, value) {
        const jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
        assign(session, jpath, value);
    };

    config.remove = function(name) {
        const jpath = _.isArray(name) ? name : name.split('.');
        assign(session, jpath, undefined);
        const filename = config.configFilename();
        const json = loadConfigFile(filename);
        if (unset(json, jpath))
            writeConfigFile(filename, json);
    };
    return config;
}

function commander_opts() {
    return commander_options.reduce((result, opt) => {
        const name = opt.name();
        const prop = name.replace('-', '_');
        const key = name.split('-').reduce((str, word) => {
            return str + word[0].toUpperCase() + word.slice(1);
        });
        const value = name === 'version' ? commander._version : commander[key];
        if (value != null && !name.startsWith('add-')) {
            result[prop] = parse(value);
        }
        return result;
    }, {});
}

function opt(name, defaultValue) {
    const opt = '--' + name.replace('_', '-');
    const idx = process.argv.indexOf(opt)+1;
    const value = idx && process.argv[idx];
    return value || process.argv.reduce((value, arg) => {
        return arg.indexOf(opt) === 0 && arg.charAt(opt.length) == '=' ?
            arg.substring(opt.length +1) : value;
    }, defaultValue);
}

function parse(str) {
    if (!str || !_.isString(str)) return str;
    const chr = str.charAt(0);
    return chr == '{' || chr == '"' || chr == '[' ||
        str == 'true' || str == 'false' || _.isFinite(str) ?
        JSON.parse(str) : str;
}

function get(object, jpath) {
    if (_.isEmpty(jpath)) return object;
    const initial = _.initial(jpath);
    const last = _.last(jpath);
    const cfg = get(object, initial);
    return _.property(last)(cfg);
};

function loadConfigFile(filename) {
    try {
        fs.accessSync(filename, fs.R_OK);
        return JSON.parse(fs.readFileSync(filename, 'utf-8'));
    } catch(e) {
        console.log("Could not parse " + filename + ": " + e.message);
        return {};
    }
}

function writeConfigFile(filename, json) {
    awriter.writeFileSync(filename, JSON.stringify(json, null, '  ') + '\n');
}

function assign(obj, path, value) {
    const prop = _.first(path);
    if (path.length == 1) {
        try {
            return obj[prop] != value;
        } finally {
            if (_.isUndefined(value)) {
                delete obj[prop];
            } else {
                obj[prop] = value;
            }
        }
    } else if (_.isObject(obj[prop])) {
        return assign(obj[prop], _.rest(path), value);
    } else {
        obj[prop] = {};
        return assign(obj[prop], _.rest(path), value);
    }
}

function unset(obj, path) {
    if (_.isUndefined(obj) || !path.length) {
        return false;
    } else if (path.length == 1) {
        if (!_.has(obj, path)) return false;
        delete obj[path];
        return true;
    } else {
        return unset(obj[_.first(path)], _.rest(path));
    }
}
