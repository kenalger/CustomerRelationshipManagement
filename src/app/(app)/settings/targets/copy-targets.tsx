"use client";

import { CopyPlus } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { TargetPeriod } from "@/generated/prisma/enums";
import { copyTargetsAction } from "@/server/actions/targets";

type Outcome =
  | { kind: "error"; text: string }
  | { kind: "copied"; text: string }
  | { kind: "nothing"; text: string };

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Copy last period's numbers forward.
 *
 * The result is reported in full, in place, and stays on screen: `copyTargets`
 * skips any cell that already holds a number, and a skip that is not stated is
 * how a manager comes to believe a quota was set when it was not. A toast would
 * be worse than nothing here — it disappears while they are still reading the
 * grid it is describing.
 */
export function CopyTargets({
  period,
  fromPeriodStart,
  toPeriodStart,
  fromName,
  toName,
  available,
}: {
  period: TargetPeriod;
  fromPeriodStart: string;
  toPeriodStart: string;
  fromName: string;
  toName: string;
  /** How many targets the previous period holds, so the button can say. */
  available: number;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    setOutcome(null);
    start(async () => {
      const result = await copyTargetsAction({ period, fromPeriodStart, toPeriodStart });

      if (!result.ok) {
        setOutcome({ kind: "error", text: result.error });
        return;
      }

      const { copied, skipped } = result.data;
      const skippedNote =
        skipped === 0
          ? "Nothing was skipped."
          : `${plural(skipped, "target was", "targets were")} skipped because ${
              skipped === 1 ? "that cell" : "those cells"
            } already had a number for ${toName} — copying never overwrites a figure you have already adjusted.`;

      setOutcome(
        copied === 0
          ? { kind: "nothing", text: `Nothing was copied. ${skippedNote}` }
          : {
              kind: "copied",
              text: `Copied ${plural(copied, "target", "targets")} from ${fromName} into ${toName}. ${skippedNote}`,
            },
      );
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface px-5 py-3.5">
        <div className="min-w-0">
          <p className="t-label text-foreground">Copy from {fromName}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {available === 0
              ? `${fromName} has no targets to copy.`
              : `${plural(available, "target", "targets")} in ${fromName}. Cells that already have a number for ${toName} are left alone.`}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={run}
          loading={pending}
          disabled={available === 0}
        >
          <CopyPlus size={14} aria-hidden />
          Copy forward
        </Button>
      </div>

      {/* Every branch is stated, including the one where nothing happened. */}
      {outcome ? (
        <Callout
          tone={
            outcome.kind === "error" ? "danger" : outcome.kind === "nothing" ? "warning" : "success"
          }
        >
          {outcome.text}
        </Callout>
      ) : null}
    </div>
  );
}
