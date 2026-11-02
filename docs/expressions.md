# Expressions

`columns`, `variables`, `criteria`, `filter`, `precedence`, `eval_score` and similar
options all take expressions written in a small, Excel-like language. For the full
list of functions, see the generated [function reference](reference/functions.md).

## Syntax

An expression combines fields, constants and function calls with operators.

- **Constant**: a number (`10`, `0.5`) or a quoted string (`"position"`).
- **Function call**: `NAME(arg1, arg2, …)`, where each argument is itself an expression.
- **Field**: a value from the current bar or security (see below).
- **Name**: another column, variable or parameter in the same request, referenced
  by name.

## Fields

Fields without a prefix:

| Field | Meaning |
|---|---|
| `symbol` | Symbol used by the market |
| `market` | Market code (see `markets` in `etc/mtrader.json`) |
| `ending` | Date/time the bar ended |

Fields prefixed by an interval, such as `day.close`:

| Field | Meaning |
|---|---|
| `<interval>.ending` | Date/time the interval ended (the prefix is optional) |
| `<interval>.open` / `.high` / `.low` / `.close` | Prices |
| `<interval>.volume` | Volume |
| `<interval>.adj_close` | Close adjusted for dividends and splits |

`<interval>` is `year`, `quarter`, `month`, `week`, `day` or `mN` (N-minute bars,
e.g. `m60`). Intraday intervals need a data source that supports them. One request
can mix intervals, such as `day.close` and `week.close`. The `interval` option sets
which interval produces the rows.

## Operators

| Operator | Result |
|---|---|
| `+ - * / %` | Arithmetic (`%` is the remainder) |
| `= != <> < <= > >=` | Comparison: non-zero when true, `0` when false |
| `AND`, `OR`, `!` | Logical: `0` is false, anything else is true |
| `( )` | Grouping |

## Columns, variables and parameters

- **columns** appear in the output, in the order you give them.
- **variables** are named expressions that columns can reference but that aren't
  in the output.
- **parameters** are constants. `optimize` searches over them using
  `parameter_values`.

```js
{
  columns:    { date: 'DATE(ending)', signal: 'sma_cross' },
  variables:  { sma_cross: 'SMA(fast_len,day.adj_close) > SMA(slow_len,day.adj_close)' },
  parameters: { fast_len: 50, slow_len: 200 }
}
```

## Where each function family can be used

| Family | Scope | Examples |
|---|---|---|
| common | anywhere, including `exec` in the shell | `IF`, `ROUND`, `MAX`, `DATE`, `WORKDAY`, `BS`, `BSIV` |
| lookback | `quote` and above; reads earlier bars of one security | `SMA(n, expr)`, `EMA`, `OFFSET(n, expr)`, `HIGHEST`, `RSI`, `STDEV` |
| indicator | `quote` and above; must be interval-prefixed | `day.ATR(14)`, `day.PSAR(…)`, `day.OBV(…)` |
| rolling | `collect` and above; reads earlier output rows | `PREV("col")` (this security), `PREC("col")` (preceding row of any security), `COUNTPREC()`, `SUMPREV`, `MAXTOTAL`, `LOOKUP` |
| quoting | `collect` and above; compares securities | `MAXCORREL`, `SPLIT`, `DIVIDEND` |

Rolling functions are what make backtests possible. `PREV("position")` carries a
security's position from one row to the next, and `PREC("profit")` accumulates
across the whole portfolio. Their arguments are column *names* as strings, not
expressions.

## Trying expressions

```
$ mtrader
> exec ROUND(PI(), 2)
3.14
> help lookback-functions
```
