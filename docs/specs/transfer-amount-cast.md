# Product brief: Xfer Funds amount typing

## Outcome
Let an authorized user save a valid Xfer Funds entry without PostgreSQL rejecting the paired debit and credit insert.

## Scope and decisions
The fix is limited to type resolution for the amount parameter used by the transfer transaction insert. The existing paired-entry transaction, validation, authorization and response remain unchanged. No schema or migration change is required.

## US-1: Save a transfer
As an account editor, I want to save a transfer between two accounts so that both account balances receive the matching debit and credit entries.

### Acceptance criteria
- AC-1: Given valid, distinct writable source and destination accounts and a positive integer-cent amount, when I submit Xfer Funds, then the API returns `201` with the transfer ID and commits the paired entries.
- AC-2: Given the paired transfer insert, when the source debit negates the supplied amount and the destination credit uses it directly, then both amount expressions are explicitly resolved as PostgreSQL `bigint` values.
- AC-3: Existing validation for duplicate accounts and invalid amounts, authorization checks, rollback behavior and response format continue to work.

# Architecture / implementation brief

Cast the reused amount parameter to `bigint` in both values tuples of the existing `INSERT INTO transactions` statement. This supplies a concrete operand type for the unary minus and preserves integer-cent storage in `transactions.amount_cents`. Do not alter the transfer schema, route contract, or transaction boundary. Add a route test that submits a valid transfer, asserts its success and verifies the typed debit and credit SQL fragments and values.

## Architect review

Approved. Explicit `bigint` casts resolve PostgreSQL operator selection at the only ambiguous expression while preserving the existing atomic `BEGIN`/`COMMIT` pair, account authorization, and positive-integer input validation. The adjustment neither exposes data nor changes transfer semantics.

# QA report

| Criterion | Automated test | Result | Evidence |
| --- | --- | --- | --- |
| AC-1 | `Fastify API routes > creates a balanced transfer with explicitly typed debit and credit amounts` | Pass | Valid request returns `201`, the transfer ID, and commits before releasing the connection. |
| AC-2 | Same route test | Pass | The captured insert contains `-$4::bigint` and `$4::bigint`, with the supplied integer-cent value in both entries. |
| AC-3 | Full unit and Playwright suites | Pass | Existing authorization, validation, rollback, responsive UI, and browser regression coverage passed. |

`npm test` passed with 71 tests. `npm run build` passed. `E2E_BASE_URL=http://localhost:8091 npx playwright test --workers=4` passed with 265 tests across Chromium, Firefox, WebKit, iPhone and iPad. No defects found; no schema change is required.
