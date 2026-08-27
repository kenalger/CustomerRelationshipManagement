# Roadmap

Sequenced by user value against build cost. Each milestone is shippable on its own.

## M0 — Foundation ✅ *shipped 2026-08-23*
Next.js 16 + Prisma 7 + Postgres, full schema for core + ingestion entities, Auth.js credentials with org signup, five-role model, tenant-scoped service layer, app shell.
**Done when:** two users in two orgs can log in and cannot see each other's data, proven by an automated test.
**Verified:** 23 Vitest tests pass, including the tenant-isolation and permissions suites. Confirmed live — signed in as Acme, Globex's lead is absent from `/leads`.
*Still open in M0:* Neon provisioning, Vercel connection.
*Closed 2026-08-24:* team invitations — see `04-features/team/plan.md`.
*Added since:* GitHub Actions CI — Postgres service, migration drift check, typecheck, lint, tests, build.

## M1 — The core record system ✅ *shipped 2026-08-23*
Contacts, Companies, Deals with list views, detail pages, and an activity timeline.
**Done when:** a rep can run a day's work manually, end to end.
**Verified:** 39 Vitest tests pass. Signed in as Acme over HTTP: dashboard, leads, pipeline, contacts, companies and both detail pages all render; no Globex data appears on any of them.
*Built:* companies + deals + activities services (all tenant-scoped and audited); create forms for contact, company, deal; contact/company/deal detail pages; activity logging against any record; pipeline board grouped by stage with per-stage totals; dashboard weighted forecast.
*Also shipped:* inline record editing, tasks with per-record panels and a grouped queue, ⌘K search.
*Not yet:* saved views, column sorting, bulk actions.

## M2 — Pipeline ✅ *shipped 2026-08-24*
Configurable pipelines and stages, drag-and-drop board, stage-change audit trail, weighted forecast.
**Done when:** a manager can see an accurate pipeline without asking anyone.
*Built:* read-only board grouped by stage with counts and totals; stage changes via a picker on the deal page, each writing a `STAGE_CHANGE` activity and an audit row in the same transaction; weighted forecast on the dashboard.
*Also shipped:* drag-and-drop board with optimistic moves and keyboard support.
*Also shipped:* pipeline/stage admin at `/settings/pipelines` — multiple pipelines, stage add/edit/reorder/delete, probability and outcome.
*Not yet:* forecast history, per-rep rollups, reordering within a stage.

## M3 — Lead ingestion + integrations ← *the differentiator*
Source-agnostic ingestion pipeline, then one source at a time. Split into sub-milestones because three external approval processes sit on the critical path.

- **M3a** Pipeline + Lead entity + Facebook Lead Ads + assignment/notification (~5 wks) — *Meta App Review starts week 1*
  - 🔨 *Partly shipped 2026-08-23:* two-phase ingestion (record → materialize), signed webhook receiver, Graph API client, field normalizer, connection health tracking. Verified live against real Meta infrastructure.
  - Also shipped: retry sweeper with exponential backoff + dead-lettering (Vercel Cron, no third-party queue), per-connection field mapping, connection health page with manual retry.
  - Also shipped: CSV contact import with column mapping and per-row error reporting.
  - Also shipped: in-app notifications — lead assigned to the owner, reauth and dead-letter alerts to admins, with dedupe so a broken connection alerts once rather than every sweep.
  - Also shipped: speed-to-lead SLA — nudge the owner, escalate past them, per-organization policy, surfaced on the dashboard.
  - *Also shipped:* SLA policy is editable at `/settings/organization`.
*Not yet:* Meta OAuth connect flow (blocked on App Review), email/Slack delivery.
- **M3b** Gmail + Microsoft Graph mailbox sync (~5 wks) — *gated on Google CASA, engage during M0*
- **M3c** Messenger / Page DMs with human triage (~2 wks)
- **M3d** Post comments (~1 wk) — *gated on legal review, internal prompts only*

See `04-features/lead-ingestion/plan.md` and `decisions.md`.

## M4 — Automation rules builder ✅ *shipped 2026-08-27*
Trigger → conditions → steps, user-composable, with a run log.
*Built:* five triggers wired to the real service call sites; conditions that reuse the segment filter vocabulary rather than inventing a second condition language; five actions, each gated to the record kinds it makes sense for; a `SET_FIELD` whitelist, because a rule that can write any column is an arbitrary write primitive; three loop guards (one run per record per event, actions inside a run raise nothing, a daily cap); a list and an editor at `/settings/automations`.
*Worth knowing:* the engine arrived complete and completely inert — nothing called `dispatch`, and no engine test could have caught it. `tests/automation-wiring.test.ts` asserts the seam, not the engine.
*Not yet:* branching, delays, outbound webhooks, AI steps. See `04-features/automation/plan.md` for why each is excluded.

## M4.5 — Design system 🔨 *pass 1 shipped 2026-08-24*
Theme-switchable token system (light + dark), rebuilt primitives, redesigned Overview / Leads / Pipeline / Contacts / Companies / Auth, and the first two charts. See `plan/08-design/`.
Pass 2 added drag-and-drop on the board (keyboard-accessible, optimistic), a ⌘K command palette searching all four record types, and themed toasts.
*Not yet:* inline edit, saved views, bulk actions, dialog primitive.

## M5 — Reporting + polish ✅ *largely shipped 2026-08-26*
*Built:* `/reports` — lead volume and conversion by source, pipeline health with days-in-stage, win/loss with grouped lost reasons, per-rep throughput, forecast accuracy (the first thing to compare `expectedCloseDate` against `closedAt`). ⌘K search, bulk actions, inline editing and saved views all shipped earlier.
*Not yet:* exports, forecast history.

## M6 — Sales management ✅ *shipped 2026-08-26*
Lead scoring, tagging, segments, targets and KPIs.
*Built:* editable scoring weights with the queue sorted on score; tags across contacts/companies/leads; saved segments whose filter is a typed document rather than a stored `where`; quotas and activity targets with live attainment, pace, and pipeline coverage derived from the team's own win rate instead of a borrowed 3×.
*Design constraint worth keeping:* outcome and activity metrics appear on the same row, and are graded differently — 100% for a quota, 70% for an activity target. See `plan/07-research/sales-kpis-and-quotas.md` for why.

## M7 — Outbound ✅ *shipped without sending, 2026-08-26*
Prospect lists, campaigns, sequence steps, A/B templates, enrollments, suppression.
*Built and tested end to end without an email provider:* a due step creates a task for a person. Nothing in the codebase pretends a message went out. Suppression is enforced at **enrollment**, not at send, so a suppressed address cannot sit inside a live sequence at all.
*Blocked:* actual sending. One decision — see `04-features/outreach/plan.md`.

## Known gaps, carried forward
- **Recurring revenue.** Deals are one-off amounts; an agency lives on retainers. This makes revenue quotas understate the business and is the largest modelling gap in the product.
- **Meta OAuth connect flow.** Code is small; shipping is blocked on App Review.
- **`Organization` → `Group`.** Raised and never resolved. See `HANDOFF.md`.

## Explicitly not on this roadmap
Marketing email campaigns, support ticketing, invoicing, mobile native apps, a no-code app builder.
