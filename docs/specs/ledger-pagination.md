# Product Brief: Ledger pagination

US-LP1: Browse all transaction history using Previous, Next, numbered pages, and results-per-page selection.

- AC-1: Default page size is 75. UI offers 25, 50, 75 and 100; page controls display current/total pages and matching record count, disable at boundaries, and show an empty state.
- AC-2: Ledger API accepts positive integer `page` and `pageSize` (1–100, default 75), returns transactions plus `pagination: { page, pageSize, totalItems, totalPages, hasNextPage, hasPreviousPage }`, validates invalid inputs, and preserves membership authorization. `limit` remains a legacy page-size alias; explicit pageSize takes precedence.
- AC-3: Pages retain newest-first ordering with ID tie-breaker and correct running balances computed over the entire account ledger. Filters apply to the matching count and rows; applying/clearing filters or changing page size resets to page 1.
- AC-4: Refreshing after mutations clamps a now-empty last page to the last available page. Loading/errors are visible, requests cannot overwrite newer results, and controls work on desktop, phone and tablet.

Decisions: Numbered pages use offset pagination. Empty results report page 1 of 1. Out-of-range pages clamp to the last page. Concurrent inserts/deletes can shift page boundaries; each response is internally consistent. Reconciliation stays unchanged. No migration or DBML changes are needed.

# Architect Implementation Brief

Use one parameterized SQL statement: compute full-ledger running balances, filter, count, clamp page, then LIMIT/OFFSET and aggregate the ordered page. One statement ensures count and rows share a snapshot. Keep existing read authorization and soft-deletion rules. In Ledger separate draft filter fields from applied filters, reload on page/size/applied filter changes, ignore stale requests, expose retry and empty states, and refresh current page after mutations. Reuse Mantine Pagination and Select. Test API validation, metadata and SQL parameters; browser default/next/previous/direct-page/size/filter/empty/error/mutation behavior. Run full build and browser suite.

## API contract

`GET /api/v1/accounts/:accountId/ledger?page=2&pageSize=75`

Existing `occurredOn`, `categoryId`, `description`, and `reconciled` filters remain supported. Invalid page/pageSize inputs return 422. `page` is bounded to 1–2147483647. An authorized viewer may read the ledger; an inaccessible account returns 404.

```json
{
  "transactions": [],
  "pagination": {
    "page": 2,
    "pageSize": 75,
    "totalItems": 151,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": true
  }
}
```

Transactions are omitted in this illustrative response. Actual responses contain the requested page's rows. Counts reflect applied filters, while running balances reflect all posted, non-deleted entries in the account. Pages beyond the end return the last available page and its actual page number. No schema migration is required; `docs/current-schema.dbml` remains accurate.

# Architect Review

Approved. PostgreSQL verification using `node scripts/check-ledger-pagination.mjs` passed against temporary tables with rollback: stable timestamp/ID ties, nonoverlapping pages, counts, full-ledger balances through filters, deleted-row exclusion, empty results, page clamping after deletion, and pending-only balances. Monetary values remain decimal integer strings in JSON, preserving PostgreSQL bigint precision. The query retains membership authorization and uses bound parameters, with count and rows from a single statement snapshot. The frontend separates draft/applied filters and ignores stale responses. Reconciliation is unchanged.

# QA Report and Product Acceptance

Browser environment: Vite with isolated API fixtures; Chromium, Firefox, WebKit, iPhone and iPad. API tests use Fastify injection with mocked database calls. SQL verification executes the actual production query against PostgreSQL temporary tables with a transaction rollback and `search_path` restricted to `pg_temp`; application data is untouched.

| Criterion | Automated evidence | Result |
| --- | --- | --- |
| AC-1 | `ledger supports next previous numbered pages sizes filters and deletion clamping` | Pass in all five projects |
| AC-2 | `defaults ledger pagination to 75 and returns empty metadata`; `validates ledger pages and page sizes and preserves read authorization`; `passes page and filters to snapshot query and returns navigation metadata` | Pass |
| AC-3 | PostgreSQL verification script (ordering, disjoint pages, full-ledger balances with filters); browser pagination flow (size/filter/clear resets) | Pass |
| AC-4 | Browser pagination flow (empty/deleted last page, error/retry, responsive layout); `new filter results cannot be overwritten by a slower previous page request` | Pass in all five projects |

Full build passed with the existing bundle-size warning. `npm test`: 18 passed. Full `npx playwright test --workers=4`: 95 passed. `node scripts/check-ledger-pagination.mjs`: passed, including a final rerun after preserving monetary strings. No unresolved test failures. Offset pages may shift when other users insert/delete transactions between requests, as documented above. Ready for user review; no deployment or migration performed.
