"use server";

import { revalidatePath } from "next/cache";

import { requireCtx } from "@/server/context";
import { markAllRead, markRead } from "@/server/services/notifications";

export type NotificationActionState = { error?: string; message?: string };

export async function markReadAction(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const ctx = await requireCtx();
  const result = await markRead(ctx, String(formData.get("notificationId") ?? ""));

  // The unread badge lives in the app shell, so every route needs refreshing.
  revalidatePath("/", "layout");

  if (!result.ok) return { error: result.error };
  return { message: "Marked read" };
}

export async function markAllReadAction(
  _prev: NotificationActionState,
  _formData: FormData,
): Promise<NotificationActionState> {
  const ctx = await requireCtx();
  const result = await markAllRead(ctx);

  revalidatePath("/", "layout");

  if (!result.ok) return { error: result.error };
  return {
    message: result.data.count === 0 ? "Nothing unread" : `Marked ${result.data.count} read`,
  };
}
