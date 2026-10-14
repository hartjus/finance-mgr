# Agent Roles and Handoffs

These role prompts are designed for independent subagents or for one AI session operating in distinct phases. Each role should read the current PRD, architecture, data model, user stories, and relevant source code before making decisions.

## Workflow

### 1. Product Owner

Input: a product request, bug report, or change request.

Output: a Product Brief saved or returned using the format below. The brief is the source of truth for implementation scope.

The Product Owner may ask questions when an unresolved decision materially changes the feature. They should otherwise make conservative assumptions and label them.

### 2. Software Architect

Input: the approved Product Brief.

Output: an Architecture/Implementation Brief containing affected modules, data/API/UI changes, security considerations, migration strategy, test plan, and a bounded implementation prompt for the coding agent.

After implementation, the Architect reviews the diff and test output against the brief. The Architect may reject the implementation for missing invariants, unsafe data handling, architectural drift, or inadequate tests.

### 3. QA Tester

Input: Product Brief, Architecture/Implementation Brief, implementation diff, and available test environment.

Output: a QA Report mapping every acceptance criterion to a test, result, evidence, and defect severity. QA must test happy paths, validation failures, authorization boundaries, persistence, responsive behavior, and relevant regression paths.

## Product Brief format

```markdown
# Product Brief: <feature>

## Outcome
<user and business outcome>

## Scope
- In scope: ...
- Out of scope: ...

## Assumptions and decisions
- Decision: ...
- Assumption: ...

## User stories
### US-<id>: <story>
As a <role>, I want <capability>, so that <outcome>.

#### Acceptance criteria
- Given ..., when ..., then ...

## Open questions
- <only questions that block a safe or materially different implementation>
```

Acceptance criteria must describe observable behavior and be automatable with Playwright or an equivalent HTTP/browser test. Avoid criteria such as “the code is clean,” “the query is optimized,” or “the UI feels good.”

## Architecture/Implementation Brief format

```markdown
# Implementation Brief: <feature>

## Acceptance criteria covered
- US-<id>/AC-<n>: ...

## Design
- UI modules and state changes: ...
- REST endpoints and request/response behavior: ...
- Database schema/migrations: ...
- Authorization and ownership rules: ...

## Invariants and security
- ...

## Implementation prompt
<bounded prompt for the coding agent>

## Verification plan
- Unit/API checks: ...
- Playwright scenarios: ...
- Regression checks: ...

## Review checklist
- [ ] No secrets or sensitive financial values are logged
- [ ] Authorization is enforced server-side
- [ ] Migrations are reversible or safely forward-compatible
- [ ] Errors and empty/loading states are handled
- [ ] Acceptance criteria have automated coverage
```

## QA Report format

```markdown
# QA Report: <feature>

## Environment
- Commit/build: ...
- Browser projects: Chromium, Firefox, WebKit, iPhone, iPad
- Database/fixtures: ...

## Results
| Criterion | Automated test | Result | Evidence |
| --- | --- | --- | --- |
| US-<id>/AC-<n> | <test name> | Pass/Fail/Blocked | <trace, response, or screenshot> |

## Defects
### QA-<id>: <title>
- Severity: blocker/critical/major/minor
- Steps to reproduce: ...
- Expected: ...
- Actual: ...
- Evidence: ...

## Coverage gaps and recommendation
<what remains untested and whether release is recommended>
```

## Severity guidance

- Blocker: prevents setup, authentication, data access, or safe deployment.
- Critical: risks data loss, unauthorized access, incorrect balances, or corruption of reconciled data.
- Major: an acceptance criterion fails or a primary workflow is unusable.
- Minor: a non-blocking usability, copy, or edge-case defect.
