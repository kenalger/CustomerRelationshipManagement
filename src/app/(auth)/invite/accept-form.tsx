"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { type TeamActionState, acceptInvitationAction } from "@/server/actions/team";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {pending ? "Creating your account" : "Join workspace"}
    </Button>
  );
}

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<TeamActionState, FormData>(acceptInvitationAction, {});

  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/25 bg-danger-muted px-3 py-2 text-[12px] text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {/* The address is fixed by the invitation — letting it be edited would
          let anyone with the link create an account under any address. */}
      <Field label="Email" htmlFor="invite-email-display">
        <Input id="invite-email-display" value={email} readOnly disabled />
      </Field>

      <Field label="Your name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
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
