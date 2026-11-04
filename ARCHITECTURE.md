# Architecture

This document is for people changing mtrader's code. It explains how the pieces
fit together and where to look for a given behaviour. For using mtrader, start
with the [README](README.md) and the guides in [`docs/`](docs/).

mtrader is a stack of layers. Each layer is a function that takes an options object
and returns a promise of rows, and each one is built on the layer below it. The same
layers back the library API, the CLI subcommands, the interactive shell and a
headless network service.

## The layer stack

```mermaid
flowchart BT
    subgraph sources["Data sources (fetch-*.js)"]
        yahoo[yahoo] --- ib[ib] --- iqfeed[iqfeed] --- ivol[ivolatility] --- files[files] --- rf[remote]
    end
    fetch["fetch<br/><small>bars, lookup, contract, adjustments</small>"]
    quote["quote<br/><small>one security · expressions · on-disk storage</small>"]
    collect["collect<br/><small>portfolio · rolling / cross-security functions</small>"]
    optimize["optimize<br/><small>genetic search over parameter_values</small>"]
    bestsignals["bestsignals<br/><small>best signal per signalset</small>"]
    strategize["strategize<br/><small>adds/substitutes signals in a strategy</small>"]
    broker["broker<br/><small>ib · collective2 · simulation · remote</small>"]
    replicate["replicate<br/><small>align broker orders with collect output</small>"]

    sources --> fetch --> quote --> collect --> optimize --> bestsignals --> strategize
    collect --> replicate
    broker --> replicate
    quote --> broker
```

| Layer | Logic | Responsibility |
|---|---|---|
| fetch | `src/fetch.js` | Routes a request (by `interval` and `market`) to the data source that serves it. Returns raw bars, symbol lookups, contract details, fundamentals or split/dividend adjustments. |
| quote | `src/quote.js`, `quote-model.js`, `periods.js` | Evaluates `columns`/`criteria` expressions over a single security's bars across multiple intervals. Fetched bars and computed columns are kept in `storage.js` so they aren't fetched or recalculated again. |
| collect | `src/collect.js` | Runs `quote` for every security in a `portfolio`, merges the rows by time and evaluates portfolio-wide expressions (`PREV`, `PREC`, `COUNTPREC`, `MAXCORREL`, …). This is where backtests happen. |
| optimize | `src/optimize.js` | A genetic search over `parameter_values`. Each candidate is scored by `eval_score` on a `collect` result. |
| bestsignals | `src/bestsignals.js` | Runs `optimize` once per candidate signal in a signalset and ranks them. |
| strategize | `src/strategize.js` | Iteratively improves a strategy expression by adding, removing and substituting signals chosen by `bestsignals`. |
| broker | `src/broker.js` | One interface over live, remote and simulated accounts: balances, positions, orders, submit and cancel. |
| replicate | `src/replicate.js` | Compares the last order row of a `collect` result with the broker's working orders and positions, then submits or cancels orders to align them. |

The layers above `collect` don't know how backtests are computed. They just call the
layer below with different options. A strategy written as a `collect` request can
therefore be optimized, signal-tested, strategized and finally traded with `replicate`,
all using the same options.

## One interface for every layer

Every layer, data source and broker is created by a factory and returns the same
shape:

```js
const layer = Factory(settings, ...lowerLayers);
await layer(options);            // => array of row objects
await layer({info: 'help'});     // => [{name, usage, description, options, properties}]
await layer({info: 'version'});  // => [{version, ...}]
await layer({info: 'pending'});  // => queued/running work (where supported)
await layer.close();             // release sockets, child processes, file handles
```

The `info: 'help'` metadata does more than document the layer:

- **Validation and filtering.** Each layer passes on only the options its
  help says it accepts, e.g. `_.pick(options, _.keys(help.options))` in
  `quote.js` and `collect.js`. Unknown options are dropped rather than passed down.
- **Routing.** `fetch.js` asks each data source for its help and builds an
  `interval → market → source` table from the `interval` and `market` values each
  one advertises. `broker.js` uses the chosen broker adapter's help to filter
  the options it passes on.
- **Field discovery.** `properties` lists the fields that expressions may reference
  (such as `day.close`), and layers read it to decide which fields an expression
  can use.
- **User documentation.** The interactive shell's `help <command>` text and the
  generated [reference](docs/reference/README.md) are both rendered from it.

When you add an option, add it to the layer's `help()` too. Otherwise the layer
above will drop the option silently.

## Life of a request

Following one `collect` request from the command line to the data sources shows
how the layers, processes and caches meet:

1. `mtrader collect …` runs `src/mtrader-collect.js`. `config.js` merges the
   configuration files, the `--load`ed session and the command-line options into
   one options object (see [configuration flow](#configuration-flow)).
2. The collect wrapper decides where the work runs: in this process
   (`--runInBand`), on a local child worker, or on a remote `mtrader start` service,
   preferring the lowest worker tier. If `collect.cache_size` is set, whole results
   are memoized on disk by `disk-cache.js` first.
3. `collect.js` splits the request. A `reset_every` duration becomes one
   sub-request per segment, each sent back through step 2 so segments can run in
   parallel. Each portfolio member becomes a `quote` request, or a nested `collect`
   if the member has its own `portfolio`.
4. `quote.js` works out which intervals and how much history (*warm-up*) the
   expressions need, reads the matching blocks from storage and fetches only the
   blocks that are missing or out of date (see [quote storage](#quote-storage)).
5. `fetch.js` sends each block request to the data source registered for that
   interval and market, trying the next registered source if one fails.
6. Back in `collect.js`, the per-security rows are merged in time order and the
   portfolio expressions are evaluated row by row, with `PREV`/`PREC` reading
   values computed for earlier rows.

`optimize`, `bestsignals` and `strategize` repeat steps 2–6 many times with
different `parameters`, which is why the worker pool and the caches matter.
`replicate` runs the same `collect` request once, takes its last row and hands the
resulting orders to `broker`.

## Process model

Each command has a pair of modules. `src/X.js` holds the logic (the layer above),
and `src/mtrader-X.js` wraps it. Each wrapper serves three roles, chosen when the
module loads:

```mermaid
flowchart LR
    subgraph wrapper["src/mtrader-X.js"]
        cli["CLI<br/><small>isMainModule(import.meta)<br/>with arguments</small>"]
        child["Child worker<br/><small>forked, no arguments,<br/>process.send present</small>"]
        lib["Library<br/><small>imported, wrapped in share.js</small>"]
    end
    logic["src/X.js"]
    cli --> logic
    child --> logic
    lib --> logic
```

- **CLI**: `mtrader X ...` runs `mtrader-X.js` in a child process, which prints
  the rows with `tabular.js`.
- **Child worker**: heavy layers (`quote`, `collect`, …) start child
  processes with `config.fork()`. A child answers requests over IPC through
  `promise-reply.js`, which provides promise-based request/response over
  `process.send`. Configuration changes in the parent are forwarded to its children.
- **Library**: `share.js` makes the factory reference-counted, so all callers in a
  process share one instance. The instance is torn down only when the last
  caller calls `close()` (or on SIGINT/SIGTERM).

Pass `--runInBand` (`config('runInBand', true)`) to keep everything in one process.
The tests do this, and it's the easiest way to debug.

`src/mtrader.js` puts all the wrappers together into the public API
(`new Mtrader()`) and the interactive shell (run `mtrader` with no arguments,
implemented on `node:readline` in `shell.js`). Given a command, `mtrader` runs
`src/mtrader-<command>.js` in a child process, passing on the global options
that came before the command. The wrappers parse their arguments with the
shared `commander` program, which `config.js` reads its option values from.

## Distributed work

```mermaid
flowchart LR
    client["mtrader (client)"] -->|IPC| local1["local worker"]
    client -->|IPC| local2["local worker"]
    client -->|"wss:// (remote-process.js)"| svc1["mtrader start<br/>(remote host)"]
    client -->|"wss://"| svc2["mtrader start<br/>(remote host)"]
    svc1 --> w1["its own workers"]
```

- `worker-queue.js` is a load-balancing queue. It sends each task to the
  least-loaded worker in the lowest available *tier*, and spreads ties at random.
- `remote-workers.js` uses the same queue with remote mtrader services as the workers.
  When one fails, the task is retried on a different worker.
- `remote-process.js` gives a WebSocket connection, optionally mutual TLS (see
  `remote.*` in [configuration](docs/configuration.md)), the same interface as a
  forked child. A remote service is therefore just another worker.
- `mtrader start` (`mtrader-start.js`) is the server side. It listens on
  `remote.listen` and serves requests with its own `Mtrader` instance.
- `collect.remote`, `fetch.remote` and `broker.remote` tell a client to send
  work to these services.

## Quote storage

`quote.js` never asks a data source for more than it needs. Each security's bars
are stored per interval in *blocks* sized so that a typical request touches only a
few files:

| Interval | One block holds |
|---|---|
| `year`, `quarter`, `month`, `week` | the whole history |
| `day` | five calendar years |
| `m15` and longer | one month |
| `m5` – `m10` | one week |
| shorter than `m5` | one day |

Each block records when it was fetched (`asof`) and whether it is `complete`. A
complete block is never fetched again. The latest, incomplete block is topped up
by fetching from its last stored bar onwards. If the first new bar doesn't match
the stored one (for example after a split adjustment upstream), every stored block
for that security is discarded and fetched again. A block is also replaced when the
time zone, `ending_format` or `salt` it was built with differs from the request's.

Computed columns that need warm-up history are stored next to the bars, so
indicators such as `SMA(200, day.close)` aren't recalculated for old data.
`offline` reads only what is stored, and `read_only` reads what is stored but fails
if anything is missing.

## Interactive Brokers

IB support is the most involved data source and broker, and is split into four
modules:

```mermaid
flowchart BT
    tws["IB Gateway / TWS"]
    bridge["ib-tws-node<br/><small>Java TWS API bridge</small>"]
    client["ib-client.js<br/><small>promise API · request ids · error routing</small>"]
    gateway["ib-gateway.js<br/><small>shared connections per clientId</small>"]
    fetchib["fetch-ib.js"]
    brokerib["broker-ib.js"]
    tws --> bridge --> client --> gateway
    gateway --> fetchib
    gateway --> brokerib
```

- **`ib-tws-node`** (a dependency) runs IB's Java client and exposes its calls and
  events to Node. Its errors arrive as `(id, time, code, message, …)` events.
- **`ib-client.js`** turns that event API into promises. It allocates request ids,
  matches responses and errors to requests, treats IB warnings (codes 2000–2999 and
  a few others) as non-fatal, and keeps account, order and execution state, saved
  under `lib_dir` so it survives restarts.
- **`ib-gateway.js`** shares one client per connection (host, port, `clientId`), so
  `fetch-ib` and `broker-ib` in the same process reuse it. It can send market data
  calls to a separate `market_data` connection.
- **`fetch-ib.js`** maps mtrader's `symbol.market` names to IB contracts
  (`toLocalSymbol`, `toFutSymbol`, `toFopSymbol` and their `from…` inverses, driven
  by the `markets.*.datasources.ib` settings in `etc/mtrader.json`). It sends
  requests for older history to the other enabled sources first and recent or live
  requests to IB first, falling back to the other in each case. While a market is
  open it can combine historical bars with a live midpoint from `reqMktData`.
- **`broker-ib.js`** turns order rows into IB orders: it resolves each contract with
  `reqContractDetails`, builds combo (`BAG`) orders from `LEG` attachments, and
  groups attached and OCA orders.

## Storage and caching

| Module | What it stores | Where |
|---|---|---|
| `storage.js` | Per-security collections of bars and computed columns, as gzipped CSV with metadata. The quote layer's long-lived store. | `<cache_dir>/<market>/…` |
| `fetch-files.js` | Record/replay cache in front of the other data sources. Tests replay from `test/data`. | `fetch.files.dirname` |
| `disk-cache.js` | Memoizes whole results on disk, keyed by a hash of the options (used by collect). | `<cache_dir>` |
| `memoize-cache.js` | In-memory LRU-style memoization of promises. | memory |
| `atomic-write.js`, `read-write-lock.js` | Atomic file replacement and coordination between processes for the stores above. | – |
| `broker-simulation.js`, `ib-client.js` | Simulated account state; IB account, order and execution history. | `<lib_dir>` |

`cache_dir` is safe to delete; it fills again from the data sources. `lib_dir`
holds simulation and order state that you may want to keep.

## The expression language

`parser.js` is a generic parser for an Excel-like expression grammar. It doesn't
evaluate anything itself. The caller supplies `constant`, `variable` and
`expression` handlers, and the parser builds whatever those handlers return,
normally closures over a row context. Each layer adds its own function library:

| Library | Available in | Examples |
|---|---|---|
| `common-functions.js` | everywhere | `IF`, `ROUND`, `DATE`, `BS`, `BSIV` |
| `lookback-functions.js` | quote and above | `SMA`, `EMA`, `OFFSET`, `HIGHEST`, `RSI` |
| `indicator-functions.js` | quote and above (interval-prefixed) | `day.ATR`, `day.PSAR`, `day.OBV` |
| `rolling-functions.js` | collect and above | `PREV`, `PREC`, `COUNTPREC`, `SUMTOTAL`, `LOOKUP` |
| `quoting-functions.js` | collect and above | `MAXCORREL`, `SPLIT`, `DIVIDEND` |

Lookback functions declare how many earlier bars they need (`warmUpLength`), and
quote uses that to fetch enough history before `begin`. See
[expressions](docs/expressions.md) and the generated
[function reference](docs/reference/functions.md).

## Configuration flow

`config.js` is a process-wide singleton. It merges these sources, with later ones
taking precedence:

1. `etc/mtrader.json` bundled with the package
2. `<prefix>/etc/mtrader.json`
3. the session file named with `--load <name>` (looked up in `config_dir`)
4. command-line options
5. `--set a.b=value`, `--add-column`, `--add-variable` and values set at runtime
   with `config(name, value)`

Forked children receive the parent's effective configuration as arguments and are
sent later changes over IPC. See [configuration](docs/configuration.md).

## Conventions that cut across layers

- **Time.** Every request carries a `tz`, and bars carry an `ending` timestamp
  formatted with `ending_format`. Use `moment-timezone` with an explicit zone, never
  the local zone. Markets declare `security_tz`, `trading_hours`, `liquid_hours`
  and `open_time`, which `periods.js` uses to place bars in intervals.
- **Validation.** Code in `src/` checks its arguments with `node:assert` (and
  `like.assert` for options patterns), so a bad option fails close to where it
  was passed with an `AssertionError` naming the option.
- **Money.** Prices, quantities and balances in brokers and replication use
  `big.js`, not floating point.
- **Logging.** Use `logger.js` (`trace`/`debug`/`log`/`warn`/`error`), never
  `console`. Its level is set by `--verbose` and `--quiet`.
- **Cancellation and timeouts.** `interrupt.js` lets long loops notice SIGINT and
  SIGTERM, and `time-limit.js` bounds calls to external services. Every factory's
  `close()` must release what it opened, or the process won't exit.

## Source map

| Area | Files |
|---|---|
| Entry points | `mtrader.js`, `mtrader-*.js`, `shell.js` (interactive shell) |
| Layers | `fetch.js`, `quote.js`, `collect.js`, `optimize.js`, `bestsignals.js`, `strategize.js`, `broker.js`, `replicate.js` |
| Data sources | `fetch-{yahoo,ib,iqfeed,ivolatility,files,remote}.js`, with their clients `*-client.js`, `ib-gateway.js`, `adjustments-yahoo.js` |
| Brokers | `broker-{ib,collective2,simulation,remote}.js`, `collective2-client.js` |
| Expressions | `parser.js`, `*-functions.js`, `statistics.js`, `quote-model.js`, `periods.js` |
| Processes | `share.js`, `promise-reply.js`, `worker-queue.js`, `remote-workers.js`, `remote-process.js`, `interrupt.js`, `auto-restart.js` |
| Storage | `storage.js`, `disk-cache.js`, `memoize-cache.js`, `atomic-write.js`, `read-write-lock.js`, `read-call-save.js` |
| Support | `config.js`, `mtrader-config.js`, `logger.js`, `tabular.js`, `merge.js`, `lookup.js`, `like.js`, … |

Tests live in `test/*.spec.js`, one per module, with recorded market data under
`test/data`. [CONTRIBUTING](CONTRIBUTING.md) explains which tests need network
access or live services.
