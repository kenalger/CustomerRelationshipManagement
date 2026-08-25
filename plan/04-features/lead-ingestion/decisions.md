# Lead ingestion — decisions taken 2026-08-23

Answers from the product owner in the scoping session. These are **decided**; changing one requires an ADR.

| # | Question | Decision |
|---|---|---|
| D1 | Which Facebook surface? | **All of them** — Lead Ads forms, Page DMs/Messenger, and post comments |
| D2 | Email mechanism? | **Full mailbox sync** via Gmail API + Microsoft Graph OAuth |
| D3 | Lead lifecycle? | **Lead is a first-class entity.** Stays a Lead with a status until a human qualifies it; converting creates Contact + Company + Deal |
| D4 | Automation scope? | Instant assignment + notification, auto-create deal on qualify, **and a full if/then rules builder** |

## Consequences the owner should have in front of them

### Honest cost of D1 + D2 + D4 as one milestone
| Work | Estimate | Gated by |
|---|---|---|
| Ingestion pipeline + Lead entity + dedupe | 3 weeks | — |
| Facebook Lead Ads | 2 weeks | Meta App Review (weeks, external) |
| Messenger ingestion | 2 weeks + intent parsing | separate Meta permission + review |
| Comment ingestion | 1 week | **legal gate — see below** |
| Gmail sync | 3 weeks | Google CASA assessment (weeks, $) |
| Microsoft Graph sync | 2 weeks | Microsoft publisher verification |
| Assignment + notification | 1 week | — |
| Auto-create deal | 3 days | — |
| Rules builder UI + engine | 4–8 weeks | — |

That is roughly **five to six months of sequential work with three external approval processes on the critical path**. It is not one milestone. It is split below — nothing is dropped, only ordered.

### D1 comment harvesting — flagged, not blocked
Scraping post commenters for outreach has two real problems the team cannot engineer away:
1. **Meta Platform Terms** restrict using Platform Data to build contact lists for marketing outreach.
2. **Consent.** Someone commenting on a post has not agreed to be contacted. Under GDPR that is processing without a lawful basis; several US states' laws are moving the same direction.

Also worth knowing before building it: **comments contain no email and no phone.** A "lead" from this source is a name and a string of text. Its practical value is a manual-outreach prompt, not a contactable record.

**Gate:** this ships only after the product owner confirms a legal review, and only as an internal prompt-to-engage — never auto-enrolled into outbound sequences. Tracked as Q13.

### D2 mailbox sync — the approval is the schedule
Gmail's `gmail.readonly` is a **restricted scope**. Shipping it to customers requires an annual third-party CASA security assessment. Budget and lead time are real and must be started *now*, in parallel with M0, or it becomes the thing that holds the release. Owner: devops + product. Tracked as Q14.

This also makes the CRM a processor of every email in a rep's inbox — including mail unrelated to any customer. `crm-security` owns the scoping, retention, and DPA position before a line of sync code is written.

## Revised sequencing — everything survives, order changes

- **M3a — Pipeline + Lead Ads (~5 wks).** `IngestionEvent` → normalize → dedupe → assign. Facebook Lead Ads as the first source. Lead entity, queue, statuses, convert flow. Instant assignment + notification. Auto-create deal on qualify. *Meta App Review starts week 1.*
- **M3b — Email (~5 wks, gated on CASA).** Gmail then Microsoft Graph. Auto-logging against contacts. *CASA engagement starts during M0.*
- **M3c — Messenger (~2 wks).** Conversation → lead, with a human triage step.
- **M3d — Comments (~1 wk, gated on legal sign-off).** Internal engagement prompts only.
- **M4 — Rules builder (~6 wks).** Trigger → condition → action UI over the ingestion event stream.

The M3a pipeline is built as source-agnostic from day one, so M3b–M3d are each one normalizer plus one auth flow, not new pipelines.

## Still open — needed before M3a starts
| # | Question | Owner |
|---|---|---|
| Q5 | Exact dedupe rule. Email-only, or fuzzy on name + company? | product |
| Q6 | On duplicate: merge, link, or reject? Who resolves field conflicts? | product |
| Q8 | Assignment rule: round-robin, territory, product line? Per-source overrides? | product |
| Q10 | Volume at launch and at 12 months? Decides queue architecture. | product |
| Q11 | Retention of `rawPayload` — how long do we keep the Facebook/email original? | security |
| Q12 | Meta down or token dead: what does the customer see, who gets paged? | devops |
| Q13 | Legal review of comment harvesting — approved or dropped? | product |
| Q14 | Who owns the Meta app and the CASA budget, and when does each start? | product + devops |
