# Product Brief: Aggregate monthly budget trends

US-BT1: Compare planned and actual monthly expense and income totals in an additional line chart.

- AC-1: Budget retains the current bar chart and adds a January–December line chart with planned expenses, actual expenses, planned income and actual income, with legend and USD tooltips.
- AC-2: The lines aggregate all categories within the selected account/year or all-accounts scope, follow existing planned-value rules (checked months excluded), and show zero for empty months. Account/year changes update the chart.
- AC-3: The chart remains usable on desktop, phone and tablet without page overflow.

Decision (updated by user): The additional line chart is cumulative year-to-date: each month's point sums January through that month for each of the four series. Empty later months carry forward the previous total; a new year starts from zero. The existing bar chart retains monthly values. Preserve existing checked-month exclusions and positive expense magnitudes. No scheduling or API changes.

## Cumulative revision acceptance criteria
- AC-4: Given values in multiple months, each line displays running year-to-date totals independently for expenses/income and planned/actual, including carry-forward through empty months. Account/year changes recalculate totals; the bar chart remains monthly.

## Cumulative revision implementation brief
Derive a separate cumulative dataset from the existing monthly dataset, accumulating integer cents before converting to displayed dollars. Bind only the trend chart to it and update its heading/description. Extend browser fixture data into February and verify January, February, and empty March totals, all-accounts scope, year reset, and unchanged monthly bar values. Run build and the full browser suite.

# Architect Implementation Brief

Add a responsive Recharts LineChart card alongside the existing bar chart in Budget. Reuse `chartData`, already computed from cents and converted to USD for rendering. Use red/green families for expenses/income and dashed planned versus solid actual lines, with a legend and currency tooltip. Verify multi-category totals, checked-month exclusion, empty months, scope/year changes and responsive layout, then full build and Playwright suite.

# Architect Review

Cumulative revision: Approved. A separate dataset accumulates each of the four series in cents, then converts to display dollars. Only the additional LineChart consumes it; the original BarChart still uses the monthly dataset. Running totals are recreated on each render, so scope/year changes do not retain prior totals. Copy explicitly labels the chart cumulative and year-to-date.

Approved. The new chart consumes the same monthly aggregates as the bar chart, preserving year/account scope and checked-month semantics. No separate aggregation, API, database, authorization or ledger behavior is introduced. The card has a named region, descriptive text, a four-series legend, and keyboard chart accessibility. Focused Chromium test passed with explicit multi-category, empty-month, all-account and year-change tooltip assertions.

# QA Report and Product Acceptance

Cumulative revision: build passed; full Playwright suite passed 85/85 across all five projects. AC-4 maps to `cumulative trend lines carry monthly totals forward and follow account and year scope`: January starts at January amounts, February includes January plus February, March carries February totals forward, all-account values combine both accounts, and changing year resets the totals. The monthly bar chart remains bound to its original dataset (verified by review). Fixtures isolate browser tests from live financial data. Revision is ready for user review.

Local Vite app with isolated browser API fixtures. `npm run build` passed with the existing bundle-size warning. Full `npx playwright test --workers=4`: 85 passed across Chromium, Firefox, WebKit, iPhone and iPad.

AC-1, AC-2 and AC-3 map to `monthly trend lines aggregate categories and follow account and year scope` in `e2e/budget-trends.spec.ts`, passing in every project. Assertions cover four curves and legend labels, retention of the bar chart, USD totals across categories, excluded checked amounts, zero months, combined account totals, a year with no data, and absence of page overflow. Initial tests needed selectors updated for the installed Recharts SVG structure and overlapping zero-value points. No remaining failures. Live database integration was not exercised; no API or persistence changes were made. Requested chart is ready for user review.
