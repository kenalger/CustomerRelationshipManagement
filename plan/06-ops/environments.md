# Environments

| Env | Host | Database | Purpose |
|---|---|---|---|
| local | `next dev` | local Postgres / Neon branch | development |
| preview | Vercel per-PR | Neon branch per PR, seeded | review + Playwright |
| staging | Vercel | dedicated Neon branch | pre-release verification, migration rehearsal |
| production | Vercel | Neon primary | real customer data |

## CI (GitHub Actions, every PR)
`.github/workflows/ci.yml` — Postgres 17 service container, then: `prisma generate` → `migrate deploy` → **`migrate diff` drift check** (catches a schema edited without a migration; uses Prisma 7's `--from-config-datasource`, since `--to-schema-datamodel` and `--shadow-database-url` were removed) → `typecheck` → `lint` → `vitest` → `build`. Red CI blocks merge.

**Not yet wired:** Playwright against the preview deploy, and Neon branch-per-PR. Both need a real Neon project and a Vercel connection first.

## Migrations
Run as a discrete, observable step before the new build serves traffic — never implicitly at request time. Expand → backfill → contract across releases. Every migration ships with a stated rollback.

## Scheduled jobs
`vercel.json` runs `/api/cron/ingestion` every 5 minutes. It requires `Authorization: Bearer $CRON_SECRET` — the route is a mutating endpoint and must never be open. It runs two independent sweeps under `Promise.allSettled`, so a failure in one cannot skip the other:
- **Ingestion retry** — stuck and failed lead imports, exponential backoff, giving up after 6 attempts and leaving them for a manual retry on the Connections page.
- **SLA** — nudges owners on leads past the first-touch target and escalates past them at the escalation window.

Both accept an optional `organizationId` to narrow the scan to one tenant, which support uses for reprocessing and tests use for isolation.

Deliberately a database-backed sweeper rather than a hosted queue: no third-party account, runs on the free tier (ADR 0003). Trade-off is at-least-once delivery at minute-level latency, which is safe because `materializeLead` is idempotent.

## Secrets
Managed in Vercel per environment. `.env.example` documents names only, never values. Nothing sensitive behind `NEXT_PUBLIC_`. Provider OAuth tokens are encrypted at rest and scoped per organization.

## Observability
Sentry for errors. Structured logs carrying request id + org id. Alerts on error rate, p95 latency, job queue depth, and **failed ingestion events** — a silently dropped lead is a lost customer.

## Backups
Neon PITR enabled. The restore procedure is documented here and rehearsed quarterly. An untested backup is not a backup.
