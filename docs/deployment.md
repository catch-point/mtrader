# Deployment

mtrader can run as a headless service that other mtrader instances send work to
(collect jobs, fetch requests, broker actions) over a secure WebSocket. See
[architecture](../ARCHITECTURE.md#distributed-work).

## Running a service by hand

```sh
mtrader config remote.listen wss://0.0.0.0:8443
mtrader config remote.key_pem  etc/mtrader-privkey.pem
mtrader config remote.cert_pem etc/mtrader-fullchain.pem
mtrader start            # serves until stopped
mtrader stop             # stops the service listening on remote.listen
```

Point clients at it:

```sh
mtrader config 'collect.remote' '[{"enabled":true,"location":"wss://host:8443"}]'
mtrader config fetch.remote.enabled true
mtrader config fetch.remote.location wss://host:8443
mtrader pending          # what each remote is working on
```

To restrict which clients can connect, set `remote.ca_pem`, `remote.requestCert`
and `remote.rejectUnauthorized` (see [configuration](configuration.md#remote-service)).

## `install-daemon.sh` (Debian/Ubuntu, systemd)

```sh
sudo bash -c 'bash <(curl -sL https://raw.githubusercontent.com/catch-point/mtrader/master/install-daemon.sh)'
```

The script:

1. Installs Node.js, `unzip` and `libxtst6` if they're missing (using apt).
2. Creates an `mtrader` system user and group with home `/opt/mtrader`, unless
   `/etc/default/mtrader` names another `DAEMON_USER`.
3. Installs or updates mtrader globally for that user with npm.
4. Optionally installs IB Gateway and the TWS API jar for the `ib` data source and
   broker.
5. Asks for the domains, listen interface, port and default time zone, and writes
   them to `<prefix>/etc/mtrader.json`.
6. Optionally gets a Let's Encrypt certificate with certbot, plus pre/post renewal
   hooks.
7. Writes and starts `/etc/systemd/system/mtrader.service`.

`/etc/default/mtrader` can set variables such as `DAEMON_USER` beforehand.
`uninstall-daemon.sh` removes the service, the certificates and their hooks, the
generated config and the cache directory.

## Operations

- **Logs**: `journalctl -u mtrader`. Use `-v`/`-x` for more detail; `replicate --log`
  also appends to a file.
- **State**: back up `lib_dir` (simulated accounts, order history). `cache_dir`
  can be rebuilt.
- **Upgrades**: rerun `install-daemon.sh`. Remote connections use a versioned
  path (`/mtrader/<major>/remote`), so clients and services need the same major
  version.
