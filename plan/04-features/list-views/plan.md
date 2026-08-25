# Feature: Sorting, row selection, bulk actions

- **Status:** Shipped 2026-08-24
- **Milestone:** M1 / M5
- **Source:** `plan/07-research/crm-ui-mechanics.md` — three of the load-bearing gaps: no sort, no row selection so no bulk actions.

## Sorting
Column headers on leads and contacts sort via the **URL**, not component state, so a sorted view is shareable, survives a refresh, and Back undoes it. Clicking the active column flips direction; clicking another starts ascending. Active filters ride along, so sorting does not clear the search.

- **Sortable columns are an allowlist.** `orderBy` reaches the query builder, so accepting whatever the URL says would let a crafted param sort by — and therefore probe the ordering of — any column, `passwordHash` included.
- **Every sort carries a stable `id` tiebreak.** Without one, two rows sharing a sort key can swap places between pages and a record is silently skipped.

## Row selection
- Header checkbox with a real **indeterminate** state when only part of the page is selected.
- **Shift-click extends a range** from the last clicked row, the way every spreadsheet and mail client behaves. The range is a slice of what is on screen, not of the whole table.
- `onClick` rather than `onChange` on row checkboxes, because `onChange` does not carry `shiftKey`.

## Bulk actions
Leads: assign an owner, mark worked, convert, mark junk. Contacts: assign an owner, delete.

- **The bar is anchored to the bottom of the viewport.** A rep scrolls while selecting; a bar pinned above the table is unreachable exactly when it is needed.
- **Partial success is reported, not hidden.** "12 updated, 3 skipped" with the first error, because a bulk operation half-failing is the normal case.
- **Every write re-scopes by `organizationId` in the `updateMany` itself**, rather than trusting the id array. The ids come from the client, so a crafted array is the obvious attack — a foreign id simply matches nothing and is counted as failed.
- **Ids are deduplicated** before counting, so three copies of one row is one success.
- **200-record cap** per action, refused loudly rather than hanging.
- **`bulkConvertLeads` is sequential on purpose.** Each conversion is a multi-table transaction creating a company, contact and deal; 200 in parallel would exhaust the pool and deadlock on the company upsert.
- **Marking a lead junk or worked stops its SLA clock**, otherwise the sweeper keeps nagging about leads already triaged.
- **Bulk delete is not a rep action** — a Rep is refused. It is a soft delete, so names still resolve on the records they touched.
- **One audit row per batch**, not per record.

## Three bugs found while building this
1. **A crafted `sort` param rendered an error boundary.** `z.enum().default()` only covers a *missing* value — an unknown one still threw, so a stale bookmark broke the page. Now `.catch()`, which degrades to the default ordering. Same for `dir`, `page` and `perPage`. The allowlist still decides what reaches `orderBy`. A malformed `ownerId` deliberately still throws, because that is a caller bug rather than a stale link.
2. **`"use server"` files may only export async functions.** A leftover sync arrow export failed the Turbopack build with a bare "Ecmascript file had an error".
3. **Concurrent interactive transactions corrupt the pg protocol.** `Promise.all` over `ingestLead` produced `08P01: bind message supplies 9 parameters, but prepared statement "" requires 0`. The product never does this — the webhook receiver and both sweepers are loops — so the seeding in the test was made sequential. Worth knowing before anyone parallelises a batch.

Also fixed one of my own test bugs worth recording, because it silently weakened an assertion: `"c1".padEnd(25,"0")` and `"c10".padEnd(25,"0")` are **the same string**, so a 201-id fixture collapsed below the 200 cap and the "refuses an oversized selection" test passed for the wrong reason. Padded on the left instead, with an assertion that the set really is 201.

## Verified
18 new tests (229 total). Live: selection checkboxes and select-all render, sorting by company and by email genuinely reverses the order, and `?sort=passwordHash` now renders the list rather than an error.

## Not built
- No saved views — sort and filters live in the URL but cannot be named and stored.
- Companies has sortable headers but no selection or bulk actions.
- No virtualization; a 10,000-row list will still be slow.
- No keyboard row navigation, and no `Space` to peek.
