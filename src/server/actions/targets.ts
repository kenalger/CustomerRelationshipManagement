"use server";

import { revalidatePath } from "next/cache";

import type { TargetMetric, TargetPeriod } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import { copyTargets, deleteTarget, setTarget } from "@/server/services/targets";

/**
 * Server actions for targets and quotas.
 *
 * Same shape as `actions/tags.ts`: the action resolves the caller's context,
 * hands the work to the service, and revalidates. `guarded` is what turns the
 * `ForbiddenError` a MANAGER-gated service throws into a `Result` the screen
 * can render — a rep who somehow reaches a disabled control gets a sentence,
 * not an error boundary.
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
 * Three screens read this data and none of them is the settings page alone:
 * a quota changed here moves the reports attainment table and the signed-in
 * user's dashboard strip, so all three are invalidated together.
 */
function revalidateTargets() {
  revalidatePath("/settings/targets");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
}

/**
 * Creates or replaces one target.
 *
 * `periodStart` crosses as an ISO string because a `Date` is fine over the RSC
 * boundary but a string is what a URL-driven screen already has; the service's
 * `z.coerce.date()` accepts it and then normalises it to the real period start
 * in the org's timezone. Validation, the currency rule and the MANAGER gate all
 * live in the service — this deliberately re-checks none of them, so there is
 * one place for those rules rather than two that can disagree.
 */
export async function setTargetAction(input: {
  /** Null = the whole team. */
  userId: string | null;
  metric: TargetMetric;
  period: TargetPeriod;
  /** Any instant inside the period. */
  periodStart: string;
  value: number;
  /** Revenue metrics only; null for everything else. */
  currency: string | null;
}) {
  const ctx = await requireCtx();
  const result = await guarded(() => setTarget(ctx, input));
  if (result.ok) revalidateTargets();
  return result;
}

/** Clearing a cell removes the target rather than setting it to zero — a zero target is a real statement ("not chasing this"), and the two must stay distinguishable. */
export async function deleteTargetAction(targetId: string) {
  const ctx = await requireCtx();
  const result = await guarded(() => deleteTarget(ctx, targetId));
  if (result.ok) revalidateTargets();
  return result;
}

/**
 * Copies one period's targets into another.
 *
 * Returns the service's `{ copied, skipped }` untouched: the caller must show
 * both. A skipped cell is one where a number the manager believes they just set
 * was not set, and swallowing that count is the failure mode this whole action
 * exists to avoid.
 */
export async function copyTargetsAction(input: {
  period: TargetPeriod;
  fromPeriodStart: string;
  toPeriodStart: string;
}) {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    copyTargets(ctx, {
      period: input.period,
      fromPeriodStart: new Date(input.fromPeriodStart),
      toPeriodStart: new Date(input.toPeriodStart),
    }),
  );
  if (result.ok) revalidateTargets();
  return result;
}
