# Project Agent Workflow

This project uses three cooperating roles for product-to-code work:

1. Product Owner — turns an incoming request into clarified user stories, specifications, and automated-testable acceptance criteria.
2. Software Architect — evaluates the approved stories, defines the implementation approach, writes an implementation prompt, and reviews the resulting design/security posture.
3. QA Tester — validates the implementation against the acceptance criteria using automated tests and reports defects and coverage gaps.

Role prompts and handoff formats are in [docs/agents](docs/agents/README.md).

## Required handoff order

Use this sequence for feature work:

```text
request
  -> Product Owner brief
  -> Architect implementation brief
  -> AI implementation
  -> Architect review
  -> QA test report
  -> Product acceptance / follow-up
```

An implementation should not begin until the Product Owner brief has explicit acceptance criteria. QA should not report success unless each criterion is mapped to a passing automated test or an explicitly documented, approved exception.

## Repository guardrails

- Preserve the existing architecture and security decisions in `docs/architecture.md` and `docs/data-model.dbml`.
- `docs/current-schema.dbml` documents the implemented database schema; `docs/data-model.dbml` remains the candidate/design model. Whenever adding or changing a migration in `apps/api/migrations/`, update `docs/current-schema.dbml` in the same change to reflect the resulting schema after all migrations are applied. Also update it for schema changes made by `apps/api/src/migrate.ts` (including migration metadata tables).
- Keep the current-schema DBML accurate for tables, columns/types, nullability, defaults, enums, primary/unique keys, indexes, foreign keys and referential actions. Record PostgreSQL details not represented directly (such as CHECK expressions or index sort directions) in explicit notes. Exclude deferred/unimplemented objects. Verify the DBML against all migration SQL and migration-runner DDL before acceptance, and update its migration-version header. SQL migrations remain the schema source of truth.
- Keep deferred scheduling work out of current feature scope unless the request explicitly reactivates it.
- Use `apply_patch` for source and documentation changes.
- Never expose passwords, session tokens, encryption keys, or full account numbers in logs, tests, fixtures, or reports.
- Run the narrowest relevant checks during implementation, then run the full build and Playwright suite before acceptance.
