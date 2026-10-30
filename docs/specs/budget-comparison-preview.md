# Product brief: Focused budget comparison

## Outcome and scope
Make Planned vs Actual in Budget preview readable while retaining category comparisons for all twelve months and the full year. Keep the original Budget screen available unchanged. No API, schema, forecast or scheduling changes.

## US-1: Understand performance against a budget
As an account member, I want to compare plans with actual income and spending for a chosen period without scanning a wide annual matrix.

### Acceptance criteria
- AC-1: Given preview, Budget plan and Planned vs actual use one shared month/full-year control in the same location. Changing it in either tab preserves the period when moving between tabs. Comparison also provides an Expenses/Income switch; category rows show planned, actual and a plainly labeled difference.
- AC-2: Given expense overspending, underspending, income shortfalls, above-plan income and unbudgeted actuals, totals and labels are correct in integer cents. Categories represented only by actuals remain visible; all-account values sum matching rows from every account.
- AC-3: Given another month, year or account, results follow the selected scope. Empty periods explain that there is no activity; loading or failed loads do not display misleading comparison totals.
- AC-4: Given phone, tablet or desktop, the compact comparison remains usable without page overflow. The original Budget still displays its existing annual comparison.

## Decisions
Positive expense difference means over plan; positive income difference means above plan. Differences are explicitly labeled rather than sign-only or color-only. Zero-plan actuals are labeled No plan. Full year includes January–December, not only year-to-date. Existing protected endpoints supply the same read-only reporting data.

# Architect implementation brief
Add a typed, read-only BudgetComparison component. Add one `BudgetPeriodControl` above tab content and reuse it in both Budget plan and Planned vs actual through the parent month/view state. Aggregate the union of budget-line and actual category IDs; sum rather than find actual records to support All accounts. Hide the plan-only summary in the comparison tab to avoid duplicate metrics. Use a four-column desktop table and compact responsive category rows on mobile; no change to original renderPlannedActual. Maintain amount storage and arithmetic in integer cents. Verify with deterministic Playwright scenarios, then full build and full five-project suite.

## Architect review
Approved. The comparison is read-only, reuses authenticated data loading and scope controls, and adds no mutations or schema changes. Arithmetic sums integer cents, including multiple account records for the same category/month. Category membership is derived from plans and actuals rather than only the selectable category catalog. Zero/zero rows are omitted to reduce noise. Original comparison rendering remains intact. No secrets or sensitive account identifiers were added.

# QA report

## Environment and evidence
- Working tree, local Vite server on port 8091; deterministic synthetic API fixtures.
- `npm run build`: passed, with the existing bundle-size advisory.
- `E2E_BASE_URL=http://localhost:8091 npx playwright test --workers=4`: **260 passed** in Chromium, Firefox, WebKit, iPhone and iPad (20 comparison cases, including shared period-control coverage).
- `git diff --check`: passed.
- Desktop and phone screenshots visually reviewed; generated under `test-results/budget-comparison-comparis-90c57--monthly-and-annual-periods-<project>/comparison.png`.

## Acceptance mapping
All tests below are in `e2e/budget-comparison.spec.ts` and pass in all five projects.

| Criterion | Test | Result |
| --- | --- | --- |
| US-1/AC-1 | one shared period control keeps the plan and comparison on the same period; comparison explains expense and income differences for monthly and annual periods | Pass |
| US-1/AC-2 | comparison explains expense and income differences for monthly and annual periods; comparison aggregates all accounts and follows account and year selection | Pass |
| US-1/AC-3 | comparison aggregates all accounts and follows account and year selection; comparison withholds totals during loading and errors and recovers empty state | Pass |
| US-1/AC-4 | comparison explains expense and income differences for monthly and annual periods | Pass |

## Defects / coverage limits
No failing acceptance criteria. Browser tests use mocked API data, not a live database. Existing server authorization and financial reporting endpoints are unchanged. The full suite also verifies the original budget, preview editor, save failures and permission controls.

## Product acceptance / follow-up
Ready for evaluation in Budget preview → Planned vs actual. The original Budget screen remains available for comparison.
