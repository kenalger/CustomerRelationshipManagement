"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { type FormState, signUpAction } from "@/server/actions/auth";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating…" : "Create workspace"}
    </Button>
  );
}

export function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signUpAction, {});

  return (
    <form action={action} className="mt-5 space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <Field label="Company name" htmlFor="organizationName" error={state.fieldErrors?.organizationName}>
        <Input id="organizationName" name="organizationName" required autoFocus />
      </Field>

      <Field label="Your name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>

      <Field label="Work email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint="At least 12 characters."
        error={state.fieldErrors?.password}
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>

      <Submit />
    </form>
  );
}
