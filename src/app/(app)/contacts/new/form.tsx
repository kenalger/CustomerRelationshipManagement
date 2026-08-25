"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { type ActionState, createContactAction } from "@/server/actions/crm";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Create contact"}
    </Button>
  );
}

export function NewContactForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createContactAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName" error={state.fieldErrors?.firstName}>
          <Input id="firstName" name="firstName" required autoFocus />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={state.fieldErrors?.lastName}>
          <Input id="lastName" name="lastName" />
        </Field>
      </div>

      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" />
      </Field>

      <Field label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
        <Input id="phone" name="phone" type="tel" />
      </Field>

      <Field label="Job title" htmlFor="title" error={state.fieldErrors?.title}>
        <Input id="title" name="title" />
      </Field>

      <div className="space-y-1.5">
        <label htmlFor="companyId" className="block text-sm font-medium">
          Company
        </label>
        <select
          id="companyId"
          name="companyId"
          className="h-9 w-full rounded-md border border-border-subtle bg-surface px-2 text-sm"
        >
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <Submit />
    </form>
  );
}
