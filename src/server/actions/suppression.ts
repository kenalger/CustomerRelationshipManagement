"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import { suppress, suppressMany, unsuppress } from "@/server/services/suppression";

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

export async function suppressAction(input: { email: string; reason: string; note?: string }) {
  const ctx = await requireCtx();
  const result = await guarded(() => suppress(ctx, input));
  if (result.ok) revalidatePath("/settings/suppression");
  return result;
}

export async function suppressManyAction(input: { emails: string; reason: string }) {
  const ctx = await requireCtx();
  const result = await guarded(() => suppressMany(ctx, input));
  if (result.ok) revalidatePath("/settings/suppression");
  return result;
}

export async function unsuppressAction(id: string) {
  const ctx = await requireCtx();
  const result = await guarded(() => unsuppress(ctx, id));
  if (result.ok) revalidatePath("/settings/suppression");
  return result;
}
