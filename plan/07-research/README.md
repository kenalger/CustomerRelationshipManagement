# Research notes

What the team learned from the web, so nobody re-discovers it.

File one note per topic using `plan/_templates/research-note.md`. Every claim carries a source URL and the date it was read.

**Source priority:** official vendor docs and changelogs → dependency docs and GitHub issues → engineering blogs and talks → YouTube walkthroughs → forum posts. Prefer sources from the last 18 months; date anything older.

Anything that couldn't be verified against a real source is marked `UNVERIFIED` — never written as confident fact.

## Topics needed before M3 (lead ingestion)
- [x] `meta-lead-ads-api.md` — **done 2026-08-23.** Payload shapes confirmed against Meta's own docs; five App Review permissions listed; 90-day retention limit found.
- [ ] `gmail-api-sync.md` — OAuth scopes, watch/history incremental sync, push notifications, quota units
- [ ] `microsoft-graph-mail.md` — delta queries, subscription renewal, scopes
- [ ] `email-parsing-inbound.md` — inbound parse services, threading, signature/reply stripping, spam handling
- [ ] `webhook-security.md` — signature verification per provider, replay protection, idempotency keys
- [ ] `lead-dedupe-strategies.md` — how incumbent CRMs match and merge; normalization rules
- [ ] `crm-automation-ux.md` — how HubSpot/Pipedrive/Attio/Close present workflow builders

## Added 2026-08-26
- [x] `sales-kpis-and-quotas.md` — **partial.** Goodhart's law and the committed-vs-aspirational split are well sourced and are the load-bearing findings. **Benchmark numbers are NOT established** — the session's web search budget was exhausted (200/200) and every quota/attainment source I could name directly returned 403 or 404. No default quota or coverage ratio may ship as a hardcoded constant until this is finished.

## Added by the 2026-08-23 scoping decisions
- [ ] `meta-app-review.md` — permissions needed per surface, review timeline, Business Verification, tech-provider vs. own-app model
- [ ] `meta-messenger-api.md` — message webhooks, `pages_messaging`, 24-hour window, turning a conversation into a lead
- [ ] `meta-platform-terms-comments.md` — what Platform Terms actually permit for comment data; **legal gate for M3d**
- [ ] `google-casa-assessment.md` — restricted-scope requirements, current cost, timeline, assessor options, annual renewal
- [ ] `microsoft-graph-publisher-verification.md` — verification + admin consent for org-wide mail access
- [ ] `rules-engine-design.md` — how HubSpot/Pipedrive/Attio model trigger→condition→action; data model for user-composable rules
