"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { type SettingsState, updateOrganizationAction } from "@/server/actions/settings";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

/** Half-hour steps across the day, labelled in the viewer's own locale. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const minutes = i * 30;
  const label = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60))
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return { minutes, label };
});

/** From the runtime's own tz database, so it cannot drift from validation. */
function zones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  const all = supported ? supported("timeZone") : [];
  return all.length > 0 ? all : ["UTC", "Asia/Manila", "Europe/London", "America/New_York"];
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? "Saving" : "Save changes"}
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

export function OrganizationForm({
  defaults,
  slug,
}: {
  defaults: {
    name: string;
    industry: string | null;
    website: string | null;
    timezone: string;
    businessHoursEnabled: boolean;
    businessDays: number[];
    businessStartMinute: number;
    businessEndMinute: number;
    rawPayloadRetentionDays: number;
    slaFirstTouchMinutes: number;
    slaEscalateMinutes: number;
  };
  slug: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updateOrganizationAction, {});
  const [hoursOn, setHoursOn] = useState(defaults.businessHoursEnabled);
  const [days, setDays] = useState<number[]>(defaults.businessDays);

  const toggleDay = (day: number) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      {state.message ? <Callout tone="success">{state.message}</Callout> : null}

      <Section title="Workspace" description="How this workspace is identified.">
        <Field label="Name" htmlFor="name" error={state.fieldErrors?.name}>
          <Input id="name" name="name" defaultValue={defaults.name} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Industry" htmlFor="industry" error={state.fieldErrors?.industry}>
            <Input
              id="industry"
              name="industry"
              defaultValue={defaults.industry ?? ""}
              placeholder="e.g. Marketing agency"
            />
          </Field>
          <Field label="Website" htmlFor="website" error={state.fieldErrors?.website}>
            <Input
              id="website"
              name="website"
              type="url"
              defaultValue={defaults.website ?? ""}
              placeholder="https://"
            />
          </Field>
        </div>

        <p className="text-[13px] text-muted">
          Workspace URL is <span className="font-mono">{slug}</span> and cannot be changed.
        </p>
      </Section>

      <Section
        title="Time and working hours"
        description="Everything time-based resolves against this — task due dates, the lead queue, and when an SLA fires."
      >
        <Field label="Timezone" htmlFor="timezone" error={state.fieldErrors?.timezone}>
          <Select id="timezone" name="timezone" defaultValue={defaults.timezone}>
            {zones().map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            name="businessHoursEnabled"
            defaultChecked={defaults.businessHoursEnabled}
            onChange={(e) => setHoursOn(e.target.checked)}
            className="mt-1 size-3.5 cursor-pointer accent-[var(--accent)]"
          />
          <span>
            <span className="block text-[14px] font-[510]">Only count working hours</span>
            <span className="block text-[13px] text-muted">
              A lead arriving Friday evening is not three days late by Monday morning. Turn this
              off if the team genuinely responds around the clock.
            </span>
          </span>
        </label>

        <fieldset
          disabled={!hoursOn}
          className={cn("space-y-4 transition-opacity", !hoursOn && "opacity-50")}
        >
          <div>
            <span className="t-label mb-1.5 block">Working days</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day) => {
                const on = days.includes(day.value);
                return (
                  <label
                    key={day.value}
                    className={cn(
                      "cursor-pointer rounded-sm border px-2.5 py-1 text-[13px] transition-colors",
                      on
                        ? "border-accent bg-accent-soft font-[560] text-accent"
                        : "border-border-strong text-secondary hover:bg-hover",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="businessDays"
                      value={day.value}
                      checked={on}
                      onChange={() => toggleDay(day.value)}
                      className="sr-only"
                    />
                    {day.label}
                  </label>
                );
              })}
            </div>
            {state.fieldErrors?.businessDays ? (
              <p role="alert" className="mt-1.5 text-[13px] text-danger">
                {state.fieldErrors.businessDays[0]}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Day starts" htmlFor="businessStartMinute">
              <Select
                id="businessStartMinute"
                name="businessStartMinute"
                defaultValue={String(defaults.businessStartMinute)}
              >
                {TIMES.map((t) => (
                  <option key={t.minutes} value={t.minutes}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Day ends"
              htmlFor="businessEndMinute"
              error={state.fieldErrors?.businessEndMinute}
            >
              <Select
                id="businessEndMinute"
                name="businessEndMinute"
                defaultValue={String(defaults.businessEndMinute)}
              >
                {TIMES.map((t) => (
                  <option key={t.minutes} value={t.minutes}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>

        <div className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2">
          <Field
            label="Nudge the owner after"
            htmlFor="slaFirstTouchMinutes"
            hint={hoursOn ? "Working minutes." : "Minutes, wall clock."}
            error={state.fieldErrors?.slaFirstTouchMinutes}
          >
            <Input
              id="slaFirstTouchMinutes"
              name="slaFirstTouchMinutes"
              type="number"
              min={1}
              max={10080}
              defaultValue={defaults.slaFirstTouchMinutes}
              required
            />
          </Field>
          <Field
            label="Escalate to managers after"
            htmlFor="slaEscalateMinutes"
            hint="Must be later than the nudge."
            error={state.fieldErrors?.slaEscalateMinutes}
          >
            <Input
              id="slaEscalateMinutes"
              name="slaEscalateMinutes"
              type="number"
              min={1}
              max={10080}
              defaultValue={defaults.slaEscalateMinutes}
              required
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Data retention"
        description="How long the raw body of an inbound lead is kept after it has been turned into a record."
      >
        <Field
          label="Keep raw lead payloads for"
          htmlFor="rawPayloadRetentionDays"
          hint="Days. The lead, contact and deal are kept indefinitely — only the original provider payload is removed."
          error={state.fieldErrors?.rawPayloadRetentionDays}
        >
          <Input
            id="rawPayloadRetentionDays"
            name="rawPayloadRetentionDays"
            type="number"
            min={1}
            max={365}
            defaultValue={defaults.rawPayloadRetentionDays}
            required
            className="max-w-32"
          />
        </Field>
        <Callout tone="info">
          A failed import can only be replayed while its payload still exists. Past this window it
          cannot be recovered — and Meta deletes its own copy after 90 days regardless.
        </Callout>
      </Section>

      <Submit />
    </form>
  );
}
