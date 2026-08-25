# Tech stack (fixed — change via ADR only)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.3.2**, App Router, TypeScript strict | Turbopack default. Request APIs (`params`, `searchParams`, `cookies()`, `headers()`) are **async**. Middleware is now `proxy`. |
| UI | **Tailwind 4** + shadcn/ui | Dense, data-tool aesthetic — not a marketing site |
| Server logic | Server actions + route handlers, thin | Business logic in `server/services/` |
| Validation | Zod, one schema shared client + server | |
| DB | Postgres (**Neon free plan**) + **Prisma 7.9** | ADR 0002. Pooled URL at runtime, direct URL for migrations | Every domain row is `organizationId`-scoped |
| Auth | Auth.js | Roles: Owner, Admin, Manager, Rep, Read-only |
| Background jobs | Inngest | Retries, backoff, DLQ, per-tenant concurrency |
| Tests | Vitest (unit/integration) + Playwright (e2e) | |
| Hosting | Vercel (Hobby in dev → **Pro before real use**) + Neon branch per PR | ADR 0003. Hobby is non-commercial only |
| Errors/logs | Sentry + structured logs carrying request + org id | |

## Proposed folder structure

app/ # routes, layouts, loading/error boundaries
components/ # shared UI (shadcn primitives + composites)
server/
services/ # business logic, tenant-scoped, unit-testable
integrations/ # facebook/, email/, webhooks/ — external boundary
jobs/ # Inngest function definitions
lib/ # auth, db client, zod schemas, utils
prisma/ # schema.prisma + migrations
plan/ # this folder
tests/ # e2e specs

## Non-negotiables
- Tenant id comes from the session. Never from the client.
- No third-party call on a user-blocking request path — queue it.
- Every mutation that changes ownership, stage, or value writes an `AuditLog` row in the same transaction.
