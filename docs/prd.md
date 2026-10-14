# Personal Finance Manager

This application is meant to track personal finances and should support multiple accounts. This application does not perform any financial transactions, but rather tracks existing transactions.

## High level features

- Transaction tracking - History of credits/debits for an account
    - Transaction entry
    - Reconciliation with bank histories
- Budgeting - Create a monthly budget and track against the months expenditures
- Analysis
    - Categorization of all transactions
    - Aggregation and statistics of all categories by month
    - Charts
- Schedule of automated payments

This application is designed to run against a relational database and support a mobile-first user interface. Desktop and tablet screen sizes are also supported.

This application supports a UI and API layer.

## Product constraints and decisions

- The application is self-hosted in Docker on a personal server and uses a responsive UI, REST API, and relational database.
- Users have separate authenticated logins. An account owner may explicitly grant another user viewer or editor access to an account.
- Version one supports USD only and manual transaction entry only.
- Full account numbers are stored with reversible application-level encryption; only the last four digits are displayed in the UI.
- Categories are a flat, user-defined list. A category is required for every transaction. Transfers use the protected `Xfer Accounts` category.
- Transactions are ordered newest first by transaction date, then by creation timestamp. Backdated transactions are allowed and update running balances accordingly.
- Unreconciled non-transfer transactions may be edited or soft-deleted. No edit history is required before reconciliation.
- Reconciliation requires a strong user confirmation. A reconciled transaction is locked and cannot be edited, deleted, or unreconciled. Errors are corrected with a new corrective or reversing transaction.
- Transfers are immutable paired ledger entries: a debit in the source account and equal credit in the destination account.
- Inactive accounts retain readable history but cannot receive transactions, transfers, or scheduled activity until reactivated.
- Scheduled transactions run monthly on a selected calendar day. The Pacific-time scheduler runs every six hours, creates pending entries, and requires user confirmation before posting. Schedule changes affect future occurrences only.
- Budgets support monthly and yearly planned income (credits) and expenses (debits), compared with actual posted transactions.
- API list endpoints support pagination, filtering, and search. Mutations use idempotency keys where applicable, optimistic concurrency for edits, and consistent JSON error responses.
- The API exposes liveness and readiness health endpoints, supports versioned database migrations, and redacts passwords and full account numbers from logs.
- Administrators can create PostgreSQL database exports; restore workflow and export-at-rest encryption are deferred to a future release.
- Supported browsers are the current version and two prior versions of Chromium-based browsers, WebKit/Safari, and Firefox. Layouts must support regular iPhone, iPad, and desktop breakpoints.

## Key data fields:

Accounts:
* Account number
* Account name
* Starting balance
* isActive
* Current Balance
* Reconciled Balance

Transactions:
* Account Id
* Date of transaction
* Type - Credit | Debit
* Amount
* Miscelleneous identifier
* Description
* Category
* Notes (optional)

## Epics

### 1. Account management
User should be able to add/edit accounts.

### 2. Transaction entry and viewing
User should be able to view a ledger of their transactions, starting with the most recent transactions and working toward the oldest.
A running balance is presented on each line with the transaction itself.
Credits and Debits must be clearly distinguishable for the user.

### 2.1 Entry
A user can add a new transaction to the selected account
As a transaction is added, the balance for the account is updated to reflect the transaction.

### 3. Add Multiple transactions
A user can add multiple transactions at once for a given account. This is meant to increase the speed and efficiency for the user.

### 4. Account Transfer
A user can transfer funds between accounts. This appears as a debit from which the fund are withdrawn, and as a credit to the account where deposited.

### 5. Reconciliation
Reconciliation is the process of verifying or confirming that the bank has the same transactional amount. All transactions that are created are not reconciled. Reconciliation only happens when the transaction amount has been verified. When that occurs, a flag is set on the transaction to indicate it has been reconciled.
When a transaction is reconciled, the Reconciled Balance of the Account is updated to reflect the change.

### 5.1 Editing transactions
Transactions can be edited and updated as long as they have not been reconciled. Once the transaction has been reconciled, it is considered "locked" and cannot be modified.

### 6. Analysis
Transactions for an account are aggregated by month and category.


### 7. Budget
