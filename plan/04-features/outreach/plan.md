# Outbound: cold email, sequences and lead generation

- **Status:** Steps 1, 3 and 7 shipped 2026-08-26. Steps 2, 4, 5, 6 outstanding. One hard blocker unchanged.
- **Brief:** cold email campaigns · ICP prospect lists · outreach sequences · follow-up cadences · response-rate tracking · A/B testing · a lead-gen system tracking volume, conversion and cost per lead.

## Honest position: the app is inbound-only today

Everything built so far assumes a lead **arrives**. Facebook Lead Ads, forwarded email, CSV import, the SLA clock, round-robin assignment, conversion — all of it starts from a lead that already exists.

Nothing here reaches *out*. Verified against the codebase:

| Capability the brief needs | Today |
|---|---|
| Send an email | **Absent.** No provider, no SMTP, no `Resend`/`SendGrid`/`Postmark` dependency anywhere. |
| Sequence / cadence | Absent. No model. |
| Campaign | Absent. |
| Email template | Absent. |
| Tagging / segments | **Absent as data.** The 10 code hits for "tag" are the UI badge component, not a `Tag` model. |
| Lead scoring | Absent. |
| Suppression / unsubscribe list | Absent. |
| Reply tracking | Absent. Inbound email sync (M3b) was never built either. |
| Cost per lead | Absent — no spend data exists anywhere in the schema. |

## The blocker: sending

**Cold email cannot be built without an email provider**, and that is a decision plus an account, not code. It also is not only an API key:

- A **sending domain** with SPF, DKIM and DMARC. Sending cold mail from an unauthenticated domain lands in spam and damages the domain the business uses for real mail — usually the argument for a separate sending domain.
- **Warm-up.** A new domain sending volume immediately gets filtered.
- **Reply handling.** Response rate is the metric in the brief, and a reply arrives at a mailbox — so this needs inbound sync (M3b), which is itself gated on the Google CASA assessment already flagged as unstarted.
- **Suppression and unsubscribe** are not optional. CAN-SPAM requires a working opt-out; GDPR and CASL constrain cold outreach to EU and Canadian recipients considerably. This is a design constraint, not a footnote: it dictates a suppression list checked before every send, a one-click unsubscribe, and per-domain sending limits.

Nothing in the brief works end to end until sending exists. What *can* be built now is everything the sending sits on top of.

## What is buildable now, in dependency order

**1. Tagging** — ✅ **shipped.** `Tag` + `Tagging` models, colour constrained to the nine validated palette pairs by enum rather than free hex. Applies to contacts, companies and leads; a rep cannot tag a record they cannot see; deleting a tag is MANAGER+. 32 tests.

  *Worth recording:* Postgres unique indexes are case-sensitive, so `@@unique([organizationId, name])` would have happily allowed both "Enterprise" and "enterprise". An explicit case-insensitive pre-check does the real work, with `P2002` caught as a race backstop.

**2. Segments (saved filters)** — ✅ **shipped.** A named, saved query over leads/contacts/companies. `Segment.filter` is a *typed document*, validated on the way in and translated to a Prisma `where` on the way out — deliberately not a stored `where` clause, because a saved row that can dictate a query is a way to walk around `visibleTo(ctx)`. Shared segments are visible to the whole group, but a rep running one still sees only their own records: a segment narrows, it never widens.

**3. Lead scoring** — ✅ **shipped, end to end.** Weights are editable at Settings → Lead scoring (ADMIN+), the queue sorts on the score, and an unscored lead shows a dash rather than a 0 — `Lead.score` defaults to 0, so "nobody has scored this" and "this is worthless" would otherwise look identical. Recalculating is an explicit, bounded action rather than something a form submission does to 50k rows.

  Original notes: A typed weight document on `Organization.scoringRules`, ADMIN-only to change. The core `scoreLead()` is a **pure function** with no database access, so it is tested against fixed inputs rather than fixtures. Scores persist to `Lead.score` with an index on `(organizationId, status, score)` so the queue can sort on it in SQL. The bulk recompute is sequential, avoiding the documented `08P01` protocol failure.

**4. Prospect lists** — ✅ **shipped.** `ProspectList` + `ProspectListMember`, populated from a segment or by hand. Every add funnels through one visibility chokepoint, so an id the caller cannot see is *skipped* rather than refused — a rep bulk-adding 500 ids should not be told "forbidden" because two belong to a colleague, and nothing they cannot see may land on the list either way.

  *Worth recording:* `memberCount` is visibility-scoped, so the size shown next to the rows always agrees with the rows. An owner and a rep therefore see different sizes for the same list — deliberate, because a count that disagrees with the page beneath it reads as a bug. And deleting a list *detaches* any campaign built from it (`onDelete: SetNull`) rather than failing: the enrollments are the durable thing, the list was only the source.

**5. Campaign + Sequence model** — ✅ **shipped, without sending.** `Campaign` (goal, owner, list, status), `SequenceStep` (position, delay, template, instruction), `Enrollment` (contact/lead, position, state, next-due). Enrollments advance on a cron every 15 minutes; a step that comes due becomes a **task** carrying the step's instruction, worked by a person. Nothing in the codebase pretends a message went out — when a provider is chosen, the sender replaces the task, and everything around it is already built and tested.

  *Worth recording:* the sweep is **task-first, then advance**. A crash between the two repeats a task, which is noise; advancing first and crashing would skip a prospect's step, which is a lost deal. At-least-once is the right bias for outreach, and the advance is a compare-and-set on the position it read so it cannot double-advance either.

  Business hours are deliberately not applied to sequence delays: `lib/business-hours.ts` *measures* elapsed working minutes and has no inverse that *adds* them, and what comes due is a task in a queue rather than a message in an inbox — a 3am due time is picked up when the rep starts their day. Send-window shaping belongs in the sender, next to the deliverability rules, once one exists.

  *Also worth recording:* `delayMinutes` is measured from the previous step completing, not from enrollment, so inserting a step does not reschedule the whole sequence. And the sweep is **sequential**, not `Promise.all` — concurrent interactive transactions on the pg adapter produce `08P01`, which this project has now hit twice.

**6. Templates + A/B variants** — ✅ **shipped.** `EmailTemplate` + `TemplateVariant`. Variant assignment is a stable hash of the enrollment, not `Math.random()`, so a retry can never flip a prospect between variants — which is the difference between an A/B test and two piles of noise.

**7. Reporting** — ✅ **shipped** (except campaign response rate, which needs campaigns). `/reports` gives lead volume and conversion by source, median first-touch in *working* minutes, open pipeline by stage with median days-in-stage flagged amber past 14 days and red past 30, win/loss with lost reasons grouped by frequency, and per-owner throughput with untouched leads called out.

  Two deliberate refusals: a source with no leads reports `null` conversion rather than `0%`, because "no data" and "we tried and failed" are different findings. And **cost per lead is absent with a note saying why** — no spend data exists, and a number invented from nothing is worse than its absence.

## Sequencing against what is already planned
Tagging and scoring are independent and can start immediately. Segments build on the existing URL filters. Campaigns and sequences are meaningful without sending but only *complete* with it, so the provider decision should be made before step 5 rather than after.

## Decisions needed
1. **Email provider** — Resend has a free tier and is the smallest step; SendGrid/Postmark are more established for volume. This also unblocks notification email and team invitations, both currently copy-the-link-by-hand.
2. **Sending domain** — the company's primary domain, or a separate one for outbound. This materially affects deliverability risk.
3. **Jurisdictions** — whether prospects include EU/UK/Canada, which changes consent handling from "advisable" to "required".
4. **Cost per lead** — manual spend entry, or integrate ad platforms.
