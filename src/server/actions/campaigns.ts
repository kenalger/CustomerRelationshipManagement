"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  activateCampaign,
  addStep,
  archiveCampaign,
  completeCampaign,
  createCampaign,
  deleteCampaign,
  enrollList,
  pauseCampaign,
  removeStep,
  reorderSteps,
  stopEnrollment,
  updateCampaign,
  updateStep,
} from "@/server/services/campaigns";

/**
 * Server actions for outbound campaigns.
 *
 * Shaped like `actions/tags.ts` rather than `actions/settings.ts`: almost
 * every control on the campaign screen is a button on a row — reorder, stop,
 * activate — not a form submission, so `useTransition` over a plain async
 * function returning `Result` is the fit. The two genuine forms (new campaign,
 * new step) submit through the same functions so there is one shape to learn.
 *
 * NOTHING HERE SENDS EMAIL. Activating a campaign schedules tasks for people,
 * which is what `services/campaigns.ts` actually does.
 */

/** Turns a thrown `ForbiddenError` into something a page can render. */
async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

/**
 * The list shows step and enrollment counts for every campaign, so any change
 * to one campaign is visible on both screens. Two paths is cheap enough that
 * threading the specific one through every caller is not worth it.
 */
function revalidateCampaign(campaignId?: string) {
  revalidatePath("/campaigns");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
}

// ─────────────────────────── campaign lifecycle ───────────────────────────

export async function createCampaignAction(input: {
  name: string;
  goal?: string | null;
  listId?: string | null;
}): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    createCampaign(ctx, {
      name: input.name,
      goal: input.goal ?? null,
      // A `<select>` with no choice made posts "", which is not a cuid — the
      // schema would reject it rather than read it as "no list".
      listId: input.listId || null,
    }),
  );
  if (result.ok) revalidateCampaign(result.data.id);
  return result;
}

export async function updateCampaignAction(
  campaignId: string,
  input: { name?: string; goal?: string | null; listId?: string | null },
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    updateCampaign(ctx, campaignId, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.goal === undefined ? {} : { goal: input.goal }),
      ...(input.listId === undefined ? {} : { listId: input.listId || null }),
    }),
  );
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

/** Starts a DRAFT campaign, or resumes a PAUSED one — the service handles both. */
export async function activateCampaignAction(
  campaignId: string,
): Promise<Result<{ id: string; resumed: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => activateCampaign(ctx, campaignId));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

export async function pauseCampaignAction(
  campaignId: string,
): Promise<Result<{ id: string; paused: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => pauseCampaign(ctx, campaignId));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

export async function completeCampaignAction(
  campaignId: string,
): Promise<Result<{ id: string; closed: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => completeCampaign(ctx, campaignId));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

export async function archiveCampaignAction(
  campaignId: string,
): Promise<Result<{ id: string; stopped: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => archiveCampaign(ctx, campaignId));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

/**
 * The irreversible one. `archiveCampaign` is the reversible choice and the
 * screen presents it first, per the service's own note.
 */
export async function deleteCampaignAction(campaignId: string): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteCampaign(ctx, campaignId));
  if (result.ok) revalidateCampaign();
  return result;
}

// ─────────────────────────── sequence steps ───────────────────────────

export async function addStepAction(
  campaignId: string,
  input: { delayMinutes: number; templateId?: string | null; instruction?: string | null },
): Promise<Result<{ id: string; position: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    addStep(ctx, campaignId, {
      delayMinutes: input.delayMinutes,
      templateId: input.templateId || null,
      instruction: input.instruction ?? null,
    }),
  );
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

export async function updateStepAction(
  campaignId: string,
  stepId: string,
  input: { delayMinutes?: number; templateId?: string | null; instruction?: string | null },
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    updateStep(ctx, stepId, {
      ...(input.delayMinutes === undefined ? {} : { delayMinutes: input.delayMinutes }),
      ...(input.templateId === undefined ? {} : { templateId: input.templateId || null }),
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    }),
  );
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

/** MANAGER+. The service renumbers what is left, so positions stay contiguous. */
export async function removeStepAction(
  campaignId: string,
  stepId: string,
): Promise<Result<{ id: string }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => removeStep(ctx, stepId));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

/** Takes the WHOLE sequence in its new order — a partial list is rejected. */
export async function reorderStepsAction(
  campaignId: string,
  orderedIds: string[],
): Promise<Result<{ id: string; positions: Record<string, number> }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => reorderSteps(ctx, campaignId, orderedIds));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

// ─────────────────────────── enrollment ───────────────────────────

export async function enrollListAction(
  campaignId: string,
): Promise<Result<{ enrolled: number; alreadyEnrolled: number; skipped: number; suppressed: number }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => enrollList(ctx, campaignId));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}

/**
 * Stopping is terminal: `activateCampaign` never resumes a STOPPED enrollment,
 * which is why the screen asks for a reason rather than offering a toggle.
 */
export async function stopEnrollmentAction(
  campaignId: string,
  enrollmentId: string,
  reason: string,
): Promise<Result<{ id: string; stopped: boolean }>> {
  const ctx = await requireCtx();
  const result = await guarded(() => stopEnrollment(ctx, enrollmentId, reason));
  if (result.ok) revalidateCampaign(campaignId);
  return result;
}
