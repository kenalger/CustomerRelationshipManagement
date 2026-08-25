# Feature: Currency safety, deal aging, loss reasons, activity recency

- **Status:** Shipped 2026-08-24
- **Milestone:** M2
- **Source:** `plan/07-research/crm-ui-mechanics.md` — the "gaps in a naive build" section, assessed against our own schema.

## The bug that mattered most

`getPipelineBoard`, `getDashboard`, the board and the deals page all summed `Number(deal.value)` across rows while `currency` was selected and ignored. `createDeal` accepts any three-letter currency, so this was reachable immediately: **€30,000 plus $60,500 displayed as $90,500.** Every headline figure in the product was wrong the moment a second currency existed.

Fixed in `src/lib/money.ts`: a total is a *set* of per-currency amounts, not a number. We have no FX rates and inventing them would be worse than not converting, so the UI shows the dominant currency and discloses the rest (`$60,500 +1 more`, and "2 currencies — totals shown in USD" on the overview). The single-currency case — which is almost everyone — renders identically to before. `unsafeTotal` exists on the type and is documented as never-display.

Verified live: created a EUR deal alongside the USD ones and confirmed the header reads `$60,500 +1 more` rather than `$90,500`.

## Three schema gaps closed

| Field | Why it was load-bearing |
|---|---|
| `Deal.stageEnteredAt` | Without it there is no days-in-stage and no way to see a rotting deal — the thing a manager actually wants from a pipeline. |
| `Deal.lostReason` | `Stage.isLost` records *that* a deal was lost. Nothing recorded *why*, so every loss looked like every other. |
| `Contact.lastActivityAt` / `Company.lastActivityAt` | "Who have I not touched in 30 days" needed a join against every activity. Now one indexed scan. |

## Decisions
- **A loss requires a reason.** Moving a deal into a lost stage without one is refused. Pipedrive is the only mainstream CRM with this mandatory, and it is the field that makes win/loss analysis possible at all.
- **Dragging a card into a lost stage does not mark it lost.** A drag has nowhere to type a reason, so the board declines and offers a link to the deal page. Silently losing the reason, or inventing a blank one, would be worse than the extra click.
- **`lastActivityAt` only moves forward.** Backfilling a call from three months ago must not make a record look staler than it is.
- **The reason clears** when a deal comes back out of a lost stage, along with `closedAt`.
- **Aging thresholds are 14 and 30 days**, amber then red, and the colour is always accompanied by the number.

## Verified
11 new tests (203 total): stage-entry stamping, clock reset on every move, refusal of a missing and a whitespace-only reason, reason stored and written to the timeline, reason cleared on reopen, won needing no reason, recency starting null (never-contacted is not contacted-long-ago), recency advancing, recency refusing to move backwards, and the 30-day stale query.

## Not built
- No rotting *rule* per pipeline — thresholds are hard-coded at 14/30 rather than configurable per stage the way Pipedrive does it.
- No win/loss reporting over `lostReason` yet; the data is being captured for it.
- No stale-contact view, though the index and column now exist.
- Lead values are not currency-aware because leads carry no amount.
