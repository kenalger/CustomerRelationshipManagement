# Test strategy

## The pyramid
- **Unit (Vitest)** — service functions in `server/services/`. Fast, no network, majority of tests.
- **Integration (Vitest + test Postgres)** — services against a real database, including transactions and constraints.
- **E2E (Playwright)** — the handful of flows a broken deploy must never survive.

## Suites that block a merge
1. **Tenant isolation** — for every resource, org A cannot read, list, update, or delete org B's data. Never skipped, never quarantined.
2. **Permissions** — each role against each action, negative cases included.
3. **Money + pipeline math** — deal values, currency, weighted forecast, stage transitions, won/lost accounting.
4. **Ingestion idempotency** — the same webhook delivered twice creates exactly one lead.
5. **Daily loop e2e** — create contact → create deal → log activity → advance stage → close won.

## Rules
- Behavior through the public surface. No asserting on internals.
- Each test seeds and cleans its own data. No ordering dependencies.
- Playwright: `getByRole` locators; wait on conditions, never `waitForTimeout`.
- A flaky test is a broken test — fix the race or delete it. Never retry it into passing.
- Never claim a suite passes without the real output.

## Release criteria
CI green, no open P0/P1, tenant-isolation and permissions suites passing, migrations verified against a production-sized copy, rollback path written down.
