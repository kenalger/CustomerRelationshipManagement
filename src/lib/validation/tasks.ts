import { z } from "zod";

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "What needs doing?").max(200),
  notes: z.string().trim().max(5000).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  dueAt: z.coerce.date().nullish(),
  assigneeId: z.string().cuid().nullish(),
  contactId: z.string().cuid().nullish(),
  dealId: z.string().cuid().nullish(),
  leadId: z.string().cuid().nullish(),
});

export const taskListFilterSchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  state: z.enum(["open", "done"]).default("open"),
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskListFilter = z.infer<typeof taskListFilterSchema>;
