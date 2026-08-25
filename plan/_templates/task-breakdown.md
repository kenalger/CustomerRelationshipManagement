# Tasks: <feature>

Each task has exactly one owner role and is independently verifiable.

| # | Task | Owner role | Depends on | Verification |
|---|---|---|---|---|
| 1 | | crm-data-modeler | — | |
| 2 | | crm-backend-dev | 1 | |
| 3 | | crm-frontend-dev | 2 | |
| 4 | | crm-qa-engineer | 3 | |
| 5 | Security review | crm-security | 3 | |

## Definition of done
- [ ] Acceptance criteria in `plan.md` all met
- [ ] Tests written and passing (real output pasted, not asserted)
- [ ] Tenant isolation verified by an automated test
- [ ] `plan/` updated to match what actually shipped
- [ ] Security review complete if auth, tenancy, or PII was touched
