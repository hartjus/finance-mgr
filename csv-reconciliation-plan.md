# Plan: Bank CSV-assisted reconciliation

Date: 2026-10-14
Status: Planning complete; implementation not started. Bank format specification and a sanitized sample CSV are required before the parser contract can be finalized.

## Product Owner brief

### Outcome

Help an account owner/editor compare bank transactions with existing ledger entries, resolve discrepancies, and explicitly approve reconciliation without silently creating duplicate transactions.

### Confirmed requirements

- Support one specific bank CSV format. The user will provide the format and sample later. No generic column-mapping interface.
- Find candidates by exact signed amount first, then a fixed, inclusive date window of three calendar days before or after the bank date. The window is not user-adjustable.
- Use similar descriptions to rank candidates, including examples such as `Trader Joe's` and `Trad joes`.
- Permit manual matching outside the date window. Amount and debit/credit direction must still match exactly.
- Present ledger and bank entries side by side. Close but non-exact matches are highlighted yellow.
- Require explicit approval of every pair, including exact matches, and a separate final confirmation of the selected group before reconciliation.
- Never automatically create transactions. Suggest adding only after no reconciliation match and no match in regular transaction history can be found. Accepting that suggestion opens a pre-populated Add Transaction form; it does not save it.

### Scope and proposed defaults

In scope: CSV validation, read-only candidate discovery, pair review, manual override of date restrictions, duplicate/history checks, conditional prefilled entry, and atomic confirmed reconciliation.

Out of scope: multiple bank formats, configurable tolerances, amount tolerances, split/combined matches, automatic categorization, bank connectivity, background imports, scheduling, undoing reconciliation, and bulk automatic transaction creation.

The following are conservative planning assumptions, not additional user-confirmed requirements:

- Each file targets the account selected on the reconciliation screen. Display its name and masked account number prominently; never infer a destination from arbitrary CSV text.
- One bank row can pair with only one ledger entry, and one ledger entry can satisfy only one bank row per review. Identical bank rows retain distinct source-row identities and are flagged, not silently deduplicated.
- Regular history checks include posted/reconciled and pending, non-deleted entries in the selected account. Pending entries are duplicate warnings, not reconciliation candidates. Soft-deleted entries are excluded from normal history; restoration remains a separate workflow.
- A possible history candidate is not proof of a duplicate. Users must review unresolved possibilities; unrelated recurring payments can be rejected as candidates. An accepted already-reconciled match is labeled `Already reconciled` and excluded from the save group.
- Users may skip unresolved bank rows and reconcile only individually approved pairs. Final confirmation explicitly reports all excluded/unresolved rows.
- Raw files and review drafts are not retained in the database or browser storage in this first version. Refresh preserves the account route and committed ledger changes, but requires re-upload and fresh approval. Warn before abandoning an active draft where browser navigation permits.
- The existing standalone Add Transaction action remains available. The stricter history-check gate applies to CSV-driven add suggestions.

### User stories and acceptance criteria

#### US-CSV-1: Load and validate a bank file

As an authorized account editor, I want to preview bank rows without changing my ledger.

- AC-1: Given a valid supported file and writable active account, when it is loaded, then each transaction displays its source row, bank date, description, and signed USD amount; no transaction or reconciliation is saved.
- AC-2: Given malformed CSV, unsupported headers, invalid dates/amounts, unsupported currency, or exceeded limits, when loaded, then a safe error identifies the problem and reconciliation is blocked. Invalid transaction rows are not silently skipped.
- AC-3: Given a review draft, when the account/file is changed or the draft is abandoned, then old pairs and approvals cannot apply to the new account/file; reload never silently restores approvals.

#### US-CSV-2: Discover and choose matches

As an account editor, I want understandable candidates that tolerate bank posting delays and description differences.

- AC-1: Given eligible entries, when suggestions are calculated, then only exact signed amounts within inclusive ±3 calendar days are automatic candidates. Different amounts/directions and entries from another account are excluded.
- AC-2: Given the same normalized description and calendar date, when a pair is shown, then it is labeled `Exact match`. A date difference or approximate description is labeled `Suggested match` and highlighted yellow, with the difference explained in text.
- AC-3: Given several candidates or duplicate-looking bank rows, when reviewed, then all alternatives remain inspectable, nothing is approved automatically, and a ledger entry cannot be approved for two bank rows.
- AC-4: Given a valid same-amount entry outside ±3 days, when the user searches and selects it, then the pair is allowed, labeled `Manual match — outside date window`, and highlighted yellow. A different signed amount is rejected by both UI and API.
- AC-5: Given a changed pair, when an approved candidate is replaced, removed, or refreshed with a changed transaction version, then its approval and any pending group confirmation are invalidated.

#### US-CSV-3: Check history before suggesting entry

As an account editor, I want duplicate prevention before recording a missing bank transaction.

- AC-1: Given no chosen reconciliation match, when history is checked, then the search covers the selected account's entire non-deleted history, not just the current ledger page or the automatic date window. Results show dates, descriptions, amounts, and reconciliation/posting status.
- AC-2: Given an existing matching history entry, when identified, then no add suggestion is offered. Already-reconciled entries are informational only; an eligible unreconciled entry can instead become a proposed pair; pending entries explain why they cannot yet be reconciled.
- AC-3: Given no genuine match after successful reconciliation and history searches, when all potential candidates are resolved as unrelated or absent, then `Add missing transaction` is offered. Incomplete, loading, failed, or unresolved searches never qualify as “no match.”
- AC-4: Given an add suggestion, when accepted, then the existing Add Transaction form opens with account, bank date, description, signed amount/direction and supported identifier prefilled. Category remains a required user choice; no save occurs until explicitly submitted.
- AC-5: Given the form is cancelled or invalid, then no transaction is created. Given a successful save, then the new row is posted, unreconciled, and not pair-approved; refreshed discovery presents it for separate pair and group confirmation. Repeated submission must not create duplicates.

#### US-CSV-4: Approve and reconcile safely

As an account editor, I want full control over which matches become irreversible reconciliations.

- AC-1: Given any proposed pair, including an exact one, when displayed, then approval is initially unset. Only individually approved pairs are eligible for the final group; there is no approve-all shortcut in this feature.
- AC-2: Given approved pairs, when Save and reconcile is selected, then a separate dialog displays the account, pairs, debit/credit totals, net amount, projected reconciled balance, and excluded-row counts, and warns that reconciliation locks transactions. Cancelling changes no reconciliation state.
- AC-3: Given final explicit confirmation, when the save succeeds, then exactly the approved eligible entries are reconciled atomically, balances refresh, and the result persists after reload. Existing transaction amounts, dates, descriptions, and current balance are unchanged by reconciliation.
- AC-4: Given any stale version, deleted/pending/already-reconciled entry, duplicate assignment, amount mismatch, revoked access, or inactive account, when submitted, then the entire group is rejected without partial reconciliation. Conflicts require refreshed data and renewed approvals for affected pairs.
- AC-5: Given a double-click, network timeout, or retry, then no duplicate state transition occurs. An uncertain result is resolved through a read refresh before any new save; an already-completed group is never blindly retried as fresh work.

#### US-CSV-5: Preserve security and usability

As a user, I want the review to respect account access and work on my device.

- AC-1: Given an unauthenticated user, nonmember, viewer, or inactive account, when accessing preview/search/save operations, then authentication and the operation's account permissions are enforced server-side. CSV workflow writes are limited to owners/editors of active accounts.
- AC-2: Given desktop/tablet/phone layouts, then each bank/ledger pair and its approval controls remain usable without page overflow. Desktop uses side-by-side columns; phone may stack the two clearly labeled halves within one pair card. Keyboard access and text labels convey every color-coded state.
- AC-3: Given CSV cells containing markup/formulas or sensitive content, then cells are treated as inert text, never executed or inserted as HTML; raw files, account numbers, credentials, and session values do not appear in application logs or error reports. Automated fixtures use synthetic data.
- AC-4: Given the existing non-CSV reconciliation, ad-hoc entry, ledger pagination, or a transfer entry, then existing workflows remain functional. Reconciling a transfer side changes only that side's reconciliation state, not its paired values.

### Remaining external dependency

Obtain the bank's format specification and a sanitized representative CSV. Confirm headers, encoding, delimiter/quoting, date column and date format, signed amount or separate debit/credit conventions, currency, identifiers, metadata/footer rows, and whether exports include pending transactions. Do not infer ambiguous date/sign conventions. Capture these decisions as parser fixtures before feature implementation acceptance.

## Architect implementation brief

### Existing implementation

- `apps/web/src/App.tsx` contains `Reconciliation` and the reusable `TransactionForm`, selection totals, add-entry modal, and group confirmation.
- `apps/api/src/server.ts` exposes account-scoped reconciliation GET/POST endpoints. The GET returns all eligible posted/unreconciled/non-deleted entries. The POST requires `confirmed: true` and performs an atomic update, but does not currently compare the transaction versions reviewed by the user.
- Regular history is paginated with a default page size of 75. Candidate discovery must not mistake a single page for complete history.
- `docs/current-schema.dbml` describes the implemented schema. Existing transaction versions and reconciliation columns support this feature without a planned schema migration.

### Matching and history algorithm

1. Parse using an explicit adapter for the supplied bank format. Normalize to source-row ID, calendar date, description, signed integer USD cents, and optional identifier. Preserve original display text. Handle quoted delimiters/newlines and supported BOM/line endings through a CSV parser, not string splitting.
2. Never use floating-point money. Use integer-safe parsing/comparison, preserving bigint values as decimal strings across JSON where necessary; reject unsupported ranges rather than rounding. Compare date-only day ordinals to avoid DST/timezone shifts.
3. Query account-scoped eligible transactions by exact signed amount; partition automatic candidates to ±3 days. Normalize descriptions with Unicode normalization, case folding, punctuation removal, and whitespace collapse. Rank normalized equality first, then deterministic fuzzy similarity and absolute date distance, with stable transaction IDs as final ordering tie-breakers.
4. Similarity is a ranking aid, not authorization or proof. Do not discard exact-amount/date candidates solely for a weak description score. Use a deterministic tested edit/token similarity function; calibrate with synthetic examples and the sanitized bank sample. Do not invent a confidence percentage suggesting statistical certainty.
5. Mark exact only when signed amount, date, and normalized description are equal. All other proposed pairs require yellow/text explanation. No ranking result auto-approves a pair.
6. For manual search and duplicate checks, search all dates for that exact signed amount in the same account, including reconciled and pending entries for history. Paginate results and report full counts. A server-side search covers the whole dataset even when the UI renders only a page. Unreviewed potential candidates keep the add-suggestion gate closed; same amount alone does not establish a genuine match.
7. Distinguish no candidate, ambiguous candidate, approved pair, already recorded, pending history match, and ignored row. Track candidate rejections explicitly for the current draft. Removing an assignment makes that ledger entry available again.
8. Before opening a suggested add form, refresh the history check; after creation, refresh discovery and reset the row's approval. This is duplicate-risk reduction, not a guarantee against two users independently entering identical legitimate-looking transactions.

### UI and state

Extract CSV-specific parsing/review/matching helpers and components rather than adding the entire workflow to `App.tsx`. Keep draft state scoped to account and file identity. Store candidates, transaction versions, chosen pairs, individual approvals, candidate rejection decisions, and search completion states independently.

Add an Upload bank CSV action, validation preview, pair review with status filters, manual history-search dialog, conditional add suggestion, and final summary. Show both dates/descriptions/amounts and a date-offset label. Keep unresolved bank rows and unmatched ledger rows inspectable. A history match is never silently marked reconciled.

Abort or ignore stale requests after account/file changes. Disable duplicate submissions. Handle empty files, no candidates, all-already-recorded files, errors, and loading explicitly. Proposed starting limits: 5 MiB and 5,000 transaction rows, subject to validation against the bank sample and load tests; reject excess explicitly rather than truncating. Batch candidate lookup and page rendering to avoid one network request per row.

### API design (proposed new routes)

Keep the existing manual reconciliation contract compatible. Add dedicated CSV routes under `/api/v1/accounts/:accountId/reconciliation/csv`:

- `POST /preview`: read-only processing of normalized validated bank rows; returns candidates with versions, classification reasons, history summaries, and row-level errors. Parse the raw CSV in the browser so unrelated raw bank metadata is not uploaded. The server independently validates normalized fields and computes authoritative candidate eligibility; it does not trust client classifications.
- `POST /candidates`: read-only, paginated exact-signed-amount search across all dates, returning eligible and historical candidates with explicit status and pagination metadata. Validate request limits and account scope. This endpoint also supports complete duplicate checks independent of ledger pagination.
- `POST /commit`: body includes `confirmed: true` and a nonempty list of pairs, each with source-row ID, validated bank fields, transaction ID, expected version, explicit pair approval, and explicit manual-date override when applicable. Reject duplicate source/transaction IDs and unapproved pairs. The UI is responsible for genuine confirmation interaction; boolean fields are contract validation, not proof of a human action.

On commit, start a database transaction, recheck active account/write permission, lock account/membership and target transaction rows as needed to serialize conflicting permission/status changes, and verify every row's account, eligibility, expected version, exact signed amount, and date rule or explicit manual override. Update reconciliation timestamps/user/version together; otherwise roll back the entire group with a stable conflict error. Parameterize all queries and preserve existing error/session/CSRF conventions.

Duplicate submission safety comes from atomic eligibility/version checks: a second execution cannot reconcile rows twice. A retry may return a conflict after a successful first commit; the client must refresh and explain actual state rather than claim failure or success from the timeout alone. No persistent import receipt or exactly-once replay response is promised in this first version.

### Persistence and security

No new database tables or migrations are planned. Persist only user-saved transactions and existing reconciliation metadata. No raw CSV archive, durable pair audit, draft resume, or cross-upload bank-row identity is provided. Re-upload protection relies on history checks and review, not a guaranteed bank transaction ID. If the supplied format enables or the user later requests durable import identity/auditing, obtain approval for the expanded schema first.

Do not edit either DBML to describe unimplemented tables. Any subsequently necessary migration must update `docs/current-schema.dbml` in the same implementation change, per `AGENTS.md`. Preserve the candidate/design model and deferred scheduling boundaries.

Limit request body size, row count, field length, candidate page size, and query workload server-side as well as in the browser. Disable logging request bodies for these routes. Never send the file to an external matching service. Use only synthetic or properly sanitized fixtures/screenshots/traces.

### Delivery sequence

1. Obtain sanitized sample and freeze the bank adapter contract, limits, and fixture cases; confirm proposed defaults before coding materially different behavior.
2. Implement/test pure CSV normalization, cents/date handling, description ranking, classification, and one-to-one assignment helpers.
3. Implement authenticated candidate/history endpoints and atomic version-aware CSV commit; test against an isolated PostgreSQL database.
4. Build upload/pair/manual-search UI and individual approvals; reuse the existing final confirmation and Add Transaction form, adding optional prefill support without changing ordinary entry defaults.
5. Implement the complete-history gate and creation refresh path. Cover repeated uploads, duplicate-looking rows, conflict recovery, permission changes, and stale responses.
6. Run focused checks, then full unit/API tests, build, and all configured Playwright projects. Complete Architect review, QA criterion mapping, and Product acceptance. Update architecture/API documentation alongside implemented changes.

### Bounded implementation prompt

Implement the approved Product Owner brief in this document using the existing React/Mantine, TypeScript/Fastify, and PostgreSQL stack. Do not begin the bank parser implementation without the supplied format and sanitized fixtures. Cover every numbered acceptance criterion; preserve existing manual reconciliation and ledger pagination. Enforce exact signed cents, fixed ±3-day automatic suggestions, explicit out-of-window override, one-to-one assignment, individual and group confirmation, complete history checks before add suggestions, and version-aware atomic saves. Reuse TransactionForm for explicitly requested missing entries and require separate reconciliation afterward. Do not add scheduling, automatic imports, persistent CSV storage, or schema changes without an approved need. Follow repository guardrails and provide actual automated evidence, not a claimed QA pass based on this plan.

## QA verification plan

These are planned tests, not executed results. Each listed criterion must receive a named automated test and evidence in the implementation QA report.

| Criteria | Required automated coverage |
| --- | --- |
| US-CSV-1/AC-1–3 | Parser fixtures and browser tests: valid preview without writes; quoting/BOM; invalid fields/header/limits; account/file switch, cancel and reload isolation. |
| US-CSV-2/AC-1–2 | Unit/API/browser: exact cents/sign, ±0/1/2/3 days and excluded ±4 days, leap/month/year/DST boundaries, normalized and approximate descriptions, yellow/text labels. |
| US-CSV-2/AC-3–5 | Unit/API/browser: repeated amounts, duplicate CSV rows, competing assignments, manual distant dates, rejected amount/direction overrides, approval invalidation. |
| US-CSV-3/AC-1–3 | PostgreSQL/API/browser: history matches beyond page 75 and outside date window; reconciled/pending matches; unrelated candidates; incomplete/failed search never enables add. |
| US-CSV-3/AC-4–5 | Browser/API: explicit suggestion click, prefill, required category, cancel/validation, idempotent creation retry, unreconciled/unapproved new row and refreshed discovery. |
| US-CSV-4/AC-1–2 | Browser/API: unchecked exact/fuzzy/manual pairs; no approval shortcut; summary totals and skipped counts; final cancellation; missing approval/confirmation rejected. |
| US-CSV-4/AC-3–5 | PostgreSQL/API/browser: atomic success and rollback, stale edits/deletion/status, duplicate IDs, simultaneous commits, timeout refresh, reload persistence, reconciled locks and unchanged current balance. |
| US-CSV-5/AC-1 | API/browser: unauthenticated/nonmember/viewer/inactive restrictions and access revoked during review; cross-account ID injection. |
| US-CSV-5/AC-2–3 | All browser projects: keyboard, accessible status labels, responsive pair layouts, inert malicious CSV text, safe error output and synthetic fixtures. |
| US-CSV-5/AC-4 | Regression: existing reconcile-entry/core-flow/ledger-pagination suites and transfer-side reconciliation assertions. |

Commands after implementation: `npm test`, `npm run build`, and `npx playwright test --workers=4`, plus the new isolated database integration checks. Run narrow tests first. Browser projects: Chromium, Firefox, WebKit, iPhone, and iPad. Mocked browser API fixtures alone are insufficient evidence for PostgreSQL atomicity or complete-history queries. Never test mutations against the user's live financial data.

## Architect review gates and acceptance status

- [ ] Bank specification and sanitized sample incorporated; parser assumptions resolved.
- [ ] Proposed defaults reviewed; scope matches the confirmed user requirements.
- [ ] API authorization, exact money handling, concurrency, all-or-nothing save, and sensitive-data protections reviewed against actual code.
- [ ] History checks demonstrably cover all matching records, not only the first page; no accidental auto-entry or auto-reconciliation.
- [ ] Every criterion mapped to a passing automated test or explicitly approved exception.
- [ ] Full build and Playwright suite pass; regressions resolved.
- [ ] Product Owner/user accepts implemented behavior.

Planning review verdict: Approved with follow-up for the bank-format dependency and proposed defaults. This is not implementation approval, a completed Architect code review, or a QA pass. No application code or database changes are made by this plan.
