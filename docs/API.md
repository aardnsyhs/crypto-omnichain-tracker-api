# Transaction Story Explorer API

Active registry: Ethereum, Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash. BSC and Polygon remain legacy EVM lookup-compatible and are excluded from the overview. The product looks up individual transactions on a selected network; it does not trace a cross-chain journey.

- `GET /health/live`: process liveness, no sessions or provider calls.
- `GET /health/ready`: bounded PostgreSQL/Redis checks; database unavailable => HTTP 503; Redis unavailable => HTTP 200 degraded/cache bypass.
- `GET /v1/session`: HTTP 204 after issuing or renewing a signed anonymous cookie. Await before initial concurrent history/lookup calls.
- `POST /v1/transactions/lookup`: existing `{ chain, transactionHash, refresh? }` request and `{ data, meta }` response. EVM hashes have `0x` plus 64 hexadecimal characters; UTXO hashes have 64 hexadecimal characters without `0x`. Each caller owns its `meta.requestId` and history record. Refresh has a 15-second cooldown.
- `GET /v1/history?limit=20`: history isolated by the signed cookie, never an unsigned session ID.
- `GET /v1/overview`: Blockchair-only active network overview. Missing numeric fields are null, never a substitute zero. Preserved fields retain `fieldUpdatedAt` timestamps and appear in `staleFields`; the containing section has `status: stale` and `isStale: true`. `updatedAt` is its oldest valid value timestamp. Additive `meta.isRateLimited` and `meta.providerStatus` expose quota failures, including HTTP 402/429. Existing fields remain compatible.

Overview freshness: 60 seconds; maximum value age: 300 seconds from original collection. The frontend polls every 60 seconds only while the overview and tab are visible. This is periodic refresh, not instantaneous real-time data.

Errors use `{ error: { code, message, requestId } }`. HTTP 429 supplies Retry-After. Provider quota errors remain `UPSTREAM_RATE_LIMITED` with HTTP 503. Timeouts remain `UPSTREAM_TIMEOUT`; pending status, missing receipts, metadata gaps and provider errors remain distinct. No CoinGecko integration is used.
