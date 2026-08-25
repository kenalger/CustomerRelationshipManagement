# 0002 — Neon Postgres as the database

- **Status:** Accepted
- **Date:** 2026-08-23
- **Owner:** crm-architect + crm-devops

## Context
We need a Postgres database. Constraint from the product owner: **stay on free tiers as far as possible.** We also need a per-PR preview database, because `plan/06-ops/environments.md` commits to running Playwright against an isolated database on every pull request.

## Decision
**Neon** serverless Postgres, free plan, accessed through Prisma.

Free plan as of 2026-08-23 ([Neon pricing](https://neon.com/pricing)): 0.5 GB storage per project, 100 CU-hours/month, autoscale to 2 CU, scale-to-zero after ~5 minutes idle, up to 100 projects and 10 branches per project.

## Alternatives rejected
- **Supabase free** — 500 MB database, but **projects pause after 7 days of inactivity** and need a manual resume. A CRM that is unreachable after a quiet week is not a CRM. Neon's scale-to-zero resumes on the next query with no human in the loop. Supabase's 2-active-project cap also can't cover local + staging + per-PR branches.
- **Railway / Render free Postgres** — time-limited trials or forced deletion of idle databases; no branching.
- **Local Docker Postgres only** — fine for development, no answer for preview or production.
- **SQLite / Turso** — loses `Decimal` fidelity for money, JSONB for raw ingestion payloads, and the concurrent-write behavior a multi-user CRM needs.

## Consequences
- Branch-per-PR preview databases come free, which is exactly what CI needs.
- **0.5 GB is the real ceiling.** `IngestionEvent.rawPayload` (raw Facebook and email bodies) will dominate storage. A retention job that prunes raw payloads is a launch requirement, not a nice-to-have — this is question Q11 in `plan/04-features/lead-ingestion/plan.md`.
- Scale-to-zero means a cold first query of roughly a second. Acceptable for internal use; revisit before any customer-facing SLA.
- Prisma must use a pooled connection string in serverless. Direct URL for migrations, pooled for runtime.
- Real production data outgrows the free plan. Neon paid starts around $5/mo — this is the expected upgrade path, not a surprise.
