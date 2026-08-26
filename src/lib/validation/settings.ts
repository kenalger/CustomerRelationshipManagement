import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));

/** Validated against the runtime's own tz database rather than a hardcoded list. */
const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Pick a valid timezone" },
);

export const organizationSchema = z
  .object({
    name: z.string().trim().min(2, "Company name is required").max(100),
    industry: optionalText(100),
    website: optionalText(300),

    timezone,
    businessHoursEnabled: z.coerce.boolean(),
    businessDays: z.array(z.coerce.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
    businessStartMinute: z.coerce.number().int().min(0).max(1439),
    businessEndMinute: z.coerce.number().int().min(1).max(1440),

    // 1 day is the tightest useful window for replaying a failed import;
    // beyond a year the storage and privacy cost outweighs any benefit.
    rawPayloadRetentionDays: z.coerce.number().int().min(1).max(365),

    // Bounds are deliberate: under a minute is noise, and a target measured in
    // days is not a speed-to-lead policy.
    slaFirstTouchMinutes: z.coerce.number().int().min(1).max(10_080),
    slaEscalateMinutes: z.coerce.number().int().min(1).max(10_080),
  })
  .refine((v) => v.businessEndMinute > v.businessStartMinute, {
    message: "The working day has to end after it starts",
    path: ["businessEndMinute"],
  })
  .refine((v) => !v.businessHoursEnabled || v.businessDays.length > 0, {
    message: "Pick at least one working day, or turn business hours off",
    path: ["businessDays"],
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
