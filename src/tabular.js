// tabular.js
/*
 *  Copyright (c) 2016-2021 James Leigh, Some Rights Reserved
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

const fs = require('graceful-fs');
const os = require('os');
const path = require('path');
const process = require('process');
const zlib = require('zlib');
const _ = require('underscore');
const spawn = require('child_process').spawn;
const Writable = require('stream').Writable;
const {parseStream, format} = require('fast-csv');
const awriter = require('./atomic-write.js');
const logger = require('./logger.js');

module.exports = function(data, options) {
    if(_.isString(data)) return read(data, options);
    else return write(data, options);
};

function write(data, options) {
    if (_.isEmpty(data)) return logger.info("Empty result, not writing", options.output || '');
    const filename = getOutputFile(options);
    const transpose = options.transpose && options.transpose.toString() != 'false';
    const reverse = options.reverse && options.reverse.toString() != 'false';
    const append = filename && options.append && options.append.toString() != 'false';
    const gzip = filename && (options.gzip && options.gzip.toString() != 'false' || filename.endsWith('.gz'));
    const csv = options.csv || filename && (filename.endsWith('.csv') || filename.endsWith('.csv.gz'));
    if (transpose && append) throw Error("Cannot append to a transposed file");
    return Promise.resolve(append ? new Promise(cb => {
        fs.access(filename, fs.R_OK, err => err ? cb(false) : cb(true));
    }).then(present => new Promise((ready, error) => {
        const objects = [];
        if (!present) return ready(objects);
        const stream = fs.createReadStream(filename).on('error', error);
        const pipe = gzip ? stream.pipe(zlib.createGunzip().on('error', error)) : stream;
        parseStream(pipe, csv ?
            {headers : true, ignoreEmpty: true, delimiter: ',', quote: '"', escape: '"'} :
            {headers : true, ignoreEmpty: true, delimiter: '\t', quote: null, comment: '#'}
        )
            .on('error', error)
            .on('data', data => objects.push(_.mapObject(data, parseValue)))
            .on('end', () => ready(objects));
    })).then(existing => reverse ? existing.reverse().concat(data) : existing.concat(data)) : data)
      .then(data => {
        if (filename) return awriter(filename => writeData(transpose, reverse, csv, gzip, filename, data), filename);
        else return writeData(transpose, reverse, false, false, null, data);
    }).then(() => launchOutput(filename, options));
}

function read(filename, options) {
    const reverse = options.reverse && options.reverse.toString() != 'false';
    const gzip = filename && (options.gzip && options.gzip.toString() != 'false' || filename.endsWith('.gz'));
    const csv = options.csv || filename && (filename.endsWith('.csv') || filename.endsWith('.csv.gz'));
    return new Promise((ready, error) => {
        const objects = [];
        const stream = fs.createReadStream(filename).on('error', error);
        const pipe = gzip ? stream.pipe(zlib.createGunzip().on('error', error)) : stream;
        parseStream(pipe, csv ?
            {headers : true, ignoreEmpty: true, delimiter: ',', quote: '"', escape: '"'} :
            {headers : true, ignoreEmpty: true, delimiter: '\t', quote: null, comment: '#'}
        )
            .on('error', error)
            .on('data', data => objects.push(_.mapObject(data, parseValue)))
            .on('end', () => ready(objects));
    }).then(existing => reverse ? existing.reverse() : existing);
}

function writeData(transpose, reverse, csv, gzip, filename, data) {
    return new Promise((finished, error) => {
        const output = createOutputStream(filename).on('error', error);
        output.on('finish', finished);
        if (transpose) {
            const writer = format(csv ? {
                headers: false,
                quote: '"',
                escape: '"',
                delimiter: ',',
                rowDelimiter: '\r\n',
                includeEndRowDelimiter: true
            } : {
                headers: false,
                quote: false,
                escape: '\\',
                delimiter: '\t',
                rowDelimiter: '\n',
                includeEndRowDelimiter: true
            }).on('error', error);
            if (gzip) {
                writer.pipe(zlib.createGzip().on('error', error)).pipe(output);
            } else {
                writer.pipe(output);
            }
            if (_.isArray(data)) {
                const keys = data.reduce((all_keys, datum) => {
                    const keys = _.keys(datum);
                    if (keys.length > all_keys.length && !_.difference(keys, all_keys).length)
                        return keys;
                    else
                        return _.union(all_keys, keys);
                }, []);
                const rows = keys.map(key => {
                    const values = _.pluck(data, key);
                    if (reverse) values.reverse();
                    return [key].concat(values).map(formatValue);
                });
                rows.forEach(row => writer.write(row));
            } else {
                _.pairs(data).forEach(datum => writer.write(datum.map(formatValue)));
            }
            writer.end();
        } else {
            const headers = data.reduce((all_keys, datum) => {
                const keys = _.keys(datum);
                if (keys.length > all_keys.length && !_.difference(keys, all_keys).length)
                    return keys;
                else
                    return _.union(all_keys, keys);
            }, []).map(formatValue);
            const writer = format(csv ? {
                headers,
                quote: '"',
                escape: '"',
                delimiter: ',',
                rowDelimiter: '\r\n',
                includeEndRowDelimiter: true
            } : {
                headers,
                quote: false,
                escape: '\\',
                delimiter: '\t',
                rowDelimiter: '\n',
                includeEndRowDelimiter: true
            }).transform(obj => _.mapObject(obj, formatValue)).on('error', error);
            if (gzip) {
                writer.pipe(zlib.createGzip().on('error', error)).pipe(output);
            } else {
                writer.pipe(output);
            }
            if (_.isArray(data) && reverse) data.reduceRight((m,datum) => writer.write(datum), 0);
            else if (_.isArray(data)) data.forEach(datum => writer.write(datum));
            else writer.write(data);
            writer.end();
        }
    });
}

function getOutputFile(options) {
    const output = options.output;
    if (output) return output;
    else if (!options.launch) return null;
    const name = process.title.replace(/.*\//,'').replace(/\W/g,'') +
        process.pid + Date.now().toString(16) + '.tsv';
    return path.resolve(os.tmpdir(), name);
}

function createOutputStream(outputFile) {
    if (outputFile) return fs.createWriteStream(outputFile);
    const delegate = process.stdout;
    const output = Object.create(Writable.prototype);
    output.cork = delegate.cork.bind(delegate);
    output.end = function(chunk) {
        if (chunk) delegate.write.apply(delegate, arguments);
        delegate.uncork();
        output.emit('finish');
    };
    output.setDefaultEncoding = encoding => delegate.setDefaultEncoding(encoding);
    output.uncork = delegate.uncork.bind(delegate);
    output.write = delegate.write.bind(delegate);
    return output;
}

function launchOutput(outputFile, options) {
    const launch = options.launch;
    if (!launch) return outputFile;
    const command = (_.isArray(launch) ? launch : launch.split(' ')).concat(outputFile);
    return new Promise((ready, exit) => {
        logger.debug("launching", command);
        const p = spawn(_.first(command), _.rest(command), {
            detached: true,
            stdio: 'inherit'
        }).on('error', exit).on('exit', code => {
            if (code) exit(Error("Process exitted with code " + code));
            else ready();
        }).unref();
        _.delay(ready, 500); // give child process a chance to error
    }).then(_.constant(outputFile));
}

function parseValue(value) {
    if (!_.isString(value)) return value;
    else if (value == '' || value == 'null') return null;
    else if (value == 'true' || value == 'false') return value == 'true';
    const chr = value.charAt(0);
    if (chr == '"' || chr == '[' || chr == '{') return JSON.parse(value);
    const number = Number(value);
    if (value == 'NaN' || number.toString() === value) return number;
    else return value;
}

function formatValue(value) {
    if (value == null) return JSON.stringify(null);
    if (_.isObject(value) && typeof value.toJSON == 'function') return formatValue(value.toJSON());
    if (_.isObject(value)) return JSON.stringify(value);
    if (_.isString(value) && !value) return JSON.stringify(value);
    if (_.isString(value) && value.match(/[^/:\w\-\.\+]/)) return JSON.stringify(value);
    else return value;
}
