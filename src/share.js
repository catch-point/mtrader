// share.js
/*
 *  Copyright (c) 2019 James Leigh, Some Rights Reserved
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

/**
 * Creates a version of the factory function such that repeated calls will
 * have no effect, returning the value from the original call, until the close
 * function of the returned instance is called. Care should be taken to not call
 * closed more then the number of times the given factory function is called.
 */
module.exports = function(factory, onclose) {
    let used = 0;
    const shared = function() {
        used++;
        if (shared.instance) return shared.instance;
        const self = shared.instance = factory.apply(this, arguments);
        let closed = false;
        used = 1;
        const close_handler = self.close ? self.close.bind(self) : () => Promise.resolve();
        self.close = async function(closedBy, force) {
            if (closed || --used && !force) return;
            closed = true;
            if (shared.instance === self) shared.instance = null;
            if (onclose) await onclose.apply(this, arguments);
            return close_handler.apply(this, arguments);
        };
        return self;
    };
    process.on('SIGINT', () => shared.instance && shared.instance.close('SIGINT', true));
    process.on('SIGTERM', () => shared.instance && shared.instance.close('SIGTERM', true));
    return shared;
}
