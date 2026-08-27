# CRM

B2B sales CRM — leads, contacts, and pipeline in one place, with lead ingestion from Facebook and email as the differentiator.

**Picking this up? Read [`HANDOFF.md`](./HANDOFF.md) first** — current state, what does not work and why, and the gotchas that cost real time.

**All planning lives in [`plan/`](./plan).** Read [`plan/README.md`](./plan/README.md) first — code without a plan document is unreviewed scope.

## Stack
Next.js 16 (App Router) · TypeScript · Postgres + Prisma 7 · Auth.js · Tailwind 4 · Vitest · Neon + Vercel

Decisions and their rejected alternatives: [`plan/01-architecture/adr/`](./plan/01-architecture/adr).

## Getting started
See [`plan/06-ops/local-development.md`](./plan/06-ops/local-development.md).

```bash
npm install
npx prisma dev --name crm-local   # keep open; copy the URLs into .env
npx prisma migrate dev
npm run db:seed
npm run dev
```

Sign in as `owner@acme.test` / `password123456`.

## The one rule
Every domain row carries `organizationId`, and it comes from the session — never from client input. `tests/tenant-isolation.test.ts` enforces this and is never skipped.
