"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  createTemplate,
  deleteTemplate,
  deleteVariant,
  updateTemplate,
  upsertVariant,
} from "@/server/services/templates";

/**
 * Server actions for email templates and their A/B variants.
 *
 * Same shape as `actions/tags.ts` — plain async functions returning `Result`,
 * driven from `useTransition`. The editor is a live surface (a body field with
 * a preview beside it), so `useActionState`'s form round-trip would fight it.
 *
 * A template is copy waiting for a person: nothing here sends anything.
 */

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

/**
 * Campaign steps show the template's name, so renaming or deleting copy
 * changes what the sequence screens read — both paths are invalidated.
 */
function revalidateTemplates() {
  revalidatePath("/settings/templates");
  revalidatePath("/campaigns");
}

export async function createTemplateAction(input: {
  name: string;
  subject: string;
  body: string;
}): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => createTemplate(ctx, input));
  if (result.ok) revalidateTemplates();
  return result;
}

export async function updateTemplateAction(
  templateId: string,
  input: { name?: string; subject?: string; body?: string },
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => updateTemplate(ctx, templateId, input));
  if (result.ok) revalidateTemplates();
  return result;
}

/**
 * MANAGER+. Steps pointing at this template keep their instruction and lose
 * the copy (`onDelete: SetNull`), so the count of affected steps comes back
 * for the screen to report.
 */
export async function deleteTemplateAction(
  templateId: string,
): Promise<Result<{ id: string; stepsAffected: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteTemplate(ctx, templateId));
  if (result.ok) revalidateTemplates();
  return result;
}

/** Create-or-replace: a variant is identified by its label, not by an id. */
export async function upsertVariantAction(
  templateId: string,
  input: { label: string; subject: string; body: string },
): Promise<Result<{ id: string; label: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => upsertVariant(ctx, templateId, input));
  if (result.ok) revalidateTemplates();
  return result;
}

export async function deleteVariantAction(
  templateId: string,
  label: string,
): Promise<Result<{ removed: boolean }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteVariant(ctx, templateId, label));
  if (result.ok) revalidateTemplates();
  return result;
}
