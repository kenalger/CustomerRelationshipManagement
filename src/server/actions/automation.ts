"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  createAutomation,
  deleteAutomation,
  setAutomationEnabled,
  setSteps,
  updateAutomation,
} from "@/server/services/automation";

/**
 * Server actions for the automation screens.
 *
 * Same shape as `actions/tags.ts`: the service returns a `Result` for anything
 * a user can cause, and `guarded` turns the one thing it *throws* — a role
 * failure — into a renderable error rather than an error boundary. The role
 * checks themselves stay in the service; these actions never re-implement them.
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
 * An automation is only ever read on its own two screens, so unlike a tag
 * there is nothing else to invalidate.
 */
function revalidateAutomations(id?: string) {
  revalidatePath("/settings/automations");
  if (id) revalidatePath(`/settings/automations/${id}`);
}

export async function createAutomationAction(input: {
  name: string;
  description?: string;
  trigger: string;
  dailyRunLimit?: number;
}): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  // `enabled` is deliberately absent — `automationCreateSchema` is `.strict()`
  // and does not accept it. A rule arrives as a draft and is armed separately,
  // by a higher role.
  const result = await guarded(() =>
    createAutomation(ctx, {
      name: input.name,
      description: input.description?.trim() || null,
      trigger: input.trigger,
      ...(input.dailyRunLimit === undefined ? {} : { dailyRunLimit: input.dailyRunLimit }),
    }),
  );
  if (result.ok) revalidateAutomations(result.data.id);
  return result;
}

/**
 * Name, description and the daily cap.
 *
 * Built key by key rather than forwarded, because the service reads
 * `"conditions" in patch` to decide whether to CLEAR the stored conditions —
 * so a `conditions` key must never appear here by accident. Conditions have
 * their own action below for exactly that reason.
 */
export async function updateAutomationAction(
  id: string,
  patch: { name?: string; description?: string | null; dailyRunLimit?: number },
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();

  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  // An emptied box means "there is no description", not an empty one.
  if (patch.description !== undefined) payload.description = patch.description?.trim() || null;
  if (patch.dailyRunLimit !== undefined) payload.dailyRunLimit = patch.dailyRunLimit;

  const result = await guarded(() => updateAutomation(ctx, id, payload));
  if (result.ok) revalidateAutomations(id);
  return result;
}

/**
 * The condition document, or `null` to clear it.
 *
 * Separate from the patch above so that saving a name can never silently wipe
 * the conditions, and so that clearing them is an explicit act.
 */
export async function setAutomationConditionsAction(
  id: string,
  conditions: Record<string, unknown> | null,
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => updateAutomation(ctx, id, { conditions }));
  if (result.ok) revalidateAutomations(id);
  return result;
}

/**
 * Replaces the whole ordered step list — the service takes an array and
 * derives each position from its index, so there is no per-step endpoint and
 * no way to end up with two steps at position 3.
 */
export async function setAutomationStepsAction(
  id: string,
  steps: { action: string; config: Record<string, unknown> }[],
): Promise<Result<{ count: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => setSteps(ctx, id, steps));
  if (result.ok) revalidateAutomations(id);
  return result;
}

/** Arming or disarming a rule. ADMIN+ — the service is what enforces that. */
export async function setAutomationEnabledAction(
  id: string,
  enabled: boolean,
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => setAutomationEnabled(ctx, id, enabled));
  if (result.ok) revalidateAutomations(id);
  return result;
}

export async function deleteAutomationAction(id: string): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteAutomation(ctx, id));
  if (result.ok) revalidateAutomations(id);
  return result;
}
