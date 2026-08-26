# Feature: targets, quotas and activity KPIs

- **Status:** Shipped 2026-08-26 — schema, period arithmetic, service and all three screens. Retainer gap still open (see Honest limits §3).
- **Last updated:** 2026-08-26
- **Research:** `plan/07-research/sales-kpis-and-quotas.md`

## Problem

A manager can currently see what happened (`/reports`) but cannot say what *should* happen. There is no number to be measured against, so:

- "Are we going to hit the month?" is answered by opening the pipeline and squinting.
- A rep has no idea whether 6 deals is good.
- A quarter is discovered to be missed in the last week of it, when nothing can be done.

Today this lives in a spreadsheet somebody updates on Mondays, which is stale by Tuesday and disagrees with the CRM by Friday.

## The thing this feature must not do

Read §1 of the research note before building. Activity KPIs are the textbook case of **Goodhart's law**: *when a measure becomes a target, it ceases to be a good measure.* A rep told to make 40 calls a day will make 40 calls a day, and they will get shorter.

Three design rules follow, and they are not negotiable:

1. **No activity number is ever shown alone.** Calls sit next to what the calls produced. A rep with 200 calls and no meetings is the finding, and a screen that shows only the 200 hides it.
2. **Quota and activity targets are graded differently.** Quota is *committed* — 100% is the expectation. Activity targets are *aspirational* — **70% is success**, per the OKR convention. Giving them the same red/green treatment teaches the team that activity is the goal.
3. **The system reports; it does not judge.** No composite "rep score", no league table ranked on activity, no automatic flagging of a person. A manager reads the numbers and forms a view — that is their job, and a product that does it for them will do it badly.

## Proposed solution

**One `Target` model, not three.** A quota and an activity target have the same shape — a metric, a person or the team, a period, a number — so they are one table with one screen. Splitting them produces two settings pages that drift.

Management sets targets at **Settings → Targets**: pick a period (month or quarter), pick a metric, and set a number per rep or for the team. A rep sees their own; a manager sees everyone's.

Attainment is **always computed live from Deals, Leads and Activities, never stored.** A stored number is wrong the moment a deal is re-staged, and a "recalculate" button that people forget to press is worse than no number.

Each target is shown with three things, not one:
- **Attainment** — where you are (e.g. 62%).
- **Pace** — attainment vs how much of the period has elapsed. 62% on day 12 of 30 is ahead; on day 27 it is a miss that is still fixable. **Pace is the number a manager acts on**, and it is nearly free to compute.
- **Coverage** — for revenue quotas only: open weighted pipeline ÷ quota remaining. This is the earliest honest signal of whether the period lands, and unlike an activity count it cannot be improved by doing more of something cheap.

**Coverage target is derived, not hardcoded.** The received wisdom is 3×, but the correct number for any team is `1 ÷ win rate`, which this app already computes from real history in `reports.ts`. A team that wins 50% needs 2×, and telling them to hold 4× makes them chase junk. The screen shows the derivation, so the number is arguable rather than magic.

## Scope

### In this release

**Data**
- `Target` — `organizationId`, `userId` (null = whole team), `metric`, `period` (MONTH | QUARTER), `periodStart` (a date in the **org's timezone**, not UTC — the org already carries one, and a UTC month boundary silently shifts the period for everyone outside GMT), `value`, `currency` (revenue metrics only), `createdById`. Unique on `(organizationId, userId, metric, periodStart)`.
- Add `durationMinutes` and `outcome` to `Activity` — see "Honest limits" below.

**Metrics — outcome (quota-able, committed)**
| Metric | Source |
|---|---|
| `REVENUE_WON` | Σ `Deal.value` where stage `isWon` and `closedAt` in period |
| `DEALS_WON` | count of the same |
| `LEADS_CONVERTED` | `Lead.status = CONVERTED` in period |

**Metrics — activity (aspirational)**
| Metric | Source |
|---|---|
| `CALLS_LOGGED` | `Activity.type = CALL` |
| `MEETINGS_HELD` | `Activity.type = MEETING` **with `outcome = HELD`** |
| `FIRST_TOUCHES` | `Lead.firstTouchedAt` set in period |

**Read-only KPIs — computed, never targeted**
These are shown on the dashboard and reports because a manager needs them to interpret the targets, but nobody is measured against them:
- Win rate, average deal size, sales cycle length (already have the data)
- **Deal slippage** — `expectedCloseDate` vs `closedAt`. The field is already captured, edited and sorted on, but **nothing has ever compared it to the actual close date**, so a deal that slips three months in a row currently looks identical to one that closed on time.
- Median speed-to-lead in working hours (already built)
- Untouched leads (already built)

**Screens**
- Settings → Targets: a grid of rep × metric for the selected period, inline-editable. Copy-from-last-period, because nobody wants to retype 8 numbers every month.
- Dashboard: the signed-in user's own targets, with pace.
- Reports → Team: every rep's attainment and pace, with the outcome column beside the activity column on the same row.

### Not in this release

- **Commission and compensation.** Deliberate: OKR guidance is explicit that conflating targets with pay degrades both, and payroll is a different product with different auditing needs.
- **Composite rep scores or rankings.** See design rule 3.
- **Forecast submission** (rep-committed "I'll close these three"). Real feature, separate one.
- **Recurring revenue / retainers.** See "Honest limits" — this is the biggest gap and it needs its own plan.
- **Cost per lead.** Still no spend data anywhere. Unchanged from the outreach plan.
- **Team hierarchies.** Targets are per-user or org-wide. No manager-of-manager rollups; the org is one internal team today.
- **Historical target snapshots.** Editing a past target rewrites history. Acceptable now, wrong at scale — noted so it is a decision rather than an oversight.

## Honest limits — read before promising anything

**1. A "calls logged" KPI is an honour system.** `Activity` has type, subject, body and `occurredAt`. No duration, no outcome. The metric counts rows a rep created, and anyone can create 40. Adding `durationMinutes` and `outcome` (`CONNECTED` / `NO_ANSWER` / `LEFT_MESSAGE`) makes it meaningfully harder to fake and is a small migration — **it is in scope above for exactly that reason.** Even then it is self-reported. The screen should say so rather than implying the number is verified.

**2. "Meetings booked" is the most gameable metric in sales**, because a meeting that no-shows costs nothing to produce. This is why the metric above is `MEETINGS_HELD` and depends on the new `outcome` field. Shipping "meetings booked" instead would be shipping a number that goes up when nothing happens.

**3. Deals are one-off amounts, and an agency lives on retainers.** There is no recurring-revenue model in the schema, so `REVENUE_WON` counts the signing of a £2k/month retainer as £2k — or as £24k if someone types the annual figure — and the two reps who do each will never be comparable. **This is the single biggest measurement gap in the product for an agency**, and it is bigger than this feature. Flagged, not solved here.

**4. Multi-currency totals stay a set, not a number.** `lib/money.ts` already refuses to sum across currencies, and quota attainment must not become the place that quietly breaks that rule.

## Acceptance criteria

- **Given** a manager sets a `REVENUE_WON` quota of 50,000 for a rep for September, **when** that rep's won deals in September total 31,000, **then** attainment reads 62% and the currency is shown.
- **Given** the same target on 12 September, **then** pace reads *ahead* (62% attained, 40% elapsed); on 27 September the same 62% reads *behind*.
- **Given** the team's trailing win rate is 40%, **then** the coverage target derives as 2.5× and the screen states that derivation.
- **Given** a target with no matching activity at all, **then** attainment reads **0% of 50,000**, never a bare `0` and never a dash — "no progress" and "no data" must not look identical.
- **Given** a REP views the targets screen, **then** they see their own targets and cannot edit any.
- **Given** a READ_ONLY user, **then** they see every target and can edit none *(matching the existing oversight-role rule in `authz.ts`)*.
- **Given** an org in `Asia/Manila`, **when** a monthly period starts, **then** it starts at midnight Manila, not midnight UTC.
- **Given** a manager sets a target for a user in another org, **then** it is refused as not found.

## Roles

| Action | Who |
|---|---|
| View own targets | Everyone incl. READ_ONLY |
| View everyone's | MANAGER+ *(and READ_ONLY, per the existing oversight rule)* |
| Set / edit / delete targets | MANAGER+ |

## Success metric

A manager can answer "will we hit the month, and who needs help" in one screen without opening a spreadsheet. Failure mode to watch for after shipping: **if activity attainment rises while win rate falls, the feature is doing harm** and the activity targets should be pulled. That check should be built as a report, not left to memory.

## Dependencies

| Depends on | Status |
|---|---|
| `reports.ts` win rate, owner performance | ✅ built |
| `lib/money.ts` per-currency totals | ✅ built |
| `lib/business-hours.ts` + org timezone | ✅ built |
| `Activity.durationMinutes` / `outcome` | ❌ **new migration, in this release** |
| Recurring revenue model | ❌ not planned — blocks honest agency revenue reporting |

## Found during the build — recorded because the plan did not predict them

**1. Team-wide targets were not unique.** `@@unique([organizationId, userId, metric, periodStart])` does not constrain rows where `userId IS NULL`, because Postgres treats NULLs as distinct in a unique index. Two identical team quotas both inserted, and an upsert keyed on that index could never match the existing row. Found by probing the real database rather than reading the schema. Fixed with `NULLS NOT DISTINCT`, which Prisma's schema language cannot express — so the index is recreated by hand in a migration and `@@unique` carries a comment saying so.

**2. `period` was missing from the uniqueness key.** Every quarter starts on a month boundary, so a MONTH and a QUARTER target for the same person and metric shared a `periodStart` on 1 January, 1 April, 1 July and 1 October — the same row. Setting the quarterly quota silently overwrote the monthly one, on four days a year and no others. The service had the same gap in two lookups: `setTarget` found and overwrote the wrong row, and `copyTargets` treated a quarterly target as blocking a monthly one it never conflicted with.

Both are the same lesson: **the uniqueness key was reviewed by reading it and looked right.** Neither showed up until a test wrote two rows and counted them.

**3. Coverage deliberately ignores `expectedCloseDate`.** Filtering open pipeline by forecast date would drop most of it, because the field is optional and mostly unset — reporting a coverage crisis that is really a data-entry one. The `dealSlippage` report now surfaces how much of the pipeline carries no forecast date, which is the honest way to show that gap.

## Decisions needed — grill

1. **Quota metric.** Revenue won, deals won, or leads converted? Revenue is the real answer for a business but is the one most distorted by the retainer gap in §3. **Recommendation: support all three, default the dashboard to revenue, and fix retainers next.**

2. **Retainers — how bad is this?** If most agency revenue is monthly recurring, `REVENUE_WON` is measuring the wrong thing and I would rather build recurring revenue *before* quotas than bolt it on after. **What proportion of revenue is retainer versus project?** This changes the order of work.

3. **Activity targets: build them at all?** The research says they are the most likely part of this to backfire. The safe version ships outcome quotas plus pace and coverage, and shows activity as *context only* — visible, never targeted. **Recommendation: ship activity as context first; add activity targets only if a manager asks after using it.** This is the decision I would most like you to push back on.

4. **Period.** Monthly, quarterly, or both? Both costs little now and is awkward to retrofit.

5. **Who sets targets — MANAGER or ADMIN?** MANAGER matches "the person who runs the team", ADMIN matches "the person who owns the numbers". They differ the day a team lead should not be able to lower their own team's quota.

6. **Can a rep see their colleagues' attainment?** Visible-to-all is normal on a sales floor and is a motivator for some and corrosive for others. The default here should be deliberate, not inherited from `visibleTo()` by accident.

7. **Ramp.** A rep who starts on the 20th against a full monthly quota is being set up to fail. Handle by letting the manager set a smaller number (free), or by a real `effectiveFrom` on the target (more correct, more code)?

## Sources

See `plan/07-research/sales-kpis-and-quotas.md`. Benchmark numbers are **not** established — the session's web search budget was exhausted, so no default quota or coverage ratio should ship as a hardcoded constant on this research alone.
