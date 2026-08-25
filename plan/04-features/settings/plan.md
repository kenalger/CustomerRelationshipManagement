# Feature: Organization settings and pipeline administration

- **Status:** Shipped 2026-08-24
- **Owner role:** crm-backend-dev + crm-ux-designer
- **Milestone:** M2 / M3a

## Problem
The SLA policy and the sales process were both hardcoded defaults in database columns with no way to change them. A manager could not adjust the speed-to-lead target, rename a stage, change a probability, or reorder the process — all of which are the first things a real team wants to do.

## What shipped

**`/settings/organization`** — workspace name plus the two SLA numbers the cron sweeper enforces.

**`/settings/pipelines`** — multiple pipelines, one default; rename; add, edit, reorder, and delete stages with name, probability, and open/won/lost outcome; per-stage deal counts.

## Decisions

- **Escalation must come strictly after the first-touch target.** Equal values would fire both SLA stages on the same sweep, so the nudge would never be seen on its own. Rejected with a message on the specific field.
- **A pipeline is never created empty.** New pipelines come with New / Won / Lost, because a pipeline with no stages cannot hold a deal and would break the board and the conversion flow.
- **Exactly one default pipeline, always** — clearing the flag across the org and setting it in the same transaction.
- **Reordering parks every stage on a negative order first, then writes the final positions.** `Stage` has a unique constraint on `(pipelineId, order)`, so a naive swap collides mid-transaction. Two passes avoid it without needing a deferrable constraint. The test reverses the entire list, which is the worst case.
- **A reorder must be a full permutation of that pipeline's stages.** A partial list would leave gaps; a foreign id would move another pipeline's stage. Both are rejected, and there is a test that injects a stage from a different tenant.
- **A stage holding deals cannot be deleted.** The foreign key is `Restrict`, so the database would throw an opaque error; the service catches it first and names the count. The delete button is disabled with a tooltip, so the person knows before clicking rather than after.
- **Stages are reached through their pipeline**, which is how tenancy is proven — `Stage` has no `organizationId` of its own.
- **Settings changes revalidate the pages that read them** — the board, the overview, and the lead queue all render the SLA numbers or the stage list.

## Verified
18 tests: SLA bounds and ordering, permission floor (a Manager cannot change org settings), no empty pipelines, duplicate name rejection, single-default invariant, append order contiguity, full-reversal reorder, non-permutation and cross-tenant reorder rejection, delete guarded by deal count, delete of an empty stage, and cross-tenant rename/update/delete.

Live: both pages render; the first stage correctly has no "move up"; an equal-window SLA was rejected with the right message; changing the policy to 10/45 propagated to the overview banner on the next render.

## Pipeline editor rebuild (2026-08-24)

Owner feedback: setting up a pipeline was "hard to understand".

**What was wrong.** Every stage row was a live form — a name input, a probability input, an outcome select and its own Save button. Eleven visible controls per pipeline, permanently. With six stages that is roughly eighteen inputs on screen at once, so the page read as a form to fill in rather than a pipeline to understand. Won and Lost sat in the same list as the open stages despite behaving completely differently, and "Probability" appeared as a bare number with nothing saying what it did.

**What it is now.**

- **Read mode by default.** Zero visible inputs on load — verified: 0 text inputs and 0 selects in the initial render, down from 11 per pipeline. Editing is opt-in per row, and the row's controls stay hidden until hover or keyboard focus.
- **The funnel is separated from the outcomes.** Open stages render as a numbered `<ol>` under "The funnel"; Won and Lost sit under "How a deal closes" with `counts as won` / `counts as lost` tags. They are terminal and not part of the order, so they are not in the reorderable list.
- **Win chance, not "probability".** Shown as a small bar plus the number, so the shape of the funnel is legible at a glance. The copy says what it actually does: *"a $10,000 deal at 25% counts as $2,500"*. That sentence is the thing nobody could infer from a number field.
- **A pipeline with no won/lost stage now says so** — in danger tone, because deals in it can never be closed and nothing else in the UI would reveal that.
- **Rename and "make default" moved into an overflow menu.** A permanently-editable name input in the header read as unfinished.
- **"Add a stage" and "New pipeline" are buttons that reveal their form**, rather than forms sitting open waiting to be filled.
- **Reorder is labelled "Move earlier / Move later"**, not up/down arrows over an index column — the direction that matters is position in the process.
- New pipelines explain what they come with: *"Starts with New, Won and Lost so it works straight away."*

## Not built
- No archive/delete for a whole pipeline (stages only).
- No per-source or per-pipeline SLA policy — one policy per organization.
- No business-hours awareness: a lead arriving at 2am starts its clock immediately.
- Reordering is arrow buttons, not drag-and-drop. The board has DnD; this list does not.
