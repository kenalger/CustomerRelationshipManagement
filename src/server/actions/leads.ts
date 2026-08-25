"use server";

import { revalidatePath } from "next/cache";

import { requireCtx } from "@/server/context";
import { convertLead, markLeadTouched } from "@/server/services/leads";

export type LeadActionState = { error?: string; message?: string };

export async function convertLeadAction(
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const ctx = await requireCtx();
  const result = await convertLead(ctx, String(formData.get("leadId") ?? ""));

  if (!result.ok) return { error: result.error };

  revalidatePath("/leads");
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { message: "Converted" };
}

export async function markTouchedAction(
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const ctx = await requireCtx();
  const result = await markLeadTouched(ctx, String(formData.get("leadId") ?? ""));

  if (!result.ok) return { error: result.error };

  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return { message: "Marked as worked" };
}
