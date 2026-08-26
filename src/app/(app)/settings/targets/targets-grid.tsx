"use client";

import { useState, useTransition } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { Td, TableShell, Th, Tr } from "@/components/ui/table";
import type { TargetMetric, TargetPeriod } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { isMoneyMetric, isOutcomeMetric } from "@/lib/targets";
import { deleteTargetAction, setTargetAction } from "@/server/actions/targets";

type Subject = { userId: string | null; name: string };

type Cell = {
  id: string;
  userId: string | null;
  metric: TargetMetric;
  value: number;
  currency: string | null;
};

/**
 * Labels only. Which of these is an outcome and which carries a currency is
 * never written down here — `isOutcomeMetric` and `isMoneyMetric` in
 * `lib/targets.ts` are the single place that distinction is made, and a second
 * copy in a component is exactly how the settings screen and the report come to
 * disagree about what a number means.
 */
const METRICS: { key: TargetMetric; label: string }[] = [
  { key: "REVENUE_WON", label: "Revenue won" },
  { key: "DEALS_WON", label: "Deals won" },
  { key: "LEADS_CONVERTED", label: "Leads converted" },
  { key: "CALLS_LOGGED", label: "Calls logged" },
  { key: "MEETINGS_HELD", label: "Meetings held" },
  { key: "FIRST_TOUCHES", label: "First touches" },
];

const cellKey = (userId: string | null, metric: TargetMetric) => `${userId ?? ""}|${metric}`;

/**
 * One editable number.
 *
 * Commits on blur and on Enter, the way a spreadsheet does — a Save button per
 * cell in a grid of forty would be unusable. An emptied cell deletes the target
 * rather than writing 0: a zero target is a real statement ("we are not chasing
 * this metric this period") and must stay distinguishable from having no target
 * at all.
 */
function TargetCell({
  subject,
  metric,
  target,
  period,
  periodStart,
  canEdit,
}: {
  subject: Subject;
  metric: TargetMetric;
  target: Cell | undefined;
  period: TargetPeriod;
  periodStart: string;
  canEdit: boolean;
}) {
  const money = isMoneyMetric(metric);
  const [draft, setDraft] = useState(target ? String(target.value) : "");
  const [currency, setCurrency] = useState(target?.currency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The server is the source of truth after a revalidate. Adjusted during
  // render rather than in an effect — React's own pattern for resetting state
  // when a prop changes, and it avoids a frame showing the stale draft.
  const [seen, setSeen] = useState(target);
  if (seen !== target) {
    setSeen(target);
    setDraft(target ? String(target.value) : "");
    setCurrency(target?.currency ?? "");
    setError(null);
  }

  const revert = () => {
    setDraft(target ? String(target.value) : "");
    setCurrency(target?.currency ?? "");
  };

  const commit = () => {
    const raw = draft.trim();
    const code = money ? currency.trim().toUpperCase() : "";
    setError(null);

    if (raw === "") {
      setCurrency("");
      if (!target) return;
      start(async () => {
        const result = await deleteTargetAction(target.id);
        if (!result.ok) {
          revert();
          setError(result.error);
        }
      });
      return;
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      revert();
      setError("That is not a number");
      return;
    }

    const unchanged =
      target && value === target.value && (!money || code === (target.currency ?? ""));
    if (unchanged) return;

    start(async () => {
      const result = await setTargetAction({
        userId: subject.userId,
        metric,
        period,
        periodStart,
        value,
        // The currency rule lives in the service schema; this only forwards
        // what the metric can carry so a count never arrives with a code on it.
        currency: money ? code || null : null,
      });
      if (!result.ok) {
        setError(result.fieldErrors?.currency?.[0] ?? result.fieldErrors?.value?.[0] ?? result.error);
      }
    });
  };

  if (!canEdit) {
    if (!target) return <span className="text-[13px] text-muted">Not set</span>;
    return (
      <span className="text-[14px] tabular-nums">
        {money ? formatMoney(target.value, target.currency ?? "USD") : target.value.toLocaleString("en-US")}
      </span>
    );
  }

  const label = `${METRICS.find((m) => m.key === metric)?.label ?? metric} target for ${subject.name}`;

  return (
    <div className="space-y-1">
      {/*
       * One blur handler for the whole cell, not one per input.
       *
       * A revenue cell holds two controls, and tabbing from the number to the
       * currency beside it is not finishing the edit — committing there would
       * post an amount with no currency and bounce the service's own rule back
       * at the user mid-keystroke. `relatedTarget` outside this box means focus
       * has genuinely left the cell.
       */}
      <div
        aria-busy={pending || undefined}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          commit();
        }}
        className="flex items-center gap-1"
      >
        <Input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={draft}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              revert();
              setError(null);
            }
          }}
          className="min-w-0 flex-1 text-right tabular-nums"
        />
        {/* Only revenue carries a currency. Everything else is a count, and a
            count denominated in GBP is not a thing. */}
        {money ? (
          <Input
            type="text"
            maxLength={3}
            value={currency}
            placeholder="USD"
            aria-label={`Currency for ${label}`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-[3.6rem] shrink-0 px-1.5 text-center uppercase"
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MetricTable({
  title,
  description,
  caption,
  metrics,
  rows,
  byKey,
  period,
  periodStart,
  canEdit,
}: {
  title: string;
  description: string;
  caption: string;
  metrics: { key: TargetMetric; label: string }[];
  rows: Subject[];
  byKey: Map<string, Cell>;
  period: TargetPeriod;
  periodStart: string;
  canEdit: boolean;
}) {
  return (
    <Panel title={title} description={description} bodyClassName="p-0">
      <TableShell caption={caption}>
        <thead>
          <tr>
            <Th>Person</Th>
            {metrics.map((metric) => (
              <Th key={metric.key} align="right">
                {metric.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Tr key={row.userId ?? "team"}>
              <Td className="w-[220px]">
                <span className="flex items-center gap-2">
                  {row.userId === null ? (
                    <span
                      aria-hidden
                      className="flex size-[22px] shrink-0 items-center justify-center rounded-sm bg-[var(--tag-gray-bg)] text-[10px] font-semibold tracking-tight text-[var(--tag-gray-fg)]"
                    >
                      ALL
                    </span>
                  ) : (
                    <Avatar name={row.name} size={22} />
                  )}
                  <span className="truncate">{row.name}</span>
                </span>
              </Td>
              {metrics.map((metric) => (
                <Td key={metric.key} align="right">
                  <TargetCell
                    subject={row}
                    metric={metric.key}
                    target={byKey.get(cellKey(row.userId, metric.key))}
                    period={period}
                    periodStart={periodStart}
                    canEdit={canEdit}
                  />
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Panel>
  );
}

/**
 * People down, metrics across, split into the two things a target can be.
 *
 * The split is not decoration: a quota is committed and 100% is the
 * expectation, while an activity target is aspirational and 70% is a success.
 * Setting them in one undifferentiated grid is how a team learns that the two
 * are graded the same way, which is the Goodhart failure this feature exists to
 * avoid.
 */
export function TargetsGrid({
  rows,
  targets,
  period,
  periodStart,
  periodName,
  canEdit,
}: {
  rows: Subject[];
  targets: Cell[];
  period: TargetPeriod;
  /** ISO instant for the start of the period being edited. */
  periodStart: string;
  periodName: string;
  canEdit: boolean;
}) {
  const byKey = new Map(targets.map((t) => [cellKey(t.userId, t.metric), t]));

  const committed = METRICS.filter((m) => isOutcomeMetric(m.key));
  const aspirational = METRICS.filter((m) => !isOutcomeMetric(m.key));

  return (
    <div className="space-y-5">
      <MetricTable
        title={`Committed — ${periodName}`}
        description="Quota. 100% is the expectation, and a miss is a real miss."
        caption={`Committed targets for ${periodName}`}
        metrics={committed}
        rows={rows}
        byKey={byKey}
        period={period}
        periodStart={periodStart}
        canEdit={canEdit}
      />

      <MetricTable
        title={`Aspirational — ${periodName}`}
        description="Activity. 70% counts as a success, and these are graded that way everywhere they appear."
        caption={`Aspirational targets for ${periodName}`}
        metrics={aspirational}
        rows={rows}
        byKey={byKey}
        period={period}
        periodStart={periodStart}
        canEdit={canEdit}
      />

      {canEdit ? (
        <p className="text-[13px] text-muted">
          Numbers save when you leave a cell or press Enter. Clearing a cell removes the target
          entirely — a target of 0 means &ldquo;not chasing this&rdquo;, which is a different
          statement from having none.
        </p>
      ) : null}
    </div>
  );
}
