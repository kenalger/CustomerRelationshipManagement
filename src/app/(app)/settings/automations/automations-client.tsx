"use client";

import { Plus, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { PageToolbar } from "@/components/page-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn, timeAgo } from "@/lib/utils";
import {
  createAutomationAction,
  setAutomationEnabledAction,
} from "@/server/actions/automation";
import { RUN_LABEL, type RecordKind, supportsConditions } from "./shared";

type Row = {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  triggerLabel: string;
  enabled: boolean;
  stepCount: number;
  runCount: number;
  sentence: string;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
};

type TriggerOption = { value: string; label: string; hint: string; kind: RecordKind };

/**
 * The armed/draft control.
 *
 * A switch, not a checkbox, and always beside the word — "On" and "Off" are
 * what carry the state, the colour only reinforces it. Below ADMIN the same
 * component renders as a plain word, so a manager sees the truth rather than a
 * control that looks broken when they press it.
 */
function EnableSwitch({
  row,
  canArm,
  pending,
  onToggle,
}: {
  row: Row;
  canArm: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  const word = row.enabled ? "On" : "Draft";

  if (!canArm) {
    return (
      <span className="inline-flex items-center gap-2">
        <Badge tone={row.enabled ? "success" : "neutral"}>{word}</Badge>
      </span>
    );
  }

  // A rule with no steps cannot be armed — the service refuses it, so the
  // control says why rather than letting someone press it and read an error.
  const blocked = !row.enabled && row.stepCount === 0;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={row.enabled}
        aria-label={`${row.enabled ? "Turn off" : "Turn on"} ${row.name}`}
        disabled={pending || blocked}
        title={blocked ? "Add at least one step before turning this on" : undefined}
        onClick={() => onToggle(!row.enabled)}
        className={cn(
          "inline-flex h-[18px] w-8 shrink-0 items-center rounded-sm border p-px transition-colors duration-100",
          "disabled:cursor-not-allowed disabled:opacity-50",
          row.enabled
            ? "justify-end border-accent bg-accent"
            : "justify-start border-border-strong bg-hover",
        )}
      >
        <span aria-hidden className="block size-3.5 rounded-xs bg-surface" />
      </button>
      <span className={cn("text-[13px]", row.enabled ? "font-[560] text-foreground" : "text-muted")}>
        {word}
      </span>
    </span>
  );
}

function LastRun({ row }: { row: Row }) {
  if (row.lastRunAt) {
    return (
      <span className="inline-flex flex-col">
        <span className="text-[13px] tabular-nums">{timeAgo(row.lastRunAt)}</span>
        <span className="text-[12px] text-muted">
          {RUN_LABEL[row.lastRunStatus ?? ""] ?? row.lastRunStatus}
        </span>
      </span>
    );
  }
  if (row.runCount === 0) {
    return <span className="text-[13px] text-muted">Never run</span>;
  }
  // Ran, but further back than the window this page reads. Not "never", and
  // not a dash that could be misread as zero.
  return (
    <span className="text-[13px] text-muted" title={`${row.runCount} runs recorded`}>
      Not in the recent log
    </span>
  );
}

function NewAutomationForm({
  triggerOptions,
  onCancel,
}: {
  triggerOptions: TriggerOption[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState(triggerOptions[0]?.value ?? "LEAD_CREATED");
  const [limit, setLimit] = useState("500");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const chosen = triggerOptions.find((option) => option.value === trigger);
  const parsedLimit = Number.parseInt(limit, 10);

  const submit = () =>
    start(async () => {
      setFieldErrors({});
      const result = await createAutomationAction({
        name: name.trim(),
        description: description.trim() || undefined,
        trigger,
        dailyRunLimit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Draft created — add its steps, then turn it on");
      router.push(`/settings/automations/${result.data.id}`);
    });

  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="border-b border-border-subtle px-5 py-3.5">
        <h3 className="t-heading">New automation</h3>
        <p className="mt-0.5 text-[13px] text-muted">
          Pick what it listens for. The trigger cannot be changed afterwards — both the conditions
          and the steps are validated against the kind of record it is about.
        </p>
      </header>

      <div className="space-y-4 p-5">
        <Field label="Name" htmlFor="new-name" error={fieldErrors.name}>
          <Input
            id="new-name"
            autoFocus
            value={name}
            maxLength={80}
            placeholder="Route hot leads to the duty rep"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="new-description"
          hint="Optional. Why this rule exists — worth writing for whoever inherits it."
          error={fieldErrors.description}
        >
          <Textarea
            id="new-description"
            value={description}
            rows={2}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <Field
          label="Trigger"
          htmlFor="new-trigger"
          hint={chosen?.hint}
          error={fieldErrors.trigger}
        >
          <Select
            id="new-trigger"
            value={trigger}
            onChange={(event) => setTrigger(event.target.value)}
            className="max-w-sm"
          >
            {triggerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {chosen && !supportsConditions(chosen.kind) ? (
          <Callout tone="info">
            A {chosen.kind.toLowerCase()} rule cannot carry conditions — the condition vocabulary is
            the lead filter, and there is no deal or task equivalent. It will run every time the
            trigger fires.
          </Callout>
        ) : null}

        <Field
          label="Daily run limit"
          htmlFor="new-limit"
          hint="The most records this rule may touch in a day. It stops and says so rather than writing thousands of rows."
          error={fieldErrors.dailyRunLimit}
        >
          <Input
            id="new-limit"
            type="number"
            min={1}
            max={50000}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            className="w-32 tabular-nums"
          />
        </Field>

        <Callout tone="warning">
          It is created as a draft and will not touch a single record until an admin turns it on.
        </Callout>

        <div className="flex gap-2">
          <Button size="sm" onClick={submit} loading={pending} disabled={name.trim() === ""}>
            Create draft
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}

export function AutomationsClient({
  rows,
  triggerOptions,
  canWrite,
  canArm,
}: {
  rows: Row[];
  triggerOptions: TriggerOption[];
  canWrite: boolean;
  canArm: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (row: Row, next: boolean) => {
    setBusyId(row.id);
    start(async () => {
      const result = await setAutomationEnabledAction(row.id, next);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // The toast repeats the sentence, because "enabled" on its own does not
      // tell you what is now happening to live records.
      toast.success(next ? `Live — ${row.sentence}` : `${row.name} is a draft again`);
    });
  };

  return (
    <div className="space-y-5">
      <PageToolbar
        actions={
          canWrite && !creating ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} strokeWidth={2} />
              New automation
            </Button>
          ) : null
        }
      />

      {creating ? (
        <NewAutomationForm triggerOptions={triggerOptions} onCancel={() => setCreating(false)} />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No automations yet"
          hint="An automation is one sentence: when something happens in the CRM, do these things. For example — when a lead is created and its score is at least 70, give it to whoever has the fewest open leads and raise a call task due today."
          action={
            canWrite && !creating ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={13} strokeWidth={2} />
                New automation
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableShell caption={`${rows.length} automations`}>
          <thead>
            <tr>
              <Th>Automation</Th>
              <Th>Trigger</Th>
              <Th>State</Th>
              <Th>Last run</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <Link
                    href={`/settings/automations/${row.id}`}
                    className="font-[510] text-foreground decoration-border-strong underline-offset-2 hover:underline"
                  >
                    {row.name}
                  </Link>
                  {/* The rule as a sentence, on every row, so nobody has to
                      open the editor to find out what it does. */}
                  <span className="mt-0.5 block text-[12px] text-muted">{row.sentence}</span>
                </Td>
                <Td className="text-secondary">{row.triggerLabel}</Td>
                <Td>
                  <EnableSwitch
                    row={row}
                    canArm={canArm}
                    pending={pending && busyId === row.id}
                    onToggle={(next) => toggle(row, next)}
                  />
                </Td>
                <Td>
                  <LastRun row={row} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {rows.length > 0 && !canArm ? (
        <p className="text-[12px] text-muted">
          {canWrite
            ? "You can write and edit a rule here. Turning one on or off is an admin action — arming it is a separate permission because a live rule changes real records."
            : "Automations are read-only for your role. Writing a rule needs a manager; turning one on needs an admin."}
        </p>
      ) : null}
    </div>
  );
}
