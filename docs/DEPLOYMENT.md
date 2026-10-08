# Transaction Story Explorer: single-VPS deployment

These are reviewable instructions and templates. Nothing here has been installed on the live VPS. Use one API process and one frontend process behind the existing local Nginx. The API throttle and refresh cooldown are process-local. Multiple API instances would require shared limiting and session-bootstrap coordination.

## Configuration and prerequisites

Use Node.js **24 LTS**, npm, PostgreSQL 16 and Redis 7. Node 24 is the supported major in both `.nvmrc` files and CI. See the [Node release schedule](https://nodejs.org/en/about/previous-releases). Install a current patched Node 24 binary at `/usr/bin/node`, or change both service templates to its actual absolute path.

Create an unprivileged `tracker` user, `/srv/tracker/{api,web}/releases`, `/etc/tracker`, and `/var/www/acme`. Each release is a separate checked-out directory; `current` symlinks point to the active release. Keep the previous release until verification is complete. Review ownership: `tracker` must read application files and write only the frontend `.next/cache` directory. Environment files should be root-owned mode 0600, readable by systemd. Do not place production `.env` files in source control or public directories.

Copy the backend `.env.production.example` to `/etc/tracker/api.env` and frontend `.env.production.example` to `/etc/tracker/web.env`. Supply:

| Setting | Value to supply |
| --- | --- |
| `DATABASE_URL` | Dedicated database/user/password, URL-encoded password, actual local port and DB name |
| `REDIS_URL` | Local Redis endpoint with a dedicated password, URL-encoded |
| `SESSION_SECRET` | Output of `openssl rand -hex 32`; rotating it invalidates existing cookies |
| `BLOCKCHAIR_API_KEY` | Actual provider key with quota for the expected traffic, or remove the setting for public access |
| `ETHEREUM_RPC_URL` | Your Ethereum RPC HTTPS endpoint |
| `BSC_RPC_URL`, `POLYGON_RPC_URL` | Existing legacy RPC endpoints, optional if legacy lookups are not needed |
| `WEB_ORIGIN` | Exactly `https://tracker.ardiansyah.app` |
| `NEXT_PUBLIC_API_BASE_URL` | Exactly `https://api.ardiansyah.app`, set **before the frontend production build** |
| `API_HOST`, `PORT`, `TRUST_LOCAL_PROXY` | `127.0.0.1`, `4000`, `true` for this topology |
| TLS certificate paths | Issued certificates for each hostname; templates contain expected Let's Encrypt paths |

Do not leave any `REPLACE_...` entries active. Production requires explicit database/Redis/origin/secret settings and rejects invalid numeric settings before module initialization. Development uses `.env.example` defaults. `PORT` takes precedence over the legacy `API_PORT` alias. The API uses `/v1` routes; the configured API URL must not include `/v1`.

Bind PostgreSQL and Redis to loopback and protect them with credentials. Open only SSH and HTTP/HTTPS at the firewall. Do not expose ports 3000, 4000, 5432 or 6379. Trust is limited to 127.0.0.1/32 and ::1/128; do not set Express trust proxy to `true` or append untrusted forwarded IPs in Nginx. This configuration assumes no CDN or external reverse proxy in front of Nginx.

## Install, migrate, build

Run commands in a **new release directory**, with the relevant environment loaded securely. Examples below assume environment variables are exported, not printed. A shell operator may use `set -a; . /etc/tracker/api.env; set +a` from a privileged, non-logging shell. Do not print environment files into deployment logs.

Backend:

```sh
npm ci --ignore-scripts
npm run prisma:generate
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
npm exec prisma migrate status
npm run prisma:deploy
```

`prisma:deploy` executes **Prisma 7.10 `prisma migrate deploy`**, confirmed against the installed CLI. It applies only checked-in migrations. Never run `migrate dev`, `migrate reset`, or `db push` against production. Back up and review SQL before applying migrations. Client generation is explicit because installation disables lifecycle scripts. `start:prod` runs the clean-build entrypoint `dist/src/main.js`. Keep full lockfile dependencies in the release for the Prisma CLI and generated client; the systemd service needs no npm or TypeScript execution. Do not prune or regenerate the client after building without rechecking startup.

Frontend, using `/etc/tracker/web.env` at build time:

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run build
mkdir -p .next/cache
```

The frontend API origin is compiled into the client bundle. Changing only the service environment cannot change an already built bundle. Rebuild for a different origin. The existing Google font integration fetches fonts during build, so permit access to Google's font hosts from the build machine.

Run E2E and `scripts/integration.cjs` only against isolated test databases/Redis as CI does. Integration tests create session/history/log records. Provider scenarios use fixtures and a local HTTP stub; no provider credentials are needed. The Jest 29 suite uses a throttler shim because its VM loader cannot load the installed CJS throttler/ESM Nest combination; `scripts/integration.cjs` exercises the actual compiled guard and proxy behavior under Node 24.

## HTTPS and Nginx

Copy `deploy/nginx/tracker-limits.conf` into Nginx's `http` context once. Stage the two virtual-host templates. On a host without certificates, initially enable only the port-80 ACME locations, then obtain certificates using your existing ACME tooling, for example `certbot certonly --webroot -w /var/www/acme -d tracker.ardiansyah.app -d api.ardiansyah.app`. A combined certificate may use one certificate directory; update both TLS paths accordingly. Verify renewal with your certificate tooling before enabling both HTTPS server blocks. DNS changes and certificate issuance are operator actions, not part of this repository pass.

`proxy_pass` has no trailing path, preserving `/v1/...`. Nginx overwrites forwarded headers and request IDs. Lookup limiting (30/minute with a burst of 5), overview limiting (60/minute, burst 5), and general API limiting (5/second, burst 10) happen **before session middleware performs database work**. Body size is capped at 16 KiB for API requests. API upstream read timeout is 50 seconds, above the 35-second RPC enrichment deadline and 45-second frontend deadline. Redis/database commands have bounded timeouts.

Nest CORS allows only the frontend origin, with credentials. Both hostnames are same-site HTTPS; the API issues a host-only, signed, Secure, HttpOnly, SameSite=Lax cookie. Do not add a broad `.ardiansyah.app` cookie domain. Frontend overview requests omit credentials and backend overview routes bypass sessions. The frontend initializes `/v1/session` once before concurrent history/deep-link requests. Cookie renewal uses remaining database lifetime, preserving expiry alignment.

Validate staged configuration with `nginx -t` and review it before an operator reloads Nginx. The templates intentionally restrict `/health/` to local monitoring. Validate public CORS via `/v1/session` or `/v1/overview`.

## Start and verify

Copy `deploy/systemd/tracker-api.service` and the frontend's `deploy/systemd/tracker-web.service` to `/etc/systemd/system`. Review paths, user, ports, environment file permissions, and `.next/cache` ownership. After selecting each `current` release symlink, an operator runs:

```sh
systemctl daemon-reload
systemctl enable --now tracker-api tracker-web
curl --fail http://127.0.0.1:4000/health/live
curl --fail http://127.0.0.1:4000/health/ready
curl --fail --head http://127.0.0.1:3000
curl --fail --head https://tracker.ardiansyah.app
curl -i -H 'Origin: https://tracker.ardiansyah.app' https://api.ardiansyah.app/v1/session
journalctl -u tracker-api -u tracker-web --since '10 minutes ago'
```

Readiness returns HTTP 503 when PostgreSQL fails, 200 `degraded` with `redis: bypassed` when only Redis fails, and 200 `ready` when both checks succeed. Liveness is process-only. Health responses do not issue cookies, use lookup quotas, or query blockchain providers. Readiness is a required deployment check, but also verify one real EVM transaction, one UTXO transaction, history isolation, quota configuration, and provider access before public launch. API shutdown hooks close Prisma and Redis on SIGTERM.

## Freshness and recovery policy

Overview values are fresh for 60 seconds and may be preserved for at most **300 seconds total since that field was last obtained**, not 300 seconds after expiry. Per-field timestamps and `staleFields` accompany each section; `updatedAt` is the oldest retained field timestamp, so a mixed section is explicitly stale. Cache reads recheck every field's age even during the envelope TTL. A total failed refresh cannot replace the last valid envelope. Quota failure cools down for 60 seconds; other total failures for 15 seconds. A successful partial batch may fetch missing networks individually, stopping on quota errors. Redis outage falls back to the latest in-process overview under the same age bounds.

Transaction provider work is deduplicated by chain/hash, but every request gets its own request ID, history write and telemetry. A manual refresh has a 15-second per-transaction cooldown in addition to IP limits. Pending transactions are not cached; degraded and low-confirmation results use shorter TTLs. RPC enrichment stops issuing new work at its overall deadline, aborts HTTP calls, and retains receipt/transaction data already obtained.

## Backup, retention, and logs

Use PostgreSQL tooling of the same or newer supported major, a protected `.pgpass`/service configuration, and encrypted backup storage. Do not put database passwords in shell arguments or shell history. Example with a configured `PGSERVICE=tracker_backup`:

```sh
pg_dump --format=custom --file=/secure/backup/tracker.dump
pg_restore --list /secure/backup/tracker.dump
```

Take daily backups, retain 7 daily and 4 weekly copies off-host, and restore-test monthly into a separate database. Restore using a separately configured `PGSERVICE=tracker_restore`:

```sh
pg_restore --no-owner --no-acl --dbname=tracker_restore /secure/backup/tracker.dump
```

Never restore over a live database without an approved recovery plan and downtime. Redis holds disposable caches and does not require a data backup; retain its configuration and credentials securely. Back up environment files separately with restricted access.

Sessions expire after 30 days by default. Retain search history and request logs for 30 days; remove history of expired sessions. `node scripts/cleanup.cjs --dry-run` is the default preview. `--execute` removes at most 500 history rows, 500 request logs, and 500 expired **childless** sessions per invocation. Active sessions are not deleted. Repeat bounded batches until no eligible records remain. The command uses 5-second SQL statement timeouts. No cleanup or schedule was enabled in this task. Review expected counts and backups before scheduling it.

Nginx access logs include client IPs and query strings; do not add cookie or authorization headers. Review `deploy/tracker-logrotate.conf`, retain 14 daily logs, and avoid duplicate handling by an existing `/var/log/nginx/*.log` rule. Service output uses journald; `deploy/tracker-journald.conf` documents a 500 MiB/14-day cap but changes host-wide policy, so integrate it with the existing VPS logging policy rather than blindly installing it.

## Rollback

Stop the affected application, restore the `current` symlink to the previous verified release (including its node_modules and generated Prisma client), restart, then check readiness and HTTP behavior. This pass adds no schema migration and is compatible with the two existing migrations. For future schema changes, roll back application code only if the previous version is compatible with the applied schema. Additive changes usually allow this; dropped columns, changed types, and data transformations may not. Prefer forward repair. Database restoration is a separate, potentially data-losing operation and is never an automatic part of application rollback.
