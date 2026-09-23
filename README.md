# Crypto Omnichain Transaction Tracker — API

Backend service for **Crypto Omnichain Transaction Tracker**, built with NestJS, strict TypeScript, PostgreSQL (Prisma), Redis, and multi-chain EVM RPC adapters.

## Project Context

This repository (`crypto-omnichain-tracker-api`) contains the backend service and owns the canonical API contract. The frontend client lives in a paired separate repository (`crypto-omnichain-tracker-web`). The frontend consumes the versioned API contract and never imports backend source code directly.

## Capabilities & Architecture

- **Transaction Story Engine:** Explains user intent, native transfers, ERC-20 token movements, and approval allowances with deterministic, execution-status-aligned narratives.
- **Multi-Chain Support:** Ethereum Mainnet, BNB Smart Chain, and Polygon PoS.
- **EVM RPC Enrichment:** Decodes receipts, logs, and token metadata using standard JSON-RPC (`eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_call`) with bounded deadlines and graceful degradation.
- **Strict Decoding Standards:** Distinguishes ERC-20 from ERC-721 NFT events; handles BigInt token amounts without floating-point precision loss; detects maximum allowance (`2^256 - 1`) and zero allowance revocations.
- **Provider Reconciliation:** Validates chain IDs, detects execution status discrepancies between Blockchair and on-chain RPC receipts, and flags uncertain states as `unknown`.
- **Status-Based Cache-Aside (Redis):**
  - Confirmed: 3600s TTL
  - Failed: 3600s TTL
  - Degraded / Temporary failure: 60s TTL
  - Pending: strictly 0s (bypassed)
  - Preserves immutable `fetchedAt` timestamps on cache hits.
- **Auditing & History:** Scoped anonymous session history and request telemetry persisted in PostgreSQL.

## Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 15
- Redis >= 7

## Setup and Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

3. Run database migrations:
   ```bash
   npm run prisma:migrate
   ```

## Development Commands

- `npm run start:dev` — Start the application in development watch mode
- `npm run build` — Compile TypeScript into production bundle in `dist/`
- `npm run start:prod` — Run production build
- `npm run lint` — Execute ESLint static analysis
- `npm run format` — Format code with Prettier
- `npm run typecheck` — Run TypeScript type checking without emitting files
- `npm run test` — Execute unit tests with Jest
- `npm run test:e2e` — Execute end-to-end integration tests

## Documentation

- Full specification: [docs/mvp-spec.md](docs/mvp-spec.md)
- Canonical API contract: [docs/api-contract.md](docs/api-contract.md)
