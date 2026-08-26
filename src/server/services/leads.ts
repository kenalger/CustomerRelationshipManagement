import { db } from "@/lib/db";
import { buildDedupeKey, normalizePhone } from "@/lib/dedupe";
import { leadListFilterSchema } from "@/lib/validation/crm";
import { segmentWhereById } from "@/server/services/segments";
import { fireAutomation } from "@/server/services/automation-bus";
import { type Ctx, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";
import { notify, notifyAdmins } from "@/server/services/notifications";
import type { ConnectionProvider, LeadSource } from "@/generated/prisma/enums";

/** A provider payload after its normalizer has run. Source-agnostic on purpose. */
export type NormalizedLead = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  message?: string | null;
};

export type IngestInput = {
  organizationId: string;
  provider: ConnectionProvider;
  source: LeadSource;
  /** The provider's own id for this payload — leadgen_id, Gmail message id. */
  externalId: string;
  rawPayload: unknown;
  normalized: NormalizedLead;
  connectionId?: string | null;
};

export type IngestOutcome =
  | { kind: "created"; leadId: string }
  | { kind: "duplicate"; leadId: string }
  | { kind: "replayed"; leadId: string | null };

export type RecordedEvent =
  | { kind: "recorded"; eventId: string }
  | { kind: "replayed"; eventId: string; leadId: string | null };

/**
 * Phase 1 of ingestion: durably record the raw payload, idempotently.
 *
 * Split out from `ingestLead` because Meta's Lead Ads webhook carries only a
 * `leadgen_id` — the field data needs a second authenticated call we must not
 * make on the request path (Meta retries non-200s and throttles slow
 * endpoints). The receiver records and returns 200; a job materializes the
 * lead afterwards.
 */
export async function recordIngestionEvent(input: {
  organizationId: string;
  provider: ConnectionProvider;
  externalId: string;
  rawPayload: unknown;
  connectionId?: string | null;
}): Promise<RecordedEvent> {
  const existing = await db.ingestionEvent.findUnique({
    where: {
      organizationId_provider_externalId: {
        organizationId: input.organizationId,
        provider: input.provider,
        externalId: input.externalId,
      },
    },
    select: { id: true, lead: { select: { id: true } } },
  });
  if (existing) {
    return { kind: "replayed", eventId: existing.id, leadId: existing.lead?.id ?? null };
  }

  const event = await db.ingestionEvent.create({
    data: {
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      provider: input.provider,
      externalId: input.externalId,
      payload: input.rawPayload as never,
      status: "RECEIVED",
    },
    select: { id: true },
  });

  return { kind: "recorded", eventId: event.id };
}

/**
 * Phase 2: turn a recorded event into a Lead — dedupe, assign, link.
 *
 * Safe to retry: an event already carrying a lead short-circuits, so a job
 * that dies after committing but before acking does not double-create.
 */
export async function materializeLead(
  eventId: string,
  normalized: NormalizedLead,
  source: LeadSource,
): Promise<IngestOutcome> {
  const phone = normalizePhone(normalized.phone);
  const dedupeKey = buildDedupeKey({ ...normalized, phone });

  return db.$transaction(async (tx) => {
    const event = await tx.ingestionEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizationId: true,
        connectionId: true,
        lead: { select: { id: true } },
      },
    });
    if (!event) throw new Error(`Ingestion event ${eventId} not found`);
    if (event.lead) return { kind: "replayed", leadId: event.lead.id } as const;

    const duplicate = await tx.lead.findUnique({
      where: {
        organizationId_dedupeKey: { organizationId: event.organizationId, dedupeKey },
      },
      select: { id: true },
    });

    if (duplicate) {
      await tx.ingestionEvent.update({
        where: { id: event.id },
        data: { status: "DUPLICATE", processedAt: new Date() },
      });
      // The duplicate submission is still evidence of intent — log it on the
      // existing lead rather than dropping it on the floor.
      await tx.activity.create({
        data: {
          organizationId: event.organizationId,
          type: "NOTE",
          subject: "Duplicate inbound submission",
          body: normalized.message ?? null,
          leadId: duplicate.id,
        },
      });
      return { kind: "duplicate", leadId: duplicate.id } as const;
    }

    // Assign an owner before the lead is visible, so nothing lands unowned.
    const ownerId = await pickOwnerRoundRobin(tx, event.organizationId);

    const lead = await tx.lead.create({
      data: {
        organizationId: event.organizationId,
        source,
        status: "NEW",
        firstName: normalized.firstName ?? null,
        lastName: normalized.lastName ?? null,
        email: normalized.email?.toLowerCase() ?? null,
        phone,
        companyName: normalized.companyName ?? null,
        message: normalized.message ?? null,
        dedupeKey,
        ownerId,
        connectionId: event.connectionId,
        ingestionEventId: event.id,
      },
      select: { id: true },
    });

    await tx.ingestionEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    // Same transaction as the lead: speed to first contact is the metric this
    // whole feature exists to move, and an alert that can go missing while the
    // lead lands is worse than no alert.
    if (ownerId) {
      const who =
        [normalized.firstName, normalized.lastName].filter(Boolean).join(" ") ||
        normalized.email ||
        "Someone";
      await notify(
        {
          organizationId: event.organizationId,
          userId: ownerId,
          type: "LEAD_ASSIGNED",
          title: `New lead: ${who}`,
          body: [normalized.companyName, normalized.message].filter(Boolean).join(" — ") || null,
          entity: "Lead",
          entityId: lead.id,
        },
        tx,
      );
    }

    return { kind: "created", leadId: lead.id } as const;
  });
}

/** Attempts before we stop retrying and leave the event for a human. */
export const MAX_INGESTION_ATTEMPTS = 6;

/**
 * Exponential backoff, capped. Meta keeps lead data for 90 days, so the
 * schedule is tuned to keep retrying well inside that window rather than
 * giving up fast: ~1m, 4m, 9m, 16m, 25m, 36m.
 */
export function backoffFor(attempts: number): Date {
  const minutes = Math.min(attempts * attempts, 60);
  return new Date(Date.now() + minutes * 60_000);
}

/** Marks an event failed so it surfaces on the connection health dashboard. */
export async function failIngestionEvent(
  eventId: string,
  error: string,
  options: { retryable?: boolean } = {},
) {
  const current = await db.ingestionEvent.findUnique({
    where: { id: eventId },
    select: { attempts: true },
  });
  const attempts = (current?.attempts ?? 0) + 1;
  const giveUp = options.retryable === false || attempts >= MAX_INGESTION_ATTEMPTS;

  const event = await db.ingestionEvent.update({
    where: { id: eventId },
    data: {
      status: "FAILED",
      error: error.slice(0, 2000),
      attempts,
      // Null means the sweeper will not pick it up again — a human must.
      nextAttemptAt: giveUp ? null : backoffFor(attempts),
    },
    select: { organizationId: true, provider: true, externalId: true },
  });

  if (giveUp) {
    await notifyAdmins({
      organizationId: event.organizationId,
      type: "INGESTION_DEAD_LETTERED",
      title: "A lead could not be imported",
      body:
        `${event.provider.toLowerCase()} lead ${event.externalId} failed ${attempts} times and ` +
        "will not be retried automatically. Meta deletes lead data after 90 days — " +
        "fix the connection and retry before then.",
      entity: "IngestionEvent",
      entityId: eventId,
      // One standing alert per provider, not one per lost lead.
      dedupeKey: `dead-letter:${event.provider}`,
    });
  }
}

/**
 * One-phase ingestion, for sources whose payload already carries the lead
 * (email, CSV, web forms). Facebook uses the two-phase pair above.
 */

export async function ingestLead(input: IngestInput): Promise<IngestOutcome> {
  const recorded = await recordIngestionEvent(input);
  if (recorded.kind === "replayed") {
    return { kind: "replayed", leadId: recorded.leadId };
  }
  const outcome = await materializeLead(recorded.eventId, input.normalized, input.source);

  // Only a genuinely new lead. A duplicate folded into an existing record is
  // not a new lead arriving, and firing on it would run the welcome rule twice
  // for the same person.
  if (outcome.kind === "created") {
    await fireAutomation({
      organizationId: input.organizationId,
      trigger: "LEAD_CREATED",
      recordKind: "LEAD",
      recordId: outcome.leadId,
      // The ingestion event is the occurrence, so a replayed webhook that
      // somehow reached here twice claims the same run rather than a second.
      triggerEventId: recorded.eventId,
    });
  }

  return outcome;
}

/**
 * Round-robin across writeable users in the org: fewest open leads wins, oldest
 * assignment breaks the tie. Territory and product-line routing is question Q8
 * in plan/04-features/lead-ingestion/plan.md and is deliberately not guessed at.
 */
async function pickOwnerRoundRobin(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organizationId: string,
): Promise<string | null> {
  const candidates = await tx.user.findMany({
    where: {
      organizationId,
      deletedAt: null,
      role: { in: ["OWNER", "ADMIN", "MANAGER", "REP"] },
    },
    select: {
      id: true,
      _count: { select: { ownedLeads: { where: { status: { in: ["NEW", "WORKING"] } } } } },
    },
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a._count.ownedLeads - b._count.ownedLeads || a.id.localeCompare(b.id));
  return candidates[0].id;
}

export async function listLeads(ctx: Ctx, rawFilter: unknown) {
  const filter = leadListFilterSchema.parse(rawFilter);

  // A segment is composed with AND, never spread: its clause already carries
  // the tenant and visibility scope, and spreading would let its keys collide
  // with the ones below.
  let segmentWhere: Record<string, unknown> | null = null;
  if (filter.segmentId) {
    const resolved = await segmentWhereById(ctx, filter.segmentId, "LEAD");
    if (!resolved.ok) {
      // Deliberately empty rather than falling through to the unfiltered list.
      // Someone who asked for "stale enterprise leads" and is shown all 4,000
      // has been told something false; an empty list with the reason on it has
      // not.
      return {
        rows: [],
        total: 0,
        page: filter.page,
        perPage: filter.perPage,
        segmentError: resolved.error,
      };
    }
    segmentWhere = resolved.data;
  }

  const where = {
    ...(segmentWhere ? { AND: [segmentWhere] } : {}),
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.q
      ? {
          OR: [
            { firstName: { contains: filter.q, mode: "insensitive" as const } },
            { lastName: { contains: filter.q, mode: "insensitive" as const } },
            { email: { contains: filter.q, mode: "insensitive" as const } },
            { companyName: { contains: filter.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    // Last on purpose: the visibility rule overrides the caller's own ownerId
    // filter, so a rep who passes a colleague's id still sees only their own.
    ...visibleTo(ctx),
  };

  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: [
        filter.sort === "status"
          ? { status: filter.dir }
          : filter.sort === "source"
            ? { source: filter.dir }
            : filter.sort === "companyName"
              ? { companyName: filter.dir }
              : filter.sort === "score"
                ? { score: filter.dir }
                : { createdAt: filter.dir },
        { id: "asc" },
      ],
      skip: (filter.page - 1) * filter.perPage,
      take: filter.perPage,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        companyName: true,
        source: true,
        status: true,
        score: true,
        // Not decoration: `score` defaults to 0, so a lead nobody has scored
        // yet is indistinguishable from one scored as worthless. `scoredAt`
        // is the only thing that separates them, and the column shows a dash
        // rather than a 0 when it is null.
        scoredAt: true,
        createdAt: true,
        firstTouchedAt: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    db.lead.count({ where }),
  ]);

  // Age belongs to the data, not the view — a component that reads the clock
  // during render is impure.
  const withAge = rows.map((lead) => ({
    ...lead,
    ageMinutes: Math.floor((Date.now() - lead.createdAt.getTime()) / 60_000),
  }));

  return { rows: withAge, total, page: filter.page, perPage: filter.perPage, segmentError: null };
}

/**
 * Qualifies a lead into real records: Contact, Company if named, and an open
 * Deal in the default pipeline. One transaction — a lead that half-converted
 * would be invisible in both the lead queue and the pipeline.
 */
export async function convertLead(
  ctx: Ctx,
  leadId: string,
): Promise<Result<{ contactId: string; dealId: string }>> {
  requireWrite(ctx);

  const lead = await db.lead.findFirst({
    // A lead the caller cannot see is "not found", so conversion is never a
    // way to pull someone else's lead into your own pipeline.
    where: { id: leadId, organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) },
  });
  if (!lead) return err("Lead not found");
  if (lead.status === "CONVERTED") return err("This lead has already been converted");
  if (!lead.firstName && !lead.email) {
    return err("A lead needs at least a name or an email before it can be converted");
  }

  const pipeline = await db.pipeline.findFirst({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, stages: { orderBy: { order: "asc" }, take: 1, select: { id: true } } },
  });
  const firstStageId = pipeline?.stages[0]?.id;
  if (!pipeline || !firstStageId) {
    return err("No pipeline is configured — an admin needs to create one first");
  }

  const result = await db.$transaction(async (tx) => {
    let companyId: string | null = null;
    if (lead.companyName) {
      const existing = await tx.company.findFirst({
        where: {
          organizationId: ctx.organizationId,
          name: lead.companyName,
          deletedAt: null,
        },
        select: { id: true },
      });
      companyId =
        existing?.id ??
        (
          await tx.company.create({
            data: {
              organizationId: ctx.organizationId,
              name: lead.companyName,
              ownerId: lead.ownerId ?? ctx.userId,
            },
            select: { id: true },
          })
        ).id;
    }

    const contact = await tx.contact.create({
      data: {
        organizationId: ctx.organizationId,
        firstName: lead.firstName ?? lead.email ?? "Unknown",
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        companyId,
        ownerId: lead.ownerId ?? ctx.userId,
      },
      select: { id: true },
    });

    const deal = await tx.deal.create({
      data: {
        organizationId: ctx.organizationId,
        title: `${lead.companyName ?? [lead.firstName, lead.lastName].filter(Boolean).join(" ")} — new business`,
        value: 0, // unknown at conversion; the rep sets it
        currency: "USD",
        pipelineId: pipeline.id,
        stageId: firstStageId,
        contactId: contact.id,
        companyId,
        ownerId: lead.ownerId ?? ctx.userId,
      },
      select: { id: true },
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: "CONVERTED",
        convertedContactId: contact.id,
        convertedDealId: deal.id,
        convertedAt: new Date(),
        firstTouchedAt: lead.firstTouchedAt ?? new Date(),
      },
    });

    // Carry the lead's history onto the contact so nothing is orphaned.
    await tx.activity.updateMany({
      where: { organizationId: ctx.organizationId, leadId: lead.id },
      data: { contactId: contact.id },
    });

    await writeAudit(tx, ctx, {
      entity: "Lead",
      entityId: lead.id,
      action: "convert",
      before: { status: lead.status },
      after: { status: "CONVERTED", contactId: contact.id, dealId: deal.id },
    });

    return { contactId: contact.id, dealId: deal.id };
  });

  return ok(result);
}

export async function markLeadTouched(ctx: Ctx, leadId: string): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const updated = await db.lead.updateMany({
    where: {
      id: leadId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      firstTouchedAt: null,
      ...visibleTo(ctx),
    },
    data: { firstTouchedAt: new Date(), status: "WORKING" },
  });
  if (updated.count === 0) return err("Lead not found or already worked");
  return ok({ id: leadId });
}
