import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { SectionHeader } from "@/components/section-header";
import { Callout } from "@/components/ui/callout";
import { TargetPeriod } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { periodBounds, periodLabel, shiftPeriod } from "@/lib/targets";
import { cn } from "@/lib/utils";
import { hasRole, seesAllRecords } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { listTargets } from "@/server/services/targets";
import { CopyTargets } from "./copy-targets";
import { TargetsGrid } from "./targets-grid";

export const metadata = { title: "Targets · CRM" };

/**
 * Anything read from a URL is parsed with `.catch()`, never `.default()`.
 * `.default()` only covers a *missing* value — a hand-typed `?period=WEEK`
 * would throw and take the whole screen to an error boundary, which is a
 * hostile response to a mistyped link.
 */
const periodParam = z.enum(TargetPeriod).catch("MONTH");

/**
 * `2026-09` or `2026-Q3` from the URL, back to an instant inside that period.
 *
 * Midday on the 15th: no real timezone is more than 14 hours from UTC, so that
 * instant is inside the same month everywhere, and the org's own
 * `periodBounds` then decides where the period actually starts. Returns null
 * for anything unparseable so the caller falls back to today.
 */
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

/**
 * "2026-09" → "September 2026".
 *
 * Derived from the key rather than from `toLocaleDateString`, which would
 * format the stored instant in the *server's* zone and can name the wrong
 * month for an org that is a day ahead.
 */
function humanPeriod(key: string): string {
  const [year, tail] = key.split("-");
  return tail.startsWith("Q") ? `${tail} ${year}` : `${MONTH_NAMES[Number(tail) - 1]} ${year}`;
}

function href(period: TargetPeriod, key: string) {
  return `/settings/targets?period=${period}&at=${key}`;
}

export default async function TargetsSettingsPage({
  searchParams,
}: PageProps<"/settings/targets">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  // Read once, at the top, and passed down — no component below this line asks
  // the clock a second time and gets a slightly different answer.
  const now = new Date();

  const period = periodParam.parse(sp.period);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { timezone: true },
  });
  const timeZone = org.timezone;

  const anchor = anchorParam.parse(sp.at) ?? now;
  const { start } = periodBounds(period, anchor, timeZone);
  const key = periodLabel(period, start, timeZone);
  const previous = shiftPeriod(period, start, timeZone, -1);
  const next = shiftPeriod(period, start, timeZone, 1);
  const previousKey = periodLabel(period, previous.start, timeZone);
  const nextKey = periodLabel(period, next.start, timeZone);

  const canEdit = hasRole(ctx, "MANAGER");
  const seesEveryone = seesAllRecords(ctx);

  const [people, targets, previousTargets] = await Promise.all([
    db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, email: true },
      // Alphabetical, always. Ordering people by a number is the league table
      // this feature is explicitly designed not to be.
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    listTargets(ctx, { period, periodStart: start }),
    listTargets(ctx, { period, periodStart: previous.start }),
  ]);

  /**
   * A REP sees their own row and nothing else — including no "Whole team" row,
   * which aggregates everyone's revenue and would hand out the company number
   * sideways. This mirrors `targetVisibility` in the service rather than
   * assuming it, so the grid can never show a column the service will not fill.
   */
  const rows = seesEveryone
    ? [
        { userId: null as string | null, name: "Whole team" },
        ...people.map((p) => ({ userId: p.id as string | null, name: p.name ?? p.email })),
      ]
    : people
        .filter((p) => p.id === ctx.userId)
        .map((p) => ({ userId: p.id as string | null, name: p.name ?? p.email }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <SectionHeader
        title="Targets"
        description="One number per person per metric, for a month or a quarter. Attainment is never stored — every figure on the dashboard and in reports is recomputed from deals, leads and activities when the page loads."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={href(period, previousKey)}
            aria-label={`Previous period, ${humanPeriod(previousKey)}`}
            className="flex size-8 items-center justify-center rounded-md border border-border-subtle bg-surface text-secondary transition-colors hover:text-foreground"
          >
            <ChevronLeft size={15} aria-hidden />
          </Link>
          <span className="min-w-[9.5rem] text-center text-[14px] font-[560]">
            {humanPeriod(key)}
          </span>
          <Link
            href={href(period, nextKey)}
            aria-label={`Next period, ${humanPeriod(nextKey)}`}
            className="flex size-8 items-center justify-center rounded-md border border-border-subtle bg-surface text-secondary transition-colors hover:text-foreground"
          >
            <ChevronRight size={15} aria-hidden />
          </Link>
        </div>

        <div
          role="group"
          aria-label="Period length"
          className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface p-0.5"
        >
          {(["MONTH", "QUARTER"] as const).map((option) => {
            const active = period === option;
            // Switching length re-anchors on the same instant, so a manager
            // looking at September lands on the quarter that contains it
            // rather than on today's.
            const optionKey = periodLabel(
              option,
              periodBounds(option, anchor, timeZone).start,
              timeZone,
            );
            return (
              <Link
                key={option}
                href={href(option, optionKey)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[13px] transition-colors duration-100",
                  active
                    ? "bg-accent-soft font-[560] text-accent"
                    : "text-secondary hover:text-foreground",
                )}
              >
                {option === "MONTH" ? "Month" : "Quarter"}
              </Link>
            );
          })}
        </div>
      </div>

      {canEdit ? (
        <CopyTargets
          period={period}
          fromPeriodStart={previous.start.toISOString()}
          toPeriodStart={start.toISOString()}
          fromName={humanPeriod(previousKey)}
          toName={humanPeriod(key)}
          available={previousTargets.length}
        />
      ) : (
        <Callout tone="info">
          {seesEveryone
            ? "You can see every target here but cannot change one. Setting a number someone is measured against is a manager action."
            : "These are your own targets. Only a manager can change them."}
        </Callout>
      )}

      <TargetsGrid
        // Remount on a period change: every cell holds a draft of its own
        // number, and carrying August's drafts into September would show
        // figures nobody set.
        key={`${period}:${key}`}
        rows={rows}
        targets={targets.map((t) => ({
          id: t.id,
          userId: t.userId,
          metric: t.metric,
          value: t.value,
          currency: t.currency,
        }))}
        period={period}
        periodStart={start.toISOString()}
        periodName={humanPeriod(key)}
        canEdit={canEdit}
      />

      <Callout tone="warning">
        <strong className="font-[560]">Activity counts are self-reported.</strong> Calls, meetings
        and first touches are rows someone in this workspace created, and anyone can create one.
        They are worth watching next to the outcome they were supposed to produce, and worth
        nothing on their own — which is why reports never shows one without the other.
      </Callout>
    </div>
  );
}
