# Product brief: Xfer Accounts in forecast

## Outcome
Show the protected `Xfer Accounts` category in the Budget & forecast screen when it has a plan or posted transfer activity.

## Scope and decisions
Include transfer plans and actuals in forecast tables, summary totals, chart, cash outlook and local scenarios. A transfer remains a protected category: its forecast method is displayed as `Transfer` and cannot be changed. Existing account access, transaction immutability and category protection remain unchanged. No schema or migration change is needed.

## US-1: Forecast transfers
As an account member, I want to see planned and actual transfers in the forecast so that the screen represents every budget category.

### Acceptance criteria
- AC-1: Given planned or posted `Xfer Accounts` activity, when I open Budget & forecast, then it appears in the matching income or expense table and contributes to the corresponding forecast figures.
- AC-2: Given a writable account, the Xfer Accounts row is readable but has no Fixed/Variable control or forecast-method write request.
- AC-3: Given All accounts, transfer rows and values aggregate under the same category and preserve account membership restrictions.
- AC-4: Existing non-transfer forecast methods, protected-category restrictions, loading/error states and responsive layouts continue to work.

# Architecture / implementation brief
Remove the system-category and linked-transfer filters only from the forecast read aggregation. Return `is_system` with plans and daily amounts; carry it through the pure calculator and display a non-editable Transfer badge for protected expense rows. Retain the existing server-side `NOT c.is_system` condition for forecast-method mutations. Use integer cents throughout. Add API SQL assertions, calculator coverage and deterministic Playwright coverage; run unit, build and full browser suites.

## Architect review
Approved. The read query includes the protected category and linked transfer rows while preserving account membership filtering, posted/deleted boundaries, integer-cent aggregation and the existing read-only endpoint. The mutation query still excludes system categories, so Xfer Accounts cannot acquire a forecast method. The UI represents that restriction with a Transfer badge.

# QA report

`npm test` passed with 70 tests. `npm run build` passed. `E2E_BASE_URL=http://localhost:8091 npx playwright test --workers=4` passed with 265 tests across Chromium, Firefox, WebKit, iPhone and iPad. The forecast API SQL test confirms that no system-category or linked-transfer exclusion remains. Calculator coverage verifies a protected transfer category aggregates as Fixed. The browser test verifies the row, totals, All accounts aggregation, Transfer label and absence of method-write requests. No defects found; no schema change is required.
