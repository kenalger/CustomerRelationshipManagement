"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import type { Result } from "@/server/result";
import {
  type BulkOutcome,
  bulkAssignContacts,
  bulkAssignLeads,
  bulkConvertLeads,
  bulkDeleteContacts,
  bulkSetLeadStatus,
} from "@/server/services/bulk";

export type BulkResult =
  | { ok: true; outcome: BulkOutcome }
  | { ok: false; error: string };

async function run(
  fn: () => Promise<Result<BulkOutcome>>,
  paths: string[],
): Promise<BulkResult> {
  try {
    const result = await fn();
    for (const path of paths) revalidatePath(path);
    // The nav badges read these counts, so the shell needs invalidating too.
    revalidatePath("/", "layout");

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, outcome: result.data };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function assignLeadsAction(ids: string[], ownerId: string): Promise<BulkResult> {
  const ctx = await requireCtx();
  return run(() => bulkAssignLeads(ctx, ids, ownerId), ["/leads", "/dashboard"]);
}

export async function setLeadStatusAction(
  ids: string[],
  status: "WORKING" | "JUNK",
): Promise<BulkResult> {
  const ctx = await requireCtx();
  return run(() => bulkSetLeadStatus(ctx, ids, status), ["/leads", "/dashboard"]);
}

export async function convertLeadsAction(ids: string[]): Promise<BulkResult> {
  const ctx = await requireCtx();
  return run(() => bulkConvertLeads(ctx, ids), ["/leads", "/contacts", "/deals", "/dashboard"]);
}

export async function assignContactsAction(ids: string[], ownerId: string): Promise<BulkResult> {
  const ctx = await requireCtx();
  return run(() => bulkAssignContacts(ctx, ids, ownerId), ["/contacts"]);
}

export async function deleteContactsAction(ids: string[]): Promise<BulkResult> {
  const ctx = await requireCtx();
  return run(() => bulkDeleteContacts(ctx, ids), ["/contacts", "/dashboard"]);
}
