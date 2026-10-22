# Product brief: Budget & forecast (new version)

Follow-up: the later [Fixed/Variable methods feature](forecast-methods.md) supersedes the original all-expenses pace rule and adds persisted account/category preferences. The original implementation report below records the initial version.

Keep the existing Budget screen unchanged. Add a separate screen using existing plans and posted transaction history, inspired by the approved visual concept.

## Acceptance criteria

- AC1: A separate navigation item and refreshable account/month route open the new screen; original Budget remains available and unchanged. Account and month selections persist in the URL, including All accounts.
- AC2: Summary cards, cumulative spending chart, and expense/income category table use all selected accounts' monthly plans and posted actuals through the reporting cutoff. Checked plans remain included; deleted/pending transactions and transfers are excluded from income/spending. Unbudgeted categories remain visible.
- AC3: Forecast methods are explicit: completed months use actuals; future months use plans; current-month expenses use the greater of plan and daily spending pace per category, income the greater of received and plan. The cutoff day is inclusive; on the final calendar day forecasts equal actuals with no remaining days. Estimated cents are rounded. Cash outlook uses posted balance through the cutoff including transfers plus remaining forecast income minus expenses. No payment timing, safety buffer, or minimum-balance claims.
- AC4: Review history and plan links work; an expense-reduction what-if updates only a local scenario, cannot exceed remaining forecast expenses, and never writes data. Viewers can read the screen; editing links require a writable active account.
- AC5: Loading, empty, error/retry and inaccessible-account states are supported; stale requests cannot replace newer scope data. Desktop, phone, tablet and dark theme remain usable.

## Architect implementation brief

Add a read-only authenticated `/accounts/:accountId/forecast?month=YYYY-MM` endpoint, returning daily category aggregates, monthly category plans and balance at cutoff using one SQL snapshot. Validate parameters and enforce account membership. Use PostgreSQL integer-cent sums serialized as strings, no ledger pagination or transaction descriptions. Exclude linked transfers and system transfer categories from spending/income (including imported standalone transfers); include all posted entries in balance. No schema changes.

Create a pure frontend forecast calculator and separate screen module. All-account scope aggregates only membership-visible accounts and fails closed if any request fails. Route month is optional for direct navigation (defaults to the current UTC month); UI navigation uses an explicit month. Use UTC calendar day consistently with the API. Reuse existing plan editor via navigation without altering its implementation; the screen explains that the matching year must be selected there. No schedule engine, bank integration, saved scenario, new budget model or mutation endpoint.

Verify calculator boundaries (leap year, historical/future, rounding, no plan), API authentication/membership/validation/SQL filters, interactive scopes, reload, scenarios, chart data, errors and responsive layout. Run targeted tests, full unit suite, build and full Playwright suite.

## Architect review and QA

Architect review: approved. The Budget component and existing budget endpoints are unchanged. The new endpoint is read-only, validates account/month inputs, stops after membership denial, and aggregates all reporting data in one SQL snapshot. No migration, scheduler, sensitive transaction descriptions, or persisted scenario has been introduced. All-account requests use only accounts already visible to the signed-in user. Forecast limitations are displayed in the screen.

QA report (2026-10-22):

| Criterion | Automated evidence | Result |
| --- | --- | --- |
| AC1 | `e2e/forecast.spec.ts` account/month switch, all-account aggregation, reload and original Budget navigation; `tests/forecast.test.ts` route validation; existing budget browser regressions | Pass |
| AC2 | `scripts/check-forecast.mjs` real PostgreSQL query with synthetic checked plans, unbudgeted rows, transfers, pending/deleted/foreign/out-of-range rows; calculator tests and forecast browser summary/table/chart checks | Pass |
| AC3 | `tests/forecast.test.ts` current/past/future, leap month, first/final day, rounding, cash bridge, unbudgeted/empty plans and all-account aggregation | Pass |
| AC4 | Forecast browser scenario changes expected surplus/balance without any mutation requests, then leaves baseline unchanged; original plan and history links; API read-only viewer and missing-membership tests | Pass |
| AC5 | Forecast browser loading, error/retry, empty, dark-theme overflow, inaccessible account and delayed stale-response tests across five projects | Pass |

Full results: `npm test` 51/51 passed; `npm run build` passed (existing large-bundle advisory); Playwright 170/170 passed across Chromium, Firefox, WebKit, iPhone and iPad. `node scripts/check-forecast.mjs` passed against a disposable PostgreSQL 17 container, which was stopped afterward. Browser tests use mocked API data; SQL verification uses synthetic tables, not production financial data. Desktop and phone screenshots were visually reviewed.

Limitations: pace extrapolation can overstate front-loaded expenses; no bill-date inference or minimum-balance guarantee. Future-month cash is intentionally unavailable because intervening flows are unknown. Plans are shared with the existing editor, not a second saved budget. Its year selector remains independent and this is explained beside the plan link. No live financial data was modified. Product acceptance is pending user review.
