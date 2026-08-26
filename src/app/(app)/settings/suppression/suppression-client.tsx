"use client";

import { Ban, Search } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Td, TableShell, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  suppressAction,
  suppressManyAction,
  unsuppressAction,
} from "@/server/actions/suppression";

type Row = {
  id: string;
  email: string;
  reason: string;
  note: string | null;
  createdAt: Date;
  addedBy: string | null;
};

const REASONS = [
  { value: "UNSUBSCRIBED", label: "Unsubscribed" },
  { value: "BOUNCED", label: "Bounced" },
  { value: "COMPLAINED", label: "Marked as spam" },
  { value: "MANUAL", label: "Added by hand" },
] as const;

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  REASONS.map((r) => [r.value, r.label]),
);

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="border-b border-border-subtle px-5 py-3.5">
        <h3 className="t-heading">{title}</h3>
        <p className="mt-0.5 text-[13px] text-muted">{description}</p>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

export function SuppressionClient({
  rows,
  total,
  page,
  perPage,
  q,
  canWrite,
  canRemove,
}: {
  rows: Row[];
  total: number;
  page: number;
  perPage: number;
  q: string;
  canWrite: boolean;
  canRemove: boolean;
}) {
  const [mode, setMode] = useState<"one" | "many">("one");
  const [email, setEmail] = useState("");
  const [blob, setBlob] = useState("");
  const [reason, setReason] = useState<string>("UNSUBSCRIBED");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const addOne = () =>
    start(async () => {
      const result = await suppressAction({ email, reason, note: note || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEmail("");
      setNote("");
      toast.success(
        result.data.added ? "Added to the do-not-contact list" : "That address was already on it",
      );
    });

  const addMany = () =>
    start(async () => {
      const result = await suppressManyAction({ emails: blob, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBlob("");
      const { added, alreadyPresent, rejected } = result.data;
      // Every number reported, including what could not be read: a paste that
      // silently drops four rows is how a list ends up with holes in it.
      const parts = [`${added} added`];
      if (alreadyPresent > 0) parts.push(`${alreadyPresent} already there`);
      if (rejected > 0) parts.push(`${rejected} unreadable`);
      toast.success(parts.join(", "));
    });

  const remove = (row: Row) =>
    start(async () => {
      const result = await unsuppressAction(row.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(`${row.email} can be contacted again`);
    });

  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const href = (next: number) =>
    `/settings/suppression?${new URLSearchParams({ ...(q ? { q } : {}), page: String(next) })}`;

  return (
    <div className="space-y-5">
      <Callout tone="info">
        This list is enforced when someone is enrolled in a campaign, not only when a message is
        sent. A suppressed address cannot be added to a sequence at all.
      </Callout>

      {canWrite ? (
        <Section
          title="Add addresses"
          description="Paste an unsubscribe export, or add one address with a note."
        >
          <div className="flex gap-1 rounded-lg border border-border-subtle bg-page p-0.5 w-fit">
            {(["one", "many"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[13px] transition-colors",
                  mode === value
                    ? "bg-accent-soft font-[560] text-accent"
                    : "text-secondary hover:text-foreground",
                )}
              >
                {value === "one" ? "One address" : "Paste a list"}
              </button>
            ))}
          </div>

          <Field label="Reason" htmlFor="reason">
            <Select
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-xs"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          {mode === "one" ? (
            <>
              <Field label="Email address" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  value={email}
                  placeholder="name@company.com"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && email.trim() !== "") addOne();
                  }}
                />
              </Field>
              <Field
                label="Note"
                htmlFor="note"
                hint="Optional. Why this address is on the list — useful a year from now."
              >
                <Input
                  id="note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <Button size="sm" onClick={addOne} loading={pending} disabled={email.trim() === ""}>
                Add address
              </Button>
            </>
          ) : (
            <>
              <Field
                label="Addresses"
                htmlFor="blob"
                hint="One per line, or separated by commas. Headers and stray names are skipped and counted rather than failing the paste."
              >
                <Textarea
                  id="blob"
                  value={blob}
                  rows={6}
                  placeholder={"name@company.com\nother@company.com"}
                  onChange={(e) => setBlob(e.target.value)}
                />
              </Field>
              <Button size="sm" onClick={addMany} loading={pending} disabled={blob.trim() === ""}>
                Add all
              </Button>
            </>
          )}
        </Section>
      ) : null}

      <section className="rounded-md border border-border-subtle bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <h3 className="t-heading">
            {total === 1 ? "1 address" : `${total.toLocaleString()} addresses`}
          </h3>
          <form role="search" className="relative">
            <Search
              size={14}
              strokeWidth={1.75}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search addresses…"
              aria-label="Search the do-not-contact list"
              className="w-56 pl-8"
            />
          </form>
        </header>

        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Ban}
              title={q ? "No matching addresses" : "Nobody is suppressed yet"}
              hint={
                q
                  ? "Try a different search."
                  : "Unsubscribes and bounces land here automatically once sending exists. Until then, add them by hand."
              }
            />
          </div>
        ) : (
          <TableShell caption={`Do not contact, ${total} total, page ${page}`}>
            <thead>
              <tr>
                <Th>Address</Th>
                <Th>Reason</Th>
                <Th>Added by</Th>
                {canRemove ? (
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <span className="font-[510]">{row.email}</span>
                    {row.note ? (
                      <span className="block truncate text-[12px] text-muted">{row.note}</span>
                    ) : null}
                  </Td>
                  <Td className="text-secondary">
                    {REASON_LABEL[row.reason] ?? row.reason.toLowerCase()}
                  </Td>
                  <Td className="text-secondary">{row.addedBy ?? "Automatically"}</Td>
                  {canRemove ? (
                    <Td align="right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => remove(row)}
                      >
                        Remove
                      </Button>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}

        {lastPage > 1 ? (
          <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3 text-[13px]">
            <span className="text-muted">
              Page {page} of {lastPage}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Link href={href(page - 1)} className="text-secondary hover:text-foreground">
                  Previous
                </Link>
              ) : null}
              {page < lastPage ? (
                <Link href={href(page + 1)} className="text-secondary hover:text-foreground">
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
