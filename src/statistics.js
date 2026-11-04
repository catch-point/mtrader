// statistics.js
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
'use strict';

const ss = require('simple-statistics');

/**
 * The statistics used by the expression functions and optimizer, backed by
 * simple-statistics. Samples too small to measure give NaN rather than
 * throwing, and the normal quantile is infinite at 0 and 1.
 */
module.exports = {
    /** Sample standard deviation (n - 1 denominator) */
    std(values) {
        return values.length < 2 ? NaN : ss.sampleStandardDeviation(values);
    },
    /** Pearson correlation coefficient of two samples of equal length */
    corr(x, y) {
        return x.length < 2 || y.length < 2 ? NaN : ss.sampleCorrelation(x, y);
    },
    /** Standard normal cumulative distribution function */
    normcdf(x) {
        return 0.5 * (1 + ss.errorFunction(x / Math.SQRT2));
    },
    /** Standard normal quantile function (inverse of normcdf) */
    norminv(p) {
        if (p <= 0) return p == 0 ? -Infinity : NaN;
        if (p >= 1) return p == 1 ? Infinity : NaN;
        return ss.probit(p);
    }
};
