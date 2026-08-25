"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  addStage,
  createPipeline,
  deleteStage,
  renamePipeline,
  reorderStages,
  setDefaultPipeline,
  updateOrganization,
  updateStage,
} from "@/server/services/settings";

export type SettingsState = {
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

function done(result: Result<unknown>, message: string): SettingsState {
  // The SLA banner and pipeline board both read this data, so a settings
  // change has to invalidate more than its own page.
  revalidatePath("/settings/organization");
  revalidatePath("/settings/pipelines");
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  revalidatePath("/leads");

  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  return { message };
}

export async function updateOrganizationAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() =>
      updateOrganization(ctx, {
        name: formData.get("name") ?? "",
        slaFirstTouchMinutes: formData.get("slaFirstTouchMinutes") ?? 30,
        slaEscalateMinutes: formData.get("slaEscalateMinutes") ?? 120,
      }),
    ),
    "Settings saved",
  );
}

export async function createPipelineAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() => createPipeline(ctx, { name: formData.get("name") ?? "" })),
    "Pipeline created",
  );
}

export async function renamePipelineAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() =>
      renamePipeline(ctx, String(formData.get("pipelineId") ?? ""), {
        name: formData.get("name") ?? "",
      }),
    ),
    "Pipeline renamed",
  );
}

export async function setDefaultPipelineAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() => setDefaultPipeline(ctx, String(formData.get("pipelineId") ?? ""))),
    "Default pipeline updated",
  );
}

export async function addStageAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() =>
      addStage(ctx, String(formData.get("pipelineId") ?? ""), {
        name: formData.get("name") ?? "",
        probability: formData.get("probability") ?? 0,
        outcome: formData.get("outcome") ?? "open",
      }),
    ),
    "Stage added",
  );
}

export async function updateStageAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() =>
      updateStage(ctx, String(formData.get("stageId") ?? ""), {
        name: formData.get("name") ?? "",
        probability: formData.get("probability") ?? 0,
        outcome: formData.get("outcome") ?? "open",
      }),
    ),
    "Stage saved",
  );
}

export async function deleteStageAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireCtx();
  return done(
    await guarded(() => deleteStage(ctx, String(formData.get("stageId") ?? ""))),
    "Stage deleted",
  );
}

/** Called from the reorder buttons, which have no form to submit. */
export async function moveStageAction(
  pipelineId: string,
  stageIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const result = await guarded(() => reorderStages(ctx, { pipelineId, stageIds }));

  revalidatePath("/settings/pipelines");
  revalidatePath("/deals");

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
