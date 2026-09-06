# Crypto Omnichain Transaction Tracker — API

Backend service for **Crypto Omnichain Transaction Tracker**, built with NestJS, strict TypeScript, PostgreSQL, and Redis.

## Project Context

This repository (`crypto-omnichain-tracker-api`) contains the backend service and owns the canonical API contract. The frontend client lives in a paired separate repository (`crypto-omnichain-tracker-web`). The frontend consumes the versioned API contract and never imports backend source code directly.

## Current Phase: Milestone 1A (API Foundation)

Milestone 1A establishes the strict NestJS foundation, code quality tooling, testing harness, and unversioned health endpoints (`/health/live` and `/health/ready`).

Third-party provider integrations (Blockchair), Redis cache-aside, Prisma ORM/PostgreSQL, and anonymous session management are deferred to subsequent milestones.

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

## Setup and Installation

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

## Development Commands

- `npm run start:dev` — Start the application in development watch mode
- `npm run build` — Compile TypeScript into production bundle in `dist/`
- `npm run start:prod` — Run production build
- `npm run lint` — Execute ESLint static analysis
- `npm run format` — Format code with Prettier
- `npm run format:check` — Verify code formatting
- `npm run typecheck` — Run TypeScript type checking without emitting files
- `npm run test` — Execute unit tests with Jest
- `npm run test:e2e` — Execute end-to-end integration tests

## Health Endpoints

Health probes are unversioned infrastructure routes:

- `GET /health/live` — Liveness probe returning process uptime and timestamp.
- `GET /health/ready` — Readiness probe reporting dependency readiness (`200 OK` with degraded status in Milestone 1A before database and cache are wired).

## Documentation

- Full specification: [docs/mvp-spec.md](docs/mvp-spec.md)
- Canonical API contract: [docs/api-contract.md](docs/api-contract.md)
