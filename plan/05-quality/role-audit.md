# Role and access audit

- **Date:** 2026-08-25 · **Gaps closed the same day** — see "Resolution" below
- **Method:** every exported service function inspected for a guard, then 8 probe tests in `tests/role-audit.test.ts` that exercise each role against real records. The tests assert what the system *actually does*, so the gaps below cannot regress silently.

## The model

`READ_ONLY(0) < REP(1) < MANAGER(2) < ADMIN(3) < OWNER(4)`, checked by `requireRole(ctx, minimum)`. `requireWrite` is `requireRole(ctx, "REP")`.

Across the whole service layer there are exactly three guard shapes: **20× `requireWrite`**, **14× `requireRole(ADMIN)`**, **1× `requireRole(REP)`**.

## What is correct

- **`organizationId` always comes from the signed session**, never from input. This is the property that actually matters and it holds everywhere.
- **READ_ONLY cannot write.** Verified against create, update, delete and deal mutations.
- **Admin surfaces are properly gated** — org settings, pipelines, team, invitations, connections all require ADMIN. REP, MANAGER and READ_ONLY are all refused.
- **Unguarded functions are unguarded by design, and each has a different authenticator:** the ingestion path (tenant resolved from the `Connection`), the cron sweepers (`CRON_SECRET` at the route), signup, `acceptInvitation` (the token *is* the authorization, single-use and expiring), and the notification read functions (scoped to `ctx.userId`, so they can only touch your own).
- **No UI-only permissions.** Every `canEdit` / `canWrite` / `canDelete` prop mirrors a server-side check; nothing is hidden in the client and permitted on the server.

## Three real gaps

### 1. MANAGER is decorative — it grants nothing a REP lacks
Nothing in the codebase checks for MANAGER. The only occurrence is in round-robin assignment, listing it as an eligible owner. A Manager and a Rep are granted an identical set of operations.

This is the clearest miss against any standard CRM, where a manager reassigns work, sees team performance, and overrides a rep. Right now the role exists in the enum, the invite form and the badge, and means nothing.

### 2. There is no record-level visibility at all
Every list filters by `organizationId` only. No query is ever scoped to the caller — `grep 'ownerId: ctx.userId'` finds it used only when *setting* an owner during import, never when reading.

Proved: a REP who owns nothing listed every contact, lead and deal in the organization, then **changed a $50,000 deal to $1 and moved it to Won**. Nothing objected.

`plan/01-architecture/tech-stack.md` promises "record-level visibility (own records vs team vs all)". It was never built. Salesforce, HubSpot and Pipedrive all default a rep to their own records and widen deliberately.

### 3. Delete is inconsistent between one and many
`softDeleteContact` requires only `requireWrite`, so a **REP can delete any contact**. `bulkDeleteContacts` additionally refuses REP. So a rep is blocked from deleting two contacts and permitted to delete them one at a time. Whichever rule is right, both paths should agree.

## Resolution (2026-08-25)

Product owner chose **own-records for REP** and **reps cannot delete**. Implemented across three parallel agents, each owning disjoint files, with verification kept in-house.

**The rule lives in one place** — `src/server/authz.ts`:
- `seesAllRecords(ctx)` — false only for REP. Expressed as a capability, not a `RANK` comparison, because READ_ONLY sits *below* REP but must see everything: it is an oversight role, and scoping it to "records you own" makes it useless.
- `visibleTo(ctx)` / `assignedTo(ctx)` — a Prisma `where` fragment spread **alongside** `organizationId`, never replacing it.
- `requireDelete(ctx)` — MANAGER and above, for one record or many.

**Applied to:** contacts, deals, leads (list, get, update, convert, mark-touched), the pipeline board's nested deals, search across all four entity types, every dashboard figure, tasks, activity logging, and all five bulk actions.

**Two extra gaps the agents found that the audit had missed.** Both reviewers independently flagged that `createContact` and `createDeal` accepted a client-supplied `ownerId` with no role check — so a rep could create a record owned by a colleague and instantly lose sight of it. Now `resolveOwner(ctx, requested)` forces a REP's own id.

**One deliberate exception: companies are NOT owner-scoped.** Scoping them broke the product — `listCompanies` feeds the company picker on New Contact and New Deal, so a rep would get an empty dropdown and no way to file a contact under an existing account. An account is shared context; the contacts and deals hanging off it are the owned records. *Editing* a company is still owner-scoped. This was my instruction being wrong, caught by a test rather than by review.

**Verified:** 20 role tests plus 249 in the full suite, all green. The tests assert the model directly — a rep listing, reading, searching, editing, moving, bulk-reassigning and logging against a record they do not own — so a regression fails loudly rather than silently widening access.

**Still open:** MANAGER remains capability-identical to ADMIN for records (both see everything) and is now distinguished only by being able to delete. A reporting line on `User` would let a manager see *their reports'* records specifically rather than the whole org; that is the next refinement, not shipped.

## Original recommendation, for the record

1. **Decide the visibility model** — this is a product decision, not a technical one, and everything else depends on it. Options: all-visible (today), own-records-only for REP, or team-scoped with MANAGER seeing their reports.
2. **Give MANAGER real capability** once visibility exists — typically: see and reassign everything their reports own, plus bulk actions.
3. **Align the two delete paths** — trivial, but it is a live inconsistency.
4. Consider gating `listConnections` to ADMIN. It does not expose tokens (`encryptedTokens` is never selected), but `lastError` can contain provider error payloads.

Nothing here is a tenant-isolation failure. Every gap is *within* an organization.
