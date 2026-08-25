# Feature: CSV contact import

- **Status:** Shipped 2026-08-24
- **Owner role:** crm-integrations-dev
- **Milestone:** M3a

## Problem
Every company already has its list somewhere — a spreadsheet, a Salesforce export, a Mailchimp dump. Without import, adopting this CRM means retyping hundreds of rows, which means it does not get adopted.

## Flow
Three steps at `/contacts/import`:

1. **Choose a file** — drag or browse. Parsed in the browser with `papaparse`; nothing reaches the server until the mapping is confirmed, so no file storage is needed at all.
2. **Map columns** — auto-guessed from headers via an alias table (`Job Title` → title, `Organisation` → company, and so on), with a five-row preview rendered exactly as it will import. Each target field can only be claimed by one column; a second would silently win.
3. **Result** — created / updated / skipped / failed as four figures, plus a per-row error list.

## Decisions
- **Partial failure is the normal case.** Real spreadsheets have blank rows, malformed emails, and duplicates. One bad row never aborts the run.
- **Row numbers count the header as line 1**, so the number in the error list matches the line in the person's file. Off-by-one here makes the whole panel useless.
- **Error messages are written for whoever owns the spreadsheet.** "First name is empty — every contact needs at least a first name", not `firstName: expected string, received null`. A test asserts no Zod internals leak through.
- **Dedupe by email only.** Fuzzy name matching would silently merge distinct people, which is unrecoverable. Rows with no email are always created.
- **Duplicates within one file** are caught too, case-insensitively, so a spreadsheet that repeats someone does not create them twice.
- **Companies are resolved once and cached per run.** A 2,000-row file from one customer would otherwise issue thousands of identical queries.
- **The mapping is validated against a fixed field allowlist.** A crafted mapping cannot reach `organizationId` or any other column; there is a test that tries.
- **One audit row per batch**, not per contact — the batch is the event worth recording.
- **No silent caps.** Over 5,000 rows the import is refused outright with a message saying so, and the wizard warns and disables the button before you try. A half-import is worse than none, because you cannot tell what landed.

## Verified
13 tests: clean import, company dedupe, per-row failures with correct line numbers, blank-row padding, skip vs. update on duplicate, in-file dedupe, no-email rows, missing required mapping, crafted-mapping rejection, oversized-file refusal with no partial write, batch audit, permission floor, tenant isolation.

Live, against a deliberately messy 8-row CSV — quoted commas, a missing first name, a malformed email, an in-file duplicate, a blank row:
`created 2, skipped 3, failed 2, companiesCreated 3`, errors on lines 5 and 6, and `"Northwind Logistics, Inc."` parsed intact.

## Not built
- Leads and companies import (contacts only). The pipeline is reusable — it needs a normalizer and a target service.
- XLSX. CSV only.
- Undo. There is an audit row but no rollback.
- Resumable large imports; over 5,000 rows the file must be split.
