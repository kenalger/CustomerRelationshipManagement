# `plan/` — where all development planning lives

Every piece of development work on this CRM is planned here **before** it is built. Code without a plan document is unreviewed scope.

## Layout

| Folder | Holds | Owner role |
|---|---|---|
| `00-vision/` | The problem we're solving and who for | `crm-product-analyst` |
| `01-architecture/` | Stack decisions + numbered ADRs | `crm-architect` |
| `02-data-model/` | Domain model, entities, tenancy rules | `crm-data-modeler` |
| `03-roadmap/` | Milestones and sequencing | `crm-product-analyst` |
| `04-features/<name>/` | One folder per feature: `plan.md`, `ux.md`, `tasks.md` | `crm-product-analyst` + feature lead |
| `05-quality/` | Test strategy and release criteria | `crm-qa-engineer` |
| `06-ops/` | Environments, CI/CD, runbooks, `incidents/` | `crm-devops` |
| `07-research/` | Notes from web research — vendor docs, articles, talks | everyone |
| `_templates/` | Copy these; don't invent new formats | — |

## The workflow

1. **Problem** → `crm-product-analyst` writes `04-features/<name>/plan.md` from the template. Includes what's explicitly *not* in scope.
2. **Research** → whoever owns the unknowns reads real sources on the web and files `07-research/<topic>.md`. No integration is designed from memory.
3. **Design** → `crm-architect` writes an ADR if the change is structural. `crm-ux-designer` writes `ux.md`. `crm-data-modeler` updates `02-data-model/domain-model.md`.
4. **Break down** → `tasks.md` from the template, each task owned by one role.
5. **Build** → backend / frontend / integrations devs implement against the plan.
6. **Verify** → `crm-qa-engineer` tests against the acceptance criteria. `crm-security` reviews anything touching tenancy, auth, or PII.
7. **Ship** → `crm-devops` releases. The plan is updated to reflect what actually shipped.

## Rules

- A plan that doesn't say what it **excludes** hasn't been thought through.
- Acceptance criteria are Given/When/Then and must be able to fail.
- Plans are living documents. When reality diverges, fix the plan in the same PR — a stale plan is worse than no plan.
- Keep them short. A one-page plan that gets read beats a five-page plan that doesn't.
