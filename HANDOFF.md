# Handoff

- **Updated:** 2026-08-27
- **State:** 684 tests passing, 34 test files, 17 migrations, 34 app pages. Build, lint and the design guard are clean.
- **Read `plan/README.md` next.** Every feature has a plan document; several record decisions that are not obvious from the code.

## Start it up

```bash
npm install
npx prisma dev --name crm-local    # MUST stay running — see "Gotchas"
npx prisma migrate dev
npm run db:seed                    # two orgs, the minimum the isolation tests need
npm run db:seed:demo               # fills Acme with a quarter of realistic work
npm run dev
```

Sign in as any of these — password `password123456` for all:

| Account | Role | Use it to see |
|---|---|---|
| `owner@acme.test` | OWNER | everything |
| `tom@acme.test` | MANAGER | target setting, team views |
| `iris@acme.test` | REP | own-records-only scoping |
| `auditor@acme.test` | READ_ONLY | sees all, changes nothing |

`owner@globex.test` is the second tenant. It exists so isolation can be checked by eye as well as by test.

## What works

**Records** — leads, contacts, companies, deals. List views, detail pages, inline editing, activity timeline, tasks, ⌘K search, bulk actions.

**Pipeline** — configurable stages, drag-and-drop board, stage-change audit trail, weighted forecast.

**Lead ingestion** — two-phase Facebook Lead Ads pipeline: signed webhook, Graph client, normalizer, dedupe, retry with dead-lettering, connection health. Speed-to-lead SLA with escalation. CSV import. Google Sheets import.

**Scoring and segmentation** — editable weights, scores on the lead queue, tags, saved segments.

**Outbound** — prospect lists, campaigns with sequence steps, A/B templates, enrollments, a do-not-contact list enforced at enrollment.

**Targets and KPIs** — quotas and activity targets, live attainment, pace, pipeline coverage derived from the team's own win rate, forecast accuracy.

**Automation** — trigger → conditions → steps, with a run log and three loop guards. Screens to build a rule without SQL.

## What does NOT work, and why

| | |
|---|---|
| **Sending email** | No provider chosen. Campaigns deliberately create a *task* for a person instead; nothing pretends a message went out. Choosing a provider unblocks cold email, notification email and invitations at once. |
| **Connecting Facebook** | The ingestion pipeline is real and tested, but **no OAuth route exists** and `connection.create` appears nowhere. The one connection in dev was inserted by hand. Finishing it is one route pair — and Meta App Review, which is a submission and a wait. |
| **Google Sheets sync** | Import only, by design. A shared link is read once. "Sync" would mean two writers and conflict rules nobody has specified. |
| **Retainers / recurring revenue** | Deals are one-off amounts. `REVENUE_WON` counts a £2k/month retainer as £2k. **For an agency this makes revenue quotas systematically understate the business** — the largest known modelling gap. |
| **Cost per lead** | No spend data anywhere. The reports say so rather than inventing a number. |

## Decisions waiting on a human

1. **Has Meta App Review been started?** Nothing else unblocks live Facebook lead capture.
2. **Email provider**, and a sending domain. Blocks three features.
3. **Retainers** — what share of revenue is recurring? If it is most of it, model that before anyone trusts the quota screens.
4. **`Organization` → `Group` rename.** Raised long ago and never resolved: the app is multi-tenant by construction, and the ask was to treat it as one internal company. My recommendation is to rename and keep the isolation boundary; removing tenancy would invalidate every authorization test.
5. **Should an automation be able to send email?** Every other action is internal.

## Gotchas — each of these cost real time

**The local database must be running.** `npx prisma dev --name crm-local`. When it stops, every DB-backed suite fails at `makeOrg` with *"Server has closed the connection"*, which looks like a code failure and is not. This happened during this session.

**Never call `db.$disconnect()` in a test.** `lib/db.ts` caches the client on `globalThis`; that cache is shared between test files, so one file disconnecting closes the client every later file still holds. Twenty-five files were doing this and the suite failed intermittently for a whole day, in whichever suites happened to run next. See the comment in `tests/setup.ts`.

**Do not run two `vitest` processes at once** against this database. They create and drop organizations and will delete each other's fixtures.

**Do not judge a test run made while `next dev` is recompiling.**

**Never run concurrent interactive transactions on the pg adapter.** `Promise.all` over functions that each open a `$transaction` produces `08P01: bind message supplies N parameters, but prepared statement "" requires 0`. Sequential loops only. This has bitten three times.

**Postgres treats NULLs as distinct in a unique index.** A nullable column in a compound unique key does not constrain the rows where it is null. `Target` needed `NULLS NOT DISTINCT`, applied by hand because Prisma cannot express it — see `prisma/migrations/20260826054809_target_team_uniqueness`.

**Prisma reads `undefined` as "leave this column alone."** Use `Prisma.DbNull` to null a Json column.

**Only elements cross the RSC boundary, never functions.** Passing a Lucide icon *component* from a Server Component fails; pass `ReactNode`.

**Do not import `src/server/services/*` into a client component.** It pulls Prisma — and `fs`, `net`, `tls` — into the browser bundle and the build fails.

**Page actions never go in `PageHeader`.** It takes no `action` prop by design; use `PageToolbar`. Reasoning and sources are in `plan/08-design/design-system.md`.

## Verifying UI work

The design guard (`node scripts/check-design.mjs`) catches tokens and rounding, not layout. **Layout must be looked at.** Playwright driving the installed Chrome works well and needs no project dependency:

```bash
npm install playwright --prefix /tmp/shots     # keeps package.json clean
# then drive http://localhost:3000, log in, screenshot, and read the PNG
```

Every UI defect found on 2026-08-26–27 — a wrapped nav, a grey slab over empty grid cells, a table overflowing by 167px, a hydration mismatch on the pipeline board — was invisible in the code and obvious in a screenshot.

## Where the bodies are buried

- `src/server/authz.ts` — the single authorization chokepoint. `READ_ONLY` deliberately sees everything; it is an oversight role, and scoping it to "records you own" would make it useless.
- `src/lib/targets.ts` — period arithmetic in the org's timezone. Verified against the IANA database, including a 45-minute zone and a DST boundary.
- `src/lib/money.ts` — totals are a set of per-currency amounts, never one number.
- `src/server/services/automation.ts` — the three loop guards. Read the comments before changing any of them.
- `src/lib/google-sheet-url.ts` — the SSRF surface. The URL is rebuilt, never appended to.
