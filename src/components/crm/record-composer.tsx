"use client";

import { CheckSquare, Mail, MessageSquare, Phone, Users } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { type ActionState, logActivityAction } from "@/server/actions/crm";
import { type TaskState, createTaskAction } from "@/server/actions/tasks";

/**
 * One composer for everything you add to a record.
 *
 * Closed by default. A record page previously showed TWO permanently-open
 * forms stacked on each other — an activity form with a type selector, a
 * subject field and a textarea, plus a task form with its own title, date and
 * assignee — roughly a dozen controls competing with the timeline you came to
 * read.
 *
 * Every CRM studied keeps this collapsed: Salesforce's docked composer has a
 * Closed state and Email / Log a Call / New Task tabs; Attio puts New note and
 * New task behind header actions with `n` and `t` shortcuts. The form appears
 * when you mean to write something.
 */
const TABS = [
  { id: "NOTE", label: "Note", Icon: MessageSquare, verb: "Log note" },
  { id: "CALL", label: "Call", Icon: Phone, verb: "Log call" },
  { id: "EMAIL", label: "Email", Icon: Mail, verb: "Log email" },
  { id: "MEETING", label: "Meeting", Icon: Users, verb: "Log meeting" },
  { id: "TASK", label: "Task", Icon: CheckSquare, verb: "Add task" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * The outcomes each activity type can carry, mirroring `OUTCOMES_BY_TYPE` in
 * `lib/validation/crm.ts` — which is what actually enforces it. A note or an
 * email has no outcome worth recording, so neither is listed and the control
 * does not render.
 */
const OUTCOMES: Partial<Record<TabId, { value: string; label: string }[]>> = {
  CALL: [
    { value: "CONNECTED", label: "Spoke to them" },
    { value: "NO_ANSWER", label: "No answer" },
    { value: "LEFT_MESSAGE", label: "Left a message" },
  ],
  MEETING: [
    { value: "HELD", label: "Meeting happened" },
    { value: "NO_SHOW", label: "They no-showed" },
    { value: "RESCHEDULED", label: "Rescheduled" },
  ],
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? "Saving" : label}
    </Button>
  );
}

export function RecordComposer({
  link,
  canWrite = true,
}: {
  link: { contactId?: string; companyId?: string; dealId?: string; leadId?: string };
  canWrite?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("NOTE");
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const [activityState, logActivity] = useActionState<ActionState, FormData>(
    logActivityAction,
    {},
  );
  const [taskState, createTask] = useActionState<TaskState, FormData>(createTaskAction, {});

  // Focus the field that matters as soon as it exists, so opening the
  // composer and typing is one motion.
  useEffect(() => {
    if (!open) return;
    if (tab === "TASK") titleRef.current?.focus();
    else bodyRef.current?.focus();
  }, [open, tab]);

  if (!canWrite) return null;

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const isTask = tab === "TASK";
  const error = isTask ? taskState.error : activityState.error;

  const hidden = Object.entries(link).map(([key, value]) =>
    value ? <input key={key} type="hidden" name={key} value={value} /> : null,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border border-border-subtle bg-surface",
          "px-3 py-2.5 text-left text-[14px] text-muted",
          "transition-colors hover:border-border-strong hover:text-secondary",
        )}
      >
        <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
        Log a call, email or note — or add a task
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border-strong bg-surface">
      <div role="tablist" aria-label="What to add" className="flex gap-0.5 border-b border-border-subtle p-1.5">
        {TABS.map(({ id, label, Icon }) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-sm px-2 text-[13px] transition-colors",
                selected
                  ? "bg-hover font-[560] text-foreground"
                  : "text-secondary hover:bg-hover hover:text-foreground",
              )}
            >
              <Icon size={14} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      <form
        ref={formRef}
        action={async (formData) => {
          if (isTask) await createTask(formData);
          else await logActivity(formData);
          formRef.current?.reset();
          setOpen(false);
        }}
        // Cmd/Ctrl+Enter submits from anywhere in the form, and Escape closes
        // without saving — the two shortcuts people try first.
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className="space-y-2.5 p-3"
      >
        {hidden}

        {isTask ? (
          <>
            <label className="sr-only" htmlFor="composer-title">
              What needs doing?
            </label>
            <Input
              id="composer-title"
              ref={titleRef}
              name="title"
              placeholder="Follow up on pricing…"
              required
            />
            <div className="flex items-center gap-2">
              <label className="text-[13px] text-muted" htmlFor="composer-due">
                Due
              </label>
              <Input id="composer-due" name="dueAt" type="date" className="w-40" />
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="type" value={tab} />
            <label className="sr-only" htmlFor="composer-subject">
              Subject
            </label>
            <Input id="composer-subject" name="subject" placeholder="Subject (optional)" />
            <label className="sr-only" htmlFor="composer-body">
              Details
            </label>
            <Textarea
              id="composer-body"
              ref={bodyRef}
              name="body"
              rows={3}
              placeholder="What happened?"
            />

            {/*
              Outcome and duration, for calls and meetings only.

              Not decoration: "meetings booked" is the most gameable number in
              sales because a no-show costs nothing to produce, so the KPI
              counts meetings marked HELD and this is where that gets recorded.
              Both are optional — a rep who leaves them blank logs an activity
              as before, it simply does not count toward a target.
            */}
            {OUTCOMES[tab] ? (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="t-label mb-1.5 block" htmlFor="composer-outcome">
                    Outcome
                  </label>
                  <Select id="composer-outcome" name="outcome" defaultValue="" className="w-44">
                    <option value="">Not recorded</option>
                    {OUTCOMES[tab]?.map((outcome) => (
                      <option key={outcome.value} value={outcome.value}>
                        {outcome.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="t-label mb-1.5 block" htmlFor="composer-duration">
                    Minutes
                  </label>
                  <Input
                    id="composer-duration"
                    name="durationMinutes"
                    type="number"
                    min={0}
                    max={1440}
                    placeholder="—"
                    className="w-24 tabular-nums"
                  />
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="flex items-center justify-between gap-2">
          <p aria-live="polite" className="text-[13px]">
            {error ? <span className="text-danger">{error}</span> : null}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit label={active.verb} />
          </div>
        </div>
      </form>
    </div>
  );
}
