# Feature: connections, imports and automation

- **Status:** Draft — automation is buildable now; two of the four asks are blocked on things that are not code.
- **Last updated:** 2026-08-26
- **Research:** `plan/07-research/crm-automation.md`, `plan/07-research/meta-lead-ads-api.md`

## What was asked, and what is actually true today

| Ask | State |
|---|---|
| Accept data from Facebook | **Pipeline built, front door missing.** |
| Connections screen | Built, but nothing can create a connection through it. |
| Accept data from Google Sheets | **Nothing.** |
| Accept imports | **Built** — CSV importer at `/contacts/import`. |
| Automation | **Nothing.** No rules engine of any kind. |

### Facebook: the pipeline is real, the front door is not

Verified in the codebase, not assumed. `src/server/integrations/facebook/` has a signature verifier (HMAC over the **raw** body), a payload schema, a normalizer with field aliases, a Graph client that classifies a dead token by Meta's own `error.code: 190` rather than by HTTP status, and a two-phase processor — the webhook carries only a `leadgen_id`, so the lead is fetched separately. `/api/webhooks/facebook` is live. Dedupe, retry and dead-lettering all work and are tested.

**What is missing is the OAuth flow.** There is no route anywhere that starts a Facebook authorization, and `connection.create` appears nowhere in the codebase — the one connection in the dev database was inserted by hand during live testing, and it is sitting in `NEEDS_REAUTH`. So the Connections screen can display and repair connections it cannot create.

That is one route pair — `/api/connect/facebook` and its callback — plus a "Connect a page" button. It is not large. **But it cannot be finished without Meta App Review**: `pages_show_list`, `leads_retrieval`, `pages_read_engagement` and Business Verification are required before any account other than a developer of the app can connect. That is a submission and a wait, not an afternoon.

### Google Sheets: cheaper than it looks, if scoped honestly

Two very different features share the name:

1. **Import a sheet once** — the user pastes a share link, we read it, map columns, import. Uses the CSV importer's existing mapping and dedupe. Needs only a read of a shared sheet.
2. **Keep a sheet in sync** — a connection, a cursor, a polling job, conflict rules.

(1) is a small feature on top of what exists. (2) is a distributed-systems problem: two writers, no transaction, and an obvious question about what happens when both sides edit a row. **Recommendation: build (1), and do not call it "sync".**

Even (1) needs a Google OAuth client and a verification review if we ask for private-file scopes — the same class of blocker as Meta, and the `google-casa-assessment.md` research note is still unwritten. A published "anyone with the link" sheet read as CSV avoids OAuth entirely and covers most of the real use.

## The automation engine — the part that is genuinely buildable now

Research is in the note; the design below is the small honest subset of it.

### Model

```
Automation      name, description, enabled, trigger, conditions Json, runLimit, createdById
AutomationStep  automationId, position, action, config Json
AutomationRun   automationId, recordId, recordKind, status, error, startedAt, finishedAt
AutomationLog   runId, stepPosition, outcome, detail        // what actually happened
```

### Triggers — only events our services already emit

| Trigger | Fires from |
|---|---|
| `LEAD_CREATED` | `ingestLead` |
| `LEAD_STATUS_CHANGED` | `setLeadStatus` / `convertLead` |
| `DEAL_STAGE_CHANGED` | `moveDealToStage` |
| `TASK_COMPLETED` | `toggleTask` |
| `SCHEDULE_DAILY` | the cron sweep |

**`LEAD_CREATED` and `LEAD_STATUS_CHANGED` are separate triggers**, and a status set during creation fires only the first. Attio documents exactly this trap: "record updated" that also fires on creation double-fires every rule on every new record.

### Conditions — reuse the segment vocabulary, do not invent a second one

A rule's condition is the same question a segment asks, aimed at one record. `lib/validation/segments.ts` already has a closed, `.strict()`, injection-safe filter document that translates to a Prisma `where`. Reusing it means one language to learn, one place to fix, and no chance of the two disagreeing about what "no activity in 21 days" means.

### Actions — every one is an existing service call

`ASSIGN_OWNER` · `SET_FIELD` · `ADD_TAG` · `CREATE_TASK` · `NOTIFY` · `ENROL_IN_CAMPAIGN`

### Loop protection, decided up front

Three rules, all mandatory:

1. **A record runs a given automation at most once per trigger event.** Keyed on `(automationId, recordId, triggerEventId)`.
2. **Actions taken by an automation do not re-trigger automations.** The run carries a marker; the dispatcher drops events raised inside a run. Without this, "when status changes → set status" is an infinite loop, and it is the *first* rule a new user writes.
3. **A per-automation daily cap**, defaulted and configurable. A runaway rule should stop and say so rather than write 40,000 rows.

### Roles

Writing an automation and turning it loose are different acts — HubSpot splits exactly these permissions. Draft/edit: MANAGER+. **Enable/disable: ADMIN+.** Delete: ADMIN+.

### Not in the first version

Branching, delays, outbound webhooks, AI steps, multi-object joins. Attio has all of them. None is needed for "when a Facebook lead arrives scoring over 70, assign it to the duty rep and raise a call task", and each multiplies the states a run can be in — which is the thing that makes an automation engine impossible to debug.

## Sequence

1. **Automation engine** — schema, service, dispatcher, run log, tests. Blocked on nothing.
2. **Automation UI** — list, editor, run history.
3. **Google Sheets import** via published-link CSV. Blocked on nothing.
4. **Facebook connect flow.** Code is small; shipping is blocked on Meta App Review.
5. Google OAuth import of private sheets — only if (3) proves insufficient.

## Decisions needed

1. **Sheets: one-time import, or two-way sync?** I recommend import, and say so in the UI, because "sync" promises conflict resolution we would not be building.
2. **Meta App Review — has it been started?** Nothing else unblocks a real Facebook connection, and the review is measured in weeks.
3. **Should an automation be able to email?** Everything else in the action list is internal. Sending re-opens the whole provider question from the outreach plan.
4. **Daily cap default.** I suggest 500 records per automation per day: high enough for a real import, low enough that a mistake is survivable.
