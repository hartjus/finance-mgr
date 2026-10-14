# User Stories and Acceptance Criteria

## Test convention

Every acceptance criterion below is intended to be verifiable through the browser with Playwright. Tests may use authenticated browser state, deterministic seed data, and Playwright network assertions, but must assert a user-visible result or an HTTP response rather than inspecting database state directly.

Unless a story says otherwise, a test starts with an authenticated user who owns all referenced data. Currency is USD and amounts are rendered in standard USD formatting.

## Authentication and setup

### US-01: First-run administrator setup

As the self-hosting owner, I want to create the initial administrator account so that the application is protected before financial data is entered.

**Acceptance criteria**

- Given no user exists, when I visit the application, then I am shown a setup form instead of the main application.
- Given valid email and password values, when I submit the setup form, then I am signed in and shown the account list.
- Given setup has completed, when I sign out and visit the setup URL, then I am not shown a form that can create another administrator.
- Given an invalid email or a password that violates the displayed password policy, when I submit setup, then an inline validation error is shown and no authenticated session is created.

### US-02: Sign in and sign out

As a user, I want to sign in and sign out so that only I can access my financial data.

**Acceptance criteria**

- Given a registered user, when I submit valid credentials, then I am redirected to the authenticated account list.
- Given invalid credentials, when I submit the sign-in form, then I remain signed out and see a non-sensitive error message.
- Given I am signed in, when I choose Sign out, then I am redirected to the sign-in page and a protected route redirects me there.
- Given I am signed in, when a second browser context has no session and requests an authenticated API endpoint, then it receives an unauthorized response.

### US-03: Manage local user accounts

As an administrator, I want to create and manage separate local user logins so that I can share selected accounts without sharing credentials.

**Acceptance criteria**

- Given I am an administrator, when I create a user with a valid email and password, then the user appears in the user-management list and can sign in in a separate browser context.
- Given I am not an administrator, when I visit user management or send a direct user-creation request, then the UI denies access and the API returns an authorization error.
- Given a user has no account membership, when that user signs in, then no other user's accounts are visible.

## Accounts and categories

### US-04: Create and manage an account

As a user, I want to create and update accounts so that I can track separate financial institutions or account types.

**Acceptance criteria**

- Given I am on the account list, when I create an account with a name, account number, and starting balance, then the new account appears in the account list with its name and formatted starting/current balance.
- Given an account number ending in `1234`, when the account is displayed after creation or page reload, then `1234` is visible and the full account number is not visible.
- Given an active account, when I update its name, then the new name appears in the account list and ledger header after page reload.
- Given an active account, when I deactivate it, then it is absent from the default active-account list and remains available in an inactive-account view.
- Given an inactive account, when I try to add a transaction, create a transfer involving it, or create a schedule for it, then the UI prevents the action and the API rejects a direct request.
- Given an inactive account, when I reactivate it, then I can again add transactions and use it in transfers and schedules.
- Given an account form with missing required values or a non-numeric starting balance, when I submit it, then field-level errors are displayed and no account is added to the list.

### US-05: Maintain flat categories

As a user, I want to manage a flat list of categories so that transactions and budgets can be organized.

**Acceptance criteria**

- Given the category settings page, when I add a category named `Groceries`, then it appears as a selectable category on a new transaction form.
- Given I already own a category named `Groceries`, when I try to add another category with the same name, then I see a validation error and only one `Groceries` category remains in the list.
- Given a category used by at least one transaction, when I archive it, then it no longer appears in the new-transaction category selector and remains displayed on its historical transaction.
- Given an archived category, when I view the category settings page, then it is visibly marked archived and I can reactivate it.
- Given a user account, when I view categories, then the protected `Xfer Accounts` category is present and cannot be renamed, archived, or deleted.

## Transactions and ledger

### US-06: Enter a transaction

As a user, I want to record a credit or debit so that my account ledger stays current.

**Acceptance criteria**

- Given an account and category exist, when I add a debit of `$12.34` with a date, description, and category, then the ledger shows a clearly distinguishable debit of `$12.34` and the account current balance decreases by `$12.34`.
- Given an account and category exist, when I add a credit of `$50.00`, then the ledger shows a clearly distinguishable credit and the account current balance increases by `$50.00`.
- Given a transaction with optional identifier and notes, when I save it and reopen its details, then both values are shown.
- Given a transaction form with a missing date, amount, description, or category, when I submit it, then the relevant validation errors are shown and no row is added to the ledger.

### US-07: View a ledger and running balances

As a user, I want to view a newest-first ledger with running balances so that I can understand account history.

**Acceptance criteria**

- Given an account has transactions on three distinct dates, when I open its ledger, then the transactions are displayed newest first by transaction date and, for the same date, newest first by creation time.
- Given an account has a starting balance and multiple posted transactions, when I open its ledger, then every visible transaction row shows a running balance consistent with the displayed order and the account current balance.
- Given an account has more transactions than the page size, when I load more ledger entries, then older entries are appended without duplicating or reordering already visible rows.
- Given a ledger contains both credits and debits, when I view it on a mobile viewport, then amount direction remains clearly distinguishable and the page has no horizontal overflow.
- Given I add a backdated transaction, when I return to the ledger, then it is positioned by its transaction date and all affected running balances reflect the added entry.

### US-08: Edit, soft-delete, and restore an unreconciled transaction

As a user, I want to correct unreconciled entries while retaining recovery capability.

**Acceptance criteria**

- Given an unreconciled non-transfer transaction, when I edit its amount, description, date, or category and save, then the ledger shows the new values and the displayed current balance reflects the new amount.
- Given an unreconciled non-transfer transaction, when I delete it and confirm the dialog, then it is absent from the default ledger and its amount no longer affects the displayed current balance.
- Given I deleted an unreconciled transaction, when I open the deleted-transactions view and restore it, then it reappears in the ledger and again affects the displayed current balance.
- Given an unreconciled non-transfer transaction, when I cancel its deletion dialog, then it remains visible and its balance effect is unchanged.

### US-09: Add multiple transactions

As a user, I want to add several transactions for an account in one workflow so that manual entry is faster.

**Acceptance criteria**

- Given an account and categories exist, when I enter two valid rows in the bulk-entry form and save, then both transactions appear in the selected account ledger.
- Given bulk entry includes a debit and a credit, when I save, then the account current balance changes by the net of both amounts.
- Given one bulk-entry row is invalid, when I submit the form, then that row shows a validation error and no rows from the submission are added.
- Given I add and remove draft rows in the bulk-entry form, when I save the remaining valid rows, then only the remaining rows appear in the ledger.

### US-10: Reconcile and lock a transaction

As a user, I want to mark a verified transaction reconciled so that my reconciled balance reflects confirmed bank activity and the entry cannot change.

**Acceptance criteria**

- Given an unreconciled posted transaction, when I select Reconcile, then I am shown a confirmation dialog containing that transaction's date, description, and amount, and the transaction remains unreconciled until I explicitly confirm.
- Given the reconciliation confirmation dialog, when I confirm it, then the ledger visibly marks the transaction reconciled and the account reconciled balance changes by that transaction's amount.
- Given the reconciliation confirmation dialog, when I cancel it, then the transaction remains unreconciled and the reconciled balance is unchanged.
- Given a reconciled transaction, when I open its details, then edit and delete controls are unavailable.
- Given a reconciled transaction, when I send edit or delete requests from the browser, then the API rejects them and the original ledger values remain after refresh.
- Given a reconciled transaction was marked incorrectly, when I open its details, then no unreconcile action is available and I can create a separate correcting or reversing transaction.
- Given a pending transaction, when I view its actions, then it cannot be reconciled until it is confirmed and posted.

## Transfers

### US-11: Transfer money between accounts

As a user, I want to record a transfer between accounts so that both account ledgers remain accurate.

**Acceptance criteria**

- Given two active accounts, when I transfer `$100.00` from Account A to Account B, then Account A's ledger contains a `$100.00` debit and Account B's ledger contains a `$100.00` credit with a visible shared transfer reference and the `Xfer Accounts` category.
- Given a completed transfer, when I view both account balances, then the source balance has decreased by `$100.00`, the destination balance has increased by `$100.00`, and the combined balance is unchanged.
- Given a transfer, when I open either linked ledger entry, then edit and delete controls are unavailable.
- Given I attempt a transfer to the same account or with a zero/invalid amount, when I submit it, then I see validation feedback and neither account ledger changes.
- Given a transfer entry is visible in an account ledger, when I reconcile that entry, then it is marked reconciled in that ledger while its value and linked transfer reference remain unchanged.

## Budgeting and analysis

### US-12: Plan a monthly or yearly category budget

As a user, I want to set monthly or yearly category budgets so that I can compare planned and actual income and spending.

**Acceptance criteria**

- Given an active category, when I set its monthly expense budget to `-$400.00`, then the budget view displays a planned amount of `-$400.00` for that category and month after refresh.
- Given an active income category, when I set its yearly income budget to `$60,000.00`, then the budget view displays the plan for that year and category after refresh.
- Given a budget already exists for a category and period, when I change its planned amount, then the same budget row displays the updated amount rather than a duplicate row.
- Given I enter an invalid period or non-numeric planned amount, when I save, then a validation error is shown and the existing budget amount remains unchanged.
- Given an archived category has an existing budget, when I view that budget period, then the category and historical plan remain visible.

### US-13: Compare planned and actual spending

As a user, I want a monthly planned-versus-actual view so that I can see spending against my budget.

**Acceptance criteria**

- Given a `-$400.00` grocery budget and a posted, non-deleted `-$125.00` grocery debit in the selected month, when I view the budget, then it displays planned `-$400.00`, actual `-$125.00`, and remaining `-$275.00`.
- Given a `$5,000.00` income budget and a posted `$2,500.00` paycheck credit in the selected month, when I view the budget, then it displays the positive planned and actual income amounts.
- Given a pending scheduled grocery transaction, when I view the budget, then it does not change actual spending until I confirm it.
- Given a soft-deleted grocery transaction, when I view the budget, then it does not contribute to actual spending.
- Given transactions in two different months, when I switch the selected budget month, then only the selected month's actual spending is displayed.

### US-14: Analyze spending by month and category

As a user, I want monthly category analysis and charts so that I can understand spending patterns.

**Acceptance criteria**

- Given posted, non-deleted transactions in two categories during a month, when I open monthly analysis for that month, then each category's displayed total equals the sum of its applicable transactions.
- Given a soft-deleted or pending transaction, when I view monthly analysis, then its amount is excluded from category totals.
- Given analysis data exists, when I change the month selector, then the category totals and chart update to the selected month.
- Given analysis is viewed on a mobile viewport, when the chart and category totals render, then they remain visible without horizontal page overflow.

## Scheduled transactions

### US-15: Create and manage a scheduled payment template

As a user, I want to schedule recurring payments so that upcoming activity is prepared without automatically posting it.

**Acceptance criteria**

- Given an account and category, when I create an active monthly scheduled debit on the 15th with a next due date, then it appears in the scheduled-transaction list with its monthly day and next due date.
- Given an active scheduled transaction, when I edit its description, amount, or next due date, then the updated values appear after refresh and previously generated occurrences remain unchanged.
- Given an active scheduled transaction, when I deactivate it, then no new pending transaction is created when its next due date arrives.
- Given a form missing a required account, non-zero amount, monthly day, or next due date, when I submit it, then field-level validation errors appear and no schedule is added.

### US-16: Confirm a generated pending transaction

As a user, I want to review and confirm a due scheduled payment so that it becomes an actual ledger entry only when I approve it.

**Acceptance criteria**

- Given an active schedule is due and the six-hour Pacific-time due-schedule task has run, when I open pending transactions, then exactly one pending transaction for that due date is shown with values copied from the schedule.
- Given a generated pending transaction, when I confirm it, then it is removed from pending transactions, appears as posted in the account ledger, and changes the account current balance by its amount.
- Given a generated pending transaction, when I refresh or restart the application after the due-schedule task runs again, then a second pending transaction for the same schedule and due date is not shown.
- Given a pending transaction, when I delete it, then it is absent from the pending list and does not affect the account balance.

## Backup and export

### US-17: Export the database

As the administrator, I want to export my data so that I can maintain a self-hosted backup.

**Acceptance criteria**

- Given I am an administrator, when I request a database export, then the export screen shows a queued or running export record and subsequently shows it as ready when the export completes.
- Given a ready export, when I select Download, then the browser receives a downloadable, non-empty export file and the request is authenticated.
- Given an expired export, when I revisit the export screen or attempt its download, then it is marked unavailable and no file is downloaded.
- Given an unauthenticated browser context, when it requests an export or download endpoint, then it receives an unauthorized response.

## Account sharing and resilient API behavior

### US-18: Share an account with another user

As an account owner, I want to grant another user view or edit permission so that we can collaborate on the same account without sharing a login.

**Acceptance criteria**

- Given an account owner and another registered user, when the owner grants the user viewer permission, then the shared account appears in the viewer's account list and its ledger is read-only.
- Given a viewer of a shared account, when the viewer attempts to create, edit, delete, reconcile, transfer from, or schedule activity for that account, then the UI prevents it and the API rejects a direct request.
- Given an account owner grants editor permission, when the editor opens the account, then the editor can add permitted transactions and the owner sees the resulting ledger entry after refresh.
- Given an account owner removes a member's permission, when that member refreshes or requests the account API, then the account is no longer visible and the API denies access.

### US-19: Navigate large ledgers safely

As a user, I want reliable filters, search, pagination, and conflict feedback so that ledger work remains accurate as history grows.

**Acceptance criteria**

- Given an account has more transactions than a page, when I load the next page, then older results are returned once, in the documented sort order, without duplicating prior rows.
- Given transactions with distinct descriptions, categories, reconciliation states, and dates, when I apply supported filters or a text search, then every displayed row matches the filter/search criteria and clearing filters restores the full list.
- Given I submit the same create request twice with the same idempotency key, when I reload the ledger, then only one transaction has been created.
- Given I open an unreconciled transaction in two browser contexts, when one context saves an edit and the other saves its stale version, then the stale context receives a conflict response and is prompted to refresh rather than overwriting the first edit.

### US-20: Edit an unreconciled transaction

As an authorized account user, I want to edit an unreconciled transaction so that I can correct an entry before reconciliation.

**Acceptance criteria**

- Given an owner or account editor views a posted, unreconciled, non-transfer transaction, when they open its actions, then Edit is available.
- Given a viewer, reconciled transaction, transfer, deleted transaction, pending transaction, or inactive account, when edit is attempted through the UI or API, then the action is unavailable or rejected without changing stored values.
- Given an eligible transaction, when Edit is opened, then date, amount, fixed debit/credit direction, description, category, identifier, and notes are populated.
- Given valid edits, when the user saves, then the updated values persist after refresh and the current, reconciled, variance, and running balances are recalculated.
- Given an amount is entered, when the field loses focus, then it displays exactly two decimal places; a blank, malformed, zero, negative, or wrong-direction submission is rejected without changing the original transaction.
- Given the user cancels or closes editing, then the transaction and balances remain unchanged.
- Given two browser contexts edit the same transaction, when the stale version saves second, then the API returns a conflict and the newer values are not overwritten.
