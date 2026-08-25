import { z } from "zod";

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(100),
  // Bounds are deliberate: under a minute is noise, and a target measured in
  // days is not a speed-to-lead policy.
  slaFirstTouchMinutes: z.coerce.number().int().min(1).max(10_080),
  slaEscalateMinutes: z.coerce.number().int().min(1).max(10_080),
});

export const pipelineSchema = z.object({
  name: z.string().trim().min(1, "Give the pipeline a name").max(100),
});

export const stageSchema = z.object({
  name: z.string().trim().min(1, "Give the stage a name").max(60),
  probability: z.coerce.number().int().min(0).max(100),
  outcome: z.enum(["open", "won", "lost"]),
});

export const reorderSchema = z.object({
  pipelineId: z.string().cuid(),
  /** Stage ids in their new top-to-bottom order. */
  stageIds: z.array(z.string().cuid()).min(1),
});
