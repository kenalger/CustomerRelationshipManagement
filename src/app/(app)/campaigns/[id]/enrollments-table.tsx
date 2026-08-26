"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Td, TableShell, Th, Tr } from "@/components/ui/table";
import { timeUntil } from "@/lib/utils";
import { enrollListAction, stopEnrollmentAction } from "@/server/actions/campaigns";

type Row = {
  id: string;
  kind: "contact" | "lead";
  recordId: string | null;
  name: string;
  detail: string | null;
  state: string;
  currentPosition: number;
  nextDueAt: Date | null;
  completedAt: Date | null;
  variantLabel: string | null;
  stoppedReason: string | null;
};

const STATE: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Running", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Finished", tone: "info" },
  STOPPED: { label: "Stopped", tone: "neutral" },
};

/** When the next step falls due, in words. A null due date means nothing is scheduled. */
function Due({ at }: { at: Date | null }) {
  if (!at) return <span className="text-muted">—</span>;

  return (
    <span className="tabular-nums" title={at.toLocaleString()}>
      {timeUntil(at)}
    </span>
  );
}

/** Stop needs a reason, so it is a two-step control rather than one button. */
function StopControl({
  row,
  campaignId,
  disabled,
}: {
  row: Row;
  campaignId: string;
  disabled: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  if (!asking) {
    return (
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setAsking(true)}>
        Stop
      </Button>
    );
  }

  const stop = () => {
    const trimmed = reason.trim();
    if (trimmed === "") return;
    start(async () => {
      const result = await stopEnrollmentAction(campaignId, row.id, trimmed);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAsking(false);
      setReason("");
      toast.success(`${row.name} stopped`);
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        autoFocus
        value={reason}
        maxLength={200}
        placeholder="Replied, bounced…"
        aria-label={`Reason for stopping ${row.name}`}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") stop();
          if (e.key === "Escape") setAsking(false);
        }}
        className="h-7 w-40"
      />
      <Button size="sm" onClick={stop} loading={pending} disabled={reason.trim() === ""}>
        Stop
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function EnrollmentsTable({
  campaignId,
  rows,
  stepCount,
  total,
  page,
  pageCount,
  capped,
  canWrite,
}: {
  campaignId: string;
  rows: Row[];
  stepCount: number;
  total: number;
  page: number;
  pageCount: number;
  capped: boolean;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();

  const enrollFromList = () =>
    start(async () => {
      const result = await enrollListAction(campaignId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { enrolled, alreadyEnrolled, skipped, suppressed } = result.data;
      // Every number, including what was dropped: a silent skip is how someone
      // concludes a campaign reached people it never touched. Suppressed is
      // reported separately from skipped — one is a rule working as intended,
      // the other is a record this person could not see.
      const parts = [`${enrolled} enrolled`];
      if (alreadyEnrolled > 0) parts.push(`${alreadyEnrolled} already in`);
      if (suppressed > 0) parts.push(`${suppressed} on the do-not-contact list`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      toast.success(parts.join(", "));
    });

  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
        <div>
          <h3 className="t-heading">
            {total === 1 ? "1 prospect" : `${total.toLocaleString()} prospects`}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            Who is in this campaign, which step they are on, and when the next one falls due.
          </p>
        </div>
        {canWrite ? (
          <Button size="sm" variant="secondary" onClick={enrollFromList} loading={pending}>
            Enrol from the list
          </Button>
        ) : null}
      </header>

      {capped ? (
        <p className="border-b border-border-subtle px-5 py-2 text-[13px] text-muted">
          Showing the most recent enrollments only — this campaign has more than the page limit.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={Users}
            title="Nobody is enrolled yet"
            hint="Attach a prospect list to this campaign, then enrol it. Suppressed addresses are refused here rather than at send time."
          />
        </div>
      ) : (
        <TableShell caption={`Enrollments, ${total} total, page ${page}`}>
          <thead>
            <tr>
              <Th>Prospect</Th>
              <Th>State</Th>
              <Th align="right">Step</Th>
              <Th align="right">Next due</Th>
              {canWrite ? (
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = STATE[row.state] ?? { label: row.state, tone: "neutral" as Tone };
              const href = row.recordId
                ? row.kind === "contact"
                  ? `/contacts/${row.recordId}`
                  : `/leads?q=${encodeURIComponent(row.detail ?? "")}`
                : null;

              return (
                <Tr key={row.id}>
                  <Td>
                    {href ? (
                      <Link href={href} className="font-[510] hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-[510] text-muted">{row.name}</span>
                    )}
                    {row.detail ? (
                      <span className="block truncate text-[12px] text-muted">{row.detail}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {row.stoppedReason ? (
                      <span className="block truncate text-[12px] text-muted">
                        {row.stoppedReason}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" className="tabular-nums text-secondary">
                    {/* Position 0 means "enrolled, first step not reached yet". */}
                    {row.currentPosition === 0 ? "Not started" : `${row.currentPosition} of ${stepCount}`}
                    {row.variantLabel ? (
                      <span className="block text-[12px] text-muted">Variant {row.variantLabel}</span>
                    ) : null}
                  </Td>
                  <Td align="right" className="text-secondary">
                    <Due at={row.nextDueAt} />
                  </Td>
                  {canWrite ? (
                    <Td align="right">
                      {row.state === "ACTIVE" || row.state === "PAUSED" ? (
                        <StopControl row={row} campaignId={campaignId} disabled={pending} />
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3 text-[13px]">
          <span className="text-muted">
            Page {page} of {pageCount}
          </span>
          <span className="flex gap-3">
            {page > 1 ? (
              <Link
                href={`/campaigns/${campaignId}?page=${page - 1}`}
                className="text-secondary hover:text-foreground"
              >
                Previous
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={`/campaigns/${campaignId}?page=${page + 1}`}
                className="text-secondary hover:text-foreground"
              >
                Next
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}
