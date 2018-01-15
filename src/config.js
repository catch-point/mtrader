// config.js
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

const _ = require('underscore');
const fs = require('fs');
const path = require('path');
const process = require('process');
const child_process = require('child_process');
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
            session[name] = parse(str);
        }
    } else if (arg.startsWith('--add-') && i < args.length -1) {
        var map = arg.substring('--add-'.length).replace(/s?$/,'s');
        var pair = args[i+1].split('=');
        var name = _.first(pair);
        var str = _.rest(pair).join('=');
        if (map && name && str) {
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
            else
                process.emit('SIGHUP');
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
        if (name == 'remote_workers') console.log("config", config.opts());
        if (_.isUndefined(value)) {
            var jpath = _.isArray(name) ? name : _.isUndefined(name) ? [] : name.split('.');
            return get(merge({}, session, config.opts(), loaded, stored, defaults), jpath);
        } else {
            config.options(name, value);
        }
    };

    config.load = function(filename) {
        defaults = _.extend({
            prefix: opt('prefix', process.argv[1] ? path.resolve(process.argv[1], '../..') : '')
        }, loadConfigFile(path.resolve(__dirname, '../etc/ptrading.json')));
        stored = loadConfigFile(path.resolve(defaults.prefix, 'etc/ptrading.json'));
        loadedFrom = filename || loadedFrom || opt('load');
        var default_config_dir = path.resolve(defaults.prefix, defaults.default_config_dir);
        var config_dir = opt('config_dir') || stored.config_dir || defaults.config_dir || default_config_dir;
        loaded = loadedFrom ? loadConfigFile(path.resolve(config_dir, loadedFrom)) : {};
        listeners.forEach(listener => listener(null, null, filename || true));
    };

    config.fork = function(modulePath, program) {
        var pairs = program.options.filter(o => o.required || o.optional).map(o => o.name().replace('-', '_'));
        var bools = _.reject(program.options, o => o.required || o.optional).map(o => o.name().replace('-', '_'));
        var opts = config.opts();
        var cfg = _.omit(config(), value => value == null);
        var cfg_pairs = _.pick(_.pick(cfg, pairs), _.isString);
        var cfg_bools = _.without(_.intersection(bools, _.keys(cfg)), 'version');
        var cfg_other = _.difference(_.keys(cfg), pairs, bools)
            .filter(key => _.has(session, key) || _.has(opts, key));
        var arg_pairs = _.flatten(_.zip(
            _.keys(cfg_pairs).map(option => '--' + option.replace('_', '-')),
            _.values(cfg_pairs)
        ));
        var arg_bools = cfg_bools.map(option => option.replace('_', '-'))
            .map(opt => (opt.charAt(0) == '-' ? '' : cfg[opt] ? '--' : '--no-') + opt);
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
        return path.resolve(config('prefix'), 'etc/ptrading.json');
    };

    config.configDirname = function() {
        return opt('config_dir') || config('config_dir') || path.resolve(config('prefix'), config('default_config_dir'));
    };

    config.opts = function() {
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

    config.options = function(name, value) {
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
        return fs.readdirSync(dir)
            .filter(name => name != 'ptrading.json' && name.indexOf('.json') == name.length - '.json'.length)
            .map(name => name.substring(0, name.length - '.json'.length));
    };

    config.save = function(name, cfg) {
        var file = path.resolve(config.configDirname(), name + '.json');
        writeConfigFile(file, _.omit(cfg || session, _.isNull));
    };

    config.read = function(name) {
        var file = path.resolve(config.configDirname(), name + '.json');
        try {
            fs.accessSync(file, fs.R_OK);
        } catch(e) {
            return false;
        }
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
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

function merge(obj) {
    var length = arguments.length;
    if (length < 2 || obj == null) return obj;
    for (var index = 1; index < length; index++) {
        var source = arguments[index],
        keys = _.allKeys(source),
        l = keys.length;
        for (var i = 0; i < l; i++) {
            var key = keys[i];
            if (obj[key] === void 0)
                obj[key] = source[key];
            else if (_.isObject(obj[key]) && !_.isArray(obj[key]))
                obj[key] = merge({}, obj[key], source[key]);
        }
    }
    return obj;
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
    var dirname = path.dirname(filename);
    try {
        fs.accessSync(dirname, fs.F_OK);
    } catch(e) {
        mkdirp(dirname);
    }
    fs.writeFileSync(filename, JSON.stringify(json, null, '  ') + '\n');
}

function mkdirp(dirname) {
    var parent = path.dirname(dirname);
    try {
        fs.accessSync(parent, fs.F_OK);
    } catch(e) {
        if (parent != dirname) mkdirp(parent);
    }
    fs.mkdirSync(dirname);
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
