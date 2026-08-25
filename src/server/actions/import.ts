"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { importContacts, type ImportSummary } from "@/server/services/import";

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

export async function importContactsAction(payload: {
  rows: Record<string, string>[];
  mapping: Record<string, string>;
  onDuplicate: "skip" | "update";
}): Promise<ImportResult> {
  const ctx = await requireCtx();

  try {
    const result = await importContacts(ctx, payload);
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/contacts");
    revalidatePath("/companies");
    revalidatePath("/dashboard");
    return { ok: true, summary: result.data };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
}
