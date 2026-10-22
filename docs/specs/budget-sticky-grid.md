# Product brief: Sticky budget labels

US-BSG-1: Keep budget line identity and month context visible while editing a large grid.

- AC-1: Horizontally scrolling the editable budget table keeps its Line column (including totals and section labels) fixed on the left while month columns move.
- AC-2: Vertically scrolling the budget grid keeps the month header row at the top while body rows move. The Line corner remains fixed on both axes; headers remain horizontally aligned with month inputs.
- AC-3: Both-axis scrolling leaves visible month inputs editable, without overlapping transparent labels, in light/dark themes and desktop/phone/tablet layouts. The document has no horizontal overflow.

# Architect implementation brief

Use one accessible, keyboard-focusable native two-axis scroll region with a viewport-relative maximum height around the editable table. CSS sticky first-column cells and header cells use left/top independently, opaque theme backgrounds, and a higher corner z-index. Split section-label colspans so a full-width cell does not become a giant sticky overlay. Scope CSS to this table; leave charts/comparison tables, calculations, API, and schema unchanged. Use browser geometry tests with a large synthetic budget and persist an edited visible month through mocked API. Run build/full tests/Playwright before acceptance.

# Review and QA

Architect verdict: Approved with follow-up for the unrelated existing unit-test failure. The native scroll region is limited to 65% of viewport height and contains both scroll axes; sticky top/left constraints remain independent. Opaque Mantine body backgrounds and ordered z-indices keep labels readable, including the intersecting corner. CSS is scoped to the editable grid; API, monetary calculations, permissions, comparison tables, and charts are unchanged.

QA evidence (2026-10-21): `e2e/budget-sticky-grid.spec.ts`, `budget labels stick on independent scroll axes and inputs remain editable (light/dark)`, uses a 30-line synthetic budget. AC-1 maps to fixed first-cell/corner x coordinates while month headers move horizontally. AC-2 maps to fixed header/corner y coordinates while body rows move vertically. AC-3 maps to editing June after both-axis scrolling and checking the outgoing amount/month, opaque label backgrounds, theme activation, and no document overflow. Both cases passed on Chromium, Firefox, WebKit, iPhone and iPad (10 focused passes).

Full browser regression: `E2E_BASE_URL=http://127.0.0.1:5174 npx playwright test --workers=4` — 110 passed. `npm run build` passed with the existing bundle-size warning. `npm test` reports 33 passed and one pre-existing failure: the CSV import test still expects rejection of the protected transfer category, whose rejection is commented out in the current importer. Those unrelated edits remain untouched. The first dark-mode test attempt used the wrong preference key; corrected to the application's `finance-theme` key before successful reruns. No live data was modified; browser APIs were mocked. This feature is verified and ready for user review; overall unit-suite acceptance remains pending resolution/approval of the unrelated importer mismatch.
