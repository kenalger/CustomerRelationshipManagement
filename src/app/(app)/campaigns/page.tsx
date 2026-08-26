import { Plus, Send } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordLink, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { db } from "@/lib/db";
import { hasRole } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { listCampaigns } from "@/server/services/campaigns";
import { NewCampaignForm } from "./new-campaign-form";

export const metadata = { title: "Campaigns · CRM" };

/**
 * The word does the work; the tone only reinforces it. "Running" rather than
 * "Active" because the column beside it counts *active enrollments*, and two
 * different meanings of the same word in one row is a reading tax.
 */
const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Running", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Finished", tone: "info" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const composing = sp.new === "1";
  const canWrite = hasRole(ctx, "REP");

  const [campaigns, activeCounts, lists] = await Promise.all([
    listCampaigns(ctx),
    // `listCampaigns` counts every enrollment ever made; the useful number
    // beside it is how many are still moving. One grouped count covers the
    // whole page rather than a query per row.
    db.enrollment.groupBy({
      by: ["campaignId"],
      where: { organizationId: ctx.organizationId, state: "ACTIVE" },
      _count: { _all: true },
    }),
    db.prospectList.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const activeByCampaign = new Map(activeCounts.map((row) => [row.campaignId, row._count._all]));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Outbound sequences: who hears from us, in what order, how far apart."
        action={
          canWrite && !composing ? (
            <Link href="/campaigns?new=1">
              <Button size="sm">
                <Plus size={14} strokeWidth={2} aria-hidden />
                New campaign
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="mx-auto w-full max-w-[1080px] space-y-6 p-8">
        <Callout tone="info">
          A campaign does not send email — we have not connected an email provider. When a step
          comes due it creates a task for whoever owns the prospect, carrying the instruction and
          the template copy, and that person sends the message by hand.
        </Callout>

        {composing ? <NewCampaignForm lists={lists} /> : null}

        {campaigns.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No campaigns yet"
            hint="A campaign is a cadence: a run of steps — an intro, a nudge, a last try — spaced days apart, applied to a list of prospects so nobody gets missed and nobody gets chased twice."
            action={
              canWrite && !composing ? (
                <Link href="/campaigns?new=1">
                  <Button size="sm">Create the first campaign</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <TableShell caption="Campaigns, newest first">
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Status</Th>
                <Th>Owner</Th>
                <Th align="right">Steps</Th>
                <Th align="right">Enrolled</Th>
                <Th align="right">Still moving</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => {
                const status = CAMPAIGN_STATUS[campaign.status] ?? {
                  label: campaign.status,
                  tone: "neutral" as Tone,
                };
                const active = activeByCampaign.get(campaign.id) ?? 0;

                return (
                  <Tr key={campaign.id}>
                    <Td>
                      <RecordLink href={`/campaigns/${campaign.id}`}>{campaign.name}</RecordLink>
                      {campaign.goal ? (
                        <p className="mt-0.5 truncate text-[12px] text-muted">{campaign.goal}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td className="text-secondary">
                      {campaign.owner?.name ?? campaign.owner?.email ?? "—"}
                    </Td>
                    <Td align="right" className="text-secondary">
                      {campaign.stepCount}
                    </Td>
                    <Td align="right" className="text-secondary">
                      {campaign.enrollmentCount}
                    </Td>
                    <Td align="right" className="text-secondary">
                      {active === 0 ? <span className="text-muted">none</span> : active}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </div>
    </>
  );
}
