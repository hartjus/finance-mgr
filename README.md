# Finance Manager

Self-hosted personal-finance tracker built with React/Mantine, Fastify, and PostgreSQL.

## Run locally

1. Copy `.env.example` to `.env` and replace the session secret and encryption key. Generate an encryption key with `openssl rand -base64 32`.
2. Install dependencies with `npm install`.
3. Start PostgreSQL with `docker compose up -d db`.
4. Apply the schema with `npm run db:migrate`.
5. Start the API and UI with `npm run dev`.

The UI is available at `http://localhost:8090`; the API liveness check is at `http://localhost:3010/health/live`.

## Run with Docker

Create `.env` as above, then run `docker compose up --build`. The API runs migrations before startup; the UI is available at `http://localhost:8090`, and the API at `http://localhost:3010`.

## Historical transaction import

Use `npm run import:checkbook -- --help` for the fixed-format CSV importer. It defaults to a dry-run, targets an existing account, and honors `*` reconciliation markers. See [the import guide](docs/historical-import.md) for local/Docker commands, category handling, backups, and starting-balance precautions.

## Verification

Run `npm run build` for TypeScript and production-build validation. The Playwright core-flow test targets a fresh, running local environment:

```sh
npm run test:e2e
```

Scheduled transactions and database restore are intentionally deferred.
