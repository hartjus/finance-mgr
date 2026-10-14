# Feature Brief: Edit an Unreconciled Transaction

## Product decision

Authorized users may edit the date, amount magnitude, description, category, identifier, and notes of a posted, unreconciled, non-transfer transaction. The debit/credit direction is preserved. The existing Add Transaction modal and exactly-two-decimal amount rules are reused.

Reconciled, transfer, deleted, pending, inactive-account, and unauthorized transactions cannot be edited. Unreconciled edits do not receive immutable revision history.

## Acceptance criteria

- An owner or account editor sees Edit for an eligible transaction; viewers do not.
- The edit form is populated with date, amount, fixed debit/credit direction, description, category, identifier, and notes.
- Valid edits persist after save and page reload.
- Amounts remain non-zero, non-negative magnitudes with exactly two decimal places in the UI; the original signed direction is submitted.
- Invalid amount, date, description, or category input leaves the original transaction unchanged and shows validation feedback.
- Amount/date edits recalculate current, reconciled, variance, and running balances.
- Canceling or closing the form leaves the transaction unchanged.
- Reconciled, transfer, deleted, pending, inactive-account, and viewer edit requests are rejected server-side.
- A stale transaction version returns a conflict and never overwrites the newer edit.
- The edit form remains usable at phone, tablet, and desktop breakpoints.

## API contract

`PATCH /api/v1/transactions/:transactionId` accepts the complete editable representation plus the current `version`. It validates account membership, active account state, active category ownership, posted/unreconciled/non-transfer state, integer USD cents, preserved amount sign, and optimistic concurrency. Successful updates increment `version`; conflicts return a stable `VERSION_CONFLICT` problem response.

## Implementation and verification

- Reuse `TransactionForm` in edit mode and refresh ledger/account data after save.
- Add an eligible-row edit action; keep locked rows without an edit action.
- Add API/UI coverage for valid edits, amount/sign validation, balance recalculation, locked records, authorization, and stale-version conflicts.
- Run `npm run build` and the configured Playwright projects.
