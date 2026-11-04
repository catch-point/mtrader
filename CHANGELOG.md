# Changelog

All notable changes to mtrader since 1.0. Entries before 16.2.0 were
generated from the git history and are grouped by minor version; each lists
the commit subjects included in that series, newest first.

## 17.0.1 — 2026-11-04

### Fixed

- Connections to `mtrader start` services are kept alive. A client pings a
  service after `remote.timeout`/2 milliseconds without receiving anything,
  and drops the connection if the next `remote.timeout`/2 passes without a
  pong or other traffic. `remote.timeout` defaults to 60000. The keep-alive
  existed before but never ran without `remote.timeout`; when it did run, it
  never saw pongs (it listened on the TCP socket and decremented an undefined
  counter), so idle healthy connections were closed, and dead ones lingered
  waiting for a closing handshake. A new `remote-process` spec simulates
  healthy, dead and busy services.

## 17.0.0 — 2026-11-04

### Changed

- **Breaking:** mtrader is now an ES module package (`"type": "module"`).
  Load it with `import Mtrader from 'mtrader'`; `require('mtrader')` works only
  on Node versions that can `require()` ES modules. Every module in `src/`,
  `test/` and `scripts/` uses `import`/`export`.
- **Breaking:** requires Node.js 22.12 or later.
- Uses ib-tws-node 2.1.1 (ES modules, Node 22.12+, stricter enum validation
  and checksummed TWS API downloads).
- Upgraded to the ES module releases of `commander` 15, `d3-format` 3,
  `chai` 6, `chai-as-promised` 8 and `mocha` 12.
- Number formatting goes through `src/number-format.js`, which keeps
  d3-format 1's hyphen-minus for negative numbers (d3-format 2 and later
  default to the Unicode minus sign), so `TEXT()` output and symbols are
  unchanged.
- Data sources are imported on demand by `fetch.js`, which keeps the
  `fetch.js` ↔ `fetch-*.js` import cycle out of module evaluation.

### Fixed

- `fetch-iqfeed.js` declared `isOptionExpired` twice. CommonJS silently used
  the second declaration; the unused first one is removed.
- `mtrader start` uses ws's `WebSocketServer` export, since the ES module
  build of ws has no `ws.Server`, and `Buffer.from` in place of the
  deprecated `new Buffer`. A new `mtrader-start` spec covers the service:
  HTTP and wrong-path responses, version and status requests, a remote
  fetch, and basic-auth credentials.
- `broker-ib.js` reported an order it could not build a contract for with
  `ReferenceError: contract is not defined` instead of
  `Could not create contract from …`. New specs cover the contract
  failures an order can reach: a missing symbol and an unknown market.

## 16.3.0 — 2026-11-04

### Changed

- Requires Node.js 22 or later (`engines.node` is `>=22`).
- Argument checks in `src/` use `node:assert` instead of `chai`, which is now a
  test-only dependency. Options patterns are checked with `like.assert`.
  Failures are `AssertionError`s whose message names the option.
- The interactive shell is implemented on `node:readline` (`src/shell.js`)
  instead of the unmaintained `shell` package. Commands piped into `mtrader`
  are now run in order instead of being dropped while a command is running.
- `mtrader <command>` runs `src/mtrader-<command>.js` directly instead of
  through commander's executable subcommands.
- Replaced unmaintained packages: `statkit` with `simple-statistics` (through
  `src/statistics.js`), `smr` with `ml-regression-multivariate-linear` and
  `alea` with `seedrandom`'s identical Alea generator, so seeded optimizations
  repeat exactly. `NORMSINV` of probabilities below about 1e-9 is now
  accurate; `statkit` returned values that were too far into the tail.
  Model regressions with fewer rows than independents (the first rows of a
  `regression_length` window) now use the minimum-norm least-squares fit,
  which can differ from `smr`'s; once there are enough rows the coefficients
  match.
- Upgraded, staying on CommonJS builds: `ws` 8, `fast-xml-parser` 5,
  `commander` 14, `big.js` 7, `diff` 9, `fast-csv` 5, `yauzl` 3,
  `moment-timezone` 0.6, `underscore` 1.13.8, `graceful-fs` 4.2.11, and for
  development `chai` 4, `chai-as-promised` 7, `mocha` 11, `js-beautify` 2.

### Fixed

- Removed duplicate `--solution-count` and `--version` option declarations
  that commander 14 rejects.
- Market sessions whose open time falls in a daylight saving gap on the day
  they are computed from (such as a 02:00 America/Chicago open on a
  spring-forward Sunday) now open at that time on the following trading day.
  Since moment-timezone 0.6.4 correctly moves 02:00 in the gap to 03:00,
  `periods.js` carried 03:00 on to the Monday, an hour late. Each day shift
  now sets the session's clock time on the new day. The `periods` spec is no
  longer skipped.

## 16.2.0 — 2026-11-04

### Fixed

- Combo (BAG) orders failed in `broker-ib` with "expected … to have a property
  'symbol'" because `toContractWithId` built the contract without the IB
  client, skipping the combo-leg branch.
- NYMEX future options were looked up with a one digit year (`BEG7`) although
  IB now uses two (`BEG27`), and IB's two digit local symbols could not be
  parsed. A new `fop_year_digits` IB market setting (set to `2` for NYMEX)
  controls the year written, and either form is read.
- `reqPositionsMulti` resolved to `undefined` for an account without
  positions; it now resolves to `{}`.

### Tests

- Removed a stray `describe.only` that hid every other test, and added
  `--forbid-only` to `npm test` so this fails the run in future.
- Future option lookups roll over to the next year's contract months instead
  of choosing an expired contract late in the year.
- Updated future option strikes and IB strike scales to the contracts IB
  currently lists (CBOT and NQ strikes now use one less factor of ten), and
  removed Eurodollar (GE) options, which are no longer listed.
- Match SPY's current IB name, `SS SPDR S&P 500 ETF TRUST-US`.
- `broker-ib` mocks provide `reqContractDetails`, which order submission now
  calls.
- Forex tests in `ib-client` and `fetch-ib` are skipped when the IB account
  lacks market data permission for IDEALPRO, using the new
  `test/market-data-permission.js` helper.

### Documentation

- Moved `docs/architecture.md` to `ARCHITECTURE.md` and added sections on the
  life of a request, quote block storage, the Interactive Brokers modules and
  cross-cutting conventions.
- Expanded the README with features, requirements, configuration, a live
  trading warning and development setup.
- Added this changelog.

## 16.1 — 2026-01-17 to 2026-11-02

Versions 16.1.0 – 16.1.3.

- Rewrite the documentation
- requestFA is overloaded, handle both options
- Fix Expected ALIASES to be a(n) int
- Fix error handling and requestFA changes
- Upgrade IB TWS/Java dependencies

## 16.0 — 2023-11-03 to 2025-12-29

Versions 16.0.0 – 16.0.10.

- Fix number/string concat in replicate
- Handle BP..L and AV..L symbol.markets adjustments
- Fix allocation_peak_pct and reserve_peak_allocation to use numeric max
- Include Mtrader.version
- Use two parameters in cancelOrder(int,String)
- Check for empty Yahoo! response
- fix env arguments
- Increase max-header-size for Yahoo! redirect headers
- Update Yahoo! client to new v8 API
- Fix TypeError: Big(...).minus is not a function broker-ib.js:370
- Complete close process, if socket was closed already
- Add user-agent for yahoo service to stop giving Too Many Requests errors
- Handle http 'close' without 'end' edge case
- Don't lock iqfeed during first operation
- Handle undefined reading secType
- Upgrade to IB API 10.19

## 15.2 — 2023-01-30 to 2023-11-03

Versions 15.2.0 – 15.2.2.

- Fix debugging stats in promise-text
- Only use mid price if markets are active
- Don't cache failed results
- Don't cache failed fetch datasources
- Add timeout to iqfeed sockets
- Add more debugger info to http requests
- Add more debug details in storage locks
- Update yahoo client with new crumb json formatting
- The --depth option no longer has any effect. See RFC0019.
- Tolerate unknown position conids
- Don't release iqfeed client while opening it
- ib-gateway.js read settings.clients
- Use new IBKR TWS API dateTime format

## 15.0 — 2023-01-30

Versions 15.0.0 – 15.0.1.

- Pass env to launch TWS
- Upgrade ib-tws-node to use manual-only IBKR TWS login

## 14.2 — 2022-01-21 to 2023-01-27

Versions 14.2.0 – 14.2.8.

- Update tests after IB exchange name switch
- Still using GLOBEX exchange in IB
- Ignore positions in unknown markets
- Split COMEX market from NYMEX
- Rename GLOBEX to CME
- Fix Cannot read property 'summary' of undefined
- Update ib-tws-node
- Fix TypeError: agent(...) is not a function
- Handle concurrent accountUpdateMultiEnd
- Retry when yahoo fails or timeout
- Handle yahoo request timeout
- Check for duplicate lock names/months (causing possible dead lock) in storage util
- Auto restart iqfeed on timeout
- Update nodejs installer URL
- Don't pass on remote collect, if local+remote same tier
- Add support for round trip conditionsIgnoreRth
- Add support for conditionsIgnoreRth
- Fix Cannot read property 'acctCode' of undefined Error
- Don't check directory permissions on install (too expensive)
- Fix broker FOP positions
- Fix d3 is not defined error
- Add support for some future options
- Skip broken collective2 tests
- Update test data
- Update yahoo lookup and some tests

## 14.1 — 2021-01-15 to 2022-01-14

Versions 14.1.0 – 14.1.25.

- Don't log data that timed out
- Add FOP to CBOT market
- Include position name in broker positions
- Add better error message from missing quote-model
- Reuse accountUpdatesMulti requests
- Add VALUE exchange for TSE
- Ignore broker position price errors
- Read remote process agent options from config
- Add DARK, DRCTEDGE, and EDGEA to NYSE market
- Handle missing ib price execution history
- Bump ib-tws-node version
- Use a longer look back window for the last trade in options
- Wait for ib-client to reconnect before sending first command
- Timeout iqfeed requests
- Cancel and resubmit orders with different conditions
- Only fetch past adjustments in fetch-iqfeed
- Only call ib reqMktData within market hours
- Only fail promises once after general ib-client error
- Bump ib-tws-node
- Only use price per leg for SMART exchange
- mtrader pending lists listening server activity
- Check to see if the index is out of date in storage
- Yahoo! removed the big dividend split of XLF
- Don't check ib connection status after discennected
- Bump ib-tws-node to 0.0.9
- Treat untransmitted orders as cancelled
- Add input to replicate if collect was processed separately
- Include volume in iqfeed options and allow 1980/1990 options
- Don't log collective2 as much
- Fail IB soon if missing settings
- Don't include today when asking for future price action in iqfeed
- Use major version number in storage/protocol

## 14.0 — 2020-12-30 to 2021-01-14

Versions 14.0.0 – 14.0.11.

- Don't start IB unless a port is given
- Remove test password
- Don't include orders that have not been transmitted in reqOpenOrders
- Collect will now read broker parameters (like replicate)
- Drop OCA group of replicate orders (doesn't work for options)
- Update fast-csv
- Normalize order condition string
- Update mocha
- Update ib-tws-node to 0.0.8
- Handle connection attempt, but faild in ib-client
- Roll back shell version
- Parse TWS OrderCondition from order.condition in replicate
- Switch to use tab-delimited output by default
- Fix ib-tws-node pool management
- Add close-unknown flag to replicate
- Remove IBC, use ib-tws-node instead

## 13.2 — 2020-11-05 to 2020-12-23

Versions 13.2.0 – 13.2.12.

- Tolerate missing contracts in executions (in paper accounts)
- Switch to ib-tws-node
- Ignore default adaptivePriority=Normal param in IBALGO
- Combine combo LMT orders with price per LEG
- Fix node-shell version
- Rename VIRTX to EBS
- Use attach_ref in replicate to assign parent/child orders
- Replicate to combine orders with attachments
- Combine OCA orders
- Fix some broken tests
- Add BE euronext brussels exchange
- Fix small memory leak
- Silence unhandled ib connection fail error
- Add iqfeed error message for incorrect option symbol
- Change DIVIDEND function to use split as of reference date

## 13.1 — 2020-09-03 to 2020-10-18

Versions 13.1.0 – 13.1.10.

- Merge model parameters in quote-model
- Use SMART ib exchange for TSE market orders
- Ignore zero string from C2
- Use SMART for NYSE orders to use MidPrice Algo
- Match orders even if order_ref is different
- Handle bar w/o adj in c2 broker
- Add ignore-errors options to replicate
- Use SMART exchange for NASDAQ orders
- Auto-close IB tick stream after 100 ticks
- Use IB TWS deplayed-frozen data by default

## 13.0 — 2020-08-28 to 2020-09-02

Versions 13.0.0 – 13.0.5.

- Re-read collect settings on SIGHUP
- Log yahoo symbol that failed lookup
- If collect calls quoting functions pipe to remote worker
- Only update a block once at a time
- Add OPT support to Collective2 broker
- Add required transmit flag for collective2 broker

## 12.0 — 2020-08-17 to 2020-08-27

Versions 12.0.0 – 12.0.4.

- Match up markets with ib exchange in fetch lookup better
- Update lookup to filter by currency and security_type and update tests to use NYSE
- Move assets to NASDAQ when also listed under NYSE
- Don't load future ib adjustments unless end is after now
- Fold ARCA, AMEX, and BATS into NYSE and FWB into IBIS markets

## 11.10 — 2020-07-27 to 2020-08-06

Versions 11.10.0 – 11.10.5.

- Wait until ib.login_timeout reached before restarting ib gateway
- Increase fetch-ib cache size
- Don't let timed out ib request fill the throttle queue
- Add pending command
- Cache ib reqContractDetails
- Change default hours of OPRA to match stock options

## 11.9 — 2020-06-12 to 2020-06-22

Versions 11.9.0 – 11.9.1.

- Log missing quote-model assets
- Add symbol to warning log about Yahoo! adjustments download

## 11.8 — 2020-06-12

Version 11.8.0.

- bump minor

## 11.7 — 2020-06-05 to 2020-06-12

Versions 11.7.0 – 11.7.1.

- Don't show active handlers on shutdown
- Add natgas/corn/soybeans/wheat futures to iqfeed

## 11.6 — 2020-05-09 to 2020-06-02

Versions 11.6.0 – 11.6.8.

- Fix invalid regular expression
- Add update flag to force last asset bar refresh
- Only use midpoint w/ SNAP STK if within liquid_hours
- Include eod bar if missing from iqfeed interday bars
- Use last price if within liquid_hours
- Ensure iqfeed is open before using it
- Don't reuse tws/ib order_ids that are pending cancel
- Use v8 avail heap size to limit memory cache
- Only include tws/ib smartComboRouting when sending to SMART
- Assume process heap can grow as large as before for caching
- Use Yahoo! for all adjustments in all markets

## 11.5 — 2020-04-02 to 2020-05-07

Versions 11.5.0 – 11.5.25.

- Observe memory usage and limit memoize-cache on reduced avail
- Reduce quote-model in-memory cache
- Read ib.transmit from TSE market
- Skip ATR with null bar
- Quote Model cannot use quote block cache
- Add FWB market
- Handle AV.|LSE ending in period on yahoo
- Round trading_hours for NL/ASX
- Show OPRA TRADES from IB/TWS not (slow) MIDPOINT
- Combine orders even if some legs are attached
- Add more international stock markets
- Add reserve-allocation in dollars to replicate
- Include rarely traded positions in broker-ib
- Add Palladium iqFeed symbol to map
- Update adjusted position unless a working order was filled
- Lookup underlying IB contract to get exchange
- Add limit support to simulated SNAP STK order
- Optimize heavy collect function
- Only combine orders iff they have the same order_ref
- Only update quote blocks if market is open since last bar
- Use model.begin as lower limit to options.begin in quote-model
- Add short option -t for --transpose
- Add reserve-peak-allocation to replicate
- Fix partial fetch blocks logic
- Check for recursive quote-model
- Don't include first rows if after options.end
- Read security_tz from IB contract (fixed for CST)

## 11.4 — 2020-04-02

Versions 11.4.0 – 11.4.1.

- Improve custom order type SNAP STK to work after hours
- Read security_tz from IB contract (fixed)

## 11.3 — 2020-03-26 to 2020-04-02

Versions 11.3.0 – 11.3.4.

- Reduce test result possibilities
- Minor optimizations
- Check for interrupt more often
- Only include TWS IB intraday data if market is open
- Don't fail on TWS connectivity restored 1102
- Don't include most recent trade in iqfeed when end is before open

## 11.2 — 2020-03-26

Version 11.2.0.

- Remove heuristic test for Yahoo! split data

## 11.1 — 2020-03-14 to 2020-03-25

Versions 11.1.0 – 11.1.13.

- Only combine orders with the same order_ref
- Merge IB intraday bars (not just append)
- Print dividend value before adjustment factor in fetch adjustments
- Update some unit test data
- Fix IB contract timeZoneId error
- Filter false positive warnings of fetch-model not available
- Re-load quote settings on SIGHUP (reload)
- Read security_tz from IB contract
- Reset contract lookup cache on error
- Use group name in OCA replicate orders
- Check for interrupt in dataset collect
- Keep original stoploss order when adjustment orders are still working
- Change allocation-peak-pct to use past 12mo in replicate
- Include primaryExch in IB dividend lookup to resolve ambiguity
- Only fetch dividend info for stocks

## 11.0 — 2020-03-14

Version 11.0.0.

- Change replicate quant to absolute (not a delta) and require (new) position

## 10.9 — 2020-02-12 to 2020-03-14

Versions 10.9.0 – 10.9.4.

- Store Big numbers without quotes in CSV
- Add common TRIM function
- Cache future ib dividend info
- Include extended_hours options in attached orders
- Add fetch adjustments and SPLIT/DIVIDEND fn to collect
- Use cached quote blocks when processing quote-model

## 10.8 — 2020-02-05 to 2020-03-03

Versions 10.8.0 – 10.8.18.

- Don't wait to transmit when replacing ib group/bracket orders
- Don't combine options with different rights into combo orders
- Allow double bangs in parser
- Preserve AssertionError stacks over network
- Check for overlap intraday iqfeed bars (due to conflicting trading hours)
- Ignore Invalid number in common functions
- Fix format on Polling TWS orders after placing order if no status/error (i.e. paper account)
- Truncate options.end to now in quote cache
- Don't look in config-dir if file has json ext
- Move abs call
- Test OPRA market hours and handle daylight saving time
- Include index bars (without volume) in iqfeed
- Add allocation-peak-pct options to replicate
- Include caller stack trace in remote errors
- Write empty incomplete blocks in quote
- Support quote-model include settings from file
- Change directory structure for interday cache
- Handle new Yahoo! stock split format

## 10.7 — 2020-02-05

Versions 10.7.0 – 10.7.1.

- Fix some tests
- Cancel other orders when updated working orders
- Store complete block flag in properties (not data row)

## 10.6 — 2020-02-04

Versions 10.6.0 – 10.6.2.

- Check for interrupt while computing block expressions
- Check for no adj_close in indicator functions
- Update test/data
- Include the necessary warmup block(s) used to compute lookback functions

## 10.5 — 2020-02-02 to 2020-02-03

Versions 10.5.0 – 10.5.1.

- Add test for MOC adjustment orders
- Don't use recursive calls to combine IB event handlers
- Don't modify quote cache until written

## 10.4 — 2020-01-23 to 2020-01-31

Versions 10.4.0 – 10.4.7.

- Follow load include files in quote asset settings
- Ignore ib underConId if not found
- Add fetch cache to quote-model
- Include market properties in fetch contract
- Add trading_class/hours/liquid_hours to ib properties
- Watch pending order using order properties
- Add fetch contract and use that instead of fetch lookup
- Read market hours from ib contract details when available

## 10.3 — 2020-01-22

Versions 10.3.0 – 10.3.2.

- Mark recent quote-model bar as incomplete
- Modify MOD implementation to follow excel's
- Add quote-model eval blocks replacing symbol_replace and begin/end_expression

## 10.2 — 2020-01-07 to 2020-01-20

Versions 10.2.0 – 10.2.18.

- Add tier to local workers as fallback if no remote workers available
- Handle no adj_close in broker-ib positions
- Add tier to remote worker settings
- Watch submit orders for a bit if pending
- Check cancelled ib order status
- Use new orderId when updating order quant after rejection
- Allow disk cache to be used in past and present
- Add MID common function
- Add replicate flags to exclude working/adjusting orders
- Poll TWS orders after placing order if no status/error (i.e. paper account)
- Do a better job of choosing positive combo prices in replicate
- Handle orders without a given order_ref
- Allow replicate account parameters to be overridden
- A change of IB order status after an update is confirmation
- Replace ib stack trace with caller stack trace
- Add industry to fetch-ib fundamental and broker-ib positions
- Include next dividend in DIVIDEND calculation

## 10.1 — 2020-01-05 to 2020-01-06

Versions 10.1.0 – 10.1.3.

- Filter out combo order when looking for combo legs
- Don't timeout on ib-client.reqId
- Combine 1-to-1 options spreads
- Allow replicate to cancel combo orders

## 10.0 — 2019-12-22 to 2020-01-02

Versions 10.0.0 – 10.0.7.

- Defer ib timeout for high cpu load
- Include intraday even if the only day in iqfeed
- Allow broker-ib to use a different client for market_data
- Use quote-model to estimate option midpoint prices and spreads
- Remove shared SIGTERM listeners on close
- Check for paper configuration and keep IB open until all clients close
- Add quote-model input term symbol variable
- Create quote-model to replace fetch-model/fetch-blended

## 9.2 — 2019-12-21

Version 9.2.0.

- Don't require all input bars to be present for fetch-model

## 9.1 — 2019-12-20 to 2019-12-21

Versions 9.1.0 – 9.1.1.

- Increase process.setMaxListeners
- Add DIVIDEND/SPLIT functions to fetch-model

## 9.0 — 2019-12-16 to 2019-12-20

Versions 9.0.0 – 9.0.9.

- Inline fetch-model options variables in expression
- Assume parser might be async
- Change parser to handle async handlers
- Share adjustments db and track options.tz
- Improve reqHistoricalData log messages
- Log IB calculate option prices
- Disable fetch loops by default
- Add intraday support to fetch-model
- Trim asset models by both begin/end
- Allow iqfeed to fetch single historic bar
- Replace fetch-blended with fetch-model

## 8.6 — 2019-11-24

Version 8.6.0.

- Rewrite periods.js to use security_tz, market hrs

## 8.5 — 2019-11-05 to 2019-12-17

Versions 8.5.0 – 8.5.16.

- Delegate to non-ib sources when data older then today
- Limit IB intraday MIDPOINTs to 1wk
- Adjust option model price to actual midpoint in SNAP STK LMT
- Read traded_at from positions to determine if position has traded since signal in replicate
- Add allocation arguments to replicate cli
- Don't auto-trade if position his since been traded (not since updated)
- Add security_tz, liquid_hours, open_time, and trading_hours fields
- Disable FA TWS tests
- Check for string values in incomplete quote bars
- Flatten nested OCA orders
- Don't print full git head in version
- Don't change IB TWS auto close time
- Market order as filled on filled modification error
- Change CVAR to return shortfall tail (either side)
- Refactor ib-client general error codes
- If open/high/low is not available from iqfeed sumary, use close
- Only wait to check for SIGTERM every 100k calls
- Don't fail on IB cancelling an order when it is cancelled
- Add force option to replicate to ignore live position modification times
- Add salt to quote and adj cache and rename auth_nonce to auth_salt
- Always include incomplete flag in cache to indicate incomplete block

## 8.4 — 2019-10-29 to 2019-11-03

Versions 8.4.0 – 8.4.6.

- Use IB market snapshot data when market is open
- Use IB market data when open
- Increase default IB API timeout
- Don't assume results span 5yrs (opt/fut contracts)
- Don't stop fetch loops in fetch-remote
- Check for filter variables as string names
- Prevent loops in fetch dependencies to propegating disabled settings
- Have fetch-ib fallback to others for historic data

## 8.3 — 2019-10-23 to 2019-10-29

Versions 8.3.0 – 8.3.2.

- Add more Yahoo! tests
- Don't fail on 401 from Yahoo! splits
- Share ivolatility clients using the same cache-dir
- Allow markets to have daily open price outside of liquid hours

## 8.2 — 2019-09-23 to 2019-10-18

Versions 8.2.0 – 8.2.7.

- Fix issues introduced in 8.2.4
- Add accrued_cash and total_cash to replicate parameters
- Change quant_threshold to be inclusive minimum
- Fetch files/blended can now delegate to fetch settings
- AABA dissoluted/delisted
- Change END() to return MIN(END(),NOW())
- Improve error/debug messages
- Mark IB orders as duplicate to avoid reuse
- Bump version to 8.2.0

## 8.1 — 2019-08-20 to 2019-09-23

Versions 8.1.0 – 8.1.17.

- Replicate new pending position orders
- Don't match SMART market exchanges in broker-ib
- Retry with new TWS order_id if replacing order fails
- Always ask TWS IB for the next order_id
- Filter working orders to have action and quant
- Shorten replicate order_ref
- Enable MAXCORREL to work with imported subcollects
- Map SOXX.NASDAQ separate from SOX.NASDAQ
- Remove strike_price and expiration_date from fetch fields
- Support CL and NDX in their markets
- Allow replicate to choose order_ref
- Allow adjustment orders to be direction less (i.e. MKT)
- Add extended_hours and read_only flags
- Replicate working orders using column prefix
- Add broker-remote module
- Wait for port config before connecting ib-client
- Include client libs in version command

## 8.0 — 2019-08-19

Versions 8.0.0 – 8.0.2.

- Use options.info=='help' instead of options.help==true
- Force all shared instances to close in SIGINT/SIGTERM and keep them open while serving
- Use client and server remote settings

## 7.4 — 2019-07-10 to 2019-08-19

Versions 7.4.0 – 7.4.19.

- Store ending_format in quote tables
- Add timeout for ib-client requests
- Allow multiple ib clientIds for the same ib-gateway login
- Use allocation_min/max in net_deposit
- Add EMD.CME map for iqfeed
- Summarize failed orders in replicate
- Limit big numbers
- Merge COMEX into NYMEX market
- Fix typo in broker-ib
- Don't require an order on every row of replicate
- Add ICE market
- Check for null in MAX/MIN functions
- Add HG to iqfeed map
- Handle division by zero in broker-ib
- Don't close unknown positions if traded since the last desired posting
- Add Yahoo! exch 'YHD' to LSE market
- Don't fail on reduced order in ib-client
- Validate dateTime in periods.js
- Use now to filter out sub-collect when no end given
- Reduce IB STK orders on cash available error and don't combine cancel orders
- Switch to latest ibgateway version
- Don't fail on normal error messages to account update
- Don't treat Modulus operations as associative

## 7.3 — 2019-07-09

Versions 7.3.0 – 7.3.1.

- Allow combo order type to be different from eligible leg order types
- Yahoo! is (again) adjusting dividends for large splits

## 7.2 — 2019-06-26 to 2019-07-08

Versions 7.2.0 – 7.2.5.

- Reduce order quant on AVAILABLE CASH error
- Only store complete ib acount summaries
- Validate auth_sha256 when using auth_file in broker-ib
- Check for NPE in broker-ib
- Increase default login time for IB Gateway
- Change broker settings to use same keys as local config

## 7.1 — 2019-06-22

Version 7.1.0.

- Add ib-gateway module

## 7.0 — 2019-06-14 to 2019-06-21

Versions 7.0.0 – 7.0.6.

- Pass minTick from orders for use in SNAP STK limit
- Install IB Gateway during install
- Adjust SNAP STK orders every time
- Don't warn about unknown positions is other markets
- Flush ib balances on close
- Check if position has already been closed in replicate
- Store IB contract info (not just conId)

## 6.2 — 2019-06-03 to 2019-06-14

Versions 6.2.0 – 6.2.12.

- Add MGC to iqfeed map
- Include security_type from working position when undesired
- Add more parameters to replicate
- Add working_duration and allocation parameters to replicate
- Include comboLegsDescrip in IB combo orders
- Add a futures simulation test
- Use IB orderIds in sequence and Read traded_at or posted_at in replicate orders
- Submit all combo orders at once, don't wait for failure
- Don't close cache/storage while in use
- Check if ib client already closed on ib events
- Fix regex symbol/market
- Read offset in replicate
- Check for reverse signal in replicate
- Fail fetch-ib when TWS is locked
- Remove multiplier from fetch fields

## 6.1 — 2019-06-03

Versions 6.1.0 – 6.1.2.

- Treat orders as the same even if price is missing
- Fix broker-ib balances
- Add simulated SNAP STK order for underlying offset

## 6.0 — 2019-05-30 to 2019-06-01

Versions 6.0.0 – 6.0.5.

- Support IB Algo orders in broker-ib
- Set exitCode on failure
- Fix NPE in replicate action
- Log ib-client errors with request command
- Lookup security_type in replicate
- Rename order.type to order.order_type

## 5.2 — 2019-05-27 to 2019-05-30

Versions 5.2.0 – 5.2.4.

- Rename secType to security_type
- Combine orders with the same order type in replicate
- Support combo options orders in replicate and broker-simulation
- Add more error details to BS call
- Check for divide by zero found in ATR
- Fix fetch-ivolatility typo
- Implement placeOrder for IB client

## 5.1 — 2019-05-23

Version 5.1.0.

- Generalize replicate process to work with other brokers

## 5.0 — 2019-05-15 to 2019-05-20

Versions 5.0.0 – 5.0.2.

- Add secType to fetch-yahoo
- Don't require a working broker to start
- Replace collective2/position with replicate/broker-collective2

## 4.0 — 2019-04-25 to 2019-05-15

Versions 4.0.0 – 4.0.11.

- Allow broker-ib to get positions/balance in the past
- Use ib snapshot in pre-market for fetch-ivolatility
- Include current price in interday/intraday fetch-ib results
- Handle mtrader-date reverse date terms
- Store empty blocks unless they are the latest block
- Load sessions in the order given
- Check for zero division in POVO
- Add balances,positions,orders to broker-collective2
- Store IB account balance every few minutes
- Store ib-client orders, executions, and balances
- Restore collective2 command
- Add broker-ib to list balance/positions/orders

## 3.9 — 2019-04-24 to 2019-04-25

Versions 3.9.0 – 3.9.1.

- Add 10s timeout for Yahoo! response
- Use big.js in indicator functions

## 3.8 — 2019-04-23 to 2019-04-24

Versions 3.8.0 – 3.8.2.

- Use big.js in fetch-ivolatility
- Update ib-client to include execution log and json reports
- Round trip NaN
- Read intraday prices from Yahoo!

## 3.7 — 2019-04-21 to 2019-04-22

Versions 3.7.0 – 3.7.5.

- Use historic ib data for after hours prices
- Ignore zero cum_close from Yahoo!
- Keep checking IB intraday options until ivolatility comes through
- NUMBERVALUE now returns null for invalid numbers
- Move ivolatility index.json to cache dir
- Use big.js to calculate adjustments

## 3.6 — 2019-04-21

Version 3.6.0.

- Don't log missing config files
- Compress cache files

## 3.5 — 2019-04-21

Version 3.5.0.

- Handle null values in arithmetic operators

## 3.4 — 2019-04-19

Version 3.4.0.

- Use big.js for common decimal arithmetic

## 3.3 — 2019-04-12 to 2019-04-19

Versions 3.3.0 – 3.3.3.

- Ignore fetch-ivolatility intraday values w/o bid/ask
- Have ib-client reads its own settings
- Add ib.reqContract to return just the contract summary that uses preemptive caching
- Fix fetch-ib ending time

## 3.2 — 2019-03-31 to 2019-04-12

Versions 3.2.0 – 3.2.9.

- Add more ib-client request methods
- Use a bigger IB TWS request queue
- Reconnect to TWS after failed options
- Try a little harder to keep the order of result properties in columns
- Add exec mtrader shell command
- Add INDEX to TSE market
- Fix ReferenceError: symbol in iqfeed-client
- Add BS black-scholes functions
- Fix iqfeed options expiring in decade 2000
- Fix CBOT trading hours

## 3.1 — 2019-03-26 to 2019-03-30

Versions 3.1.0 – 3.1.2.

- Add CBOE holiday information to date module
- Add Treasury Futures and CBOT market
- Add support for weekly CFE VX futures on iqfeed

## 3.0 — 2019-03-24 to 2019-03-25

Versions 3.0.0 – 3.0.1.

- Fix TEXT date formats
- Use OCC symbol format for index/equity options

## 2.6 — 2019-03-23 to 2019-03-24

Version 2.6.0.

- Better failure message from ivolatility.com authentication
- Map IQFeed security_type to TWS secType

## 2.5 — 2019-03-20 to 2019-03-23

Versions 2.5.0 – 2.5.5.

- Exclude debug node exec arguments from child processes
- Only fetch intraday data if today is next day
- Add CBOE futures market
- Change fetch-ivolatility to use ib-client snapshot for intraday
- Enable fetch intraday IB TWS API
- Merge portfolio arrays when loading
- fetch-ivolatility should ask for intraday data
- Add currency to fetch lookup results
- Include end of day in fetch-ib results
- Limit how many days are loaded in TWS intraday MIDPOINT
- Ignore stock splits to/from zero

## 2.4 — 2019-03-19 to 2019-03-20

Versions 2.4.0 – 2.4.1.

- Don't return too much from blended
- Add TWS API support for fetching market data

## 2.3 — 2019-03-19

Version 2.3.0.

- Use default timezone (not options.tz) in most date/time operations

## 2.2 — 2019-03-09 to 2019-03-15

Versions 2.2.0 – 2.2.1.

- Include peudo splits in adj_split_only
- Move year/quarter/month/week interday intervals into common fetch.js
- Store quote by market then symbol
- Change fetch internal API help
- Rename TSX to TSE and TSXV to VENTURE

## 2.1 — 2019-02-24 to 2019-03-09

Versions 2.1.4 – 2.1.12.

- Change fetch internal API
- Fix load variable name
- Check if there are too many chained conditional signals
- Try to fetch data after weekend
- Fix recent fetch-iqfeed bug
- Don't try to fetch weekend data
- Include cookies when requesting downloads from ivolatility.com
- Update ivolatility.com download URL
- Add ivolatility.com lookup
- Add shell date
- Log connection error message
- Add date/config to Mtrader class
- Use m30 intraday for options

## 2.0 — 2019-02-15 to 2019-02-19

Versions 2.0.0 – 2.0.4.

- Don't throw an error if iqfeed option isn't traded anymore
- Fix mtrader-quote strict mode and add version msg
- Fix collective2 settings
- Use async/await in more places and make interrupt.js async
- Replace var with const/let
- Update test coverage tools
- Use strict mode
- Multiple calls to mtrader.close() have to effect
- Change require('mtrader') to return a class and split collective2.js into multiple files

## 1.9 — 2019-02-14 to 2019-02-15

Version 1.9.0.

- Parallel mostRecentTrade
- Check for null portfolio
- Allow collect to take no args (again)
- Always use iqfeed summary for options mid day price

## 1.8 — 2019-02-13

Version 1.8.0.

- Fix repeated ivolatility prices

## 1.7 — 2019-02-13

Version 1.7.0.

- Read today's intraday price from iqfeed summary

## 1.6 — 2019-02-12

Version 1.6.0.

- Rename CBOEX market to CBOE and IND to X

## 1.5 — 2019-01-22 to 2019-02-12

Versions 1.5.0 – 1.5.11.

- Allow collect to take multiple arguments
- Add mtrader.date
- Use end of day for ending of intraday iqfeed mid price options
- Assume ivolatility username:password is base64 auth file
- Fix exponential number parser
- Don't create another iqfeed-client if closed
- Use 9mo life of non-jan options
- Check if option is expired before looking for intraday data
- Fix ivolatility empty result
- Assume options are only traded 3yrs within exdate
- Share fetch-remote connections
- Increase iqfeed cmd timeout
- Use bid/ask for options intraday price

## 1.4 — 2019-01-21

Version 1.4.0.

- Require ivolatility client use date in the symbol name (a Thursday, Friday, or Saturday)

## 1.3 — 2019-01-11

Version 1.3.0.

- Invert Yahoo! split data to reflect protocol change

## 1.2 — 2018-12-18 to 2019-01-11

Versions 1.2.4 – 1.2.19.

- Update test data
- Copy used static parameters from signalset to result
- Add template literal expressions to grammar
- Consider variables in concat expressions from rolling criteria
- Update shell version to silence deprecation warning
- Reuse fetch-remote connections
- Wait for cache entries to close before re-creating them
- Add Fri 2000-04-21 as ivolatility expriation exception
- Add lib_dir config and look at options expiration for combine_after
- Use consistent options symbol for ivolatility.com &lt;2010
- Add fetch.ivolatility.combine_after setting, useful to ignore iqfeed &lt;2016
- Process one ivolatility.com zip entry at a time
- Use last trading day as ivolatility.com expiration after 2015
- Check response status code from ivolatility.com
- Only check ivolatility.com four times a day
- log active handles on close
- Auto download daily updates from ivolatility.com

## 1.1 — 2018-11-16 to 2018-12-09

Versions 1.1.0 – 1.1.4.

- Add an initial ivolatility.com fetch
- Fix stoploss orders
- Allow STC to update c2 limit
- Compute working state before desired state
- Make sure columns override parameters, even when nesting
- Fix bug introduced by options

## 1.0 — 2018-09-27 to 2018-11-16

Versions 1.0.0 – 1.0.22.

- Increase default timeout
- Add IND market
- Change load key order
- Fix issue in new load option
- Add BSIV/POWER/PI functions for calculating options greeks
- Merge load filenames
- Don't require criteria for rolling functions
- Use graceful-fs everywhere
- Use graceful-fs for handle EMFILE
- Don't require a format in TEXT func
- Add POWER/SQRT/EXP/LN/NORMSDIST/NORMSINV functions
- Don't hide nested columns with null defaults
- Inline obvious options lookup
- Add LEN/SEARCH functions
- Allow more outstanding iqfeed requests
- Add REPLACE text function
- Also use stable sort for collect when results>10
- Make collect session identify optional
- Lookup market open/close hours for blended delegate
- Use current price when adjusting position
- Check for empty result in fetch-blended
- Allow fetch-blend to be used with unknown markets
- Only open at most one iqfeed-client and close it after more then 10min since it was used
- Reduce the number of iqfeed TCP connections used
- Store security_type in cfg to identify equity adjustements
- Add symbol/market to quote error messages
- Add COMEX market
- Reuse existing signal when adjusting position
- Use logger.debug for collective2 data
- Tag 1.0.0
