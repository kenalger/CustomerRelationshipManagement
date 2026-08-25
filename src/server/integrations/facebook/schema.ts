import { z } from "zod";

/**
 * Meta's leadgen webhook payload. Confirmed against the official docs on
 * 2026-08-23 — see plan/07-research/meta-lead-ads-api.md.
 *
 * Ids arrive as JSON *numbers* and are large enough to lose precision as JS
 * doubles, so every id is coerced to a string at the boundary and stays one.
 */
const id = z.union([z.string(), z.number()]).transform((v) => String(v));

export const leadgenChangeSchema = z.object({
  field: z.literal("leadgen"),
  value: z.object({
    leadgen_id: id,
    page_id: id,
    form_id: id.optional(),
    adgroup_id: id.optional(),
    ad_id: id.optional(),
    created_time: z.number().optional(),
  }),
});

export const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      // Despite the generic name, `entry[].id` is the PAGE id. It is how we
      // resolve which tenant this payload belongs to.
      id,
      time: z.number().optional(),
      // Non-leadgen changes (other subscribed fields) are ignored, not fatal.
      changes: z.array(z.unknown()).default([]),
    }),
  ),
});

/** The Graph API response when reading a lead by id. */
export const leadDetailSchema = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  ad_id: z.string().optional(),
  form_id: z.string().optional(),
  field_data: z
    .array(z.object({ name: z.string(), values: z.array(z.string()).default([]) }))
    .default([]),
});

export type LeadgenChange = z.infer<typeof leadgenChangeSchema>;
export type LeadDetail = z.infer<typeof leadDetailSchema>;
