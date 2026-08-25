"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, Input } from "@/components/ui/field";
import { type SettingsState, updateOrganizationAction } from "@/server/actions/settings";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? "Saving" : "Save changes"}
    </Button>
  );
}

export function OrganizationForm({
  defaults,
}: {
  defaults: { name: string; slaFirstTouchMinutes: number; slaEscalateMinutes: number };
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updateOrganizationAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      {state.message ? <Callout tone="success">{state.message}</Callout> : null}

      <section className="space-y-4 rounded-lg border border-border-subtle bg-surface p-4">
        <Field label="Workspace name" htmlFor="name" error={state.fieldErrors?.name}>
          <Input id="name" name="name" defaultValue={defaults.name} required />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border border-border-subtle bg-surface p-4">
        <div>
          <h2 className="text-[14px] font-semibold">Speed-to-lead policy</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Checked every five minutes. Inbound leads convert far better when contacted quickly, so
            these are the numbers the whole lead queue is measured against.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nudge the owner after"
            htmlFor="slaFirstTouchMinutes"
            hint="Minutes from arrival."
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

        <p className="text-[12px] text-muted">
          A lead stops the clock the moment somebody marks it worked or converts it — not when they
          read the notification.
        </p>
      </section>

      <Submit />
    </form>
  );
}
