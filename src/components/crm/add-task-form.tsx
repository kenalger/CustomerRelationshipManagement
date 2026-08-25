"use client";

import { Plus } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { type TaskState, createTaskAction } from "@/server/actions/tasks";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      <Plus size={14} strokeWidth={2} aria-hidden />
      Add
    </Button>
  );
}

export function AddTaskForm({
  link = {},
  assignees,
}: {
  link?: { contactId?: string; dealId?: string; leadId?: string };
  assignees?: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<TaskState, FormData>(createTaskAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await action(formData);
        formRef.current?.reset();
      }}
      className="flex flex-wrap items-end gap-2 border-t border-border-subtle p-3"
    >
      {Object.entries(link).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}

      <div className="min-w-40 flex-1">
        <label className="sr-only" htmlFor="task-title">
          What needs doing?
        </label>
        <Input id="task-title" name="title" placeholder="Follow up on pricing…" required />
      </div>

      <div>
        <label className="sr-only" htmlFor="task-due">
          Due date
        </label>
        <Input id="task-due" name="dueAt" type="date" className="w-36" />
      </div>

      {assignees && assignees.length > 1 ? (
        <div>
          <label className="sr-only" htmlFor="task-assignee">
            Assign to
          </label>
          <Select id="task-assignee" name="assigneeId" className="w-36">
            <option value="">Assign to me</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <Submit />

      {state.error ? (
        <p role="alert" className="w-full text-[12px] text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
