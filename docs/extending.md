# Extending mtrader

Data sources and brokers are plugins that follow the
[layer contract](../ARCHITECTURE.md#one-interface-for-every-layer). An adapter is a
factory that takes its settings section and returns `async fn(options)` plus
`close()`, and it describes itself when called with `{info: 'help'}`.

## Adding a data source

1. **Create `src/fetch-foo.js`**:

   ```js
   import _ from 'underscore';
   import Version from './version.js';
   const version = Version.toString();

   export default function(settings = {}) {
       const helpInfo = help(settings);
       return Object.assign(async(options) => {
           if (options.info == 'help') return helpInfo;
           if (options.info == 'version') return [{version, name: 'foo'}];
           if (options.info) return [];
           switch (options.interval) {
               case 'lookup': return lookup(options);
               case 'contract': return contract(options);
               case 'day': return interday(options);   // rows: {ending, open, high, low, close, volume, adj_close}
               default: throw Error(`Unsupported interval ${options.interval}`);
           }
       }, {
           close() { /* release sockets/processes */ return Promise.resolve(); }
       });
   };

   function help(settings) {
       // fetch.js routes by these: each entry's options.interval.values and options.market.values
       const commonOptions = {
           symbol: {description: "Ticker symbol used by the market"},
           market: {description: "Exchange market acronym", values: settings.markets}
       };
       return [{
           name: 'interday',
           usage: 'interday(options)',
           description: "Daily bars from Foo",
           properties: ['ending', 'open', 'high', 'low', 'close', 'volume', 'adj_close'],
           options: {...commonOptions, interval: {values: _.intersection(['day'], settings.intervals)}, begin: {}, end: {}, tz: {}}
       }, /* lookup, contract ... */];
   }
   ```

   Base the `help()` on `fetch-yahoo.js` or `fetch-ib.js`.
   **Anything not listed in help is never routed to your source.**

2. **Register it** in `promiseDatasources()` in `src/fetch.js` by adding
   `'foo'` to the list of source names it imports (`./fetch-foo.js`).

3. **Add defaults** to `etc/mtrader.json` under `fetch.foo` (`enabled: false`,
   `intervals`, `markets`). If symbols need translating, add
   `markets.<CODE>.datasources.foo` entries.

4. **Test it** in `test/fetch-foo.spec.js`. Wrap the source in `fetch.files` with
   `dirname: test/data` so later runs replay recorded responses instead of
   needing the service. If the service is unreachable, skip in `before()` the way
   `test/iqfeed-client.spec.js` does.

5. Run `npm run docs` to regenerate `docs/reference/fetch.md`.

## Adding a broker

Same pattern with `src/broker-foo.js`, registered in `src/broker.js`. The factory is
called as `Broker(settings, quote, …)`. It must answer `{info:'help'}` (and
`{info:'version'}`) even before it's configured, and support the actions listed in
[brokers](brokers.md#actions): one help entry per `action` value, as in
`broker-simulation.js`. Use the simulation broker's tests
(`test/broker-simulation.spec.js`, `test/replicate-simulation.spec.js`) as the
template.

## Adding an expression function

Add an entry to the `functions` table of the matching library
(`common-functions.js`, `lookback-functions.js`, …):

```js
MYFUNC: _.extend((opts, a, b) => context => a(context) + b(context), {
    args: "a, b",
    description: "What it returns",
    seeAlso: ['OTHERFUNC']
})
```

In `common-functions.js`, arguments arrive as functions of the row context. In
`lookback-functions.js` and `indicator-functions.js`, they're functions of the
array of bars up to the current one, and each result must declare a
`warmUpLength` (how many earlier bars it needs; see `OFFSET`). The `description` and `args` show
up in shell help and in `docs/reference/functions.md` after `npm run docs`.

## Adding an option to a layer

Add it to that layer's `help()` `options`. Layers keep only the options their help
declares (`_.pick(options, keys(help.options))`), so an undeclared option is
silently dropped before it reaches the code.
