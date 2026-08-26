import { BarChart3 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Td, TableShell, Th, Tr } from "@/components/ui/table";
import { formatTotal } from "@/lib/money";
import { requireCtx } from "@/server/context";
import {
  leadsBySource,
  ownerPerformance,
  pipelineHealth,
  winLoss,
} from "@/server/services/reports";

export const metadata = { title: "Reports · CRM" };

function pct(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

function minutes(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  return hours < 24 ? `${hours}h ${value % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export default async function ReportsPage() {
  const ctx = await requireCtx();

  const [sources, health, outcome, owners] = await Promise.all([
    leadsBySource(ctx),
    pipelineHealth(ctx),
    winLoss(ctx),
    ownerPerformance(ctx),
  ]);

  const hasAnything = sources.length > 0 || health.some((s) => s.deals > 0);

  return (
    <>
      <PageHeader title="Reports" description="Pipeline health and where leads come from. Last 90 days." />

      <div className="mx-auto w-full max-w-[1280px] space-y-6 p-8">
        {!hasAnything ? (
          <EmptyState
            icon={BarChart3}
            title="Nothing to report yet"
            hint="Once leads arrive and deals move through the pipeline, volume, conversion and win rate appear here."
          />
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Lead volume by source" description="Where the pipeline is actually coming from" bodyClassName="p-0">
            {sources.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">No leads in this window.</p>
            ) : (
              <TableShell caption="Leads by source">
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th align="right">Leads</Th>
                    <Th align="right">Converted</Th>
                    <Th align="right">Rate</Th>
                    <Th align="right">Median first touch</Th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((row) => (
                    <Tr key={row.source}>
                      <Td>{row.source.replaceAll("_", " ").toLowerCase()}</Td>
                      <Td align="right">{row.leads}</Td>
                      <Td align="right">{row.converted}</Td>
                      <Td align="right">{pct(row.conversionRate)}</Td>
                      <Td align="right">{minutes(row.medianFirstTouchMinutes)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <Panel
            title="Win and loss"
            description={outcome.winRate === null ? "Nothing closed yet" : `${outcome.winRate}% of closed deals were won`}
          >
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="t-caps text-muted">Won</dt>
                <dd className="mt-1 text-[24px] font-[590] tabular-nums">{outcome.won}</dd>
                <dd className="text-[13px] text-muted">{formatTotal(outcome.wonValue)}</dd>
              </div>
              <div>
                <dt className="t-caps text-muted">Lost</dt>
                <dd className="mt-1 text-[24px] font-[590] tabular-nums">{outcome.lost}</dd>
                <dd className="text-[13px] text-muted">{formatTotal(outcome.lostValue)}</dd>
              </div>
            </dl>

            {outcome.lostReasons.length > 0 ? (
              <div className="mt-5 border-t border-border-subtle pt-4">
                <p className="t-caps mb-2 text-muted">Why deals were lost</p>
                <ul className="space-y-1.5">
                  {outcome.lostReasons.map((r) => (
                    <li key={r.reason} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate">{r.reason}</span>
                      <span className="shrink-0 tabular-nums text-muted">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>
        </div>

        <Panel
          title="Pipeline health"
          description="Open stages only. Median days shows where deals are sitting."
          bodyClassName="p-0"
        >
          <TableShell caption="Open pipeline by stage">
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th align="right">Deals</Th>
                <Th align="right">Value</Th>
                <Th align="right">Median days in stage</Th>
              </tr>
            </thead>
            <tbody>
              {health.map((stage) => (
                <Tr key={stage.stage}>
                  <Td>{stage.stage}</Td>
                  <Td align="right">{stage.deals}</Td>
                  <Td align="right">{formatTotal(stage.value)}</Td>
                  <Td align="right">
                    {stage.medianDaysInStage === null ? (
                      "—"
                    ) : (
                      <span
                        className={
                          stage.medianDaysInStage >= 30
                            ? "text-danger"
                            : stage.medianDaysInStage >= 14
                              ? "text-warning"
                              : undefined
                        }
                      >
                        {stage.medianDaysInStage}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>

        <Panel title="By owner" description="Volume and follow-through per person" bodyClassName="p-0">
          <TableShell caption="Performance by owner">
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Untouched</Th>
                <Th align="right">Converted</Th>
                <Th align="right">Deals won</Th>
                <Th align="right">Value won</Th>
              </tr>
            </thead>
            <tbody>
              {owners.map((owner) => (
                <Tr key={owner.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Avatar name={owner.name} size={22} />
                      <span className="truncate">{owner.name}</span>
                    </span>
                  </Td>
                  <Td align="right">{owner.leads}</Td>
                  <Td align="right">
                    <span className={owner.untouched > 0 ? "text-warning" : undefined}>
                      {owner.untouched}
                    </span>
                  </Td>
                  <Td align="right">{owner.converted}</Td>
                  <Td align="right">{owner.dealsWon}</Td>
                  <Td align="right">{formatTotal(owner.wonValue)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>

        <Callout tone="info">
          <strong className="font-[560]">Cost per lead is not shown</strong> because no spend data
          exists in the system yet. It needs either manual spend entry per source or an ad-platform
          connection — inventing the number would be worse than its absence.
        </Callout>
      </div>
    </>
  );
}
