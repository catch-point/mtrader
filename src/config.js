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

const _ = require('underscore');
const fs = require('fs');
const path = require('path');
const process = require('process');
const child_process = require('child_process');
const merge = require('./merge.js');
const awriter = require('./atomic-write.js');
const commander = require('commander');
const commander_options = commander.options;
const commander_emit = commander.Command.prototype.emit.bind(commander);

var session = {};

process.argv.forEach((arg, i, args) => {
    if (arg == '--set' && i < args.length -1) {
        var pair = args[i+1].split('=');
        var name = _.first(pair);
        var str = _.rest(pair).join('=');
        if (name && str) {
            assign(session, name.split('.'), parse(str));
        }
    } else if (arg.startsWith('--add-') && i < args.length -1) {
        var map = arg.substring('--add-'.length).replace(/s?$/,'s');
        var pair = args[i+1].split('=');
        var name = _.first(pair);
        var str = pair.length == 1 ? name : _.rest(pair).join('=');
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

if (process.send) {
    process.on('message', msg => {
        if (msg.cmd == 'config' && msg.payload.loadFile) {
            if (_.isString(msg.payload.loadFile))
                module.exports.load(msg.payload.loadFile);
        } else if (msg.cmd == 'config' && msg.payload.unset) {
            module.exports.unset(msg.payload.name);
        } else if (msg.cmd == 'config') {
            module.exports(msg.payload.name, msg.payload.value);
        }
    });
}

process.on('SIGHUP', () => {
    module.exports.load();
});

function createInstance(session) {
    var listeners = [];
    var defaults = {}, stored = {};
    var loadedFrom, loaded = {};

    var config = function(name, value) {
        if (_.isUndefined(value)) {
            var jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
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
        loadedFrom = filename || loadedFrom || opt('load');
        loaded = loadedFrom ? loadConfigFile(config.resolve(loadedFrom)) : {};
        if (loadedFrom && _.isEmpty(loaded))
            console.error("Could not load anything from", loadedFrom);
        listeners.forEach(listener => listener(null, null, filename || true));
    };

    config.fork = function(modulePath, program) {
        var pairs = program.options.filter(o => o.required || o.optional).map(o => o.name().replace('-', '_'));
        var bools = _.reject(program.options, o => o.required || o.optional).map(o => o.name().replace('-', '_'));
        var opts = commander_opts();
        var cfg = _.omit(config(), value => value == null);
        var cfg_pairs = _.pick(_.pick(cfg, pairs), _.isString);
        var cfg_bools = _.without(_.intersection(bools, _.keys(cfg)), 'version').filter(b => cfg[b]);
        var cfg_other = _.difference(_.keys(cfg), pairs, bools)
            .filter(key => _.has(session, key) || _.has(opts, key));
        var arg_pairs = _.flatten(_.zip(
            _.keys(cfg_pairs).map(option => '--' + option.replace('_', '-')),
            _.values(cfg_pairs)
        ));
        var arg_bools = cfg_bools.map(option => option.replace('_', '-'))
            .map(opt => (opt.charAt(0) == '-' ? '' : '--') + opt);
        var arg_other = _.flatten(cfg_other.map(name => ['--set', name + '=' + JSON.stringify(cfg[name])]));
        var args = arg_pairs.concat(arg_bools, arg_other);
        var child = child_process.fork(modulePath, args);
        var fn = (name, value, loadFile) => child.connected && child.send({
            cmd: 'config',
            payload: {name, value, unset: value === undefined, loadFile}
        });
        listeners.push(fn);
        child.on('disconnect', () => {
            var idx = listeners.indexOf(fn);
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
        var jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
        if (_.isUndefined(value)) {
            return get(merge(loaded, commander_opts(), session), jpath);
        } else if (assign(session, jpath, value)) {
            listeners.forEach(listener => listener(name, value));
        }
    };

    config.session = function(name, value) {
        var jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
        if (_.isUndefined(value)) {
            return get(session, jpath);
        } else if (assign(session, jpath, value)) {
            listeners.forEach(listener => listener(name, value));
        }
    };

    config.list = function() {
        var dir = config.configDirname();
        try {
            fs.accessSync(dir, fs.R_OK);
        } catch(e) {
            return [];
        }
        var l = '.json'.length;
        return fs.readdirSync(dir)
            .filter(name => name != 'mtrader.json' && name.lastIndexOf('.json') == name.length - l)
            .map(name => name.substring(0, name.length - l));
    };

    config.save = function(name, cfg) {
        if (!name) throw Error("No name given");
        var file = config.resolve(name);
        writeConfigFile(file, _.omit(cfg || session, _.isNull));
    };

    config.resolve = function(name) {
        var args = _.toArray(arguments);
        var filename = _.last(args) + '.json';
        var loc = path.resolve(config.configDirname(), filename);
        try {
            fs.accessSync(loc, fs.R_OK);
            return loc;
        } catch(e) {
            // not a config name, maybe a file?
        }
        try {
            var file = path.resolve.apply(path, args);
            fs.accessSync(file, fs.R_OK);
            return file;
        } catch(e) {
            // couldn't find it
        }
        return args.length == 1 && !~args[0].lastIndexOf('.json') ? loc : file;
    };

    config.read = function(name) {
        var file = config.resolve.apply(this, arguments);
        try {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch(e) {
            throw Error("Could not parse " + file + ": " + e.message);
        }
    };

    config.store = function(name, value) {
        var jpath = _.isArray(name) ? name : name.split('.');
        if (assign(session, jpath, _.isUndefined(value) ? null : value)) {
            listeners.forEach(listener => listener(name, value));
        }
        var filename = config.configFilename();
        var json = loadConfigFile(filename);
        if (assign(json, jpath, value))
            writeConfigFile(filename, json);
    };

    config.unset = function(name) {
        var jpath = _.isArray(name) ? name : name.split('.');
        if (unset(session, jpath)) {
            listeners.forEach(listener => listener(name, undefined));
        }
    };

    config.add = function(name, value) {
        var jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
        assign(session, jpath, value);
    };

    config.remove = function(name) {
        var jpath = _.isArray(name) ? name : name.split('.');
        assign(session, jpath, undefined);
        var filename = config.configFilename();
        var json = loadConfigFile(filename);
        if (unset(json, jpath))
            writeConfigFile(filename, json);
    };
    return config;
}

function commander_opts() {
    return commander_options.reduce((result, opt) => {
        var name = opt.name();
        var prop = name.replace('-', '_');
        var key = name.split('-').reduce((str, word) => {
            return str + word[0].toUpperCase() + word.slice(1);
        });
        var value = name === 'version' ? commander._version : commander[key];
        if (value != null && !name.startsWith('add-')) {
            result[prop] = parse(value);
        }
        return result;
    }, {});
}

function opt(name, defaultValue) {
    var opt = '--' + name.replace('_', '-');
    var idx = process.argv.indexOf(opt)+1;
    var value = idx && process.argv[idx];
    return value || process.argv.reduce((value, arg) => {
        return arg.indexOf(opt) === 0 && arg.charAt(opt.length) == '=' ?
            arg.substring(opt.length +1) : value;
    }, defaultValue);
}

function parse(str) {
    if (!str || !_.isString(str)) return str;
    var chr = str.charAt(0);
    return chr == '{' || chr == '"' || chr == '[' ||
        str == 'true' || str == 'false' || _.isFinite(str) ?
        JSON.parse(str) : str;
}

function get(object, jpath) {
    if (_.isEmpty(jpath)) return object;
    var initial = _.initial(jpath);
    var last = _.last(jpath);
    var cfg = get(object, initial);
    return _.property(last)(cfg);
};

function loadConfigFile(filename) {
    try {
        fs.accessSync(filename, fs.R_OK);
        return JSON.parse(fs.readFileSync(filename, 'utf-8'));
    } catch(e) {
        return {};
    }
}

function writeConfigFile(filename, json) {
    awriter.writeFileSync(filename, JSON.stringify(json, null, '  ') + '\n');
}

function assign(obj, path, value) {
    var prop = _.first(path);
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
