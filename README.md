# mtrader

mtrader is a market data analysis and strategy toolkit. It fetches historic and
intraday data from Yahoo!, Interactive Brokers, DTN IQFeed and iVolatility, and
evaluates spreadsheet-style expressions over it. You can use those expressions to
backtest a portfolio, optimize and select signals, and then keep a live or
simulated brokerage account in line with the strategy.

It runs as a Node.js library, a command line tool, an interactive shell or a
headless service that other instances can send work to.

## Installation

```sh
npm install catch-point/mtrader -g
```

## Quick start

From the command line:

```sh
mtrader quote AAPL.NASDAQ --begin 2024-01-01 \
  --add-column date='DATE(ending)' --add-column close=day.close \
  --add-column sma20='SMA(20,day.close)'

mtrader            # interactive shell; type `help` to list commands
```

As a library:

```js
const Mtrader = require('mtrader');
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

## Documentation

- [Architecture](docs/architecture.md): the layer stack, process model, distributed workers, storage
- [Expressions](docs/expressions.md): syntax, fields, operators and where each function family works
- [Configuration](docs/configuration.md): `etc/mtrader.json`, precedence, sessions, directories
- [Data sources](docs/data-sources.md): Yahoo!, IB, IQFeed, iVolatility, files, remote
- [Brokers and replication](docs/brokers.md)
- [Deployment](docs/deployment.md): `mtrader start`, TLS, `install-daemon.sh`
- [Extending](docs/extending.md): adding data sources, brokers, functions, options
- [Reference](docs/reference/README.md): every option and function, generated from the code
- [Contributing](CONTRIBUTING.md)

In the shell, `help <command>`, `help expression` and `help common-functions` show
the same reference inline.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
