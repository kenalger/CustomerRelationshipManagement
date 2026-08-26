"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, Input } from "@/components/ui/field";
import {
  type ScoringState,
  rescoreAllAction,
  updateScoringRulesAction,
} from "@/server/actions/scoring";
import type { ScoringRules } from "@/server/services/scoring";

const SOURCES = [
  { key: "FACEBOOK_LEAD_ADS", label: "Facebook lead ad" },
  { key: "WEB_FORM", label: "Web form" },
  { key: "FACEBOOK_MESSENGER", label: "Messenger" },
  { key: "EMAIL", label: "Email" },
  { key: "MANUAL", label: "Entered by hand" },
  { key: "FACEBOOK_COMMENT", label: "Facebook comment" },
  { key: "CSV_IMPORT", label: "CSV import" },
] as const;

const STATUSES = [
  { key: "NEW", label: "New" },
  { key: "WORKING", label: "Working" },
  { key: "QUALIFIED", label: "Qualified" },
  { key: "CONVERTED", label: "Converted" },
  { key: "JUNK", label: "Junk" },
] as const;

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

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

/**
 * One weight.
 *
 * Controlled rather than uncontrolled, because the running total at the bottom
 * of the form is the only way an admin can tell what a change actually does —
 * a column of forty numbers with no arithmetic is not a scoring model, it is a
 * spreadsheet with worse ergonomics.
 */
function Weight({
  name,
  label,
  value,
  onChange,
  error,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  error?: string[];
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle py-2 last:border-0">
      <label htmlFor={name} className="text-[14px] text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          type="number"
          min={-100}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 text-right tabular-nums"
          aria-invalid={error?.length ? true : undefined}
        />
        <span className="w-8 text-[13px] text-muted">pts</span>
      </div>
    </div>
  );
}

export function ScoringForm({ defaults }: { defaults: ScoringRules }) {
  const [state, action] = useActionState<ScoringState, FormData>(updateScoringRulesAction, {});
  const [rescoreState, rescore] = useActionState<ScoringState, FormData>(rescoreAllAction, {});
  const [rules, setRules] = useState<ScoringRules>(defaults);

  const set = <K extends keyof ScoringRules>(key: K, value: ScoringRules[K]) =>
    setRules((prev) => ({ ...prev, [key]: value }));

  /**
   * What a genuinely good inbound lead would score today: the best source, all
   * three contact details, qualified, and fresh. Shown because a weight is only
   * meaningful relative to the ceiling — 15 points for a phone number means
   * nothing until you know whether the top of the scale is 60 or 600.
   */
  const ceiling = useMemo(() => {
    const bestSource = Math.max(...Object.values(rules.sourceWeights));
    const bestStatus = Math.max(...Object.values(rules.statusWeights));
    const raw =
      rules.base +
      bestSource +
      bestStatus +
      rules.hasEmail +
      rules.hasPhone +
      rules.hasCompanyName +
      rules.recency.freshPoints;
    return Math.max(0, Math.min(100, raw));
  }, [rules]);

  return (
    <div className="space-y-5">
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      {state.message ? <Callout tone="success">{state.message}</Callout> : null}

      <form action={action} className="space-y-5">
        <Section
          title="Baseline"
          description="Points every lead starts with, before anything is known about it."
        >
          <Weight
            name="base"
            label="Starting score"
            value={rules.base}
            onChange={(v) => set("base", v)}
            error={state.fieldErrors?.base}
          />
        </Section>

        <Section
          title="Source"
          description="A hand-raiser is worth more than a row from a spreadsheet."
        >
          {SOURCES.map((source) => (
            <Weight
              key={source.key}
              name={`sourceWeights.${source.key}`}
              label={source.label}
              value={rules.sourceWeights[source.key]}
              onChange={(v) =>
                set("sourceWeights", { ...rules.sourceWeights, [source.key]: v })
              }
            />
          ))}
        </Section>

        <Section
          title="Contactability"
          description="A lead nobody can reach cannot be worked, whatever else is true about it."
        >
          <Weight
            name="hasEmail"
            label="Has an email address"
            value={rules.hasEmail}
            onChange={(v) => set("hasEmail", v)}
          />
          <Weight
            name="hasPhone"
            label="Has a phone number"
            value={rules.hasPhone}
            onChange={(v) => set("hasPhone", v)}
          />
          <Weight
            name="hasCompanyName"
            label="Has a company name"
            value={rules.hasCompanyName}
            onChange={(v) => set("hasCompanyName", v)}
          />
        </Section>

        <Section title="Stage" description="How far along the lead already is.">
          {STATUSES.map((status) => (
            <Weight
              key={status.key}
              name={`statusWeights.${status.key}`}
              label={status.label}
              value={rules.statusWeights[status.key]}
              onChange={(v) =>
                set("statusWeights", { ...rules.statusWeights, [status.key]: v })
              }
            />
          ))}
          <p className="text-[13px] text-muted">
            Junk sits far below zero on purpose: it has to outweigh every positive rule, so a
            well-formed lead someone marked as junk still falls to the bottom of the queue.
          </p>
        </Section>

        <Section
          title="Recency"
          description="Speed-to-lead is the point. A fresh lead is boosted; one nobody touched in a month stops crowding out today's arrivals."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fresh for (hours)" htmlFor="recency.freshHours">
              <Input
                id="recency.freshHours"
                name="recency.freshHours"
                type="number"
                min={1}
                max={720}
                value={rules.recency.freshHours}
                onChange={(e) =>
                  set("recency", { ...rules.recency, freshHours: Number(e.target.value) })
                }
                className="tabular-nums"
              />
            </Field>
            <Field label="Fresh bonus (points)" htmlFor="recency.freshPoints">
              <Input
                id="recency.freshPoints"
                name="recency.freshPoints"
                type="number"
                min={-100}
                max={100}
                value={rules.recency.freshPoints}
                onChange={(e) =>
                  set("recency", { ...rules.recency, freshPoints: Number(e.target.value) })
                }
                className="tabular-nums"
              />
            </Field>
            <Field label="Stale after (days)" htmlFor="recency.staleDays">
              <Input
                id="recency.staleDays"
                name="recency.staleDays"
                type="number"
                min={1}
                max={365}
                value={rules.recency.staleDays}
                onChange={(e) =>
                  set("recency", { ...rules.recency, staleDays: Number(e.target.value) })
                }
                className="tabular-nums"
              />
            </Field>
            <Field label="Stale penalty (points)" htmlFor="recency.stalePenalty">
              <Input
                id="recency.stalePenalty"
                name="recency.stalePenalty"
                type="number"
                min={-100}
                max={100}
                value={rules.recency.stalePenalty}
                onChange={(e) =>
                  set("recency", { ...rules.recency, stalePenalty: Number(e.target.value) })
                }
                className="tabular-nums"
              />
            </Field>
          </div>
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface px-5 py-3.5">
          <div>
            <span className="t-label block">Best case with these weights</span>
            <span className="text-[13px] text-muted">
              Top source, fully contactable, qualified and fresh. Scores are clamped to 0–100.
            </span>
          </div>
          <span className="t-display tabular-nums">{ceiling}</span>
        </div>

        <div className="flex justify-end">
          <Submit label="Save weights" pendingLabel="Saving" />
        </div>
      </form>

      <Section
        title="Recalculate"
        description="Saving weights changes how new leads are scored. Existing leads keep their old score until you recalculate."
      >
        {rescoreState.error ? <Callout tone="danger">{rescoreState.error}</Callout> : null}
        {rescoreState.message ? <Callout tone="success">{rescoreState.message}</Callout> : null}
        <form action={rescore}>
          <Submit label="Recalculate scores" pendingLabel="Recalculating" />
        </form>
      </Section>
    </div>
  );
}
