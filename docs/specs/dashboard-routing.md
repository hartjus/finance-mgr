# Product Brief: Home, routing, and settings

## Outcome and scope
Provide an account overview and URLs that restore the user's screen on refresh. Organize settings into General, Categories, and Accounts. Move account creation from navigation to Accounts settings. Scheduling and draft persistence are outside this change.

## Decisions and stories
The request authorizes this scope. Home is the default entry point. Summary includes all accessible accounts, explicitly marking inactive accounts, with current and reconciled totals. Refresh restores screen, account, and settings tab; unsaved input is not persisted.

### US-N1: Account overview
- AC-1: Given accessible accounts, when Home opens, then names, masked suffixes, status, current/reconciled balances and totals are shown; opening an account shows its ledger.
- AC-2: Given no accounts, when Home opens, then an empty state links to Accounts settings.

### US-N2: Resume navigation
- AC-1: Given a ledger, analysis, budget, reconciliation, bulk-entry screen, or settings tab, when refreshed or directly opened, then the same screen and account/tab appear.
- AC-2: Given navigation between screens, when browser Back/Forward is used, then the matching screen appears. Dirty bulk entry requires confirmation before leaving.
- AC-3: Given an unknown URL or inaccessible account, then a safe unavailable state appears without another account's ledger. Signed-out users see authentication while retaining the requested location.

### US-N3: Settings organization
- AC-1: Given Settings, then General contains Appearance, Categories contains existing category management, and Accounts lists accessible accounts with creation and owner-only rename/activation controls.
- AC-2: Given Accounts settings, when Add account is clicked and valid data saved, then the account is listed and appears on Home; navigation has no Add account control. Invalid saves show an error.
- AC-3: Given phone, tablet, or desktop, then Home and settings tabs remain usable without page overflow, with accessible navigation.

## Open questions
None blocking.

# Architect Implementation Brief

## Design
Use a small History API route hook for explicit paths: `/`, `/accounts/:id/{ledger,analysis,budget,reconcile,bulk}`, `/settings/{general,categories,accounts}`, and `/transfer`. Keep existing React/Mantine UI and cookie session authentication. Use existing account/category APIs, server-derived balances, and membership permissions. Implement the architecture's previously missing `PATCH /accounts/:accountId` endpoint for owner-only name and activation changes, with strict input validation and an owner-constrained SQL update. No migrations. Unknown paths/accounts render an unavailable state. Use a mobile navigation header and collapsible drawer behavior. Preserve the all-accounts budget at `/accounts/all/budget`.

## Implementation prompt
Implement the above routes, Home summary, settings tabs, account management, and navigation guard. Keep money aggregation in cents, never persist sensitive drafts, preserve server authorization, and retain the existing workflows. Add deterministic browser tests for all criteria and update obsolete core-flow expectations.

## Verification plan
TypeScript/build checks, route and browser regression tests across Chromium, Firefox, WebKit, iPhone and iPad, then full build and full Playwright suite. Review authentication, masked account data, empty/error states, and authorization. Browser fixtures exercise frontend behavior; existing API tests verify server boundaries.

# Architect Review

Verdict: Approved with follow-up.

- Routing uses browser history and existing nginx SPA fallback; routes are resolved only after session and account loading. Missing accounts never fall back to a different ledger.
- Account changes accept only name/activation, validate UUIDs and values, require authentication, and constrain the update by owner ID. Responses return only the masked suffix. No schema, ledger, reconciliation, encryption, or scheduling changes.
- Home totals aggregate server-derived cents. Settings forms are separated into `settingsForms.tsx`, with Home/settings composition in `screens.tsx` and routing in `routing.ts`.
- Browser navigation and reload protect dirty bulk entries; drafts, modal contents, filters, and analysis/budget year selections are not persisted. The URL restores the screen/account/tab.
- Loading, retry, empty, unavailable, and signed-out states are handled. Existing nginx `try_files` supports direct route requests.
- Follow-up: live PostgreSQL integration and current-minus-two browser version testing are not exercised by this local fixture suite. Vite retains its large-bundle warning.

# QA Report

## Environment and evidence

Local workspace (no `.git` metadata available), 2026-10-13. Vite on port 5173. Browser API fixtures are isolated per test and never touch the user's database. The old core-flow test depended on first-run setup and had obsolete UI assertions; its transaction regression now uses the same isolated fixtures. This is browser workflow coverage, not a claim of live database integration coverage. Fastify injection tests mock database calls and verify request validation and owner-constrained SQL.

- `npm run build`: pass (API TypeScript, web TypeScript, production Vite build).
- `npm test`: 15 passed in four files.
- `npx playwright test --workers=4`: 60 passed, 12 scenarios in each of Chromium, Firefox, WebKit, iPhone 13, and iPad Pro 11 projects.

## Criterion mapping

| Criterion | Automated scenario | Result |
| --- | --- | --- |
| US-N1/AC-1 | Home summarizes accounts and opens the chosen ledger | Pass in all five projects |
| US-N1/AC-2 | empty Home points to Accounts settings | Pass in all five projects |
| US-N2/AC-1 | refresh restores ledger/analysis/budget/reconcile/bulk and its account; settings tabs restore and keep preferences and categories separate | Pass in all five projects |
| US-N2/AC-2 | Home summarizes accounts and opens the chosen ledger; dirty bulk entry guards browser history and mobile navigation works | Pass in all five projects |
| US-N2/AC-3 | unknown routes, inaccessible accounts, authentication and load errors | Pass in all five projects |
| US-N3/AC-1 | settings tabs restore and keep preferences and categories separate; account creation and owner management live in settings; restricts account settings to the owner and validates changes (API) | Pass |
| US-N3/AC-2 | account creation and owner management live in settings | Pass in all five projects |
| US-N3/AC-3 | Home summarizes accounts and opens the chosen ledger; settings tabs restore and keep preferences and categories separate; dirty bulk entry guards browser history and mobile navigation works | Pass in all five projects |

Regression: `records and edits an unreconciled debit` passed in every project. Initial test runs exposed ambiguous selectors; these were corrected. Browser launch required downloaded browsers and execution outside the sandbox. No unresolved failures remain in the final run.

## Product acceptance

Implemented requested Home, screen/account/tab routing, settings organization, and account-creation relocation. Automated criteria pass within the environment above. Ready for user review; no deployment performed. Draft persistence and filter/year restoration remain outside this scope.
