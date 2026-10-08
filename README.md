# Transaction Story Explorer API

NestJS API for per-network transaction lookup, presented by the frontend as an Investigative Ledger. Active networks are Ethereum, Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, and Dash. BSC and Polygon retain legacy EVM lookup compatibility but are not advertised as active overview networks. The application does not trace a cross-chain journey.

Blockchair supplies transaction dashboards and market/network statistics. Ethereum uses RPC enrichment and fallback; legacy EVM chains use their configured RPC endpoints. ERC-20 transfers and approvals are decoded from receipts. UTXO amounts use exact BigInt arithmetic. No CoinGecko dependency is used.

Use Node 24 LTS, PostgreSQL 16 and Redis 7. For local development:

```sh
cp .env.example .env
npm ci --ignore-scripts
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

`prisma:deploy` applies checked-in migrations to the configured local database. For new development migrations only, use `npm run prisma:migrate`. Never point development migration commands at production.

Checks: `npm run lint`, `npm run typecheck`, `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, and `npm run build`. Integration services must be isolated. The compiled entrypoint is `dist/src/main.js`; `npm run start:prod` starts it. Graceful shutdown closes database and cache clients.

See [API behavior](docs/API.md), [VPS deployment and rollback](docs/DEPLOYMENT.md), and [verification record](docs/VERIFICATION.md). Production examples and staged Nginx/systemd templates are included; they are not deployed automatically.
