"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  type LeadActionState,
  convertLeadAction,
  markTouchedAction,
} from "@/server/actions/leads";

function SubmitButton({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "ghost" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "…" : children}
    </Button>
  );
}

export function LeadRowActions({
  leadId,
  status,
  touched,
}: {
  leadId: string;
  status: string;
  touched: boolean;
}) {
  const [convertState, convert] = useActionState<LeadActionState, FormData>(
    convertLeadAction,
    {},
  );
  const [touchState, markTouched] = useActionState<LeadActionState, FormData>(
    markTouchedAction,
    {},
  );

  if (status === "CONVERTED") {
    return <span className="text-xs text-muted">converted</span>;
  }

  const error = convertState.error ?? touchState.error;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-1">
        {!touched ? (
          <form action={markTouched}>
            <input type="hidden" name="leadId" value={leadId} />
            <SubmitButton variant="ghost">Mark worked</SubmitButton>
          </form>
        ) : null}
        <form action={convert}>
          <input type="hidden" name="leadId" value={leadId} />
          <SubmitButton variant="secondary">Convert</SubmitButton>
        </form>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
