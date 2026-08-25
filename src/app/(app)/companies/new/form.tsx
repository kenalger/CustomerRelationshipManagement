"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { type ActionState, createCompanyAction } from "@/server/actions/crm";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Create company"}
    </Button>
  );
}

export function NewCompanyForm() {
  const [state, action] = useActionState<ActionState, FormData>(createCompanyAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <Field label="Company name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" required autoFocus />
      </Field>

      <Field label="Domain" htmlFor="domain" hint="e.g. northwind.com" error={state.fieldErrors?.domain}>
        <Input id="domain" name="domain" />
      </Field>

      <Field label="Industry" htmlFor="industry" error={state.fieldErrors?.industry}>
        <Input id="industry" name="industry" />
      </Field>

      <Field label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
        <Input id="phone" name="phone" type="tel" />
      </Field>

      <Field label="Website" htmlFor="website" error={state.fieldErrors?.website}>
        <Input id="website" name="website" type="url" placeholder="https://" />
      </Field>

      <Submit />
    </form>
  );
}
