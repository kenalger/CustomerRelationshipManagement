"use client";

import { Mail, MessageSquare, Phone, Users } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { type ActionState, logActivityAction } from "@/server/actions/crm";

const TYPES = [
  { value: "NOTE", label: "Note", Icon: MessageSquare },
  { value: "CALL", label: "Call", Icon: Phone },
  { value: "EMAIL", label: "Email", Icon: Mail },
  { value: "MEETING", label: "Meeting", Icon: Users },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? "Logging" : "Log activity"}
    </Button>
  );
}

/** `link` is the single record this activity attaches to. */
export function LogActivityForm({
  link,
}: {
  link: { contactId?: string; companyId?: string; dealId?: string; leadId?: string };
}) {
  const [state, action] = useActionState<ActionState, FormData>(logActivityAction, {});
  const [type, setType] = useState<string>("NOTE");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await action(formData);
        formRef.current?.reset();
      }}
      className="space-y-2.5 rounded-lg border border-border-subtle bg-surface p-3"
    >
      {Object.entries(link).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <input type="hidden" name="type" value={type} />

      {/* Segmented control rather than a select: logging a call is the single
          most repeated action in the app and should cost one click. */}
      <div role="radiogroup" aria-label="Activity type" className="flex gap-1">
        {TYPES.map(({ value, label, Icon }) => {
          const active = type === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setType(value)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-100",
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-secondary hover:bg-hover hover:text-foreground",
              )}
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      <label className="sr-only" htmlFor="activity-subject">
        Subject
      </label>
      <Input id="activity-subject" name="subject" placeholder="Subject (optional)" />

      <label className="sr-only" htmlFor="activity-body">
        Details
      </label>
      <Textarea id="activity-body" name="body" rows={3} placeholder="What happened?" />

      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="text-[12px]">
          {state.error ? (
            <span className="text-danger">{state.error}</span>
          ) : state.message ? (
            <span className="text-success">{state.message}</span>
          ) : null}
        </p>
        <Submit />
      </div>
    </form>
  );
}
