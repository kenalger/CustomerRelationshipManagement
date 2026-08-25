"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import { createTask, deleteTask, setTaskDone } from "@/server/services/tasks";

export type TaskState = { error?: string; message?: string; fieldErrors?: Record<string, string[]> };

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

function refresh(link: { contactId?: string | null; dealId?: string | null }) {
  revalidatePath("/tasks");
  // The nav badge lives in the shell, so every route needs invalidating.
  revalidatePath("/", "layout");
  if (link.contactId) revalidatePath(`/contacts/${link.contactId}`);
  if (link.dealId) revalidatePath(`/deals/${link.dealId}`);
}

export async function createTaskAction(_prev: TaskState, formData: FormData): Promise<TaskState> {
  const ctx = await requireCtx();

  const contactId = (formData.get("contactId") as string) || null;
  const dealId = (formData.get("dealId") as string) || null;
  const dueAt = (formData.get("dueAt") as string) || null;

  const result = await guarded(() =>
    createTask(ctx, {
      title: formData.get("title") ?? "",
      notes: formData.get("notes") ?? "",
      dueAt,
      assigneeId: (formData.get("assigneeId") as string) || null,
      contactId,
      dealId,
      leadId: (formData.get("leadId") as string) || null,
    }),
  );

  refresh({ contactId, dealId });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  return { message: "Task added" };
}

export async function toggleTaskAction(taskId: string, done: boolean): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const result = await guarded(() => setTaskDone(ctx, taskId, done));

  refresh({});
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function deleteTaskAction(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteTask(ctx, taskId));

  refresh({});
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
