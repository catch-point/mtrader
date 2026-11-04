# Configuration

All configuration goes through `src/config.js`, one merged JSON tree per process.
See [architecture](../ARCHITECTURE.md#configuration-flow) for how it reaches child
processes.

## Precedence

Later sources override earlier ones:

| # | Source | Notes |
|---|---|---|
| 1 | `etc/mtrader.json` in the package | Defaults: data sources, brokers, market definitions. |
| 2 | `<prefix>/etc/mtrader.json` | Your installation's overrides. `mtrader config <name> <value>` writes here. |
| 3 | `--load <name>` | A saved *session* (`<config_dir>/<name>.json`) holding a strategy's columns, variables, portfolio, etc. |
| 4 | Command-line options | `--begin`, `--offline`, `--cache-dir`, … |
| 5 | `--set a.b=value`, `--add-column name=expr`, `--add-variable`, `--add-parameter` | Session values for this run. Values are parsed as JSON when possible. |

In the interactive shell, `set` changes the session, `config <name> <value>` changes
the stored file, `save <name>` writes the session to `config_dir` and `load <name>`
reads one back.

From the library:

```js
import Mtrader from 'mtrader';
Mtrader.config('prefix', '/srv/mtrader');   // change this process's configuration
const mtrader = new Mtrader({offline: true}); // per-instance overrides
```

## Directories

| Key | Default | Purpose |
|---|---|---|
| `prefix` | two directories above the running script (the install root) | Base for every relative path below. |
| `cache_dir` | `<prefix>/var/cache` (`default_cache_dir`) | Quote storage and result caches. Safe to delete. |
| `lib_dir` | `<prefix>/var/lib` (`default_lib_dir`) | Simulated broker accounts and other state to keep. |
| `config_dir` | `<prefix>/etc` (`default_config_dir`) | Saved sessions (`*.json`). |

## Common runtime options

| Key | Purpose |
|---|---|
| `runInBand` | Don't fork worker processes; run everything in-process. |
| `offline` | Use only local/cached data. |
| `update` | Re-fetch the most recent bar. |
| `tz` | Default time zone (otherwise guessed from the system). |
| `salt` | Mixed into storage keys so you can keep separate computed-column caches. |
| `quote`, `collect`, `replicate` | Per-layer settings objects; `collect.nice` and `collect.remote` control worker scheduling. |

## `fetch.<source>`

Each data source has a section under `fetch` with at least `enabled`, `intervals`
and `markets`. Yahoo is always loaded as the fallback. See
[data sources](data-sources.md) for what each one needs.

```json
"fetch": {
  "iqfeed": {"enabled": true, "intervals": ["lookup", "day", "m60"], "markets": ["NYSE", "NASDAQ"]},
  "files":  {"enabled": true, "dirname": "/srv/mtrader/fixtures"}
}
```

## `broker.<name>`

`ib`, `collective2`, `simulation` and `remote` sections, each with `enabled`. See
[brokers](brokers.md).

## `markets.<CODE>`

Each market defines its trading hours, `security_tz`, `currency`,
`default_security_type`, and a `datasources` map giving each source's symbol
translation (`yahooSuffix`, `dtnPrefix`, IB `secType`/`exchange`, Collective2
`c2_prefix`, …). Add or edit a market here to support a new exchange. Requests
for an unknown market are rejected.

## Remote service

Used by `mtrader start` and by any `*.remote` client connection.

| Key | Purpose |
|---|---|
| `listen` | Address for `mtrader start`, e.g. `wss://0.0.0.0:8443`. Required to start the service. |
| `key_pem`, `cert_pem`, `ca_pem`, `crl_pem`, `dhparam_pem`, `passphrase_base64` | TLS material (file paths). |
| `requestCert`, `rejectUnauthorized` | Turn on mutual-TLS client authentication. |
| `ciphers`, `ecdhCurve`, `secureProtocol`, `secureOptions`, `honorCipherOrder` | TLS tuning, passed to Node. |
| `handshakeTimeout`, `perMessageDeflate`, `agent` | WebSocket tuning. |
| `timeout` | Keep-alive, in milliseconds (default 60000). A client pings a service after half of it with nothing received, and drops the connection if the other half passes without a reply. On a service, it is how long a client can be idle before the service pings it. |

Clients name a service with `location`, for example in `fetch.remote.location` or
`collect.remote[].location`.

## `ib`

Settings for the IB Gateway connection used by `fetch.ib` and `broker.ib`:
`clientId`, `twsApiHost`/`twsApiPort` (or `jsonApiHost`/`jsonApiPort`),
`jtsConfigDir`, and an optional `clients` list of allowed client IDs.
