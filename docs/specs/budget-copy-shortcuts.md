# Product brief: Budget copy shortcuts

## Outcome and acceptance criteria

- AC1: Each income/expense line has a Copy January action that replaces February–December amounts with the saved January amount, including zero. January and existing entered checkmarks are preserved; totals update and values survive reload. Pending field saves complete before copying.
- AC2: A selected writable account can copy all nondeleted lines from the selected year to the following year after confirmation. Names, types, categories and all twelve monthly amounts are copied; new IDs are generated and entered checkmarks are reset. The original remains unchanged. On success the destination year is shown.
- AC3: Copying into a year with any active lines returns a conflict without writes. Empty source, unsupported years, nonmembers, viewers and inactive accounts are rejected. Repeated/concurrent requests cannot create duplicates. January copy and year copy are atomic; failures leave no partial operation.
- AC4: All-accounts view requires selecting one account for year copy; line shortcuts are disabled there. Buttons are disabled while copying and during loading. Failed saves/copies show an actionable error; stale loads cannot replace the new year. Current-month copy continues working. Existing Budget/forecast/history tests pass across desktop/tablet/phone.

## Architect implementation brief

No schema change. Add authenticated bodyless POST `/budget-lines/:lineId/copy-january` and POST `/accounts/:accountId/budget/copy-next-year` with `{sourceYear, confirmed:true}`. Copy year uses one transaction, checks access, locks the account/membership, rejects nonempty destination and empty source, then clones lines and twelve month rows from one statement snapshot. Source years 1900–2199 produce targets through 2200. The account lock also covers ordinary line creation and budget mutations, preventing concurrent target creation between the emptiness check and insert.

Centralize these budget write transactions in a small service. Preserve existing API contracts and category validation for line creation. Copying retains source line ownership and category associations, including archived categories referenced by existing plans. No ledger, reconciliation or forecast-preference mutations. January uses database January after queued input saves, overwrites Feb–Dec in one operation and preserves existing checked_at values.

Frontend adds the January shortcut in the sticky line-label cell and a confirmed next-year action at the top. Scope is one selected account. Serialize input saves; copy actions wait for them and stop if any failed. Avoid reloading after every input save (local amounts/check state already reflect the edit). A visible Reload saved budget action recovers from failures. Guard request generations/year changes and disable editing/navigation selectors during copy. Extend year options to include a newly copied year.

Verification: service/API tests for transactions, auth, validation and failure behavior; disposable PostgreSQL tests for exact amounts, flags, rollback, concurrent duplicate prevention and migration-compatible SQL; Playwright copy/confirmation/persistence/conflicts/permissions/loading/pending-save checks. Run full unit suite/build/browser suite. Preserve earlier uncommitted forecast-method work.

## Architect review

Reviewed the implementation against the brief. Server-side membership/active-account checks, parameterized queries, shared account locking, transactional rollback, destination conflict protection and queued-save handling are in place. Existing line-write contracts are retained. No new schema migration or DBML change is needed for these shortcuts. Earlier uncommitted forecast-method changes are preserved. No production data was used or changed.

## QA report — 2026-10-22

Environment: local Vite server, Chromium/Firefox/WebKit/iPhone/iPad browser projects with synthetic API fixtures; disposable PostgreSQL with all current migrations for real database checks.

| Criterion | Automated coverage | Result |
| --- | --- | --- |
| AC1 | `e2e/budget-copy.spec.ts`: queued January save, all twelve amounts, zero, other-line isolation, preserved marks and reload; existing `budget-check-totals` tests; `tests/budget-copy.test.ts`; real PostgreSQL January checks | Pass |
| AC2 | Browser confirmation/cancel, all monthly values, reset marks, destination navigation and reload; PostgreSQL verifies new IDs, categories/types/names, source unchanged and excluded deleted lines | Pass |
| AC3 | Service/API validation/auth tests; PostgreSQL tests for empty/conflict/permissions, trigger-induced rollback of January and year copy, concurrent copies and concurrent ordinary creation | Pass |
| AC4 | Browser read-only/all-account/empty state, disabled in-flight/loading controls, failed-save recovery, conflict messages, delayed old-year response and current-month copy regression; full browser suite | Pass |

Verification commands and results:

- `npm test`: 69 tests passed.
- `npm run build`: API and web passed; existing bundle-size warning remains.
- `node scripts/check-budget-copy.mjs`: passed against a disposable PostgreSQL database, including real rollback and concurrency assertions.
- Full Playwright run: 210 tests passed. The subsequently added stale-year/current-month-copy regression also passed in all five browser projects (215 passing cases total).
- `git diff --check`: passed.

No known blocking defects or acceptance exceptions. Browser interaction tests mock the API; actual database copy semantics are independently exercised by the integration script. Recommend product acceptance. Deployment/rebuilding the user's running containers was not performed.
