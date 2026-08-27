"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { AutomationAction, AutomationTrigger } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DetailField } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import {
  deleteAutomationAction,
  setAutomationConditionsAction,
  setAutomationEnabledAction,
  setAutomationStepsAction,
  updateAutomationAction,
} from "@/server/actions/automation";
import {
  ACTIONS_FOR_KIND,
  ACTION_LABEL,
  KIND_NOUN,
  LEAD_SOURCES,
  LEAD_STATUSES,
  SET_FIELD_OPTIONS,
  type LeadConditions,
  type Member,
  type RecordKind,
  type RunRow,
  type StepDraft,
  type TagOption,
  defaultConfigFor,
  describeConditions,
  describeStep,
  memberLabel,
  sentenceFor,
  supportsConditions,
} from "../shared";
import { RunHistory } from "./run-history";

type Automation = {
  id: string;
  name: string;
  description: string | null;
  trigger: AutomationTrigger;
  triggerLabel: string;
  triggerHint: string;
  enabled: boolean;
  dailyRunLimit: number;
  conditions: LeadConditions | null;
  steps: StepDraft[];
};

/** Key order is not meaning, so it must not make a saved rule look unsaved. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner as object).sort(([a], [b]) => a.localeCompare(b)));
    }
    return inner;
  });
}

function Section({
  title,
  description,
  action,
  tone = "plain",
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: "plain" | "danger";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-md border bg-surface",
        tone === "danger" ? "border-danger/30" : "border-border-subtle",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5",
          tone === "danger" ? "border-danger/30" : "border-border-subtle",
        )}
      >
        <div className="min-w-0">
          <h3 className={cn("t-heading", tone === "danger" && "text-danger")}>{title}</h3>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

/**
 * A multi-select rendered as toggles.
 *
 * `aria-pressed` plus a border change, never colour alone — a chosen chip is
 * legible in greyscale and to a screen reader reading the button's state.
 */
function ChipGroup({
  legend,
  options,
  selected,
  disabled,
  onToggle,
}: {
  legend: string;
  options: readonly { value: string; label: string }[];
  selected: string[];
  disabled: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="t-label mb-1.5 block text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(option.value)}
              className={cn(
                "rounded-sm border px-2 py-1 text-[13px] transition-colors duration-100",
                "disabled:cursor-not-allowed disabled:opacity-50",
                on
                  ? "border-accent bg-accent-soft font-[560] text-accent"
                  : "border-border-subtle-strong text-secondary hover:text-foreground",
              )}
            >
              {on ? "✓ " : ""}
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The settings for one step.
 *
 * Only ever rendered for an action that `ACTIONS_FOR_KIND` allows for this
 * record kind, so there is no branch here for an illegal pair — the choice was
 * never offered.
 */
function StepConfig({
  kind,
  index,
  step,
  members,
  tags,
  onChange,
}: {
  kind: RecordKind;
  index: number;
  step: StepDraft;
  members: Member[];
  tags: TagOption[];
  onChange: (config: Record<string, unknown>) => void;
}) {
  const id = (suffix: string) => `step-${index}-${suffix}`;
  const config = step.config;
  const ownable = members.filter((member) => member.role !== "READ_ONLY");

  switch (step.action) {
    case "ASSIGN_OWNER":
      return (
        <Field
          label="Give it to"
          htmlFor={id("owner")}
          hint="Round robin picks whoever holds the fewest open records, with the lowest id breaking a tie — the same rule every run, so a run log can be reproduced."
        >
          <Select
            id={id("owner")}
            value={typeof config.userId === "string" ? config.userId : ""}
            onChange={(event) =>
              onChange(
                event.target.value === ""
                  ? { strategy: "ROUND_ROBIN" }
                  : { userId: event.target.value },
              )
            }
            className="max-w-sm"
          >
            <option value="">Whoever has the fewest open records</option>
            {ownable.map((member) => (
              <option key={member.id} value={member.id}>
                {memberLabel(member, member.email)}
              </option>
            ))}
          </Select>
        </Field>
      );

    case "SET_FIELD": {
      if (kind === "DEAL") {
        const value = typeof config.value === "string" ? config.value.slice(0, 10) : "";
        return (
          <Field
            label="Expected close date"
            htmlFor={id("date")}
            hint="Leave it empty to clear the date instead of setting one."
          >
            <Input
              id={id("date")}
              type="date"
              value={value}
              onChange={(event) =>
                onChange({
                  field: "expectedCloseDate",
                  value: event.target.value === "" ? null : event.target.value,
                })
              }
              className="w-44 tabular-nums"
            />
          </Field>
        );
      }

      const field = config.field === "score" ? "score" : "status";
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Field" htmlFor={id("field")}>
            <Select
              id={id("field")}
              value={field}
              onChange={(event) =>
                onChange(
                  event.target.value === "score"
                    ? { field: "score", value: 50 }
                    : { field: "status", value: "WORKING" },
                )
              }
            >
              {SET_FIELD_OPTIONS[kind].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          {field === "score" ? (
            <Field
              label="Score"
              htmlFor={id("score")}
              hint="0 to 100. Setting a score also stamps when it was scored, so an unscored lead is never confused with one scored zero."
            >
              <Input
                id={id("score")}
                type="number"
                min={0}
                max={100}
                value={typeof config.value === "number" ? String(config.value) : ""}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  onChange({
                    field: "score",
                    value: Number.isFinite(parsed) ? parsed : undefined,
                  });
                }}
                className="w-24 tabular-nums"
              />
            </Field>
          ) : (
            <Field label="Status" htmlFor={id("status")}>
              <Select
                id={id("status")}
                value={typeof config.value === "string" ? config.value : "WORKING"}
                onChange={(event) => onChange({ field: "status", value: event.target.value })}
              >
                {LEAD_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      );
    }

    case "ADD_TAG":
      return (
        <Field
          label="Tag"
          htmlFor={id("tag")}
          hint={
            tags.length === 0
              ? "There are no tags yet — create one under Settings → Tags first."
              : "Re-adding a tag the lead already has does nothing, and says so in the run log."
          }
        >
          <Select
            id={id("tag")}
            value={typeof config.tagId === "string" ? config.tagId : ""}
            onChange={(event) => onChange({ tagId: event.target.value })}
            className="max-w-sm"
          >
            <option value="">Choose a tag…</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        </Field>
      );

    case "CREATE_TASK":
      return (
        <div className="space-y-4">
          <Field label="Task title" htmlFor={id("title")}>
            <Input
              id={id("title")}
              value={typeof config.title === "string" ? config.title : ""}
              maxLength={200}
              placeholder="Call this lead"
              onChange={(event) => onChange({ ...config, title: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Due in"
              htmlFor={id("due")}
              hint="Days from when the rule runs. 0 is today; leave it empty for no due date."
            >
              <Input
                id={id("due")}
                type="number"
                min={0}
                max={365}
                value={typeof config.dueInDays === "number" ? String(config.dueInDays) : ""}
                onChange={(event) => {
                  const next = { ...config };
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (event.target.value === "" || !Number.isFinite(parsed)) delete next.dueInDays;
                  else next.dueInDays = parsed;
                  onChange(next);
                }}
                className="w-24 tabular-nums"
              />
            </Field>
            <Field
              label="Assign to"
              htmlFor={id("assign")}
              hint={`A task nobody owns appears on nobody's list, so if the ${KIND_NOUN[kind]} has no owner and no one is named here, the run fails and says so.`}
            >
              <Select
                id={id("assign")}
                value={typeof config.assignTo === "string" ? config.assignTo : ""}
                onChange={(event) => {
                  const next = { ...config };
                  if (event.target.value === "") delete next.assignTo;
                  else next.assignTo = event.target.value;
                  onChange(next);
                }}
              >
                <option value="">{`The ${KIND_NOUN[kind]}'s owner`}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberLabel(member, member.email)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      );

    case "NOTIFY":
      return (
        <div className="space-y-4">
          <Field label="Message" htmlFor={id("message")}>
            <Input
              id={id("message")}
              value={typeof config.message === "string" ? config.message : ""}
              maxLength={200}
              placeholder="A lead worth calling has arrived"
              onChange={(event) => onChange({ ...config, message: event.target.value })}
            />
          </Field>
          <Field label="Notify" htmlFor={id("who")}>
            <Select
              id={id("who")}
              value={typeof config.userId === "string" ? config.userId : ""}
              onChange={(event) => {
                const next = { ...config };
                if (event.target.value === "") delete next.userId;
                else next.userId = event.target.value;
                onChange(next);
              }}
              className="max-w-sm"
            >
              <option value="">{`The ${KIND_NOUN[kind]}'s owner`}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberLabel(member, member.email)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      );
  }
}

/** The client half of "never offer an illegal combination" — see `validateSteps`. */
function stepProblem(kind: RecordKind, step: StepDraft): string | null {
  const config = step.config;
  switch (step.action) {
    case "SET_FIELD":
      if (kind !== "DEAL" && config.field === "score" && typeof config.value !== "number") {
        return "choose a score between 0 and 100";
      }
      return null;
    case "ADD_TAG":
      return typeof config.tagId === "string" && config.tagId !== "" ? null : "choose a tag";
    case "CREATE_TASK":
      return typeof config.title === "string" && config.title.trim() !== ""
        ? null
        : "give the task a title";
    case "NOTIFY":
      return typeof config.message === "string" && config.message.trim() !== ""
        ? null
        : "write the notification message";
    default:
      return null;
  }
}

/** Strips the keys the service's `.strict()` schemas would reject. */
function cleanStep(kind: RecordKind, step: StepDraft): { action: string; config: Record<string, unknown> } {
  const config = step.config;
  switch (step.action) {
    case "ASSIGN_OWNER":
      return typeof config.userId === "string" && config.userId !== ""
        ? { action: step.action, config: { userId: config.userId } }
        : { action: step.action, config: { strategy: "ROUND_ROBIN" } };
    case "SET_FIELD":
      if (kind === "DEAL") {
        return {
          action: step.action,
          config: {
            field: "expectedCloseDate",
            value: typeof config.value === "string" && config.value !== "" ? config.value : null,
          },
        };
      }
      return config.field === "score"
        ? { action: step.action, config: { field: "score", value: config.value } }
        : { action: step.action, config: { field: "status", value: config.value } };
    case "ADD_TAG":
      return { action: step.action, config: { tagId: config.tagId } };
    case "CREATE_TASK": {
      const out: Record<string, unknown> = { title: String(config.title ?? "").trim() };
      if (typeof config.dueInDays === "number") out.dueInDays = config.dueInDays;
      if (typeof config.assignTo === "string" && config.assignTo !== "") out.assignTo = config.assignTo;
      return { action: step.action, config: out };
    }
    case "NOTIFY": {
      const out: Record<string, unknown> = { message: String(config.message ?? "").trim() };
      if (typeof config.userId === "string" && config.userId !== "") out.userId = config.userId;
      return { action: step.action, config: out };
    }
  }
}

export function AutomationEditor({
  automation,
  kind,
  members,
  tags,
  runs,
  canWrite,
  canArm,
}: {
  automation: Automation;
  kind: RecordKind;
  members: Member[];
  tags: TagOption[];
  runs: RunRow[];
  canWrite: boolean;
  canArm: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const saved = stable({
    name: automation.name,
    description: automation.description,
    dailyRunLimit: automation.dailyRunLimit,
    conditions: automation.conditions,
    steps: automation.steps,
    enabled: automation.enabled,
  });

  // Re-sync when the server sends a new version of this rule. Adjusted during
  // render rather than in an effect, so no frame ever shows the old steps
  // under the new name.
  const [seen, setSeen] = useState(saved);
  const [name, setName] = useState(automation.name);
  const [description, setDescription] = useState(automation.description ?? "");
  const [limit, setLimit] = useState(String(automation.dailyRunLimit));
  const [statusSel, setStatusSel] = useState<string[]>(automation.conditions?.status ?? []);
  const [sourceSel, setSourceSel] = useState<string[]>(automation.conditions?.source ?? []);
  const [scoreMin, setScoreMin] = useState(
    automation.conditions?.scoreMin === undefined ? "" : String(automation.conditions.scoreMin),
  );
  const [scoreMax, setScoreMax] = useState(
    automation.conditions?.scoreMax === undefined ? "" : String(automation.conditions.scoreMax),
  );
  const [tagSel, setTagSel] = useState<string[]>(automation.conditions?.tagIds ?? []);
  const [steps, setSteps] = useState<StepDraft[]>(automation.steps);

  if (seen !== saved) {
    setSeen(saved);
    setName(automation.name);
    setDescription(automation.description ?? "");
    setLimit(String(automation.dailyRunLimit));
    setStatusSel(automation.conditions?.status ?? []);
    setSourceSel(automation.conditions?.source ?? []);
    setScoreMin(
      automation.conditions?.scoreMin === undefined ? "" : String(automation.conditions.scoreMin),
    );
    setScoreMax(
      automation.conditions?.scoreMax === undefined ? "" : String(automation.conditions.scoreMax),
    );
    setTagSel(automation.conditions?.tagIds ?? []);
    setSteps(automation.steps);
    setConfirmingDelete(false);
    setFieldErrors({});
  }

  const conditionsAllowed = supportsConditions(kind);

  /** The draft conditions as the document the service would store, or null. */
  const buildConditions = (): LeadConditions | null => {
    if (!conditionsAllowed) return null;
    const doc: LeadConditions = {};
    if (statusSel.length > 0) doc.status = statusSel;
    if (sourceSel.length > 0) doc.source = sourceSel;
    const min = Number.parseInt(scoreMin, 10);
    const max = Number.parseInt(scoreMax, 10);
    if (Number.isFinite(min)) doc.scoreMin = min;
    if (Number.isFinite(max)) doc.scoreMax = max;
    if (tagSel.length > 0) doc.tagIds = tagSel;
    return Object.keys(doc).length === 0 ? null : doc;
  };

  const draftConditions = buildConditions();
  const clause = describeConditions(draftConditions, tags);
  const sentence = sentenceFor(automation.trigger, steps, clause);

  const stepsDirty = stable(steps) !== stable(automation.steps);
  const detailsDirty =
    name !== automation.name ||
    description !== (automation.description ?? "") ||
    limit !== String(automation.dailyRunLimit);
  const conditionsDirty = stable(draftConditions) !== stable(automation.conditions);

  const saveDetails = () =>
    start(async () => {
      setFieldErrors({});
      const parsed = Number.parseInt(limit, 10);
      const result = await updateAutomationAction(automation.id, {
        name: name.trim(),
        description,
        dailyRunLimit: Number.isFinite(parsed) ? parsed : undefined,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });

  const saveConditions = () =>
    start(async () => {
      const doc = buildConditions();
      if (
        doc?.scoreMin !== undefined &&
        doc?.scoreMax !== undefined &&
        doc.scoreMin > doc.scoreMax
      ) {
        toast.error("The highest score must be at least the lowest");
        return;
      }
      const result = await setAutomationConditionsAction(
        automation.id,
        doc as Record<string, unknown> | null,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(doc ? "Conditions saved" : "Conditions cleared — it will run every time");
    });

  const saveSteps = () =>
    start(async () => {
      for (const [index, step] of steps.entries()) {
        const problem = stepProblem(kind, step);
        if (problem) {
          toast.error(`Step ${index + 1}: ${problem}`);
          return;
        }
      }
      const result = await setAutomationStepsAction(
        automation.id,
        steps.map((step) => cleanStep(kind, step)),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.count === 0 ? "All steps removed" : `${result.data.count} steps saved`,
      );
    });

  const setEnabled = (next: boolean) =>
    start(async () => {
      const result = await setAutomationEnabledAction(automation.id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? `Live — ${sentence}` : "Turned off — it is a draft again");
    });

  const remove = () =>
    start(async () => {
      const result = await deleteAutomationAction(automation.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${automation.name} deleted`);
      router.push("/settings/automations");
    });

  const patchStep = (index: number, config: Record<string, unknown>) =>
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, config } : step)),
    );

  const move = (index: number, delta: number) =>
    setSteps((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const allowedActions = ACTIONS_FOR_KIND[kind];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/settings/automations"
          className="inline-flex items-center gap-1 text-[13px] text-secondary hover:text-foreground"
        >
          <ArrowLeft size={13} strokeWidth={2} aria-hidden />
          All automations
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h2 className="t-title">{automation.name}</h2>
          <Badge tone={automation.enabled ? "success" : "neutral"}>
            {automation.enabled ? "On — running on live records" : "Draft — never runs"}
          </Badge>
        </div>

        {/* The rule as a sentence, above everything that edits it. */}
        <p className="mt-1.5 max-w-3xl text-[14px] text-secondary">{sentence}</p>
        {automation.description ? (
          <p className="mt-1 max-w-3xl text-[13px] text-muted">{automation.description}</p>
        ) : null}
      </div>

      <Section
        title="Details"
        description="What this rule is called, and how much of the day it is allowed to spend."
      >
        <dl className="border-b border-border-subtle pb-2">
          <DetailField label="Trigger" value={automation.triggerLabel} />
          <DetailField label="About" value={`One ${KIND_NOUN[kind]} at a time`} />
        </dl>
        {/* Rendered as a fact, not as a disabled select: the trigger genuinely
            cannot be changed, because both the conditions and the steps are
            validated against the record kind it implies. */}
        <p className="text-[12px] text-muted">
          {automation.triggerHint} The trigger cannot be changed after creation — delete this rule
          and write a new one to listen for something else.
        </p>

        {canWrite ? (
          <>
            <Field label="Name" htmlFor="name" error={fieldErrors.name}>
              <Input
                id="name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Description"
              htmlFor="description"
              hint="Optional. Why this rule exists."
              error={fieldErrors.description}
            >
              <Textarea
                id="description"
                value={description}
                rows={2}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field
              label="Daily run limit"
              htmlFor="limit"
              hint="Once this many runs have started today the rule stops and records one notice saying so, rather than writing thousands of rows."
              error={fieldErrors.dailyRunLimit}
            >
              <Input
                id="limit"
                type="number"
                min={1}
                max={50000}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="w-32 tabular-nums"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={saveDetails}
                loading={pending}
                disabled={!detailsDirty}
              >
                Save details
              </Button>
              {detailsDirty ? <span className="text-[12px] text-muted">Unsaved changes</span> : null}
            </div>
          </>
        ) : (
          <dl>
            <DetailField label="Name" value={automation.name} />
            <DetailField
              label="Description"
              value={automation.description ?? <span className="text-muted">None written</span>}
            />
            <DetailField
              label="Daily run limit"
              value={<span className="tabular-nums">{automation.dailyRunLimit}</span>}
            />
          </dl>
        )}
      </Section>

      {conditionsAllowed ? (
        <Section
          title="Conditions"
          description="The rule only acts on a lead that matches all of these. Leave them all empty and it acts every time."
        >
          {canWrite ? (
            <>
              <ChipGroup
                legend="Status is any of"
                options={LEAD_STATUSES}
                selected={statusSel}
                disabled={pending}
                onToggle={(value) =>
                  setStatusSel((current) =>
                    current.includes(value)
                      ? current.filter((item) => item !== value)
                      : [...current, value],
                  )
                }
              />
              <ChipGroup
                legend="Source is any of"
                options={LEAD_SOURCES}
                selected={sourceSel}
                disabled={pending}
                onToggle={(value) =>
                  setSourceSel((current) =>
                    current.includes(value)
                      ? current.filter((item) => item !== value)
                      : [...current, value],
                  )
                }
              />

              <div className="grid max-w-sm gap-4 sm:grid-cols-2">
                <Field label="Lowest score" htmlFor="score-min" hint="Leave empty for no floor.">
                  <Input
                    id="score-min"
                    type="number"
                    min={0}
                    max={100}
                    value={scoreMin}
                    onChange={(event) => setScoreMin(event.target.value)}
                    className="w-24 tabular-nums"
                  />
                </Field>
                <Field label="Highest score" htmlFor="score-max" hint="Leave empty for no ceiling.">
                  <Input
                    id="score-max"
                    type="number"
                    min={0}
                    max={100}
                    value={scoreMax}
                    onChange={(event) => setScoreMax(event.target.value)}
                    className="w-24 tabular-nums"
                  />
                </Field>
              </div>

              {tags.length > 0 ? (
                <ChipGroup
                  legend="Carries every one of these tags"
                  options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                  selected={tagSel}
                  disabled={pending}
                  onToggle={(value) =>
                    setTagSel((current) =>
                      current.includes(value)
                        ? current.filter((item) => item !== value)
                        : [...current, value],
                    )
                  }
                />
              ) : null}

              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={saveConditions}
                  loading={pending}
                  disabled={!conditionsDirty}
                >
                  Save conditions
                </Button>
                {conditionsDirty ? (
                  <span className="text-[12px] text-muted">Unsaved changes</span>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-secondary">
              {describeConditions(automation.conditions, tags) ??
                "No conditions — this rule acts on every lead the trigger fires for."}
            </p>
          )}
        </Section>
      ) : (
        <Section
          title="Conditions"
          description={`Not available for a ${KIND_NOUN[kind]} rule.`}
        >
          <p className="text-[13px] text-secondary">
            Conditions are the lead filter vocabulary — status, source, score, tags. There is no{" "}
            {KIND_NOUN[kind]} equivalent, and inventing a second filter language is exactly what
            this design avoids. This rule acts every time its trigger fires.
          </p>
        </Section>
      )}

      <Section
        title="Steps"
        description={`They run in order, and the first one to fail stops the run. Only the actions that make sense for a ${KIND_NOUN[kind]} are offered.`}
        action={
          canWrite ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={steps.length >= 10 || pending}
              title={steps.length >= 10 ? "A rule runs at most 10 steps" : undefined}
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  {
                    action: allowedActions[0],
                    config: defaultConfigFor(kind, allowedActions[0]),
                  },
                ])
              }
            >
              <Plus size={13} strokeWidth={2} />
              Add step
            </Button>
          ) : null
        }
      >
        {steps.length === 0 ? (
          <p className="text-[13px] text-muted">
            No steps yet. A rule with no steps cannot be turned on — it would consume its daily
            budget writing runs that did nothing.
          </p>
        ) : null}

        {steps.map((step, index) => (
          <div key={index} className="rounded-md border border-border-subtle p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="t-caps shrink-0 text-muted tabular-nums">Step {index + 1}</span>
                {canWrite ? (
                  <Select
                    aria-label={`Step ${index + 1} action`}
                    value={step.action}
                    onChange={(event) => {
                      const action = event.target.value as AutomationAction;
                      setSteps((current) =>
                        current.map((item, i) =>
                          i === index ? { action, config: defaultConfigFor(kind, action) } : item,
                        ),
                      );
                    }}
                    className="w-48"
                  >
                    {allowedActions.map((action) => (
                      <option key={action} value={action}>
                        {ACTION_LABEL[action]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-[14px] font-[510]">{ACTION_LABEL[step.action]}</span>
                )}
              </div>

              {canWrite ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Move step ${index + 1} up`}
                    disabled={index === 0 || pending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={13} strokeWidth={2} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Move step ${index + 1} down`}
                    disabled={index === steps.length - 1 || pending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={13} strokeWidth={2} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={pending}
                    onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </Button>
                </div>
              ) : null}
            </div>

            {canWrite ? (
              <StepConfig
                kind={kind}
                index={index}
                step={step}
                members={members}
                tags={tags}
                onChange={(config) => patchStep(index, config)}
              />
            ) : (
              <p className="text-[13px] text-secondary">
                {describeStep(kind, step, { members, tags })}
              </p>
            )}
          </div>
        ))}

        {canWrite ? (
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={saveSteps} loading={pending} disabled={!stepsDirty}>
              Save steps
            </Button>
            {stepsDirty ? (
              <span className="text-[12px] text-muted">
                Unsaved changes — a live rule keeps running the saved steps until you save these.
              </span>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section
        title="Run history"
        description={`The last ${runs.length === 0 ? "few" : runs.length} passes this rule made at a record, including the ones where it did nothing.`}
      >
        <RunHistory runs={runs} />
      </Section>

      <Section
        title="Danger zone"
        tone="danger"
        description="Arming a rule and deleting one are admin actions — a live rule changes real records, and deleting takes its run history with it."
      >
        {canArm ? (
          <>
            <Callout tone={automation.enabled ? "warning" : "info"}>
              {automation.enabled
                ? `This rule is live. Right now: ${sentence}.`
                : `This rule is a draft and has never touched a record. Turning it on means: ${sentence}.`}
            </Callout>

            <div className="flex flex-wrap items-center gap-3">
              {automation.enabled ? (
                <Button size="sm" variant="secondary" onClick={() => setEnabled(false)} loading={pending}>
                  Turn off
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setEnabled(true)}
                  loading={pending}
                  disabled={automation.steps.length === 0}
                  title={
                    automation.steps.length === 0
                      ? "Save at least one step before turning this on"
                      : undefined
                  }
                >
                  Turn on
                </Button>
              )}
              {automation.steps.length === 0 && !automation.enabled ? (
                <span className="text-[12px] text-muted">
                  Save at least one step first — the engine refuses to arm an empty rule.
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
              {confirmingDelete ? (
                <>
                  <span className="text-[13px] text-danger">
                    Delete {automation.name}? Its steps and its whole run history go with it.
                  </span>
                  <Button size="sm" variant="danger" onClick={remove} loading={pending}>
                    Yes, delete it
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={pending}
                  >
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={pending}
                >
                  Delete this automation
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-secondary">
            This rule is {automation.enabled ? "on" : "a draft"}. Turning it on or off, and deleting
            it, are admin actions — ask an admin or the owner.
          </p>
        )}
      </Section>
    </div>
  );
}
