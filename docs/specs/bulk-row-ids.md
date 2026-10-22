# Product brief: Bulk Add without crypto.randomUUID

US-BID-1: As a user whose browser does not expose crypto.randomUUID, I can open Bulk Add and manage independent draft rows.

Acceptance criteria:

- AC-1: Given randomUUID is unavailable, clicking Bulk add renders its heading and initial row without an uncaught error.
- AC-2: Adding, editing, and removing multiple rows preserves each remaining row's values, including after removing a row and adding another.
- AC-3: Reloading the bulk route renders a fresh initial row without an uncaught error; existing bulk/navigation behavior remains covered across configured browsers.

# Architect implementation brief

Replace the unconditional crypto.randomUUID call with a module-local monotonic draft-row counter. IDs are UI-only keys and are not sent to the server or used as security tokens. No UUID fallback, randomness, dependency, schema, or API changes are needed. Use a lazy state initializer to avoid generating unused rows on each render. Cover missing randomUUID through Playwright init-script override; run focused tests, build, unit/API suite, and full browser suite.

# Architect review and QA

Architect verdict: Approved with follow-up. The local counter supplies stable unique keys during the page lifetime, including row removal/recreation. Reload resets both the module counter and draft state. IDs never enter transaction payloads, so no cryptographic or database identifier guarantees are weakened. Lazy initialization avoids unused allocations on renders. No database changes.

QA (2026-10-21): `e2e/bulk-row-ids.spec.ts`, test `Bulk Add works without randomUUID and keeps draft rows independent`, maps AC-1 to navigation/heading/no-pageerror assertions, AC-2 to independent edit/remove/re-add assertions, and AC-3 to route reload/initial empty row assertions. All criteria passed on Chromium, Firefox, WebKit, iPhone and iPad. Browser API fixtures are synthetic; no live data mutations.

- Focused Playwright run: 5 passed.
- Full `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test --workers=4`: 100 passed.
- `npm run build`: passed, existing bundle-size warning only.
- `npm test`: 33 passed, 1 failed. Unrelated existing failure in `tests/checkbook-import.test.ts`, `handles explicit fallback categories but rejects protected transfers`: the corresponding rejection in `scripts/import-checkbook.mjs` is commented out, and the category database check also no longer rejects system categories. These pre-existing importer edits were preserved, not changed as part of this bug fix.

The Bulk Add fix is verified and ready for user review. Overall suite acceptance is not claimed until the separate importer behavior/test mismatch is resolved or explicitly excepted.
