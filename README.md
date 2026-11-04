# mtrader

mtrader is a market data analysis and strategy toolkit for Node.js. It fetches
historic and intraday data from Yahoo!, Interactive Brokers, DTN IQFeed and
iVolatility, and evaluates spreadsheet-style expressions over it. You can use
those expressions to backtest a portfolio, optimize and select signals, and then
keep a live or simulated brokerage account in line with the strategy.

It runs as a library, a command line tool, an interactive shell or a headless
service that other instances can send work to.

- **One request format from research to trading.** A strategy written as a
  `collect` request can be optimized, signal-tested and traded with `replicate`
  without being rewritten.
- **Expressions, not code.** Columns, filters and signals are Excel-like formulas
  such as `SMA(20,day.close) > SMA(50,day.close)`, with lookback, indicator,
  rolling and cross-security functions.
- **Local storage.** Fetched bars and computed columns are stored on disk and
  topped up incrementally, so repeated backtests don't refetch or recompute.
- **Scales out.** Backtests and optimizations spread across local worker
  processes and remote `mtrader start` services.

## Requirements

- Node.js 22.12 or later, and npm. mtrader is an ES module package, so load
  it with `import` (or `require()` on Node versions that can load ES modules).
- Yahoo! data needs only internet access and is enabled by default. The other
  data sources and brokers are off until you configure them:

| Source | Needs |
|---|---|
| Interactive Brokers | IB Gateway or TWS, and IB's Java TWS API (used through [ib-tws-node](https://github.com/catch-point/ib-tws-node)) |
| DTN IQFeed | IQConnect running locally, with a subscription |
| iVolatility | Account credentials |
| Collective2 | API key |

## Installation

```sh
npm install catch-point/mtrader -g
```

## Quick start

Securities are named `symbol.market`, such as `AAPL.NASDAQ` or `SPY.NYSE`. The
markets are defined in [`etc/mtrader.json`](etc/mtrader.json).

From the command line:

```sh
mtrader quote AAPL.NASDAQ --begin 2024-01-01 \
  --add-column date='DATE(ending)' --add-column close=day.close \
  --add-column sma20='SMA(20,day.close)'

mtrader            # interactive shell; type `help` to list commands
```

This prints one tab-separated row per trading day, with columns `date`, `close`
and `sma20`.

As a library:

```js
import Mtrader from 'mtrader';
const mtrader = new Mtrader();

const bars = await mtrader.quote({
  symbol: 'SPY', market: 'NYSE', begin: '2024-01-01',
  columns: {
    date: 'DATE(ending)',
    close: 'day.adj_close',
    change: '(day.adj_close - OFFSET(1, day.adj_close)) * 100 / OFFSET(1, day.adj_close)'
  },
  criteria: 'day.adj_close > OFFSET(1, day.adj_close)'
});

await mtrader.close();   // shut down worker processes
```

## Commands

Each command is also a method on the library instance with the same options.

| Command | What it does |
|---|---|
| `fetch` | Raw bars, symbol `lookup`, `contract` details, `fundamental` data, `adjustments` |
| `quote` | Expression columns over one security, across intervals (`year` … `day`, `mN`) |
| `collect` | Backtests a portfolio: quote for every security, plus rolling functions (`PREV`, `PREC`, …) |
| `optimize` | Genetic search over `parameter_values` to maximize `eval_score` |
| `bestsignals` | Picks the best signal from a set of candidate signals |
| `strategize` | Iteratively builds and refines a strategy out of signals |
| `broker` | Balances, positions and orders on IB, Collective2, a simulation or a remote account |
| `replicate` | Submits or cancels orders so an account matches a strategy's latest signals |
| `config`, `date` | View or change stored settings; format the current time |
| `start`, `stop`, `pending` | Run a headless service and inspect its queue |

Run `mtrader <command> --help`, or `help <command>` in the shell, for its options.

## Example: optimize a moving-average crossover

```js
const best = await mtrader.optimize({
  portfolio: 'SPY.NYSE',
  begin: '2000-01-01', end: '2010-01-01',
  optimize_termination: 'PT5M',
  eval_validity: 'fast_len<slow_len',
  eval_score: 'gain/pain',
  columns: {
    date: 'DATE(ending)',
    change: 'close - PREV("close")',
    close: 'day.adj_close',
    gain: 'PREC("gain") + change * PREV("sma_cross")',
    pain: 'drawdown'
  },
  variables: {
    sma_cross: 'SMA(fast_len,day.adj_close)>SMA(slow_len,day.adj_close)',
    peak: 'IF(PREC("peak")>gain,PREC("peak"),gain)',
    drawdown: 'IF(PREC("drawdown")>peak-gain,PREC("drawdown"),peak-gain)'
  },
  parameter_values: {
    fast_len: [5, 10, 15, 20, 25, 50],
    slow_len: [20, 25, 50, 80, 100, 150, 200]
  }
});
console.log(best.parameters);
```

Pass the same request with `signals` and `signal_variable` to `bestsignals`, or to
`strategize` to let it build the strategy for you. Once you're happy with it, save
the session and point `replicate` at a broker.

## Configuration

Settings come from `etc/mtrader.json`, overridden by `<prefix>/etc/mtrader.json`,
a saved session (`--load <name>`) and command-line options. To turn on a data
source or broker:

```sh
mtrader config fetch.ib.enabled true     # use IB as a data source
mtrader config ib.twsApiPort 7497        # IB Gateway / TWS API port
```

See [configuration](docs/configuration.md) for the precedence rules and
directories, and [data sources](docs/data-sources.md) and
[brokers](docs/brokers.md) for each one's settings.

> [!WARNING]
> `replicate` and `broker` submit and cancel real orders when pointed at a live
> account. Try a strategy against the `simulation` broker or an IB paper-trading
> account first. mtrader comes with no warranty; see the [license](LICENSE).

## Documentation

- [Architecture](ARCHITECTURE.md): the layer stack, life of a request, processes, storage, IB
- [Expressions](docs/expressions.md): syntax, fields, operators and where each function family works
- [Configuration](docs/configuration.md): `etc/mtrader.json`, precedence, sessions, directories
- [Data sources](docs/data-sources.md): Yahoo!, IB, IQFeed, iVolatility, files, remote
- [Brokers and replication](docs/brokers.md)
- [Deployment](docs/deployment.md): `mtrader start`, TLS, `install-daemon.sh`
- [Extending](docs/extending.md): adding data sources, brokers, functions, options
- [Reference](docs/reference/README.md): every option and function, generated from the code
- [Changelog](CHANGELOG.md)

In the shell, `help <command>`, `help expression` and `help common-functions` show
the same reference inline.

## Development

```sh
git clone https://github.com/catch-point/mtrader.git
cd mtrader
npm install
npm test
```

Most tests replay recorded data from `test/data`; tests for IB, IQFeed and
iVolatility are skipped when those services aren't available. See
[CONTRIBUTING](CONTRIBUTING.md) for the test groups and code conventions.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
