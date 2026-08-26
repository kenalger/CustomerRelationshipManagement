"use client";

import Link from "next/link";

import { BulkBar } from "@/components/crm/bulk-bar";
import {
  RowCheckbox,
  SelectAllCheckbox,
  SelectionProvider,
} from "@/components/crm/selection";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Dot, type Tone } from "@/components/ui/badge";
import { SortableTh, Td, TableShell, Th, Tr } from "@/components/ui/table";
import { timeAgo } from "@/lib/utils";
import {
  assignLeadsAction,
  convertLeadsAction,
  setLeadStatusAction,
} from "@/server/actions/bulk";
import { LeadRowActions } from "./lead-row-actions";

export type LeadRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  companyName: string | null;
  source: string;
  status: string;
  score: number;
  scoredAt: Date | null;
  createdAt: Date;
  firstTouchedAt: Date | null;
  ageMinutes: number;
  ownerName: string | null;
};

const STATUS_TONE: Record<string, Tone> = {
  NEW: "info",
  WORKING: "warning",
  QUALIFIED: "success",
  CONVERTED: "neutral",
  JUNK: "danger",
};

/**
 * The score, as a number with a bar behind it.
 *
 * A bare integer in a column of integers is hard to rank at a glance, and a
 * badge would spend the accent budget on every row. The bar is the neutral
 * border colour at a width proportional to the score — comparison without
 * colour, which also means it still reads in the CVD and print cases.
 *
 * `scoredAt === null` shows a dash, not a 0: `score` defaults to 0, so an
 * unscored lead would otherwise look like one judged worthless.
 */
function ScoreCell({ score, scoredAt }: { score: number; scoredAt: Date | null }) {
  if (scoredAt === null) {
    return (
      <span className="text-[12px] text-muted" title="Not scored yet">
        —
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded-xs bg-hover">
        <span
          className="block h-full rounded-xs bg-border-strong"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </span>
      <span className="w-6 text-right text-[13px] tabular-nums">{score}</span>
    </span>
  );
}

function AgeCell({
  row,
  warnAfter,
  dangerAfter,
}: {
  row: LeadRow;
  warnAfter: number;
  dangerAfter: number;
}) {
  if (row.firstTouchedAt) {
    return <span className="text-[12px] text-muted tabular-nums">{timeAgo(row.createdAt)}</span>;
  }
  const tone: Tone =
    row.ageMinutes >= dangerAfter ? "danger" : row.ageMinutes >= warnAfter ? "warning" : "neutral";
  return (
    <Badge tone={tone}>
      <Dot tone={tone} />
      {timeAgo(row.createdAt)}
    </Badge>
  );
}

export function LeadsTable({
  rows,
  total,
  page,
  sort,
  dir,
  status,
  q,
  warnAfter,
  dangerAfter,
  assignees,
  canWrite,
}: {
  rows: LeadRow[];
  total: number;
  page: number;
  sort: string;
  dir: "asc" | "desc";
  status: string;
  q: string;
  warnAfter: number;
  dangerAfter: number;
  assignees: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const ids = rows.map((r) => r.id);
  // Filters ride along in the sort links so sorting does not clear the search.
  const carried = { status: status || undefined, q: q || undefined };

  return (
    <SelectionProvider ids={ids}>
      <TableShell caption={`Leads, ${total} total, page ${page}`}>
        <thead>
          <tr>
            {canWrite ? (
              <Th className="w-8">
                <SelectAllCheckbox />
              </Th>
            ) : null}
            <Th>Name</Th>
            <SortableTh column="companyName" activeSort={sort} activeDir={dir} basePath="/leads" params={carried}>
              Company
            </SortableTh>
            <SortableTh column="source" activeSort={sort} activeDir={dir} basePath="/leads" params={carried}>
              Source
            </SortableTh>
            <SortableTh column="status" activeSort={sort} activeDir={dir} basePath="/leads" params={carried}>
              Status
            </SortableTh>
            <Th>Owner</Th>
            <SortableTh column="score" activeSort={sort} activeDir={dir} basePath="/leads" params={carried} align="right">
              Score
            </SortableTh>
            <SortableTh column="createdAt" activeSort={sort} activeDir={dir} basePath="/leads" params={carried} align="right">
              Age
            </SortableTh>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = [row.firstName, row.lastName].filter(Boolean).join(" ") || "—";
            return (
              <Tr key={row.id}>
                {canWrite ? (
                  <Td>
                    <RowCheckbox id={row.id} label={name} />
                  </Td>
                ) : null}
                <Td>
                  <span className="font-[510]">{name}</span>
                  {row.email ? (
                    <span className="block truncate text-[12px] text-muted">{row.email}</span>
                  ) : null}
                </Td>
                <Td className="text-secondary">{row.companyName ?? "—"}</Td>
                <Td>
                  <span className="text-[12px] text-muted">
                    {row.source.replaceAll("_", " ").toLowerCase()}
                  </span>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                    {row.status.toLowerCase()}
                  </Badge>
                </Td>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <Avatar name={row.ownerName} size={18} />
                    <span className="truncate text-[12px] text-secondary">
                      {row.ownerName ?? "Unassigned"}
                    </span>
                  </span>
                </Td>
                <Td align="right">
                  <ScoreCell score={row.score} scoredAt={row.scoredAt} />
                </Td>
                <Td align="right">
                  <AgeCell row={row} warnAfter={warnAfter} dangerAfter={dangerAfter} />
                </Td>
                <Td align="right">
                  <LeadRowActions
                    leadId={row.id}
                    status={row.status}
                    touched={Boolean(row.firstTouchedAt)}
                  />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>

      {canWrite ? (
        <BulkBar
          noun="lead"
          assignees={assignees}
          onAssign={assignLeadsAction}
          actions={[
            { label: "Mark worked", run: (ids) => setLeadStatusAction(ids, "WORKING") },
            { label: "Convert", variant: "primary", run: convertLeadsAction },
            {
              label: "Junk",
              variant: "danger",
              confirm: "Mark {n} leads as junk? This stops their SLA timers.",
              run: (ids) => setLeadStatusAction(ids, "JUNK"),
            },
          ]}
        />
      ) : null}

      <span className="sr-only">
        <Link href="/leads">Reset filters</Link>
      </span>
    </SelectionProvider>
  );
}
