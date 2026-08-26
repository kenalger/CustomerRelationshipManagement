"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  applyTag,
  createTag,
  deleteTag,
  removeTag,
  renameTag,
  setTagColour,
} from "@/server/services/tags";
import type { TagTarget } from "@/server/services/tags";

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

/**
 * A tag can be on a contact, a company and a lead at once, and the pages that
 * render it are not related to each other. Revalidating the three lists plus
 * the settings page is cheaper than threading the specific record path through
 * every caller, and a tag change is rare enough that the cost is invisible.
 */
function revalidateTagged() {
  revalidatePath("/settings/tags");
  revalidatePath("/contacts");
  revalidatePath("/companies");
  revalidatePath("/leads");
}

export async function createTagAction(input: { name: string; colour: string }) {
  const ctx = await requireCtx();
  const result = await guarded(() => createTag(ctx, input));
  if (result.ok) revalidateTagged();
  return result;
}

export async function renameTagAction(tagId: string, name: string) {
  const ctx = await requireCtx();
  const result = await guarded(() => renameTag(ctx, tagId, { name }));
  if (result.ok) revalidateTagged();
  return result;
}

export async function setTagColourAction(tagId: string, colour: string) {
  const ctx = await requireCtx();
  const result = await guarded(() => setTagColour(ctx, tagId, colour));
  if (result.ok) revalidateTagged();
  return result;
}

export async function deleteTagAction(tagId: string) {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteTag(ctx, tagId));
  if (result.ok) revalidateTagged();
  return result;
}

export async function applyTagAction(tagId: string, target: TagTarget) {
  const ctx = await requireCtx();
  const result = await guarded(() => applyTag(ctx, tagId, target));
  if (result.ok) revalidateTagged();
  return result;
}

export async function removeTagAction(tagId: string, target: TagTarget) {
  const ctx = await requireCtx();
  const result = await guarded(() => removeTag(ctx, tagId, target));
  if (result.ok) revalidateTagged();
  return result;
}
