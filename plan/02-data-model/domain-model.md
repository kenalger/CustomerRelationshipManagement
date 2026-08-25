# Domain model

Source of truth alongside `prisma/schema.prisma`. If they diverge, that's a bug — fix both in one PR.

## Tenancy
`Organization` is the tenant. Every table below except `Organization` carries `organizationId`, a foreign key, and a composite index leading with it. No query crosses an org boundary.

## Core entities

| Entity | Purpose | Key fields |
|---|---|---|
| `Organization` | Tenant | name, slug, plan, settings |
| `User` | A person with a login | email, name, role, organizationId |
| `Company` | Account / business | name, domain, industry, size, ownerId |
| `Contact` | A person at a company | firstName, lastName, email, phone, companyId, ownerId |
| `Lead` | Unqualified inbound, pre-conversion | source, sourceRecordId, rawPayload, status, ownerId, dedupeKey |
| `Pipeline` | A named sales process | name, isDefault |
| `Stage` | Ordered step in a pipeline | name, order, probability, isWon, isLost |
| `Deal` | Revenue opportunity | title, value (Decimal), currency, stageId, contactId, companyId, ownerId, expectedCloseDate |
| `Activity` | Something that happened | type (call/email/meeting/note), subject, body, occurredAt, relatedTo (polymorphic) |
| `Task` | Something to do | title, dueAt, assigneeId, completedAt, relatedTo |
| `EmailMessage` | Synced email | externalId, threadId, direction, from, to, subject, snippet, contactId |
| `CustomField` | Per-org extra field | entity, key, label, type, options |
| `Tag` / `Tagging` | Cross-cutting labels | name, color |
| `AuditLog` | Who changed what | actorId, entity, entityId, action, before, after, at |
| `Connection` | An OAuth link to a provider | provider, externalAccountId, encryptedTokens, scopes, status, lastSyncAt |
| `IngestionEvent` | One raw inbound payload | connectionId, provider, externalId (unique per org), payload, status, error, receivedAt |

## Conventions
- Money: `Decimal(18,2)` + explicit `currency`. Never `Float`.
- Timestamps: UTC, `createdAt` / `updatedAt` everywhere.
- Deletes: soft (`deletedAt`) for anything a rep can see.
- Dedupe: `Lead.dedupeKey` is a normalized hash (lowercased email, else E.164 phone, else name+company). Unique per organization.
- Idempotency: `IngestionEvent.externalId` is unique per `(organizationId, provider)` — a replayed webhook is a no-op.

## Implemented
`prisma/schema.prisma` as of 2026-08-23 holds every entity above except `CustomField`, `Tag`/`Tagging`, and `EmailMessage`. `Invitation` was added for the org-invite flow. Migration: `prisma/migrations/20260823090524_init`.

## Resolved
- **Lead lifecycle** (D3): `Lead` is a first-class entity with its own status. It stays a Lead until a human converts it, which creates Contact + Company + Deal in one transaction. See `04-features/lead-ingestion/decisions.md`.

## Open questions
- Custom fields: JSONB column vs. EAV table. Needs an ADR before the first custom field ships.
- `Lead.dedupeKey` currently does exact matching only (email → phone → name+company). Fuzzy matching is question Q5 and is deliberately unimplemented — a wrong merge is unrecoverable.
- `IngestionEvent.rawPayload` retention (Q11) is unbounded today. This is the main threat to the 0.5 GB free tier — see ADR 0002.
