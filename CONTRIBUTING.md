# Contributing

Start with [ARCHITECTURE.md](ARCHITECTURE.md). Most changes touch one layer
(`src/X.js`) and maybe its CLI/worker wrapper (`src/mtrader-X.js`).

## Setup

```sh
git clone https://github.com/catch-point/mtrader.git
cd mtrader
npm install
```

## Tests

```sh
npm test                                     # whole suite (mocha, test/*.spec.js)
npx mocha test/parser.spec.js                # one file
npx mocha test/quote.spec.js -g "SMA"        # matching tests
npm run inspect                              # break on start for a debugger
```

Tests run in one process (`config('runInBand', true)`) and write to temporary
prefixes. They fall into four groups:

| Group | Specs | Needs |
|---|---|---|
| Pure logic | `parser`, `periods`, `common-functions`, `memoize-cache`, `storage`, `cache` | nothing |
| Recorded data | `quote`, `quote-model`, `collect`, `mtrader-collect`, `optimize`, `bestsignals`, `strategize`, `lookback-functions`, `indicator-functions`, `rolling-functions`, `broker-simulation`, `replicate-simulation`, `broker-collective2`, `replicate-collective2` | nothing. They replay `test/data` through the `files` source, and Collective2 is stubbed with `file://` fixtures. |
| Live internet | `fetch-yahoo`, `yahoo-client`, `adjustments`, `fetch`, `mtrader` | network access to Yahoo!. Results can change as upstream data changes. |
| Live services (skipped when unavailable) | `ib-client`, `fetch-ib`, `broker-ib`, `iqfeed-client`, `fetch-iqfeed`, `ivolatility-client` | IB Gateway/TWS on port 7496, DTN IQConnect, or iVolatility credentials |

Some tests write a cache under `tmp/` (for example `tmp/strategize`). It's
git-ignored and safe to delete.

## Conventions

- Each layer, data source and broker implements the
  [layer contract](ARCHITECTURE.md#one-interface-for-every-layer). New options
  must go in the module's `help()` or they're silently dropped.
- Use `node:assert` (`assert.ok(condition, message)`) for argument validation inside `src/`,
  and `like.assert(value, pattern)` from `src/like.js` to check an options object
  against a pattern. `chai` is a test-only dependency.
- `src/`, `test/` and `scripts/` are ES modules (`"type": "module"`): use
  `import`/`export`, `import.meta.dirname` instead of `__dirname`, and
  `isMainModule(import.meta)` from `src/is-main-module.js` instead of
  `require.main === module`. Import Node built-ins with the `node:` prefix in
  new code.
- Use `logger.js` (`trace`/`debug`/`log`/`warn`/`error`) rather than `console`.
- Write files through `atomic-write.js`.
- Use `big.js` for money and quantities in brokers and replication.

## Documentation

- Hand-written docs are in `docs/`. Update them when behaviour changes.
- `docs/reference/` is generated from the code. After changing any option,
  property or expression function, run `npm run docs` and commit the result.
  Don't edit those files by hand.
