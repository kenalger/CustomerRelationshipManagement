"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { type ActionState, createDealAction } from "@/server/actions/crm";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Create deal"}
    </Button>
  );
}

export function NewDealForm({
  companies,
  contacts,
}: {
  companies: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createDealAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <Field label="Deal name" htmlFor="title" error={state.fieldErrors?.title}>
        <Input id="title" name="title" required autoFocus />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Value" htmlFor="value" error={state.fieldErrors?.value}>
          <Input id="value" name="value" type="number" min="0" step="0.01" defaultValue="0" />
        </Field>
        <Field label="Currency" htmlFor="currency" error={state.fieldErrors?.currency}>
          <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
        </Field>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="companyId" className="block text-sm font-medium">Company</label>
        <select
          id="companyId"
          name="companyId"
          className="h-9 w-full rounded-md border border-border-subtle bg-surface px-2 text-sm"
        >
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contactId" className="block text-sm font-medium">Primary contact</label>
        <select
          id="contactId"
          name="contactId"
          className="h-9 w-full rounded-md border border-border-subtle bg-surface px-2 text-sm"
        >
          <option value="">No contact</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <Field label="Expected close date" htmlFor="expectedCloseDate">
        <Input id="expectedCloseDate" name="expectedCloseDate" type="date" />
      </Field>

      <Submit />
    </form>
  );
}
