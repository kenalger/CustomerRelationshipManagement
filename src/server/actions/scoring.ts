"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, requireRole } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import { rescoreOrganization, updateScoringRules } from "@/server/services/scoring";

export type ScoringState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

/**
 * Reads the weight document out of a flat FormData.
 *
 * The nested keys are dotted (`sourceWeights.EMAIL`) rather than bracketed,
 * because bracket notation in a form field name is a convention no framework
 * here actually implements — it would just arrive as a literal key with
 * brackets in it. Every value stays a string: `scoringRulesSchema` coerces,
 * and coercing twice is how a blank input becomes a silent zero.
 */
function readRules(formData: FormData): Record<string, unknown> {
  const document: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    // A blank input means "leave it at the default", which is what an absent
    // key already means to the schema. Submitting "" would coerce to 0.
    if (value.trim() === "") continue;

    const dot = key.indexOf(".");
    if (dot === -1) {
      document[key] = value;
      continue;
    }

    const group = key.slice(0, dot);
    const field = key.slice(dot + 1);
    const bucket = (document[group] ??= {}) as Record<string, unknown>;
    bucket[field] = value;
  }

  return document;
}

export async function updateScoringRulesAction(
  _prev: ScoringState,
  formData: FormData,
): Promise<ScoringState> {
  const ctx = await requireCtx();
  const result = await guarded(() => updateScoringRules(ctx, readRules(formData)));

  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  // New weights reorder every queue in the workspace, so the pages that sort
  // or filter on score have to be invalidated alongside this one. The scores
  // themselves are stale until a rescore runs — which is why the form says so
  // rather than silently recomputing 200k rows inside a form submission.
  revalidatePath("/settings/scoring");
  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return { message: "Weights saved. Existing scores are unchanged until you recalculate." };
}

/**
 * Recalculates scores with the current weights.
 *
 * `rescoreOrganization` is the cron-facing function: it takes an id, not a
 * Ctx, and carries no role check of its own, so the check belongs here. It is
 * bounded at a page of leads per call — the oldest-scored first — so a
 * workspace with 50k leads is caught up over several presses rather than by a
 * form submission that times out halfway and leaves the queue half-ranked.
 */
export async function rescoreAllAction(_prev: ScoringState, _formData: FormData): Promise<ScoringState> {
  const ctx = await requireCtx();

  try {
    requireRole(ctx, "ADMIN");
    const { scanned, changed } = await rescoreOrganization(ctx.organizationId);
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return {
      message:
        changed === 0
          ? `Checked ${scanned} ${scanned === 1 ? "lead" : "leads"} — every score already matched the current weights.`
          : `Rescored ${changed} of ${scanned} ${scanned === 1 ? "lead" : "leads"}. Press again if more remain.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }
}
