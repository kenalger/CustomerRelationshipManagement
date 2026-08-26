# Feature: General settings — time, retention, workspace

- **Status:** Planned 2026-08-26, awaiting approval
- **Owner roles:** crm-backend-dev, crm-security
- **Decisions taken:** org-level timezone · business hours on by default, toggleable per org · 30-day raw-payload retention · workspace profile + danger zone. **Default currency and locale deliberately excluded** for now.

## Why this, not cosmetics

General currently holds three fields: name, and the two SLA numbers. Meanwhile the code carries assumptions that belong to the organisation and are currently hardcoded or wrong:

| Evidence in the code | What it causes |
|---|---|
| `tasks.ts` → `endOfToday.setHours(23,59,59,999)` | "Today" is the **server's** day. A rep sees tasks roll over at the wrong hour. Already documented as a known limitation in `bucketFor`. |
| `sweepSlaBreaches()` counts wall-clock minutes | A lead arriving 17:55 Friday breaches at 18:25 Friday and escalates all weekend. |
| `IngestionEvent.rawPayload` never pruned | ADR 0002 named this the main threat to the 0.5 GB Neon tier; Q11 in the lead-ingestion plan is still open. It is also customers' personal data held indefinitely. |

## Schema

```prisma
model Organization {
  // Workspace profile
  industry String?
  website  String?

  // Time — IANA zone, one per organization
  timezone             String  @default("UTC")
  businessHoursEnabled Boolean @default(true)
  businessDays         Int[]   @default([1, 2, 3, 4, 5])  // ISO: 1=Mon
  businessStartMinute  Int     @default(540)              // 09:00
  businessEndMinute    Int     @default(1020)             // 17:00

  // Retention
  rawPayloadRetentionDays Int @default(30)
}

model IngestionEvent {
  payload         Json?      // nullable so it can be pruned
  payloadPrunedAt DateTime?  // the event row survives; only the body goes
}
```

Pruning nulls the **payload** and keeps the event row, so the audit trail of what arrived and when is intact even after the body is gone.

## The hard part: business-hours elapsed time

`businessMinutesBetween(from, to, org)` — minutes of *working time* between two instants, in the org's zone.

- Implemented with `Intl.DateTimeFormat` + `timeZone` to resolve wall-clock parts for an instant. No new dependency; DST is handled because each day is resolved independently rather than by adding fixed offsets.
- `businessHoursEnabled: false` degrades to plain wall-clock difference, so the toggle is one branch rather than a second code path.
- The SLA sweeper compares **business minutes elapsed** against `slaFirstTouchMinutes` / `slaEscalateMinutes`, so those numbers keep their current meaning and no migration of existing values is needed.
- The lead-queue age chip and the dashboard banner use the same function, so the number a rep sees matches the number that triggers the escalation. Today they would silently disagree.

**Edge cases that need tests:** a lead arriving mid-shift · outside hours · on a weekend · spanning a weekend · a target longer than a single working day · zero-length business days (config error) · DST transition days · `businessHoursEnabled: false`.

## Retention job

Added to the existing cron sweep, so no new infrastructure:
- Nulls `payload` on `IngestionEvent` older than `rawPayloadRetentionDays`, sets `payloadPrunedAt`.
- Batched, and reports a count like the other sweeps.
- **Never touches `Lead`, `Contact` or `Deal`.** Only the raw provider body is pruned.
- The Connections page states the current window, so nobody is surprised that a two-month-old failed import can no longer be replayed.

## Danger zone

Delete workspace: **OWNER only**, requires typing the workspace name to confirm, and states plainly what is destroyed. `Organization` already cascades to everything, so this is one delete — which is exactly why it needs a real gate rather than a `window.confirm`.

## Settings General, after

Three sections rather than one flat form:
1. **Workspace** — name, industry, website, the read-only URL slug
2. **Time and hours** — timezone, business-hours toggle, working days, start/end, then the two SLA numbers *inside* that section since they now mean business minutes
3. **Data retention** — raw-payload window with the storage and privacy reasoning stated
4. **Danger zone** — visually separated, owner-only

## Order of work
1. Schema + migration (additive, all defaulted — no backfill)
2. `businessMinutesBetween` + its tests **first**, before anything consumes it
3. SLA sweeper and the age chips move onto it
4. Retention job on the cron
5. Settings UI, sectioned
6. Danger zone last, since it is the only destructive path

## Risks
- **Timezone maths is where this goes wrong.** Building and testing the function before wiring it is deliberate.
- Changing SLA semantics changes when existing leads breach. With business hours on, some currently-breaching leads stop breaching. That is the intent, but it should be stated rather than discovered.
- `payload` becoming nullable touches the ingestion replay path — `processLeadgenEvent` must handle a pruned event by failing clearly rather than crashing.

## Explicitly not in this release
Default currency and locale (`"USD"` in 5 places, `"en-US"` in money formatting) — still hardcoded, still wrong for a non-US team, deliberately deferred. Per-user timezone. Fiscal year. Logo upload, which needs blob storage we do not have.
