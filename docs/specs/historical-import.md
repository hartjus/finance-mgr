# Product Brief: Historical Checkbook CSV import

## Outcome and decisions

Import one account's historical CSV into an explicitly selected existing account. The supplied format is `Date,Debit,Credit,ID,Description,Reconciled,Notes,Category,Working Balance,Reconciled Balance`. `*` means reconciled; blank means unreconciled. Source data is not expected to overlap existing history. Do not import the supplied sample into live data during development.

This is a trusted self-hosted operator CLI, not a public API or browser upload. It requires database credentials plus the existing acting user's email and an active account with owner/editor membership. It cannot elevate a viewer. No UI changes, scheduling, or bank matching feature. Proposed defaults: M/D/YY dates require explicit century (`--year-base 2000` for 2026); M/D/YYYY dates need none. Category names match exactly after trimming; creation requires `--create-categories`. Blank categories require `--default-category`. Protected transfer categories are rejected rather than fabricating unbalanced transfers. Ignore CSV balance columns; never modify starting balance.

## US-HI-1: Safely import historical transactions

- AC-1: Given a supported CSV, validation preserves calendar date, exact signed integer cents, identifier, description, notes, and category; `*` sets reconciliation status and blank leaves it unset. Quoting, embedded commas/newlines, CRLF, and BOM are supported.
- AC-2: Given malformed CSV/header/date/amount, both/neither nonzero debit/credit, unknown reconciliation marker, oversized input, missing required text/category, or ambiguous two-digit year, validation fails with a record/field error without exposing cell data or writing anything.
- AC-3: Given a target account and user, default dry-run checks database permissions/categories/overlap and reports counts/totals without writes. Missing/nonmember/viewer/inactive targets are rejected. Account listing exposes no full account numbers.
- AC-4: Given valid rows and explicit commit (plus reconciliation acknowledgement for starred rows), insertion of rows and optionally missing categories is atomic. Existing category ownership and archived/system restrictions are respected; new reconciled rows record import time and acting user, not a fabricated historical reconciliation timestamp.
- AC-5: Given an identical retry, deterministic account-scoped row IDs prevent duplication, including after edit or soft deletion. Identical repeated source rows remain distinct using occurrence numbers. Unexpected existing history overlap aborts rather than silently dropping data. A changed source file is not guaranteed equivalent; document recovery limitations.
- AC-6: Given any validation/database failure, the operation leaves no partial inserts or categories, and emits no raw CSV, credentials, or database exception details. Starting balance is unchanged; current/reconciled balances derive from inserted posted rows. No existing reconciled entry is mutated.

# Architect Implementation Brief

Implement `scripts/import-checkbook.mjs` with pure parser/normalizer helpers, injectable database import function, and CLI entry point. Use existing `pg`/`dotenv`; no schema migrations or API modifications. Select and lock account/membership, serialize imports for the account, precheck all rows and categories, then insert all within one transaction. Dry-run uses a read-only transaction. Bound file size and rows, parameterize SQL, and catch errors without printing sensitive PostgreSQL diagnostics. Deterministic UUIDs derive from account plus normalized source row and duplicate occurrence; IDs are not based on path or row order. An exact preexisting-content check is a conservative second guard, not fuzzy matching. Operators must not run competing manual entry while migrating history.

Implementation prompt: implement AC-1–6, default to no writes, require account/user/explicit year interpretation, support file/stdin for Docker, and document backup/starting-balance/reconciled-lock implications. Test parser and CLI negative cases and execute production import code against isolated PostgreSQL temp tables. Run full tests/build/Playwright regression before acceptance. Do not use the private sample as a committed fixture.

## Architect review

Approved. The importer is a trusted database-operator script, not an HTTP authorization bypass. Active owner/editor membership is checked inside the import transaction; account/membership locks serialize competing imports and permission changes. Categories belong to the acting user. Existing rows and starting balances are never updated. CSV text is neither executed nor logged, monetary conversion uses BigInt, and unknown database/CLI errors are redacted. Default dry-run uses `BEGIN READ ONLY` and rolls back; commits and category creation are atomic. Retrying unchanged normalized input preserves IDs and skips previous entries without overwriting edits or resurrecting deleted rows. Changed files are not an update mechanism; overlap checks and limitations are documented. No migration/DBML changes required. Source supplied by the user remains outside the repository.

## QA report — 2026-10-18

Environment: local Node/Vitest and frontend at 127.0.0.1:5173; PostgreSQL 17 in disposable Docker containers, session-local synthetic tables. Existing application containers remained stopped. No live financial data was read or written. No Git metadata available. The supplied sample was parsed offline only: ten valid rows, eight debits and two credits, all reconciled. Its contents were not copied into fixtures.

| Criterion | Automated evidence | Result |
| --- | --- | --- |
| US-HI-1/AC-1 | `maps fields and reconciliation without importing balance columns`; `supports BOM, commas, quotes, embedded newlines, credit and blank reconciliation`; PostgreSQL stored-field assertions | Pass |
| US-HI-1/AC-2 | `requires explicit century and validates real calendar dates`; six malformed-amount cases; `rejects ambiguous amount directions and unexpected markers`; `rejects missing text, bad shape, NUL, unsupported header and oversize input`; `handles explicit fallback categories but rejects protected transfers`; `rejects malformed quoting and handles trailing/blank records` | Pass |
| US-HI-1/AC-3 | PostgreSQL dry-run counts remain zero, owner/editor/viewer/nonmember/inactive checks, account-list projection checks; `requires target/user and explicit reconciliation acknowledgement before database writes` | Pass |
| US-HI-1/AC-4 | PostgreSQL commit, category creation/reuse/archived/protected checks, stored reconciliation actor/time; explicit-acknowledgement unit test | Pass |
| US-HI-1/AC-5 | `uses account-scoped stable IDs and preserves repeated identical source rows`; PostgreSQL repeat import, edited/deleted retry, changed-category overlap, repeated-source-row assertions | Pass |
| US-HI-1/AC-6 | PostgreSQL forced second-insert failure proves row/category rollback, starting/current/reconciled balance assertions; `CLI validates stdin offline and never echoes sensitive cell content in errors` | Pass |

Commands and outcomes:

- `npm test -- --silent`: 34 passed, including 16 importer cases. Existing coverage configuration excludes scripts, so no importer coverage percentage is claimed.
- `node scripts/check-checkbook-import.mjs`: passed production SQL checks using synthetic data; disposable database cleaned up afterward.
- `npm run build`: passed; existing frontend bundle-size warning remains.
- `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test --workers=4`: 95 passed across Chromium, Firefox, WebKit, iPhone, and iPad. These are existing frontend regressions against mocked API fixtures, not browser coverage of a new importer UI.

An initial malformed-comma test fixture lacked CSV quoting; corrected the fixture and reran successfully. No unresolved implementation defects found. Dockerfile's importer COPY is inspected but a new production image has not been built in this verification; users must rebuild before running the documented Docker commands. Load testing at the maximum file size and competing manual entry are not claimed. The CLI does not change any UI or public API. Product acceptance: ready for user dry-run against the chosen account; no historical import has been executed on the user's behalf.
