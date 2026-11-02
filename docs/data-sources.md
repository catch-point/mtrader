# Data sources

`fetch.js` routes every request to a data source by `interval` and `market`. Each
source advertises what it serves through its `{info:'help'}` metadata, limited by
`fetch.<source>.intervals` and `fetch.<source>.markets` in your configuration.
Yahoo is always loaded as the fallback. Every other source has to be enabled.

| Source | Module | Typical use | Needs |
|---|---|---|---|
| yahoo | `fetch-yahoo.js`, `yahoo-client.js`, `adjustments-yahoo.js` | Free daily equity bars, lookup, split/dividend adjustments | Internet access (no account) |
| ib | `fetch-ib.js`, `ib-client.js`, `ib-gateway.js` | Intraday and daily bars, futures, options, FX, fundamentals | A running IB Gateway or TWS with the API enabled, configured under `ib` (see [configuration](configuration.md#ib)) |
| iqfeed | `fetch-iqfeed.js`, `iqfeed-client.js` | Intraday and daily bars, futures and options | DTN IQFeed client (IQConnect) on localhost ports 9100/9300/5009. Set `command`/`env`/`productId` to have mtrader launch it. |
| ivolatility | `fetch-ivolatility.js`, `ivolatility-client.js` | Historic option (OPRA) daily data | iVolatility account; `auth_file` (a credentials file, relative to `<prefix>/etc`) and `downloadType` |
| files | `fetch-files.js` | Record/replay cache in front of the other sources, for fixtures and offline work | `dirname` |
| remote | `fetch-remote.js` | Use another mtrader service's data sources | `location` of an `mtrader start` service |

## Intervals

| Interval | Returns |
|---|---|
| `lookup` | Candidate symbols/markets for a symbol prefix |
| `contract` | Contract details: name, currency, `security_tz`, trading hours |
| `fundamental` | Fundamental data (iqfeed, ib) |
| `adjustments` | Split/dividend history used for `adj_close` |
| `year` `quarter` `month` `week` `day` | Interday bars |
| `m1` … `m240` | Intraday bars in minutes |

## Symbol translation

The same `symbol.market` (for example `ES.CME`) means different identifiers to
different sources. `markets.<CODE>.datasources.<source>` in `etc/mtrader.json`
holds each source's translation rules, such as `yahooSuffix`, `dtnPrefix`,
`dtnPrefixMap`, IB `secType`/`exchange`/`tradingClasses` and Collective2
`c2_prefix`.

## Inspecting what's active

```
$ mtrader
> help fetch                  # intervals and options of the active sources
> lookup IBM                  # which markets/sources know a symbol
$ mtrader -V                  # versions of every layer and source, including remotes
```

The generated [fetch reference](reference/fetch.md) lists everything the default
configuration serves.

To add a source, see [extending](extending.md).
