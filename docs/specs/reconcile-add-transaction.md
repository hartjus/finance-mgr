# Product Brief: Ad-hoc entry during reconciliation

## Outcome and scope
US-R1: As an account owner/editor, I can record a missing transaction while reconciling without leaving the screen. Reuse manual transaction entry. Scheduling and changes to reconciliation rules are out of scope.

## Acceptance criteria
- AC-1: On an active writable account, Add transaction opens the existing debit/credit form for that account. Saving adds a posted, unreconciled, unselected row, refreshes account balances, closes the form, and preserves existing selections and the reconciliation route. Reload retains the new row.
- AC-2: Invalid input or a rejected save displays an error and keeps the form open. Cancelling adds no transaction and preserves selections.
- AC-3: Viewer and inactive accounts have no Add transaction button; switching accounts targets the selected account. Desktop, phone, and tablet support the flow.

## Decisions
Close the modal on success so the user resumes reconciliation immediately. New entries require separate selection and confirmation to reconcile. No blocking questions.

# Architect Implementation Brief

Reuse `TransactionForm` in `Reconciliation`, pass categories from App, and use existing POST `/accounts/:accountId/transactions`. The server already validates membership, active status, and input, and creates posted rows with null reconciliation metadata. Refresh reconciliation rows while retaining only still-visible selected IDs; do not select the new row. Refresh account data after saving. No API or schema changes. Keep errors in the existing form and do not log financial input.

Verification: focused Playwright tests for debit/credit creation, unchanged reconciled balance, preserved selection, validation, cancellation, rejection, account targeting, permission visibility and reload. Then full build and Playwright suite across all configured projects.

# Architect Review

Approved. Entry reuses the existing form, integer-cent payload, and membership-checked creation endpoint. The database defaults to posted status and null reconciliation metadata. New entries do not invoke the reconciliation endpoint. Refresh retains only existing visible selections; the new row remains unselected. The route keys reconciliation by account ID, so switching accounts resets modal state and targets the correct account. No API, schema, or scheduling changes. Save failures remain in the form; list refresh failures use the existing screen error state.

# QA Report and Product Acceptance

Environment: local Vite app, isolated browser API fixtures; no live database modifications. API unit tests use mocked database calls. No Git metadata is available for a commit identifier.

| Criterion | Automated test in `e2e/reconcile-entry.spec.ts` | Result |
| --- | --- | --- |
| US-R1/AC-1 | ad-hoc debit and credit remain unreconciled and preserve reconciliation selections | Pass |
| US-R1/AC-2 | invalid, cancelled and rejected reconciliation entries do not add rows; selection-preservation test also checks cancellation | Pass |
| US-R1/AC-3 | entry permission follows the selected reconciliation account | Pass |

All three scenarios passed on Chromium, Firefox, WebKit, iPhone and iPad. Full `npx playwright test --workers=4`: 75 passed. `npm run build`: passed with the existing bundle-size warning. `npm test`: 15 passed. Initial focused run found an ambiguous cell selector, corrected before the full run. No unresolved defects. Browser tests verify frontend behavior against fixtures; live PostgreSQL integration is not claimed. Requested behavior is ready for user review. Docker users must rebuild the image to see the change.
