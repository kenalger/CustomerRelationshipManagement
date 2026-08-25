# Feature: Speed-to-lead SLA

- **Status:** Shipped 2026-08-23
- **Owner role:** crm-product-analyst + crm-backend-dev
- **Milestone:** M3a

## Problem
Notifying an owner when a lead arrives is not enough. The failure mode is not the rep being uninformed — it is the rep being busy. A lead sitting unworked is the most expensive failure this product has, and it is the reason the company wanted a CRM.

## Solution
Two stages, both keyed on `Lead.firstTouchedAt` being null, swept by the existing cron:

1. **Nudge** the owner after `Organization.slaFirstTouchMinutes` (default 30).
2. **Escalate** to Owners, Admins, and Managers after `slaEscalateMinutes` (default 120).

## Decisions
- **`slaNotifiedAt` / `slaEscalatedAt` live on the Lead, not on the notification.** Reading an alert must not re-arm the nudge — only *working* the lead clears it. Using the notification dedupe key alone would have re-nudged every time someone glanced at their inbox.
- **A lead is never escalated to the person sitting on it.** Escalation exists to route around the owner.
- **`escalated` and `escalationAlerts` are separate counters.** A solo organization has nobody to escalate to; reporting "2 escalated" there would imply someone was warned when nobody was.
- **Policy is per organization.** Different sales motions have different reasonable response times; 30 minutes is a default, not a law.
- **Both sweeps share one cron slot.** The free plan allows few, and both are cheap indexed scans. They run under `Promise.allSettled` so a failure in one cannot skip the other.

## Acceptance criteria
- **Given** a lead untouched past the first-touch target, **when** the sweep runs, **then** its owner is notified exactly once.
- **Given** the owner reads that notification without acting, **when** the sweep runs again, **then** no second nudge is created.
- **Given** a lead untouched past the escalation window, **when** the sweep runs, **then** every Owner/Admin/Manager *except the lead's owner* is notified.
- **Given** a rep marks the lead worked or converts it, **when** the sweep runs, **then** no SLA notification is created.

## Verified
10 tests in `tests/sla.test.ts`, plus live: backdated Acme's two untouched leads to 200 minutes, ran the cron, got `{"nudged":2,"escalated":2}`, and confirmed the dashboard banner and the "has been waiting 200 minutes" notification.

## Not built
- ~~No UI to change the policy~~ — shipped 2026-08-24 at `/settings/organization`.
- No business-hours awareness. A lead arriving at 2am starts its clock immediately.
- No per-source or per-pipeline policy.
