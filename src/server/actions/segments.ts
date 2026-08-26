"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  type SegmentEntityName,
  countSegment,
  createSegment,
  deleteSegment,
  updateSegment,
} from "@/server/services/segments";

/**
 * Segments are edited and deleted by their owner or a manager, and both throw
 * `ForbiddenError` rather than returning a Result — authorization is not a
 * validation outcome. This turns it back into something a form can render.
 */
async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

const LIST_PATH: Record<SegmentEntityName, string> = {
  LEAD: "/leads",
  CONTACT: "/contacts",
  COMPANY: "/companies",
};

export async function createSegmentAction(input: {
  name: string;
  entity: SegmentEntityName;
  filter: unknown;
  shared: boolean;
}) {
  const ctx = await requireCtx();
  const result = await guarded(() => createSegment(ctx, input));
  if (result.ok) revalidatePath(LIST_PATH[input.entity]);
  return result;
}

export async function updateSegmentAction(
  id: string,
  entity: SegmentEntityName,
  patch: { name?: string; filter?: unknown; shared?: boolean },
) {
  const ctx = await requireCtx();
  const result = await guarded(() => updateSegment(ctx, id, patch));
  if (result.ok) revalidatePath(LIST_PATH[entity]);
  return result;
}

export async function deleteSegmentAction(id: string, entity: SegmentEntityName) {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteSegment(ctx, id));
  if (result.ok) revalidatePath(LIST_PATH[entity]);
  return result;
}

/** For showing "412 leads" beside a segment before anyone runs it. */
export async function countSegmentAction(id: string) {
  const ctx = await requireCtx();
  return guarded(() => countSegment(ctx, id));
}
