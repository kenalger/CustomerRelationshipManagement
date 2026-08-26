import { businessMinutesBetween } from "@/lib/business-hours";
import { db } from "@/lib/db";
import type { LeadStatus } from "@/generated/prisma/enums";
import type { Ctx } from "@/server/authz";
import { notify } from "@/server/services/notifications";

/**
 * Speed-to-lead enforcement.
 *
 * A lead sitting unworked is the single most expensive failure this product
 * has — it is why the company wanted the CRM. Notifying on arrival is not
 * enough, because the failure mode is the owner being busy, not uninformed.
 *
 * Two stages, both driven off `Lead.firstTouchedAt` being null:
 *   1. Nudge the owner after `slaFirstTouchMinutes`.
 *   2. Escalate to managers and admins after `slaEscalateMinutes`.
 *
 * `slaNotifiedAt` / `slaEscalatedAt` on the lead — not the notification's own
 * dedupe key — are what stop this repeating. The alert being *read* must not
 * re-arm a nudge; only the lead being *worked* clears it.
 */

const ESCALATION_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

/** A lead still in play and therefore still on the clock. */
const OPEN_STATUSES: LeadStatus[] = ["NEW", "WORKING"];

function describe(lead: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  companyName: string | null;
}): string {
  return (
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
    lead.email ||
    lead.companyName ||
    "A lead"
  );
}

export async function sweepSlaBreaches(
  options: { limit?: number; organizationId?: string } = {},
) {
  const limit = options.limit ?? 100;
  // `escalated` counts leads that crossed the threshold; `escalationAlerts`
  // counts notifications actually sent. They differ when the only person who
  // could be told is the owner already sitting on the lead — worth seeing in
  // telemetry rather than reading a 2 and assuming someone was warned.
  const results = { nudged: 0, escalated: 0, escalationAlerts: 0 };

  // Cron sweeps every tenant; `organizationId` narrows it to one, which tests
  // need for isolation and support needs for reprocessing a single customer.
  const organizations = await db.organization.findMany({
    where: options.organizationId ? { id: options.organizationId } : undefined,
    select: {
      id: true,
      slaFirstTouchMinutes: true,
      slaEscalateMinutes: true,
      timezone: true,
      businessHoursEnabled: true,
      businessDays: true,
      businessStartMinute: true,
      businessEndMinute: true,
    },
  });

  for (const org of organizations) {
    const now = Date.now();

    /*
     * The wall-clock cutoff is a SUPERSET, not the answer: working minutes can
     * never exceed real minutes, so anything younger than the target in wall
     * time cannot have breached in business time either. That keeps the query
     * indexed, and the precise business-time test runs in JS below.
     */
    const stale = await db.lead.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        firstTouchedAt: null,
        status: { in: OPEN_STATUSES },
        createdAt: { lte: new Date(now - org.slaFirstTouchMinutes * 60_000) },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        ownerId: true,
        createdAt: true,
        slaNotifiedAt: true,
        slaEscalatedAt: true,
      },
    });

    if (stale.length === 0) continue;

    const managers = await db.user.findMany({
      where: { organizationId: org.id, deletedAt: null, role: { in: [...ESCALATION_ROLES] } },
      select: { id: true },
    });

    for (const lead of stale) {
      const who = describe(lead);
      // Working minutes, so a lead that arrived on Friday evening is not
      // reported as three days late on Monday morning.
      const waiting = businessMinutesBetween(lead.createdAt, new Date(now), org);
      if (waiting < org.slaFirstTouchMinutes) continue;

      // Stage 1 — nudge the owner.
      if (!lead.slaNotifiedAt && lead.ownerId) {
        await notify({
          organizationId: org.id,
          userId: lead.ownerId,
          type: "LEAD_UNWORKED",
          title: `${who} has been waiting ${waiting} minutes`,
          body: "Inbound leads convert far better when contacted quickly. This one is still untouched.",
          entity: "Lead",
          entityId: lead.id,
          dedupeKey: `sla-nudge:${lead.id}`,
        });
        await db.lead.update({ where: { id: lead.id }, data: { slaNotifiedAt: new Date() } });
        results.nudged++;
      }

      // Stage 2 — escalate past the owner.
      if (!lead.slaEscalatedAt && waiting >= org.slaEscalateMinutes) {
        for (const manager of managers) {
          // Do not escalate a lead to the very person who is sitting on it.
          if (manager.id === lead.ownerId) continue;
          const sent = await notify({
            organizationId: org.id,
            userId: manager.id,
            type: "LEAD_UNWORKED",
            title: `Escalation: ${who} unworked for ${waiting} minutes`,
            body: "The assigned owner has not made contact. Reassign or follow up.",
            entity: "Lead",
            entityId: lead.id,
            dedupeKey: `sla-escalation:${lead.id}`,
          });
          if (sent) results.escalationAlerts++;
        }
        await db.lead.update({ where: { id: lead.id }, data: { slaEscalatedAt: new Date() } });
        results.escalated++;
      }
    }
  }

  return results;
}

/** Dashboard rollup: how the team is doing against the policy right now. */
export async function slaSnapshot(ctx: Ctx) {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { slaFirstTouchMinutes: true, slaEscalateMinutes: true },
  });

  const now = Date.now();
  const base = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    firstTouchedAt: null,
    status: { in: OPEN_STATUSES },
  };

  const [unworked, breaching, escalated] = await Promise.all([
    db.lead.count({ where: base }),
    db.lead.count({
      where: { ...base, createdAt: { lte: new Date(now - org.slaFirstTouchMinutes * 60_000) } },
    }),
    db.lead.count({
      where: { ...base, createdAt: { lte: new Date(now - org.slaEscalateMinutes * 60_000) } },
    }),
  ]);

  return { ...org, unworked, breaching, escalated };
}
