import { BarChart3, ChevronLeft, ChevronRight, Target as TargetIcon } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Dot, type Tone } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Td, TableShell, Th, Tr } from "@/components/ui/table";
import { TargetPeriod } from "@/generated/prisma/enums";
import type { TargetMetric } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { formatMoney, formatTotal } from "@/lib/money";
import { isMoneyMetric, isOutcomeMetric, pace, periodBounds, periodLabel, shiftPeriod } from "@/lib/targets";
import { requireCtx } from "@/server/context";
import {
  dealSlippage,
  leadsBySource,
  ownerPerformance,
  pipelineHealth,
  winLoss,
} from "@/server/services/reports";
import { type AttainmentRow, attainment, coverage } from "@/server/services/targets";

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

// ───────────────────────── team attainment ─────────────────────────

/**
 * URL state is parsed with `.catch()`, not `.default()`. `.default()` covers a
 * missing value only, so a hand-edited `?period=WEEK` would throw and take the
 * whole report to an error boundary instead of falling back to this month.
 */
const periodParam = z.enum(TargetPeriod).catch("MONTH");

/** "2026-09" / "2026-Q3" → an instant safely inside that period in any zone. */
const anchorParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/)
  .transform((key) => {
    const [year, tail] = key.split("-");
    const month = tail.startsWith("Q") ? (Number(tail.slice(1)) - 1) * 3 + 2 : Number(tail);
    return new Date(Date.UTC(Number(year), month - 1, 15, 12));
  })
  .nullable()
  .catch(null);

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function humanPeriod(key: string): string {
  const [year, tail] = key.split("-");
  return tail.startsWith("Q") ? `${tail} ${year}` : `${MONTH_NAMES[Number(tail) - 1]} ${year}`;
}

const METRIC_LABELS: { key: TargetMetric; label: string }[] = [
  { key: "REVENUE_WON", label: "Revenue won" },
  { key: "DEALS_WON", label: "Deals won" },
  { key: "LEADS_CONVERTED", label: "Leads converted" },
  { key: "CALLS_LOGGED", label: "Calls logged" },
  { key: "MEETINGS_HELD", label: "Meetings held" },
  { key: "FIRST_TOUCHES", label: "First touches" },
];

/**
 * Pace, graded against what success means for *this* metric.
 *
 * The service leaves `row.pace` ungraded on purpose and ships
 * `successThreshold` on the row so the caller applies it once. A quota is
 * committed and measured against 100%; an activity target is aspirational and
 * 70% is a success, so an activity target at 75% must not wear the same
 * "behind" as a revenue quota at 75%.
 */
function gradedPace(row: AttainmentRow) {
  return pace(row.attained, row.target * row.successThreshold, row.elapsed);
}

/** Colour never travels alone — every tone is paired with the word below it. */
function paceLook(row: AttainmentRow): { tone: Tone; word: string } {
  switch (gradedPace(row)) {
    case "ahead":
      return { tone: "success", word: "Ahead" };
    case "on-track":
      return { tone: "info", word: "On track" };
    case "behind":
      // A missed quota and a missed stretch goal are not the same event.
      return row.isOutcome
        ? { tone: "danger", word: "Behind" }
        : { tone: "warning", word: "Behind" };
    default:
      return { tone: "neutral", word: row.target > 0 ? "Not started" : "Not chasing" };
  }
}

function attainedText(row: AttainmentRow) {
  if (!isMoneyMetric(row.metric)) {
    return `${row.attained.toLocaleString("en-US")} of ${row.target.toLocaleString("en-US")}`;
  }
  // A revenue target with no currency is misconfigured; say so rather than
  // picking one on its behalf, which is what would make the figure look real.
  if (!row.currency) return `${row.attained.toLocaleString("en-US")} — no currency set`;
  return `${formatMoney(row.attained, row.currency)} of ${formatMoney(row.target, row.currency)}`;
}

function AttainmentCell({ row }: { row: AttainmentRow }) {
  const look = paceLook(row);
  const elapsed = Math.round(row.elapsed * 100);

  return (
    <div className="space-y-1 text-right">
      {/* Pace first and largest: 62% is comfortably ahead on day 12 of 30 and a
          miss on day 27, so the raw percentage on its own decides nothing. */}
      <Badge tone={look.tone}>
        <Dot tone={look.tone} />
        {look.word}
      </Badge>
      <p className="text-[13px] tabular-nums">{attainedText(row)}</p>
      <p className="text-[12px] text-muted">
        {row.ratio === null
          ? "Target is 0 — no percentage to give"
          : `${Math.round(row.ratio * 100)}% attained · ${elapsed}% of period gone`}
      </p>
      {!row.isOutcome && row.ratio !== null ? (
        <p className="text-[12px] text-muted">
          Success here is {Math.round(row.successThreshold * 100)}%, not 100%
        </p>
      ) : null}
      {row.excluded && row.excluded.count > 0 ? (
        <p className="text-[12px] text-warning">
          {row.excluded.count === 1 ? "1 won deal" : `${row.excluded.count} won deals`} in another
          currency ({formatTotal(row.excluded.value)}) — not counted
        </p>
      ) : null}
      {isMoneyMetric(row.metric) && !row.currency ? (
        <p className="text-[12px] text-danger">No currency on this quota</p>
      ) : null}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  // Read once, here, and threaded into every service call below so pace and
  // elapsed on this page all describe the same instant.
  const now = new Date();

  const period = periodParam.parse(sp.period);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { timezone: true },
  });
  const timeZone = org.timezone;
  const anchor = anchorParam.parse(sp.at) ?? now;
  const { start } = periodBounds(period, anchor, timeZone);
  const periodKey = periodLabel(period, start, timeZone);
  const previousKey = periodLabel(period, shiftPeriod(period, start, timeZone, -1).start, timeZone);
  const nextKey = periodLabel(period, shiftPeriod(period, start, timeZone, 1).start, timeZone);
  const periodName = humanPeriod(periodKey);
  const reportHref = (p: TargetPeriod, key: string) => `/reports?period=${p}&at=${key}`;

  const [sources, health, outcome, owners, slippage, rows, cover] = await Promise.all([
    leadsBySource(ctx),
    pipelineHealth(ctx),
    winLoss(ctx),
    ownerPerformance(ctx),
    dealSlippage(ctx),
    attainment(ctx, { period, periodStart: start, now }),
    coverage(ctx, { period, periodStart: start, now }),
  ]);

  // Metrics narrow to what is actually targeted, outcomes first so the result
  // a rep is chasing is read before the effort they spent chasing it.
  const targeted = METRIC_LABELS.filter((m) => rows.some((row) => row.metric === m.key));
  const columns = [
    ...targeted.filter((m) => isOutcomeMetric(m.key)),
    ...targeted.filter((m) => !isOutcomeMetric(m.key)),
  ];

  // Subjects, alphabetically, team first. Never ordered by attainment — this
  // screen reports, it does not rank.
  const subjects = [...new Map(rows.map((row) => [row.userId ?? "", row])).values()]
    .map((row) => ({ userId: row.userId, name: row.userName }))
    .sort((a, b) => {
      if (a.userId === null) return -1;
      if (b.userId === null) return 1;
      return a.name.localeCompare(b.name);
    });

  const cellFor = (userId: string | null, metric: TargetMetric) =>
    rows.find((row) => row.userId === userId && row.metric === metric);

  /**
   * People carrying an activity target with no outcome target beside it.
   *
   * This is the one thing the layout cannot fix on its own: the columns put
   * calls next to meetings-and-revenue on the same row, but if nobody set an
   * outcome target for a person there is no outcome number to put there. Naming
   * them is the honest alternative to showing 200 calls as though it meant
   * something.
   */
  const activityOnly = subjects.filter((subject) => {
    const mine = rows.filter((row) => row.userId === subject.userId);
    return mine.some((row) => !row.isOutcome) && !mine.some((row) => row.isOutcome);
  });

  const hasAnything = sources.length > 0 || health.some((s) => s.deals > 0);

  return (
    <>
      <PageHeader title="Reports" description="Pipeline health and where leads come from. Last 90 days." />

      <div className="mx-auto w-full max-w-[1280px] space-y-6 p-8">
        {/* ─────────────── targets ─────────────── */}
        <section className="rounded-md border border-border-subtle bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
            <div>
              <h2 className="t-heading">Targets · {periodName}</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                What each person is measured against, and whether the pace gets them there.
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={reportHref(period, previousKey)}
                className="rounded-md px-2 py-1 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-foreground"
              >
<ChevronLeft size={13} strokeWidth={2} aria-hidden />
                Previous
              </Link>
              <Link
                href={reportHref(period === "MONTH" ? "QUARTER" : "MONTH", periodKey)}
                className="rounded-md px-2 py-1 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-foreground"
              >
                {period === "MONTH" ? "Quarterly" : "Monthly"}
              </Link>
              <Link
                href={reportHref(period, nextKey)}
                className="rounded-md px-2 py-1 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-foreground"
              >
Next
                <ChevronRight size={13} strokeWidth={2} aria-hidden />
              </Link>
            </div>
          </header>

          {columns.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={TargetIcon}
                title={`No targets set for ${periodName}`}
                hint="A manager sets them in Settings → Targets. Without one there is nothing to measure pace against."
              />
            </div>
          ) : (
            <>
              {activityOnly.length > 0 ? (
                <div className="border-b border-border-subtle px-5 py-3">
                  <Callout tone="warning">
                    {activityOnly.map((s) => s.name).join(", ")}{" "}
                    {activityOnly.length === 1 ? "has an activity target" : "have activity targets"}{" "}
                    with no outcome target beside{" "}
                    {activityOnly.length === 1 ? "it" : "them"}. Activity on its own does not say
                    whether the work is landing — set a revenue, deals or conversion target too.
                  </Callout>
                </div>
              ) : null}

              <TableShell caption={`Target attainment for ${periodName}`}>
                <thead>
                  <tr>
                    <Th>Person</Th>
                    {/*
                      Outcome columns come first and activity columns after, on
                      the SAME row. This is the layout requirement the whole
                      feature rests on: 200 calls beside no meetings is the
                      finding, and a screen that shows only the 200 hides it.
                    */}
                    {columns.map((column) => (
                      <Th key={column.key} align="right">
                        {column.label}
                        <span className="block text-[11px] font-normal text-muted">
                          {isOutcomeMetric(column.key) ? "outcome" : "activity"}
                        </span>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((subject) => (
                    <Tr key={subject.userId ?? "team"}>
                      <Td>
                        <span className="flex items-center gap-2">
                          <Avatar name={subject.userId === null ? null : subject.name} size={20} />
                          <span className="truncate font-[510]">{subject.name}</span>
                        </span>
                      </Td>
                      {columns.map((column) => {
                        const row = cellFor(subject.userId, column.key);
                        return (
                          <Td key={column.key} align="right">
                            {row ? (
                              <AttainmentCell row={row} />
                            ) : (
                              <span className="text-[13px] text-muted">No target</span>
                            )}
                          </Td>
                        );
                      })}
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </>
          )}
        </section>

        {/* ─────────────── pipeline coverage ─────────────── */}
        <Panel
          title="Pipeline coverage"
          description="Whether there is enough open pipeline left to make the revenue quota"
        >
          {cover.required === null ? (
            <p className="text-[13px] text-muted">
              {/* Never a fallback 3x. "We don't know yet" and "you need 3x" are
                  different claims, and only one of them is true here. */}
              Not enough closed history in the last {cover.windowDays} days to say what coverage
              this team needs — {cover.wonCount} won and {cover.lostCount} lost so far. The
              multiple is derived from your own win rate rather than borrowed, so it appears once
              enough deals have closed.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-secondary">
                Your win rate over the last {cover.windowDays} days is{" "}
                <strong className="font-[560] text-foreground">{cover.winRate}%</strong> (
                {cover.wonCount} won, {cover.lostCount} lost), so you need about{" "}
                <strong className="font-[560] text-foreground">{cover.required}×</strong> the
                remaining quota in open pipeline.
              </p>

              {cover.rows.length === 0 ? (
                <p className="mt-4 text-[13px] text-muted">No revenue quota set for this period.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {cover.rows.map((row) => (
                    <li
                      key={row.targetId}
                      className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border-subtle pb-3 text-[13px] last:border-0 last:pb-0"
                    >
                      <span className="font-[510]">{row.userName}</span>
                      <span className="flex items-center gap-3 tabular-nums text-secondary">
                        <span>
                          {formatMoney(row.weightedPipeline, row.currency)} open ·{" "}
                          {formatMoney(row.remaining, row.currency)} to find
                        </span>
                        {row.ratio === null ? (
                          <Badge tone="success">
                            <Dot tone="success" />
                            Quota met
                          </Badge>
                        ) : row.meetsRequirement === null ? (
                          <Badge tone="neutral">
                            <Dot tone="neutral" />
                            {row.ratio.toFixed(1)}× · not enough history
                          </Badge>
                        ) : (
                          <Badge tone={row.meetsRequirement ? "success" : "warning"}>
                            <Dot tone={row.meetsRequirement ? "success" : "warning"} />
                            {row.ratio.toFixed(1)}× {row.meetsRequirement ? "covered" : "short"}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>

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

          <Panel
            title="Forecast accuracy"
            description="How far deals drift from the date they were forecast to close"
          >
            {slippage.medianSlipDays === null ? (
              <p className="text-[13px] text-muted">
                {slippage.unforecast > 0
                  ? `No closed deal in this window carried a forecast close date${
                      slippage.unforecast === 1 ? "" : ` — ${slippage.unforecast} closed without one`
                    }. Forecast dates are what make this measurable.`
                  : "Nothing has closed in this window yet."}
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="t-caps text-muted">Typical slip</dt>
                    <dd className="mt-1 text-[24px] font-[590] tabular-nums">
                      {slippage.medianSlipDays > 0 ? "+" : ""}
                      {slippage.medianSlipDays}d
                    </dd>
                    {/* Median, not mean: one deal that slipped 300 days would
                        drag a mean past the point of being about anything. */}
                    <dd className="text-[13px] text-muted">
                      median across {slippage.sampled}{" "}
                      {slippage.sampled === 1 ? "deal" : "deals"}
                    </dd>
                  </div>
                  <div>
                    <dt className="t-caps text-muted">On time</dt>
                    <dd className="mt-1 text-[24px] font-[590] tabular-nums">{slippage.onTime}</dd>
                    <dd className="text-[13px] text-muted">
                      {slippage.late} late · {slippage.early} early
                    </dd>
                  </div>
                </dl>

                {slippage.unforecast > 0 ? (
                  <p className="mt-5 border-t border-border-subtle pt-4 text-[13px] text-muted">
                    {slippage.unforecast}{" "}
                    {slippage.unforecast === 1 ? "deal closed" : "deals closed"} without a forecast
                    date and {slippage.unforecast === 1 ? "is" : "are"} not counted above.
                  </p>
                ) : null}
              </>
            )}
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
