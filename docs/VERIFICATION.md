# Production-readiness pass verification

Date: 2026-10-08, Asia/Jakarta. Both repositories started on `main` tracking `origin/main` with clean working trees. No applicable repository AGENTS.md or deployment service templates were found. Work remains uncommitted and unpushed. No live VPS service, DNS record, production migration or cleanup schedule was changed.

## Confirmed findings and fixes

- Overview `data:null` was treated as a successful refresh and could replace valid values. Recovery now merges by network and field, retains original timestamps, rechecks a 300-second maximum age, preserves a valid envelope on total failure, propagates quota metadata, deduplicates refreshes and cools down without quota-related fan-out.
- Readiness was a static `not_checked` payload. It now bounds PostgreSQL and Redis checks; PostgreSQL failure returns 503, Redis failure is explicit degraded/cache bypass. Health probes bypass session creation and lookup quotas.
- Redis marked an opened socket healthy and stopped reconnecting after three attempts. Health requires ready/PING; reconnect uses bounded exponential delays up to 30 seconds with offline queue disabled and bounded commands.
- Transaction deduplication shared request ID and session side effects. Shared promises now contain transaction/cache data and reusable provider telemetry only. Each request awaits its own history and telemetry writes and retains its own ID.
- Session middleware accepted unsigned cookies and renewed database expiry without aligning cookie expiry. Only a valid signed 64-hex token is accepted, and cookie expiry follows the database session. A session bootstrap route supports serialized frontend initialization.
- RPC overall timeout discarded useful receipt/transaction data and left work running. An abort signal now reaches Axios requests, completed data is retained, timers are cleared and metadata scheduling stops at the deadline.
- Environment validation now runs before AppModule import, with explicit production configuration, HTTPS origin and strong-secret requirements, bounded numeric settings and actionable errors that omit secret values. PostgreSQL defaults are development-only. The clean-build entrypoint was `dist/src/main.js`, and `start:prod` now uses it.
- Local proxy trust is explicit and restricted. Actual throttler tests verify direct spoofed headers and multi-hop header manipulation cannot rotate client identity. Manual refresh has a bounded per-hash cooldown. Nginx templates reject excessive requests before session database work.
- The active registry already correctly distinguished six active networks from BSC/Polygon legacy compatibility. Lookup decoding, UTXO BigInt arithmetic, registry networks and response fields were preserved. Wording/documentation was aligned; no CoinGecko, authentication, wallet integration or new network was added.

## Executed checks

| Command/check | Actual result |
| --- | --- |
| `npm ci --ignore-scripts --offline` | Installed 799 backend packages from lockfile; generation is a separate required step |
| `npm run prisma:generate` | Prisma client 7.10.0 generated; required access to the existing engine cache outside the sandbox |
| `NODE_ENV=test ... npm run prisma:deploy` | Applied both checked-in migrations to a new isolated PostgreSQL 16 database on loopback port 55439 |
| `npm exec prisma migrate deploy -- --help` | Confirmed installed Prisma 7 production migration command |
| `npm run lint` | Exit 0; 14 pre-existing `no-explicit-any` warnings in overview/UTXO fixture tests |
| `npm run typecheck` | Exit 0 |
| `npm test -- --runInBand` | 17 suites, 97 tests passed |
| `npm run test:e2e -- --runInBand` | 3 suites, 13 tests passed, isolated services |
| `npm run build` | Passed; Nest deletes dist before emitting `dist/src/main.js` |
| `node scripts/integration.cjs` | Actual compiled Nest guard and real PostgreSQL/Redis: health, no probe/overview sessions, signed cookies, separate history/IDs/telemetry, refresh cooldown and proxy spoofing passed |
| `node scripts/cache-recovery.cjs` | Temporary Redis stop/restart: bypass during outage and automatic recovery passed |
| `node scripts/provider-contract.cjs` | Actual Axios client with local stub: data:null, HTTP 402/429, provider context quota flags, provider timeout passed |
| `node scripts/startup-smoke.cjs` | Production entrypoint, invalid-secret fail-fast, ready response, CORS, Secure/HttpOnly cookie and SIGTERM exit passed |
| `node scripts/cleanup.cjs --dry-run` | Isolated DB: 0 eligible records in each category; no deletion executed |
| `systemd-analyze verify ...` | Both service templates passed without installation |
| `nginx -t` with staged templates | Passed with temporary cert/log/temp paths and unprivileged ports 58080/58443; production ports/certificates require operator validation |
| `npm audit --json` | Exit 1: 38 affected entries (33 high, 5 moderate), after compatible patches |
| `npm audit --omit=dev --json` | Exit 1: 4 high Prisma CLI dependency entries; see SECURITY-REVIEW.md |
| `git diff --check` | Passed |

The initial E2E run exposed an outdated no-renewal cookie expectation and a secondary hash validation failure for unsupported chains. Cookie assertions were updated to verify identity preservation, and hash validation now defers to chain validation when the chain is unsupported. The final run above passed.

## Regression evidence

`overview-recovery.spec.ts` exercises the provider's actual result shape: total null failure, partial network and field failure, 402/429, stale expiry, later recovery, and concurrent refresh. Existing overview tests retain fee-unit and genuine-zero behavior. `environment.spec.ts` verifies production requirements and invalid numeric settings. Health tests cover ready, database-down, Redis-down and hung checks. RPC tests retain already obtained receipt/transaction data at the overall deadline, assert signal abortion, cap metadata jobs at three and verify no next batch after expiry. Existing decoder and UTXO tests still pass.

The integration script checks two real database sessions lookup the same hash concurrently with one provider call, distinct response IDs, two telemetry rows and isolated history. It also checks invalid and unsigned cookies, cooldown rejection with Retry-After, actual rate limiting and trusted/untrusted forwarded-header paths. Provider fixtures are deterministic; no paid provider reliability is required.

## Changed file groups

- Backend behavior: `src/config/`, `src/main.ts`, `src/app.module.ts`, `src/health/`, `src/database/prisma.service.ts`, `src/cache/cache.service.ts`, `src/sessions/`, `src/overview/`, `src/transactions/transactions.service.ts`, transaction validation/filter files, and Blockchair/RPC client/service files.
- Regression/operations: health/overview/config/RPC tests, E2E assertions, `scripts/{integration,cache-recovery,provider-contract,startup-smoke,cleanup}.cjs`, `.github/workflows/ci.yml`, Node/package metadata and lockfile.
- Deployment/docs: `.env.production.example`, `.env.example`, `deploy/nginx/`, `deploy/systemd/tracker-api.service`, log templates, `docs/{API,DEPLOYMENT,SECURITY-REVIEW,VERIFICATION}.md`, README.
- Frontend changes and static accessibility evidence are recorded in the sibling frontend's `docs/VERIFICATION.md` and `docs/ANTISLOP-REVIEW.md`.

## Limits and launch requirements

No browser was opened and no screenshot was captured. Real-device zoom, on-screen keyboard, visual breakpoint behavior and browser click-through remain untested by explicit instruction. GitHub-hosted workflows were authored but not remotely executed. Local equivalents passed as listed. Sandbox socket/cache/font restrictions required authorized reruns outside the sandbox; live services remained untouched. Paid-provider quota, production TLS and actual VPS networking were not tested.

Before launch: supply credentials/provider endpoints and random session secret; issue TLS certificates; review residual Prisma/development-tool advisories; validate the staged configuration against the real VPS; take and restore-test a backup; then follow `docs/DEPLOYMENT.md`. Production readiness is not inferred from compilation alone.
