# Local development

## First run
```bash
npm install
npx prisma dev --name crm-local     # local Postgres, keep this terminal open
```
Copy the `DATABASE_URL` and `SHADOW_DATABASE_URL` it prints into `.env`.
**The ports change when you restart that server** — re-copy them if the app suddenly cannot connect.

```bash
npx prisma migrate dev              # apply migrations
npm run db:seed                     # two orgs, sample leads
npm run dev                         # http://localhost:3000
```

## Seeded accounts
| Workspace | Email | Password |
|---|---|---|
| Acme Industrial | `owner@acme.test` | `password123456` |
| Globex Corp | `owner@globex.test` | `password123456` |

Two organizations exist deliberately. Globex holds one lead that Acme must never see — sign in as each and confirm.

## Commands
| Command | Does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest — tenant isolation, permissions, ingestion |
| `npm run db:migrate` | Create + apply a migration |
| `npm run db:seed` | Reseed |
| `npm run db:studio` | Prisma Studio |

## Gotchas
- **Prisma 7 needs a driver adapter.** `src/lib/db.ts` wires `PrismaPg`; `new PrismaClient()` alone will not connect.
- **The generated client lives in `src/generated/prisma`** and is gitignored. Run `npx prisma generate` after pulling a schema change.
- **Next 16**: request APIs (`params`, `searchParams`, `cookies()`, `headers()`) are async. Middleware is now `proxy`. Turbopack is the default for dev *and* build.
- Tests run serially against the same database (`fileParallelism: false`) and create/drop their own organizations.
- **Stop `npm run dev` before running the test suite.** The local connection string carries `connection_limit=10`, and a running dev server plus the suite will exhaust it — the failure surfaces as `Server has closed the connection`, which looks like a code bug and is not.
- **Do not run interactive transactions concurrently** against the local database. `Promise.all` over anything that opens a `$transaction` produces `08P01: bind message supplies N parameters, but prepared statement "" requires 0`, which reads like a schema bug and is not. The product code is sequential everywhere this matters.
- `prisma migrate diff` can emit an **empty** migration if the schema edit did not apply as intended. Check the byte count before `migrate deploy`, because an empty migration still gets recorded as applied and has to be deleted from `_prisma_migrations` by hand.
- **`prisma.config.ts` must set `shadowDatabaseUrl`.** Without it Prisma tries to use the primary database as its own shadow and every `migrate dev` fails with `type "Role" already exists`. If a shadow ever gets dirty, reset it with `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` against `SHADOW_DATABASE_URL` — check you are pointed at the shadow port, not the primary.
