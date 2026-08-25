"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { retryConnectionEvents, updateFieldMapping } from "@/server/services/connections";

export type ConnectionActionState = { error?: string; message?: string };

export async function retryConnectionAction(
  _prev: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const ctx = await requireCtx();

  try {
    const result = await retryConnectionEvents(ctx, String(formData.get("connectionId") ?? ""));
    if (!result.ok) return { error: result.error };

    revalidatePath("/settings/connections");
    revalidatePath("/leads");
    return {
      message:
        result.data.attempted === 0
          ? "Nothing to retry"
          : `Retried ${result.data.attempted}, recovered ${result.data.recovered}`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }
}

export async function saveFieldMappingAction(
  _prev: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const ctx = await requireCtx();

  try {
    const result = await updateFieldMapping(
      ctx,
      String(formData.get("connectionId") ?? ""),
      String(formData.get("fieldMapping") ?? ""),
    );
    if (!result.ok) return { error: result.error };

    revalidatePath("/settings/connections");
    return { message: "Mapping saved" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }
}
