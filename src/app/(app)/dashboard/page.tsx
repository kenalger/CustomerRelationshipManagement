import { AlertTriangle, CircleDollarSign, Sparkles, Target } from "lucide-react";
import Link from "next/link";

import { LeadsTrend } from "@/components/charts/leads-trend";
import { PipelineByStage } from "@/components/charts/pipeline-by-stage";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Dot, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { formatMoney, formatTotal } from "@/lib/money";
import { timeAgo } from "@/lib/utils";
import { requireCtx } from "@/server/context";
import { getDashboard } from "@/server/services/dashboard";
import { attainment } from "@/server/services/targets";
import { isMoneyMetric, pace, periodBounds } from "@/lib/targets";
import { db } from "@/lib/db";
import { slaSnapshot } from "@/server/services/sla";

const METRIC_LABEL: Record<string, string> = {
  REVENUE_WON: "Revenue won",
  DEALS_WON: "Deals won",
  LEADS_CONVERTED: "Leads converted",
  CALLS_LOGGED: "Calls logged",
  MEETINGS_HELD: "Meetings held",
  FIRST_TOUCHES: "First touches",
};

export const metadata = { title: "Overview · CRM" };

export default async function DashboardPage() {
  const ctx = await requireCtx();
  // Read the clock once, here, and thread it through — so pace and elapsed
  // below all describe the same instant rather than drifting mid-render.
  const now = new Date();
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { timezone: true },
  });
  const { start } = periodBounds("MONTH", now, org.timezone);

  const [data, sla, myTargets] = await Promise.all([
    getDashboard(ctx),
    slaSnapshot(ctx),
    // The signed-in user's own numbers only. A rep is scoped to themselves by
    // the service; a manager passing their own id gets the same view rather
    // than the whole team's, which belongs on /reports.
    attainment(ctx, { period: "MONTH", periodStart: start, userId: ctx.userId, now }),
  ]);

  // Ratio only means anything within one currency; comparing a mixed
  // pipeline's weighted total to its raw total would be arithmetic on
  // unlike units.
  const dominant = data.pipelineValue.dominant;
  const weightedDominant = data.weighted.byCurrency.find(
    (entry) => entry.currency === dominant?.currency,
  );
  const conversionHint =
    dominant && weightedDominant && dominant.amount > 0
      ? `${Math.round((weightedDominant.amount / dominant.amount) * 100)}% average probability`
      : undefined;
  const mixedNote = data.pipelineValue.mixed
    ? `${data.pipelineValue.byCurrency.length} currencies — totals shown in ${dominant?.currency}`
    : undefined;

  return (
    <>
      <PageHeader title="Overview" description="Where the pipeline stands right now." />

      <div className="mx-auto w-full max-w-[1280px] space-y-6 p-8">
        {sla.breaching > 0 ? (
          <p
            role="alert"
            className={`rounded-lg border px-3 py-2 text-[12px] ${
              sla.escalated > 0
                ? "border-danger/25 bg-danger-muted text-danger"
                : "border-warning/25 bg-warning-muted text-warning"
            }`}
          >
            <strong className="font-semibold">{sla.breaching}</strong>{" "}
            {sla.breaching === 1 ? "lead has" : "leads have"} gone unworked past the{" "}
            {sla.slaFirstTouchMinutes}-minute target
            {sla.escalated > 0 ? `, ${sla.escalated} past ${sla.slaEscalateMinutes} minutes` : ""}.{" "}
            <Link href="/leads?status=NEW" className="font-medium underline underline-offset-2">
              Work the queue
            </Link>
          </p>
        ) : null}

        {myTargets.length > 0 ? (
          <section className="rounded-md border border-border-subtle bg-surface">
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border-subtle px-5 py-3">
              <h2 className="t-heading">Your month</h2>
              <Link
                href="/reports"
                className="text-[13px] text-secondary transition-colors hover:text-foreground"
              >
                See the team
              </Link>
            </header>
            <div className="grid gap-px bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
              {myTargets.map((row) => {
                /*
                 * Graded against what success means for THIS metric. An
                 * activity target at 75% is a success; a revenue quota at 75%
                 * is not, and rendering them alike is how a team learns that
                 * activity is the goal.
                 */
                const goal = row.target * row.successThreshold;
                const state = pace(row.attained, goal, row.elapsed);
                const tone: Tone =
                  state === "ahead"
                    ? "success"
                    : state === "on-track"
                      ? "info"
                      : state === "behind"
                        ? row.isOutcome
                          ? "danger"
                          : "warning"
                        : "neutral";
                const word =
                  state === "ahead"
                    ? "Ahead"
                    : state === "on-track"
                      ? "On track"
                      : state === "behind"
                        ? "Behind"
                        : "Not started";

                return (
                  <div key={row.targetId} className="bg-surface p-5">
                    <p className="t-caps text-muted">{METRIC_LABEL[row.metric]}</p>
                    <p className="mt-1 text-[22px] font-[590] tabular-nums">
                      {isMoneyMetric(row.metric) && row.currency
                        ? formatMoney(row.attained, row.currency)
                        : row.attained.toLocaleString("en-US")}
                      <span className="text-[14px] font-normal text-muted">
                        {" / "}
                        {isMoneyMetric(row.metric) && row.currency
                          ? formatMoney(row.target, row.currency)
                          : row.target.toLocaleString("en-US")}
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/* Pace leads, because the percentage alone decides
                          nothing without knowing how much of the month is gone. */}
                      <Badge tone={tone}>
                        <Dot tone={tone} />
                        {word}
                      </Badge>
                      <span className="text-[12px] text-muted">
                        {row.ratio === null
                          ? "no target to measure against"
                          : `${Math.round(row.ratio * 100)}% · ${Math.round(row.elapsed * 100)}% of the month gone`}
                      </span>
                    </div>
                    {!row.isOutcome ? (
                      <p className="mt-1 text-[12px] text-muted">
                        Success here is {Math.round(row.successThreshold * 100)}%, not 100%
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Open pipeline"
            value={formatTotal(data.pipelineValue)}
            sub={`${data.openCount} open ${data.openCount === 1 ? "deal" : "deals"}`}
            icon={CircleDollarSign}
            href="/deals"
          />
          <StatTile
            label="Weighted forecast"
            value={formatTotal(data.weighted)}
            sub={conversionHint}
            icon={Target}
            href="/deals"
          />
          <StatTile
            label="New leads"
            value={String(data.newLeads)}
            sub={`${data.contacts} contacts total`}
            icon={Sparkles}
            href="/leads?status=NEW"
          />
          <StatTile
            label="Unworked"
            value={String(data.unworked)}
            sub={data.unworked > 0 ? "Nobody has made contact yet" : "All leads touched"}
            icon={AlertTriangle}
            href="/leads"
            tone={data.unworked > 0 ? "alert" : "neutral"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Open pipeline by stage"
            description={mixedNote ?? "Where value is concentrated right now"}
            bodyClassName="p-3"
          >
            <PipelineByStage
              data={data.byStage.map((s) => ({ name: s.name, value: s.value, count: s.count }))}
            currency={dominant?.currency ?? "USD"}
            />
          </Panel>

          <Panel
            title="Leads received"
            description="Last 14 days"
            bodyClassName="p-3"
          >
            <LeadsTrend data={data.trend} />
          </Panel>
        </div>

        <Panel
          title="Needs you now"
          description="Oldest leads nobody has contacted"
          action={
            <Link href="/leads">
              <Button variant="secondary" size="sm">
                View all
              </Button>
            </Link>
          }
          bodyClassName="p-0"
        >
          {data.needsAttention.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12px] text-muted">
              Every lead has been picked up. Good.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.needsAttention.map((lead) => {
                const tone: Tone =
                  lead.ageMinutes >= sla.slaEscalateMinutes
                    ? "danger"
                    : lead.ageMinutes >= sla.slaFirstTouchMinutes
                      ? "warning"
                      : "neutral";
                const name =
                  [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
                  lead.email ||
                  "Unnamed lead";

                return (
                  <li key={lead.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={name} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium">{name}</p>
                      <p className="truncate text-[12px] text-muted">
                        {lead.companyName ?? lead.email ?? "No company"}
                      </p>
                    </div>
                    <span className="hidden shrink-0 text-[12px] text-muted sm:block">
                      {lead.owner?.name ?? lead.owner?.email ?? "Unassigned"}
                    </span>
                    <Badge tone={tone}>
                      <Dot tone={tone} />
                      {timeAgo(lead.createdAt)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
