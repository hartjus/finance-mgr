# Import historical Checkbook transactions

Use `scripts/import-checkbook.mjs` (Node 22 recommended). This is a trusted operator tool with database access, not a new public API. `--user` selects the existing user to attribute the import to; it is not an authentication credential. The tool verifies that user has owner/editor access to the active target account. Keep database credentials in the environment/project `.env`, never command arguments.

## Before importing

- Back up the database. Reconciled rows are permanently locked by the application; this tool does not provide an undo.
- Choose the existing account explicitly. Import the full history file, not the sample followed by the full file.
- Check the account's starting balance: it must represent the balance **before the earliest transactions being imported**, not a balance that already includes them. The importer never adjusts it or trusts CSV running balances.
- Avoid simultaneous manual entry while importing. The import serializes with other imports for the same account, but is not a system-wide maintenance lock.
- This is historical migration, separate from the planned bank reconciliation matching flow. No fuzzy matching or automatic transfers occur.

## Format and mapping

Required header order:

```csv
Date,Debit,Credit,ID,Description,Reconciled,Notes,Category,Working Balance,Reconciled Balance
```

| Source | Destination/rule |
| --- | --- |
| Date | U.S. M/D/YYYY, or M/D/YY with explicit `--year-base 1900` or `--year-base 2000`. Use four-digit years for files spanning centuries. |
| Debit / Credit | Exactly one nonzero, positive amount; dollar signs, properly grouped commas, and trailing whitespace supported. Debit becomes negative integer cents; Credit positive. Blank or zero on the other side is allowed. |
| ID | Optional identifier, kept as text (leading zeroes preserved). |
| Description / Notes | Description required; notes optional. CSV quoting, embedded commas/newlines, and doubled quotes supported. Surrounding whitespace trimmed. |
| Reconciled | `*` creates a posted/reconciled entry; blank creates a posted/unreconciled entry. Other markers rejected. Reconciliation timestamp is the import time and actor is `--user`. |
| Category | Matches an active ordinary category owned by the acting user, exact trimmed name. `--create-categories` authorizes creating missing names. `--default-category NAME` fills blank categories only. Archived/protected categories are rejected. |
| Working Balance / Reconciled Balance | Ignored. Account balances are derived from the existing starting balance and ledger entries. |

Limits: UTF-8 (optional BOM), 10 MiB, 20,000 transactions, dates 1900–2199, exact amounts within JavaScript's safe integer-cent range. Empty lines are ignored; invalid transaction rows abort the whole import. Errors identify records/fields without echoing CSV contents. Summaries contain counts and signed-cent totals, not individual transactions.

Transfer-like descriptions are imported only as ordinary historical entries with ordinary categories. The protected `Xfer Accounts` category is rejected: a one-account CSV cannot safely create a paired transfer. If necessary, use an ordinary historical category in a working copy; no counterpart account entries are fabricated.

## Local commands

From the project root after dependencies are installed:

```sh
# Validate without connecting to any database.
npm run import:checkbook -- --file "/path/to/history.csv" --year-base 2000 --validate-only

# Find the target account UUID; replace the example email with your login email.
npm run import:checkbook -- --list-accounts --user "you@example.com"

# Dry-run: validate database permissions, categories, and overlap; write nothing.
npm run import:checkbook -- --file "/path/to/history.csv" \
  --user "you@example.com" --account "ACCOUNT_UUID" --year-base 2000 --create-categories

# Only after reviewing the dry-run and taking a backup:
npm run import:checkbook -- --file "/path/to/history.csv" \
  --user "you@example.com" --account "ACCOUNT_UUID" --year-base 2000 \
  --create-categories --commit --confirm-reconciled
```

`DATABASE_URL` must point to your intended database. The local CLI loads the project's `.env` without overriding existing environment variables. If that URL uses Docker's `db` hostname, run inside Docker instead of copying credentials into a shell command. Missing categories cause a validation error without `--create-categories`; adding that flag during dry-run still writes nothing. `--confirm-reconciled` is required on commit when any row contains `*`.

## Docker commands

The API image now includes the importer. Rebuild it once to pick up this change:

```sh
docker compose up -d --build api

docker compose exec -T api node /app/scripts/import-checkbook.mjs \
  --list-accounts --user "you@example.com"

# The host shell reads your CSV; no copying into the container is needed.
docker compose exec -T api node /app/scripts/import-checkbook.mjs \
  --file - --user "you@example.com" --account "ACCOUNT_UUID" \
  --year-base 2000 --create-categories < "/path/to/history.csv"

# Commit after reviewing the dry-run:
docker compose exec -T api node /app/scripts/import-checkbook.mjs \
  --file - --user "you@example.com" --account "ACCOUNT_UUID" \
  --year-base 2000 --create-categories --commit --confirm-reconciled \
  < "/path/to/history.csv"
```

## Retry and failure behavior

- Import and category creation are one database transaction. A failed row does not leave partial data.
- Identical normalized rows receive deterministic account-scoped IDs. Re-running the same unchanged file skips previously imported rows, even if those stored rows were later edited or soft-deleted; it does not overwrite or resurrect them. Identical repeated rows within the source retain their multiplicity.
- IDs ignore filenames, running balances, and row ordering, but include normalized content, category, and reconciliation marker. Keep the original import file unchanged for retries. Changing content is **not** an update operation. Do not edit old imports to correct reconciled data; use the application's corrective-transaction workflow.
- A second guard rejects new rows that exactly overlap existing date, signed amount, description, identifier, and notes, even if the existing row is deleted or has another category/reconciliation flag. It aborts rather than guessing whether a duplicate is legitimate. Partial/modified re-exports with repeated identical rows may require manual review; there is no force-bypass switch.
- If the connection fails during commit, the outcome can be uncertain. Retry the unchanged file against the same account; deterministic IDs prevent double insertion. A summary reports inserted/proposed rows and skipped prior imports.
- Refresh the app afterward and verify dates, totals, and reconciliation status. This tool makes no changes to other accounts or existing ledger rows.

## Verification

`npx vitest run tests/checkbook-import.test.ts` checks parsing and validation. `node scripts/check-checkbook-import.mjs` runs production import logic in disposable Docker containers using synthetic data and session-local tables; it requires existing `postgres:17-alpine` and `finance-mgr-api` images, exposes no database port, and stops the disposable database afterward. It does not start or modify the application's containers or persistent data.
