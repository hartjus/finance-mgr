# Product brief: Edit/delete during reconciliation

US-RED-1: Correct or remove unreconciled transactions without leaving reconciliation, using transaction history's rules.

- AC-1: Active account owners/editors can edit posted, unreconciled, non-transfer transactions using the shared prefilled TransactionForm (fixed direction, category/date/amount validation, expected version). Ineligible entries and viewer/inactive accounts do not expose these actions; delete eligibility matches history.
- AC-2: Successful edits refresh rows/account balances, keep the account route and unaffected selections, and deselect the edited row for renewed review. The changed entry remains unreconciled and persists after reload. Cancelling changes nothing.
- AC-3: Delete requires explicit confirmation and uses the existing soft-delete API. Success removes the row and its selection, preserves other selections, and refreshes balances. Cancel does not delete anything.
- AC-4: Validation, stale-version/locked-record, and permission failures display actionable errors without changing local rows/selections or closing the edit/delete dialog. Delete cannot be double-submitted while in progress. Reconciliation cannot be submitted during mutation/refresh or after a failed list refresh.
- AC-5: Existing Add Transaction and reconciliation continue working; actions, dialogs and account-switch isolation work on desktop/phone/tablet without document overflow.

# Architect implementation brief

Extract shared frontend edit/delete eligibility predicates used by Ledger and Reconciliation. Reuse TransactionForm with the selected transaction for PATCH/version handling and the existing DELETE route with no JSON body. Add scoped edit/delete state, confirmation/error/loading controls and safe refresh handling. Keep API/database/security rules unchanged: existing endpoints enforce membership, active accounts and transaction locks. No migration or DBML change. New Playwright scenarios use synthetic fixtures for successful edits/deletion, validation/conflict/rejection/cancel, selection handling and permissions on all five browser projects. Run full build/unit/browser suites, preserving unrelated importer edits.

# Architect review and QA

Architect verdict: Approved with follow-up for the unrelated importer unit-test failure. Ledger and Reconciliation now share eligibility predicates, and reconciliation reuses TransactionForm, PATCH/version and bodyless DELETE. Reconciled/transfer rows remain protected by the existing endpoints; no new API/security/storage behavior is introduced. Deletion confirmation has its own caught error and pending state. Changed/deleted rows are deselected, unaffected selections survive successful refresh, and failed list loads clear stale rows/selections and offer Retry. Account refresh is awaited with reconciliation blocked until complete. Account-keyed mounting isolates state on account changes. No migrations or DBML changes.

QA evidence: synthetic Playwright fixtures, local frontend at 127.0.0.1:5174; no live database mutations. All five new scenarios in `e2e/reconcile-edit-delete.spec.ts` passed on Chromium, Firefox, WebKit, iPhone and iPad (25 focused passes).

| Criterion | Passing scenario/evidence |
| --- | --- |
| AC-1 | `reconciliation edit reuses history validation and deselects changed row only` checks prefill, fixed direction, zero validation and versioned signed amount; `reconciliation actions match history permission and lock rules` checks viewer/inactive/transfer/reconciled restrictions and editor access. |
| AC-2 | Edit scenario checks deselection of changed row, preservation of another selection, preview, account-refetch request, unchanged reconciliation status and reload; conflict/cancel scenario checks discarded edits. |
| AC-3 | `reconciliation delete requires confirmation and removes only its selection` checks cancellation, bodyless DELETE, removal, remaining selection/preview, account refetch and reload. |
| AC-4 | `edit conflicts and delete rejection preserve rows and selections`; `failed post-delete refresh blocks stale reconciliation and supports retry`; delayed DELETE checks disabled confirmation while pending and one request. |
| AC-5 | All new scenarios run on phone/tablet/desktop; edit checks no horizontal document overflow; permission scenario switches accounts; existing reconcile-entry and history/core-flow regressions pass. |

Final verification:

- `npm run build`: passed (existing bundle-size warning).
- `E2E_BASE_URL=http://127.0.0.1:5174 npx playwright test --workers=4`: 135 passed.
- `npm test`: 33 passed, one pre-existing failure in `tests/checkbook-import.test.ts` expecting protected transfer-category rejection; the importer currently has that rejection commented out. Existing importer edits were preserved.

An initial test used `Notes` instead of the form's exact `Notes (optional)` label; corrected and rerun. Browser tests verify UI requests/refresh/error handling against fixtures, not a new live PostgreSQL mutation suite. The existing API implementation is reused unchanged. Feature behavior is verified and ready for user review; overall unit-suite acceptance remains pending resolution or an approved exception for the separate importer mismatch.
