"use client";

import { ChevronDown, ChevronUp, ListOrdered, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  addStepAction,
  removeStepAction,
  reorderStepsAction,
  updateStepAction,
} from "@/server/actions/campaigns";

type Step = {
  id: string;
  position: number;
  delayMinutes: number;
  instruction: string | null;
  template: { id: string; name: string; subject: string } | null;
};

const UNITS = [
  { value: "minutes", label: "minutes", minutes: 1 },
  { value: "hours", label: "hours", minutes: 60 },
  { value: "days", label: "days", minutes: 1440 },
] as const;

type Unit = (typeof UNITS)[number]["value"];

/** The service caps a delay at a year; the form should not offer more. */
const MAX_MINUTES = 525_600;

/** Picks the coarsest unit that divides evenly, so 4320 comes back as 3 days. */
function splitDelay(minutes: number): { value: number; unit: Unit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days % 7 === 0 ? plural(days / 7, "week") : plural(days, "day");
  }
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The delay in the words the schema means it in.
 *
 * `delayMinutes` is measured from the PREVIOUS step completing, not from
 * enrollment — so "4320" on step three means three days after step two, and a
 * bare number in a column would be read as three days after they signed up.
 */
function delaySentence(position: number, minutes: number): string {
  if (position <= 1) {
    return minutes === 0
      ? "As soon as they are enrolled"
      : `${formatDuration(minutes)} after they are enrolled`;
  }
  return minutes === 0
    ? `Straight after step ${position - 1}`
    : `${formatDuration(minutes)} after step ${position - 1} completes`;
}

/* ── The one form, used to add a step and to edit one ────────────────────── */

function StepForm({
  idPrefix,
  initial,
  templates,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  initial: { delayMinutes: number; templateId: string; instruction: string };
  templates: { id: string; name: string }[];
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: { delayMinutes: number; templateId: string; instruction: string }) => void;
  onCancel: () => void;
}) {
  const split = splitDelay(initial.delayMinutes);
  const [amount, setAmount] = useState(String(split.value));
  const [unit, setUnit] = useState<Unit>(split.unit);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [error, setError] = useState<string | null>(null);

  const perUnit = UNITS.find((u) => u.value === unit)?.minutes ?? 1;
  const minutes = Math.max(0, Math.round(Number(amount) || 0)) * perUnit;
  const overCap = minutes > MAX_MINUTES;

  return (
    <form
      className="space-y-4 bg-sunken px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Mirrors the service's own refine, so the common mistake is caught
        // before a round trip rather than after one.
        if (!templateId && instruction.trim() === "") {
          setError("A step needs a template or an instruction — otherwise the task says nothing");
          return;
        }
        if (overCap) {
          setError("That delay is longer than a year");
          return;
        }
        setError(null);
        onSubmit({ delayMinutes: minutes, templateId, instruction });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="t-label block text-foreground">Wait before this step</span>
          <div className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-delay`}
              type="number"
              min={0}
              step={1}
              value={amount}
              aria-label="Delay amount"
              className="w-24"
              onChange={(event) => setAmount(event.target.value)}
            />
            <Select
              value={unit}
              aria-label="Delay unit"
              className="w-32"
              onChange={(event) => setUnit(event.target.value as Unit)}
            >
              {UNITS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[12px] text-muted">
            Counted from the step before it finishing, not from enrolment.
          </p>
        </div>

        <Field
          label="Template"
          htmlFor={`${idPrefix}-template`}
          hint={
            templates.length === 0
              ? "No templates yet — write one in Settings → Email templates."
              : "The copy the task carries. Optional if the instruction says enough."
          }
        >
          <Select
            id={`${idPrefix}-template`}
            value={templateId}
            disabled={templates.length === 0}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">No template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Instruction"
        htmlFor={`${idPrefix}-instruction`}
        hint="What the person working this step actually does. It becomes the task's title."
      >
        <Textarea
          id={`${idPrefix}-instruction`}
          value={instruction}
          maxLength={1000}
          rows={2}
          placeholder="Send the intro email, then note anything they reply with"
          onChange={(event) => setInstruction(event.target.value)}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ── One step in read mode ───────────────────────────────────────────────── */

function StepRow({
  step,
  templates,
  canManage,
  canDelete,
  canMoveUp,
  canMoveDown,
  onMove,
  campaignId,
}: {
  step: Step;
  templates: { id: string; name: string }[];
  canManage: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  campaignId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pending, start] = useTransition();

  if (editing) {
    return (
      <li className="border-b border-border-subtle last:border-b-0">
        <StepForm
          idPrefix={`step-${step.id}`}
          initial={{
            delayMinutes: step.delayMinutes,
            templateId: step.template?.id ?? "",
            instruction: step.instruction ?? "",
          }}
          templates={templates}
          submitLabel="Save step"
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(values) =>
            start(async () => {
              const result = await updateStepAction(campaignId, step.id, {
                delayMinutes: values.delayMinutes,
                templateId: values.templateId,
                instruction: values.instruction,
              });
              if (result.ok) setEditing(false);
              else toast.error(result.error);
            })
          }
        />
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-3 border-b border-border-subtle px-5 py-3.5 last:border-b-0">
      <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-sm bg-[var(--tag-gray-bg)] text-[12px] font-[560] tabular-nums text-[var(--tag-gray-fg)]">
        {step.position}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-foreground">
          {delaySentence(step.position, step.delayMinutes)}
        </p>
        <p className="mt-0.5 text-[13px] text-secondary">
          {step.template ? (
            <>
              <span className="text-muted">Template</span> {step.template.name}
              <span className="text-muted"> · &ldquo;{step.template.subject}&rdquo;</span>
            </>
          ) : (
            <span className="text-muted">No template — the instruction is the whole task</span>
          )}
        </p>
        {step.instruction ? (
          <p className="mt-1 text-[13px] text-secondary">{step.instruction}</p>
        ) : null}
      </div>

      {canManage || canDelete ? (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {canManage ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Move step ${step.position} earlier`}
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              >
                <ChevronUp size={15} strokeWidth={1.75} aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Move step ${step.position} later`}
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              >
                <ChevronDown size={15} strokeWidth={1.75} aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Edit step ${step.position}`}
                onClick={() => setEditing(true)}
              >
                <Pencil size={14} strokeWidth={1.75} aria-hidden />
              </Button>
            </>
          ) : null}

          {canDelete ? (
            confirmingRemove ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await removeStepAction(campaignId, step.id);
                      if (!result.ok) toast.error(result.error);
                      setConfirmingRemove(false);
                    })
                  }
                >
                  Remove step
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingRemove(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Remove step ${step.position}`}
                onClick={() => setConfirmingRemove(true)}
              >
                <Trash2 size={14} strokeWidth={1.75} aria-hidden />
              </Button>
            )
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/* ── The sequence ────────────────────────────────────────────────────────── */

/**
 * The ordered steps of the campaign.
 *
 * Positions are contiguous from 1 and the service refuses to start a campaign
 * whose numbering has a hole in it, so nothing here can produce one: a step is
 * always appended at the end, removing one renumbers the rest server-side, and
 * reordering sends the WHOLE list of ids rather than a move instruction.
 */
export function SequenceSteps({
  campaignId,
  status,
  steps,
  templates,
  canManage,
  canDelete,
}: {
  campaignId: string;
  status: string;
  steps: Step[];
  templates: { id: string; name: string }[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [, startMove] = useTransition();

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;

    const reordered = [...steps];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    startMove(async () => {
      const result = await reorderStepsAction(
        campaignId,
        reordered.map((step) => step.id),
      );
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="t-heading">Sequence</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {steps.length === 0
              ? "Nothing happens until there is at least one step."
              : `${plural(steps.length, "step")}, worked in this order.`}
          </p>
        </div>
        {canManage && !adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={2} aria-hidden />
            Add step
          </Button>
        ) : null}
      </header>

      {canManage && status === "ACTIVE" && steps.length > 0 ? (
        <p className="border-b border-border-subtle bg-sunken px-5 py-2 text-[12px] text-secondary">
          This campaign is running. Reordering or removing a step changes what people already part
          way through the sequence get next — the safer move is to end it and start a new one.
        </p>
      ) : null}

      {steps.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={ListOrdered}
            title="No steps yet"
            hint="A step is one touch: how long to wait, which copy to use, and what the person working it should do. Three or four, a few days apart, is a normal cadence."
            action={
              templates.length === 0 ? (
                <Link href="/settings/templates">
                  <Button size="sm" variant="secondary">
                    Write a template first
                  </Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ol>
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              templates={templates}
              campaignId={campaignId}
              canManage={canManage}
              canDelete={canDelete}
              canMoveUp={index > 0}
              canMoveDown={index < steps.length - 1}
              onMove={(direction) => move(index, direction)}
            />
          ))}
        </ol>
      )}

      {adding ? (
        <div className="border-t border-border-subtle">
          <StepForm
            idPrefix="new-step"
            initial={{
              // A first step with no wait is the usual intent; a later one
              // almost never is, so the default follows the position.
              delayMinutes: steps.length === 0 ? 0 : 2880,
              templateId: "",
              instruction: "",
            }}
            templates={templates}
            submitLabel={`Add step ${steps.length + 1}`}
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={(values) =>
              start(async () => {
                const result = await addStepAction(campaignId, {
                  delayMinutes: values.delayMinutes,
                  templateId: values.templateId,
                  instruction: values.instruction,
                });
                if (result.ok) setAdding(false);
                else toast.error(result.error);
              })
            }
          />
        </div>
      ) : null}
    </section>
  );
}
