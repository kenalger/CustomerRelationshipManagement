"use client";

import { ChevronDown, ChevronRight, History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn, timeAgo } from "@/lib/utils";
import { ACTION_LABEL, RUN_LABEL, RUN_TONE, type RunRow, explainRun } from "../shared";

/**
 * Which record a run was about.
 *
 * Only a deal has a detail page to link to, so the other two kinds render as
 * their id rather than as a link that would 404. The id is the honest answer:
 * a run outlives the record it touched, and the row deliberately holds no
 * foreign key back to it.
 */
function RecordCell({ run }: { run: RunRow }) {
  const short = `${run.recordId.slice(0, 8)}…`;

  if (run.recordKind === "DEAL") {
    return (
      <Link
        href={`/deals/${run.recordId}`}
        title={run.recordId}
        className="font-mono text-[12px] text-foreground decoration-border-strong underline-offset-2 hover:underline"
      >
        Deal {short}
      </Link>
    );
  }

  // `AutomationRun.recordKind` is a plain String column, so an unrecognised
  // value is rendered as itself rather than being silently relabelled.
  const noun = run.recordKind === "LEAD" ? "Lead" : run.recordKind === "TASK" ? "Task" : run.recordKind;

  return (
    <span title={run.recordId} className="font-mono text-[12px] text-secondary">
      {noun} {short}
    </span>
  );
}

function StepLog({ run }: { run: RunRow }) {
  return (
    <div className="space-y-2 bg-sunken px-4 py-3">
      {/* The reason comes first: on a SKIPPED row it is the whole point of
          opening this. */}
      <p className="text-[13px] text-secondary">{explainRun(run)}</p>

      {run.log && run.log.length > 0 ? (
        <ol className="space-y-1">
          {run.log.map((entry) => (
            <li key={entry.position} className="flex items-baseline gap-2 text-[12px]">
              <span className="w-4 shrink-0 text-right tabular-nums text-muted">
                {entry.position}
              </span>
              <span className="shrink-0 font-[510]">
                {ACTION_LABEL[entry.action] ?? entry.action}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  entry.outcome === "ok" ? "text-success" : "text-danger",
                )}
              >
                {entry.outcome === "ok" ? "ok" : "failed"}
              </span>
              <span className="min-w-0 text-muted">{entry.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12px] text-muted">No step ran, so there is nothing to log.</p>
      )}

      <p className="text-[12px] text-muted tabular-nums">
        Started {timeAgo(run.startedAt)}
        {run.finishedAt ? ` · finished ${timeAgo(run.finishedAt)}` : " · never finished"}
      </p>
    </div>
  );
}

export function RunHistory({ runs }: { runs: RunRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No runs recorded"
        hint="Every pass this rule makes at a record is logged here — including the ones where it decided to do nothing, and why."
      />
    );
  }

  return (
    <div className="space-y-3">
      <TableShell caption={`The last ${runs.length} runs`}>
        <thead>
          <tr>
            <Th>Outcome</Th>
            <Th>Record</Th>
            <Th>Started</Th>
            <Th>Why</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const open = openId === run.id;
            return [
              <Tr key={run.id}>
                <Td>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`run-${run.id}`}
                    onClick={() => setOpenId(open ? null : run.id)}
                    className="inline-flex items-center gap-1.5 text-left"
                  >
                    {open ? (
                      <ChevronDown size={13} strokeWidth={2} aria-hidden className="text-muted" />
                    ) : (
                      <ChevronRight size={13} strokeWidth={2} aria-hidden className="text-muted" />
                    )}
                    <Badge tone={RUN_TONE[run.status] ?? "neutral"}>
                      {RUN_LABEL[run.status] ?? run.status}
                    </Badge>
                  </button>
                </Td>
                <Td>
                  <RecordCell run={run} />
                </Td>
                <Td className="tabular-nums text-secondary">{timeAgo(run.startedAt)}</Td>
                <Td className="max-w-md">
                  <span className="block truncate text-[13px] text-secondary">
                    {explainRun(run)}
                  </span>
                </Td>
              </Tr>,
              open ? (
                <tr key={`${run.id}-detail`} id={`run-${run.id}`}>
                  <td colSpan={4} className="border-b border-border-subtle p-0">
                    <StepLog run={run} />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </TableShell>

      <p className="text-[12px] text-muted">
        A repeat of an event the rule has already handled is dropped without writing a row, so a
        retried webhook leaves no trace here rather than a second run.
      </p>
    </div>
  );
}
