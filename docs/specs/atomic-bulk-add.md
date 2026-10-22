# Product brief: Atomic Bulk Add

US-ABA-1: A failed bulk entry must never leave some rows saved or create duplicates when validation is corrected.

- AC-1: Any client-detected invalid row prevents all requests; errors identify the row and the draft remains editable.
- AC-2: One batch request validates all rows and active owned categories, checks active account owner/editor access, and inserts all posted/unreconciled rows atomically; validation/authorization/database failures leave no rows or receipt behind.
- AC-3: Unchanged retries use the same request ID and return the original success without duplicate rows. Reusing a key with different data is a conflict. Concurrent identical submissions serialize.
- AC-4: While saving, editing and repeat submission are disabled. Success clears the draft before balance refresh, so a refresh failure cannot resubmit saved rows. Rejections preserve the draft.
- AC-5: Debit/credit mapping, row editing/removal, responsive layouts, and existing single-entry flows remain intact across configured browser projects.

# Architect implementation brief

Frontend validates every draft row before making one POST `/accounts/:accountId/transactions/bulk` (1–500 rows). New endpoint performs independent schema validation and uses a dedicated database transaction for authorization/category locks, all inserts, and an idempotency receipt in existing `idempotency_keys`. Store only a payload hash and result count in the receipt, not raw financial descriptions. Transaction-level advisory locking serializes an acting user's request ID; key reuse across accounts/payloads is rejected. Use existing session auth and integer USD cents. No migrations or DBML changes. UI request IDs are opaque correlation values, not authentication secrets; do not require crypto.randomUUID. Clear a successful draft before refetch and retain a stable key for unchanged retries. No deletion of existing duplicates: historical cleanup is outside this fix.

Verify frontend regression for a valid row before an invalid row, fix/retry, API rejection, lost-response retry and refresh failure; API schema/authorization/validation checks; production database service against isolated PostgreSQL for atomic rollback and idempotency. Then full build/unit/Playwright. Preserve unrelated importer changes.

# Review and QA

Architect verdict: Approved with follow-up for the unrelated importer unit-test failure. Validation now precedes the single bulk request, and server schema/category validation precedes inserts. Account/membership/category locks preserve authorization and category state during commit. Ledger rows and the receipt share one transaction, including rollback on a later insert failure; concurrent identical keys serialize through an advisory transaction lock. Retry receipts contain a hash/count only, not financial text. Existing single-entry APIs remain unchanged. Draft request IDs do not depend on secure-context browser APIs. Schema remains unchanged, so no DBML update is needed.

QA evidence (2026-10-21):

| Criterion | Passing automated coverage |
| --- | --- |
| AC-1 | `e2e/bulk-atomic.spec.ts`: `invalid later row sends nothing; correction saves one atomic batch`; `tests/bulk-api.test.ts`: `validates the entire batch before any database write`. |
| AC-2 | API tests for authentication/membership, inactive/foreign categories, successful commit/release and rollback/redaction; `scripts/check-bulk-transactions.mjs` runs production compiled service against PostgreSQL and proves a rejected second row leaves zero transactions/receipts, plus posted/unreconciled totals. |
| AC-3 | Browser tests for unchanged rejection/lost-response retry; PostgreSQL tests prove receipt replay, conflicting changed payload and simultaneous identical commits create only one batch. |
| AC-4 | Browser tests check disabled in-flight controls, retained rejected drafts, and the empty draft after recovering from a post-commit account-refresh failure. |
| AC-5 | All three browser scenarios pass in Chromium, Firefox, WebKit, iPhone and iPad; full existing regression suite, including randomUUID-unavailable bulk rows and transaction history, passes. |

Results: `npm run build` passed (existing bundle-size warning); `npx vitest run tests/bulk-api.test.ts` passed all 5 new API tests; `node scripts/check-bulk-transactions.mjs` passed using disposable PostgreSQL 17 and synthetic data, with cleanup afterward; focused bulk browser suite passed 15 cases; `E2E_BASE_URL=http://127.0.0.1:5174 npx playwright test --workers=4` passed 150 tests. The first refresh-failure test assumed the editor remained mounted, but the app shows its account-load Retry screen; the test was corrected to recover through that screen and passed on rerun.

Full `npm test` reports 38 passed and the same one pre-existing CSV importer failure (protected-transfer rejection is commented out in the current importer). Those unrelated changes were preserved; overall unit-suite acceptance remains pending its resolution or an approved exception. No application financial data was mutated, and existing duplicate transactions were not removed.

Deployment: rebuild **both API and web** (`docker compose up -d --build api web`). Retry protection applies to unchanged drafts within the current mounted screen; receipt keys are not persisted by the browser across reload/navigation. An uncertain request should be retried unchanged before editing or leaving the page. This fix does not infer or delete historical duplicates.
