# Feature: Tasks and record editing

- **Status:** Shipped 2026-08-24
- **Owner role:** crm-backend-dev + crm-ux-designer
- **Milestone:** M1

## Problem
Two holes, both fundamental:

1. **Records could not be edited.** You could create a contact, company, or deal and then never change it. The `updateContact` / `updateCompany` services existed with no UI at all, and `updateDeal` did not exist.
2. **Tasks did not exist.** The `Task` model had sat unused since M0. A CRM without follow-ups is missing the thing a rep opens it for each morning.

## Inline editing
Click a field on a record page, type, Enter or blur to save, Escape to cancel.

- **Read mode is plain text, not an input.** A page of empty boxes reads as a form to fill in, when most of the time the rep is only looking.
- **Blur saves rather than discards.** Losing a typed value because you clicked away is the single most annoying thing a CRM can do.
- **A rejected value snaps back** to what was actually stored, so nothing looks saved when it is not.
- **The field name is allowlisted per entity in the server action**, not just in the schema — the field name arrives from the client, and nothing from a client decides which column gets written.
- `READ_ONLY` sees the same values as static text.

## Tasks
Per-record panels on contacts and deals, plus a `/tasks` page with Mine / Everyone / Done.

- **Grouped Overdue / Today / Upcoming / No date**, because that is how a rep works a day — a flat list sorted by date is not the same thing.
- **Undated tasks sort last.** A someday is not the most urgent thing on the list.
- **Ticking a checkbox is optimistic**; the round trip happens behind it.
- **You are never notified about your own task** — only about one somebody else assigned you.
- **At most one linked record**, and it must belong to your organization.
- Overdue count sits in the sidebar in red, since that number only ever means something slipped.

### Known limitation
"Today" is the **server's** calendar day. A rep in a different timezone sees tasks roll over at the wrong local hour. Fixing it properly means carrying the viewer's timezone or bucketing in the browser. Documented in `bucketFor` and deliberately not papered over.

## Two bugs this work exposed
1. **`createContact` required an email.** The New Contact form does not mark email required, so submitting a name-and-phone contact failed validation — and plenty of real contacts have no email. Now optional; a malformed address is still rejected. Regression test added.
2. **A render callback across the RSC boundary.** `EditableField` took a `render` function as a prop from a Server Component. Functions do not serialise — only elements do. Replaced with a declarative `display` type (`email` / `tel` / `url` / `money` / `date`), which is better design anyway: the client owns presentation.

## Verified
19 new tests (185 total): due-date bucketing written relative to `now` so it holds in any timezone, default assignee, no self-notification, assignee notification, record attachment, multi-link rejection, cross-tenant record and assignee rejection, complete/reopen, per-user overdue count, undated ordering, mine-vs-everyone, cross-tenant complete/delete, permission floor.

Live: `/tasks` renders with all three tabs; contact, company, and deal detail pages each render inline-edit affordances and a task panel.

## Not built
- No task editing (title/date) once created — delete and re-add.
- No recurring tasks, reminders, or calendar sync.
- Inline editing does not cover owner or company reassignment (those need a picker, not a text field).
