# Product Brief: Budget preview

## Outcome and scope
Compare the approved calmer design with the existing Budget screen using the same saved budgets. This is an additional screen, not a replacement. Scheduling, API changes and schema changes are excluded.

## Decisions
The existing Budget navigation and URL remain intact. Budget preview has its own navigation entry and URL. Both screens edit live shared budget data. Month is the default view; Year retains the twelve-month editor. Copy from current month retains its existing calendar-month semantics.

## US-1: Compare and manage budgets
As an account member, I want an optional focused budget screen so I can compare layouts without duplicating data.

### Acceptance criteria
- AC-1: Given an account, both Budget and Budget preview URLs load independently; an amount saved in preview is visible in the original after navigation/reload.
- AC-2: Given monthly lines, preview shows income, expenses and remainder for the selected month; month navigation changes amounts and Year exposes all twelve months.
- AC-3: Given writable access, amount and entered changes persist; Add line validates required fields, and row menus provide January copying, current-month copying and confirmed deletion; next-year copying retains confirmation.
- AC-4: Given preview, comparison and monthly/cumulative charts appear in separate accessible tabs; the default plan does not stack these reports.
- AC-5: Given viewer, inactive or all-account scope, editing is disabled. Failed saves show a recovery action and do not report success; empty budgets invite adding a line.
- AC-6: Given desktop, tablet or phone, preview controls remain usable and wide tables scroll inside their container without overflowing the page.

## Open questions
None blocking. User approved the concept and requested parallel implementation.

# Architect Implementation Brief

## Design and implementation prompt
Add `budget-preview` to routing and navigation. Extend the existing Budget controller with an explicit preview mode to reuse loading, queued saves, authorization gates and mutation dialogs. Add a focused monthly presentation with local month/view/tab state; retain the existing annual editor and reports behind conditional sections. Use scoped responsive CSS and Mantine controls. Do not change API, database, ledger, or forecast behavior. Both screens use existing authenticated endpoints and server-side permission checks. No migration or DBML update is needed.

## Verification plan
Add deterministic Playwright coverage for AC-1 through AC-6, including persistence, negative paths and responsive containment. Run narrow browser tests during implementation, then full build and full five-project Playwright suite. Review diff for permission, save-queue and original-screen regressions before QA acceptance.

## Architect review
Approved for optional comparison on 2026-10-27. The diff preserves the original route and editor, shares all existing mutation handlers and permission gates, and limits new styling to preview. API contracts, account authorization, integer-cent storage, ledger and schema are unchanged. Existing copy/save ordering and stale-load regression tests pass. No credentials or full account numbers were introduced. Empty, loading, failed-save and read-only states are retained or explicitly presented.

# QA Report

## Environment and commands
- Working-tree build, 2026-10-27; Vite at `http://localhost:8091`.
- Deterministic intercepted API fixtures with synthetic data; browser persistence tests reload the fixture-backed saved state, not a live database.
- `npm run build`: passed (existing bundle-size advisory remains).
- `E2E_BASE_URL=http://localhost:8091 npx playwright test --workers=4`: **240 passed**, Chromium, Firefox, WebKit, iPhone and iPad; 25 preview cases included.
- `git diff --check`: passed.

## Results
All named tests below are in `e2e/budget-preview.spec.ts` and passed in all five projects.

| Criterion | Automated test | Result |
| --- | --- | --- |
| US-1/AC-1 | preview edits persist in both independent budget screens | Pass |
| US-1/AC-2 | monthly summary, annual editor and report tabs stay focused and contained | Pass |
| US-1/AC-3 | preview edits persist in both independent budget screens; preview adds validated lines and retains copy and delete actions | Pass |
| US-1/AC-4 | monthly summary, annual editor and report tabs stay focused and contained | Pass |
| US-1/AC-5 | preview disables writes for viewer, inactive and all-account scopes; preview recovers failed saves and explains empty budgets | Pass |
| US-1/AC-6 | monthly summary, annual editor and report tabs stay focused and contained | Pass |

Desktop and phone screenshots were visually reviewed. Screenshots are generated at `test-results/budget-preview-monthly-sum-1b24a--stay-focused-and-contained-<project>/budget-preview.png`. The full suite also covers original budget copying, checkmarks, totals, sticky scrolling, stale loads and trends.

## Defects and limits
No failing acceptance criteria. New browser tests exercise UI permissions and API contracts with mocks; server authorization is reused unchanged and was not independently retested against a live database for this presentation-only change.

## Product acceptance / follow-up
Ready for the user's side-by-side evaluation. Open the local app on port 8091 and select Budget or Budget preview. Both edit the same persisted budget; this is not an isolated financial sandbox. Keep the original screen until the user chooses a preferred layout. No default-screen replacement or deployment was performed.
