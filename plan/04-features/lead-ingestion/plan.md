# Feature: Lead ingestion + integrations

- **Status:** M3a partly built (see `built.md`). Q1/Q3/Q7/Q9 answered in `decisions.md`; Q5/Q6/Q8/Q10–Q14 still open.
- **Owner role:** crm-product-analyst, with crm-integrations-dev and crm-architect
- **Milestone:** M3
- **Last updated:** 2026-08-23

## Problem
Leads arrive from Facebook lead forms and from email, and today they land in an inbox or a spreadsheet. Nobody owns them, nobody knows how long they've been sitting there, and duplicates pile up. Speed-to-first-contact is the single strongest predictor of conversion for inbound B2B leads, and the current process measures it in hours or days.

## Proposed solution
One ingestion pipeline, many sources.

Source (Facebook / email / CSV / webhook)
↓
IngestionEvent — raw payload stored, idempotent on provider externalId
↓
Normalize — map provider fields to our Lead shape
↓
Dedupe — match against existing Leads and Contacts
↓
Assign — routing rules pick an owner
↓
Lead created (or merged) + notification + SLA timer starts
↓
Automation rules fire on the event

Adding a source means writing one normalizer, not a new pipeline. Automation is a consumer of the event stream, not a special case bolted onto Facebook.

## Scope
Decided 2026-08-23 — full rationale, costs, and gates in **`decisions.md`**.

### In scope, sequenced (nothing dropped)
- **M3a** source-agnostic ingestion pipeline, `Lead` as a first-class entity with a triage queue and convert flow, Facebook **Lead Ads**, dedupe, rule-based assignment + notification, auto-create deal on qualify
- **M3b** full mailbox sync — Gmail API + Microsoft Graph, auto-logging email against contacts
- **M3c** Messenger / Page DM ingestion with a human triage step
- **M3d** post-comment ingestion — **gated on legal review**, internal engagement prompts only, never auto-outbound
- **M4** user-composable trigger → condition → action rules builder

### Not in this release
- LinkedIn, Google Ads, TikTok lead forms
- Two-way sync — we ingest, we never write back to Meta
- AI lead scoring or third-party enrichment

## Acceptance criteria *(draft — cannot finalize until the questions below are answered)*
- **Given** a connected Facebook page, **when** a lead form is submitted, **then** a Lead exists in the correct org with an owner assigned, within 60 seconds.
- **Given** the same webhook is delivered twice, **when** both are processed, **then** exactly one Lead exists.
- **Given** an inbound lead whose email matches an existing Contact, **when** it is ingested, **then** no duplicate is created and the activity is attached to the existing record.
- **Given** a revoked or expired token, **when** sync fails, **then** the connection shows unhealthy, an admin is notified, and no lead is silently dropped.
- **Given** org A's connection, **when** its leads are ingested, **then** no user in org B can see them.

## Success metric
Median time from form submission to lead-with-an-owner-in-CRM under 60 seconds; duplicate rate under 2%; zero silently dropped leads.

## Open questions
Q1/Q3/Q7/Q9 are answered in `decisions.md`. Q5, Q6, Q8, Q10, Q11, Q12 remain, plus two new blockers raised by those answers:

| # | Question | Why it blocks | Owner |
|---|---|---|---|
| Q13 | Legal review of comment harvesting — approved or dropped? | Meta Platform Terms + GDPR lawful basis; comments carry no email or phone | product |
| Q14 | Who owns the Meta app and the Google CASA budget, and when does each start? | Both are multi-week external approvals on the critical path | product + devops |

## Research required *(before any code)*
- `plan/07-research/meta-lead-ads-api.md`
- `plan/07-research/gmail-api-sync.md`
- `plan/07-research/microsoft-graph-mail.md`
- `plan/07-research/email-parsing-inbound.md`
- `plan/07-research/webhook-security.md`
- `plan/07-research/lead-dedupe-strategies.md`
