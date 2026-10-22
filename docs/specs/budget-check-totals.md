# Product brief: Budget checkmarks do not change planned amounts

US-BCT-1: Marking a budget month entered must not remove its planned amount from any total or planned-versus-actual report.

- AC-1: Checking/unchecking expenses or income (including every item in a month) preserves monthly and line totals. Editing a checked item's amount updates those totals.
- AC-2: Category monthly/yearly planned amounts, variances, monthly chart and cumulative trends include checked entries. Actuals remain sourced from ledger transactions, independent of the checkmark.
- AC-3: Check state persists after refresh and retains its existing visual indication, without changing financial figures. Existing account/year scopes and desktop/mobile layouts continue working.

# Architect implementation brief

Remove checked-state zero multipliers from the five frontend calculation paths: section totals, line totals, category/month planned aggregation, chart planned expenses and chart planned income. Both charts share the same monthly dataset; cumulative trends continue summing that dataset. Keep checked_at solely for checkbox/visual state and existing persistence. No API/schema change or migration. Update the cumulative trend test, which previously encoded exclusion of checked amounts, and add interactive regression coverage for checking all entries, unchecking, editing checked amounts and reload. Run build/unit/full Playwright.

# Review and QA

Architect review: the five aggregation paths now use amounts regardless of checked_at. Check state remains limited to persistence and visual indication. Actual ledger aggregation is unchanged. No API, permission, schema, or migration changes are required.

Automated acceptance coverage (2026-10-22):

- AC-1: `e2e/budget-check-totals.spec.ts` checks every January expense/income item, verifies totals remain unchanged, edits a checked amount, and verifies the updated totals survive unchecking and refresh.
- AC-2: The same test verifies monthly/yearly category plans and variances, monthly bars, cumulative trends, and unchanged actual amounts. `e2e/budget-trends.spec.ts` additionally includes checked expense and income entries across months and account/year scopes.
- AC-3: The interactive test verifies persisted check state after refresh. `e2e/budget-trends.spec.ts` covers scopes; `e2e/budget-sticky-grid.spec.ts` covers independent scroll axes, editable inputs, and light/dark layouts. All run across Chromium, Firefox, WebKit, iPhone, and iPad configurations. Existing visual checkbox styling is unchanged.

Results: production build passed; full Playwright suite passed (155/155). Browser tests use synthetic mocked API responses, not live financial data. The chart interaction test uses plot coordinates to avoid animated zero-height bars and grid-line interception on mobile.

Unit suite: 38/39 passed. The existing unrelated `tests/checkbook-import.test.ts` protected-transfer category rejection failure remains; importer behavior was not changed for this fix. This is an outstanding suite defect, not an approved exception or a claim that the complete unit suite passes.

Product follow-up: requested behavior is implemented and all feature acceptance criteria have passing automated coverage; user acceptance is pending.
