# Architecture

## Status and goals

This document defines the initial architecture for the Personal Finance Manager described in [the PRD](prd.md). The application is self-hosted and supports separate user logins, including explicitly shared accounts.

The system tracks financial activity; it never initiates financial transactions. It favors a small operational footprint, secure storage of sensitive account data, and a responsive mobile-first experience.

## Technology choices

| Layer | Choice | Rationale |
| --- | --- | --- |
| Client | React with Mantine | Responsive, accessible component system for a mobile-first web UI. |
| API | TypeScript with Fastify | Lightweight, high-performance REST API with strong request validation support. |
| Database | PostgreSQL | Relational integrity, reliable transactions, mature backup tooling, and a straightforward self-hosted and cloud path. |
| Deployment | Docker Compose on a personal server | Runs the application and PostgreSQL locally with minimal operational overhead. |

The initial deployment is a modular monolith: one client application, one Fastify service, and one PostgreSQL database. The service contains clearly separated domain modules but does not require microservices, Redis, or a separate job queue.

```text
React + Mantine client
        |
    REST over HTTPS
        |
Fastify application
  |- authentication and ownership
  |- accounts and transactions
  |- transfers and reconciliation
  |- categories, budgets, and analysis
  |- scheduled transactions
  `- exports and backup
        |
   PostgreSQL
```

## Ownership and authentication

Users have separate logins. Accounts can be shared with other users, who receive explicit account-level permissions. A user may therefore access only accounts they own or accounts for which they have a membership record.

- A first-run setup flow creates the initial administrator.
- All normal API endpoints require authentication.
- Passwords are stored only as Argon2id password hashes.
- The API uses server-side sessions delivered in `Secure`, `HttpOnly`, `SameSite` cookies. Browser code does not retain long-lived authentication tokens.
- Account memberships use `owner`, `editor`, and `viewer` permissions. Owners can manage membership; editors can add and update permitted account data; viewers have read-only access.
- Every account-sensitive query checks the authenticated user's membership. Direct object IDs alone must never grant access.

## Money, dates, and ledger rules

- Version one supports USD only. Monetary amounts are signed integer cents; floating-point money is prohibited.
- Transaction dates are calendar dates (`DATE`), not timestamps. Creation, update, reconciliation, and deletion events use UTC timestamps.
- The transaction ledger is the authoritative source for account balances. Balance values are calculated from ledger rows, not independently editable account fields.
- A credit uses a positive amount and a debit uses a negative amount. This permits simple, reliable balance aggregation.
- `current_balance` is the starting balance plus posted, non-deleted ledger entries.
- `reconciled_balance` is the starting balance plus posted, non-deleted, reconciled entries.
- Pending scheduled transactions are excluded from actual and reconciled balances. They may be included in a separately labeled projected balance.
- Ledger ordering is `occurred_on DESC`, then `created_at DESC`, then ID as a stable tie-breaker. A backdated transaction is allowed; all affected running balances are recalculated from the ledger when it is displayed.

## Data model

The following is the logical model; physical field types, indexes, constraints, and migrations are defined with the database implementation.

### Users

`users` contains identity, password hash, administrator status, and timestamps.

### Accounts

`accounts` contains its owner, name, encrypted account number, visible last four digits, starting balance in cents, USD currency, active status, and timestamps. `account_memberships` grants other users explicit access to an account.

Full account numbers are encrypted by the application using authenticated encryption (AES-256-GCM). The database stores ciphertext, IV, authentication tag, and a key version; the encryption key is held outside the database in a deployment secret. Password-style salting and hashing is not suitable for account numbers because hashes cannot be decrypted. The UI displays only the last four digits.

The encryption key must be backed up separately from database dumps in a protected secret store or offline encrypted backup. Key rotation is supported by retaining a key version with each ciphertext and re-encrypting records under a new active key. Key loss without a backup permanently prevents recovery of full account numbers.

### Categories

`categories` contains `user_id`, name, active/archived status, and timestamps. Categories are a flat list. Each user receives a protected `Xfer Accounts` category, used for all transfer entries. A category with historical transactions is archived rather than physically deleted, preserving reporting history while excluding it from new-entry selection.

### Transactions

`transactions` is the ledger and contains:

```text
id, user_id, account_id, occurred_on,
amount_cents, currency, description, identifier,
category_id, notes,
status, reconciled_at,
reconciled_by_user_id,
transfer_id,
created_at, updated_at,
deleted_at, deleted_by_user_id,
version
```

`status` is `pending` or `posted`. Normal manually entered transactions are posted. Pending rows are created from scheduled transaction templates and become posted only after user confirmation. Every transaction has a category; transfers always use the protected `Xfer Accounts` category.

An unreconciled, non-transfer transaction may be edited or soft-deleted. No revision history is required while an item remains unreconciled. Soft-deleted rows are invisible to normal ledger views and excluded from balances, budgets, and analysis, but remain restorable. A restored row is subject to the same unreconciled rule.

Reconciliation requires a strong confirmation dialog that summarizes the transaction and requires the user to explicitly confirm. Once confirmed, the transaction is locked: it cannot be edited, deleted, restored, or unreconciled. An incorrect reconciliation is corrected only by creating a new corrective or reversing transaction.

### Transfers

`transfers` contains `user_id`, source and destination account context, transfer date, notes, and timestamps. Creating a transfer occurs in one database transaction and creates exactly two linked posted transaction rows:

- a negative debit in the source account;
- a positive credit in the destination account.

Transfers are immutable. Neither transfer row can be edited or deleted; correcting a transfer requires a compensating transfer.

### Scheduled transactions

`scheduled_transactions` stores a user-owned template: account, amount, description, category, optional notes/identifier, monthly day of month, next due date, and active status. Version one supports only monthly schedules on a specified calendar day.

An idempotent in-process task runs every six hours in the `America/Los_Angeles` timezone. For every due occurrence it creates one pending transaction and advances the template's next due date in the same database transaction. This catches up safely after downtime without a separate worker. A user confirms the pending entry to post it, or removes it while it remains unreconciled. Updating a schedule affects only future occurrences; past generated entries and dates remain unchanged.

### Budgets and analysis

`budgets` records a planned signed USD-cent amount for each user, budget period, and category. Periods may be monthly or yearly. Positive planned amounts represent expected credits/income; negative planned amounts represent expected debits/expenses. Budget reporting compares plans with posted, non-deleted transactions in the same period and category. Analysis aggregates the same transaction set by month and flat category.

## API design

The API is versioned under `/api/v1`, uses JSON request and response bodies, validates all input at the Fastify boundary, and returns consistent problem responses. Mutation endpoints use database transactions where a multi-record invariant is involved.

### Fastify request and response requirements

These rules apply to every new endpoint and to the shared web API client:

- Set `Content-Type: application/json` only when the request has a JSON body. Bodyless methods such as `DELETE` and bodyless `POST` requests must not send an `application/json` content type. Fastify's JSON parser rejects an empty body when that header is present.
- The client must preserve caller-supplied headers and must not add a body or content type implicitly. Add regression coverage for every bodyless mutation path.
- Use Fastify route schemas or the existing boundary validation helper for every request body, parameter, and query string. Do not parse request bodies manually inside handlers.
- Return `204 No Content` without a response body for successful bodyless mutations. The client must handle `204` without attempting `response.json()`.
- The global error handler must preserve intentional HTTP status codes from Fastify and domain errors. Parser, validation, authentication, authorization, not-found, conflict, and domain-lock errors must not be converted to `500 Internal Server Error`. Unexpected exceptions alone may become `500`.
- Every mutation must be tested for both its normal JSON request and its bodyless form where applicable. At minimum, transaction delete, restore, logout, and membership-removal endpoints require automated tests proving the request reaches the handler and returns the documented status.
- API integration tests should assert the status code, stable error code, and database side effect. A client-side success state is not sufficient evidence that a mutation worked.

| Resource | Endpoint examples |
| --- | --- |
| Authentication | `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` |
| Users | `GET/POST /users`, `PATCH /users/:id` (administrator-managed local users) |
| Accounts | `GET/POST /accounts`, `GET/PATCH /accounts/:id`, `GET /accounts/:id/ledger`, `GET/POST /accounts/:id/members`, `PATCH /accounts/:id/members/:userId` |
| Transactions | `POST /accounts/:id/transactions`, `PATCH /transactions/:id`, `DELETE /transactions/:id`, `POST /transactions/:id/restore` |
| Transfers | `POST /transfers`, `GET /transfers/:id` |
| Reconciliation | `POST /transactions/:id/reconcile` (requires explicit confirmation) |
| Categories | `GET/POST /categories`, `PATCH /categories/:id` |
| Budgets | `GET/PUT /budgets?periodType=monthly|yearly&periodStart=YYYY-MM-DD` |
| Analysis | `GET /analysis/monthly?year=YYYY&month=MM` |
| Scheduled transactions | `GET/POST /scheduled-transactions`, `PATCH /scheduled-transactions/:id`, `POST /pending-transactions/:id/confirm` |
| Exports | `POST /exports/database`, `GET /exports/:id/download` |

List endpoints support cursor pagination, filtering, and text search. Creation endpoints accept idempotency keys; edits require an optimistic-concurrency version. The API uses a consistent JSON problem response shape with a stable error code, human-readable title, field errors where applicable, and a request ID.

Implementation exception for ledger history: `/accounts/:id/ledger` uses numbered `page`/`pageSize` pagination (default 75, maximum 100 rows) to support direct page selection. It returns matching counts, actual page/size, total pages, and previous/next flags. Counts and rows share one SQL snapshot, and running balances are calculated before filtering and pagination. The legacy `limit` parameter is a page-size alias. See [ledger pagination](specs/ledger-pagination.md) for the contract and concurrency behavior. Reconciliation remains unpaginated.

Authorization and domain invariants are enforced by services, not solely by the client. Database constraints reinforce critical invariants, including currency, amount direction where applicable, ownership relationships, account membership, and transfer linkage. Inactive accounts retain readable history but cannot receive new transactions, transfers, scheduled transactions, or other balance-affecting updates until reactivated.

## Historical CSV migration

The trusted operator CLI `scripts/import-checkbook.mjs` supports the fixed Checkbook CSV format, separately from the HTTP API and proposed bank-matching workflow. It requires database access, an explicit acting user and target account, active owner/editor membership, dry-run review, and explicit commit/reconciled acknowledgement. It inserts posted historical entries and optionally ordinary categories atomically; deterministic account-scoped source IDs protect unchanged retries. It never modifies existing ledger entries or starting balances. Starred entries are reconciled at import time with the acting user recorded. No new schema is required. See [historical import operations](historical-import.md) for format, limits, backup, and overlap precautions.

## Backup and export

An administrator-only export flow produces a PostgreSQL `pg_dump` through a controlled application or dedicated backup sidecar process. Exports are recorded with status and expiry, made available through a short-lived authenticated download, and then removed from application storage. Restore workflow and export-at-rest encryption are explicitly deferred for a future release.

A database dump contains encrypted account-number ciphertext, but not the application encryption key. Deployment documentation must require a separate secure backup of that key; without it, encrypted account numbers cannot be recovered from an export.

## Security and operational boundaries

- Run the Docker Compose deployment on a personal server. A reverse proxy terminates HTTPS outside strictly local development.
- Keep database credentials, session secrets, and encryption keys in environment-backed secrets; never commit them.
- Parameterize all database operations through the data access layer.
- Expose liveness and readiness health endpoints for container health checks.
- Apply database migrations as an explicit, versioned deployment step before application rollout.
- Apply rate limits to authentication endpoints and redact passwords and full account numbers from logs, errors, and traces.
- Restrict CORS to the configured UI origin.
- Use automatic database backups before upgrades.

## Compatibility and quality targets

- The responsive UI is tested at regular iPhone, iPad, and desktop breakpoints; the baseline layout breakpoints are mobile below 768px, tablet from 768px through 1023px, and desktop from 1024px.
- Support the latest browser version and two previous versions of Chromium-based browsers, WebKit/Safari, and Firefox.
- End-to-end acceptance criteria are automated with Playwright across Chromium, WebKit, and Firefox.

## Future evolution

The modular monolith is deliberately sufficient for the initial product. If a cloud deployment or increased usage requires it, scheduled processing and exports can move into separate workers without changing the domain model or REST API.
