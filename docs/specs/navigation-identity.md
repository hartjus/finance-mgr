# Product Brief: Navigation icons and user identity

US-NI1: Make navigation recognizable and identify the signed-in user.

- AC-1: Home uses Tabler layout-dashboard and Budget uses report-money.
- AC-2: A circular user badge appears at the bottom of navigation on desktop, phone and tablet, remains visible when collapsed, and remains anchored while a long account list scrolls.

Decision: Profiles have email only. Derive initials from the first and last email-username segments separated by punctuation; for a single segment use its first two characters, uppercased. Show email alongside the expanded badge and in an accessible label/tooltip. No profile schema changes.

# Architect Implementation Brief

Use existing Tabler icons and Mantine Avatar. Give links a flexible scrollable region and keep the identity/sign-out footer outside it. Preserve existing authentication, routes, account permissions and sign-out behavior. No API or data-model changes. Check the footer in expanded/collapsed/mobile navigation and with many accounts; run full build and Playwright suite.

# Architect Review

Approved. Home and Budget use the requested existing icon exports. Initials derive only from the authenticated profile email; the badge has an accessible identity label and circular shape. A separate nonshrinking footer keeps identity and sign-out visible while links scroll. No new stored data or permissions.

# QA Report and Product Acceptance

`npm run build` passed (existing bundle-size warning). Full `npx playwright test --workers=4`: 80 passed across Chromium, Firefox, WebKit, iPhone and iPad. Browser tests use isolated API fixtures rather than the live database.

AC-1 and AC-2 map to `navigation icons and user badge remain visible with a scrolling account list` in `e2e/navigation-identity.spec.ts`, passing in all five projects. It verifies requested icon classes, initials, bottom positioning, scrolling, mobile visibility and desktop collapsed visibility. Initial test selector and mobile loading timing issues were corrected. No outstanding failures; requested changes are ready for user review.
