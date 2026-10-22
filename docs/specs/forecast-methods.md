# Product brief: Fixed and variable category forecasts

As a budget user, I want to choose a forecasting method per account/category so fixed bills are not extrapolated as daily spending.

## Acceptance criteria

- AC1: Unconfigured expense categories default to Fixed. Current-month Fixed forecast is max(plan, actual); Variable remains max(plan, rounded actual × days / elapsed days). Income, past/future months and final-day rules remain unchanged. Unbudgeted categories are supported.
- AC2: Active-account owners/editors can change an expense category's method on the new forecast screen. It persists after refresh and across months, applies to that account/category only and is shared with account members. The original Budget screen and stored planned amounts are unchanged.
- AC3: All accounts computes per-account/category forecasts before summing, shows Fixed/Variable/Mixed labels, and requires selection of a specific account to change methods. Tables, cards, chart, cash and scenarios use the same totals.
- AC4: API rejects unauthenticated, nonmember, viewer, inactive-account, invalid-method/ID, system and unrelated-category writes. Archived categories already represented in the account may be configured. Failed saves leave the previous method and forecast visible with an error. Stale saves cannot affect another scope; duplicate in-flight writes are prevented.
- AC5: Migration and current-schema DBML agree. Unit/API, disposable PostgreSQL and browser tests cover persistence, defaults, arithmetic, account isolation, error handling and responsive read-only/editable controls; full build and browser regression pass.

## Architect implementation brief

Add migration 003 for `account_category_forecast_methods` keyed by (account_id, category_id), method text constrained to fixed/variable, default fixed, updated_at; cascading foreign keys. No backfill: absence means Fixed. This is one shared setting, not month/year-specific; changes do not alter ledger or budget rows.

Extend the existing forecast read response with stored method mappings in the same SQL snapshot. Add idempotent PUT `/accounts/:accountId/forecast-methods/:categoryId` with `{method}`. Recheck membership/active status and category relevance inside a parameterized upsert; lock participating membership/account/category rows while writing. Require an existing undeleted budget line or ledger transaction in that account, exclude system categories; archived categories remain usable for reporting. Concurrent deliberate updates use last-writer-wins for this single preference.

Calculate at account/category granularity, then merge category summaries. Editable Fixed/Variable controls appear only on expense rows for a writable selected account. All-account method labels are read-only, showing Mixed when needed. Loading/save states and keyed screen scope prevent stale results. Save errors do not change local method state; retry is safe. Clarify scope and formulas in-screen.

Verification: pure calculator, Fastify injection permission/validation tests, real PostgreSQL migration/upsert/read assertions against synthetic data in a disposable container, Playwright interaction/persistence/failure/all-account/viewer tests; full unit suite/build/Playwright.

## Review and QA

Architect review: approved. Only the new forecast screen, its calculator/read API, and the new preference write API change behavior. Original Budget editing and ledger data are unchanged. Expense maxima are evaluated before combining accounts; the existing scope-level income calculation is explicitly preserved. Permission and category checks occur both at the route boundary and in the writing SQL statement; shared-account editors may configure categories represented in the account without owning those categories. The schema has a unique account/category key and constrained method values. Missing preferences consistently mean Fixed. PUT retries are idempotent; simultaneous deliberate edits use last-writer-wins.

QA report (2026-10-22):

| Criterion | Automated evidence | Result |
| --- | --- | --- |
| AC1 | `tests/forecast.test.ts`: default Fixed, under/over/no-plan amounts, Variable pace/rounding, first/final day, past/future/leap months and unchanged income | Pass |
| AC2 | `e2e/forecast-methods.spec.ts`: select Variable/Fixed, reload, change month, switch account, retained method and original budget regressions; PostgreSQL upsert/read-back and shared-editor checks | Pass |
| AC3 | Calculator mixed-method and same-method per-account-floor cases; browser All accounts Mixed label and summed forecasts; chart/cash assertions and existing scenario coverage | Pass |
| AC4 | `tests/server-routes.test.ts`: authentication, invalid/bodyless inputs, nonmember/viewer/inactive denial and write parameters; PostgreSQL system/unrelated/archived/unbudgeted cases; browser failed-save retry, disabled in-flight control, scope switch and read-only controls | Pass |
| AC5 | Real migration chain 001–003 plus runner metadata DDL applied in disposable PostgreSQL; default/unique/FK/CHECK and cascade assertions; DBML compared with migration and runner sources; full regression checks | Pass |

Results: `npm test` 59/59 passed; `npm run build` passed (existing bundle-size advisory); full Playwright suite 190/190 passed on Chromium, Firefox, WebKit, iPhone and iPad. `node scripts/check-forecast.mjs` passed, including synthetic-data SQL aggregation and actual migration/preference persistence tests. The disposable database was stopped afterward. Browser tests use mocked API responses; no production financial records or preferences were changed.

Deployment: rebuild API and web containers. The API Docker startup runs the migration runner before serving requests, applying 003 automatically. Outside Docker, run the migration runner before starting the new API. No backfill or destructive rollback is needed; the migration adds only the preference table. User acceptance remains pending review.
