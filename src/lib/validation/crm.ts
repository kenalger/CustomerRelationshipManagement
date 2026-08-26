import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));

export const contactCreateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: optionalText(100),
  // Optional, not required: plenty of real contacts arrive with a phone and no
  // email, and a CRM that refuses them is unusable. An empty string and a
  // missing key both mean "no email".
  email: z
    .union([z.email("Enter a valid email"), z.literal("")])
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(50),
  title: optionalText(100),
  companyId: z.string().cuid().nullish(),
  ownerId: z.string().cuid().nullish(),
});

export const contactUpdateSchema = contactCreateSchema.partial();

/**
 * Sortable columns are an allowlist, not a free string. `orderBy` is
 * interpolated into a query, so accepting whatever the URL says would let a
 * crafted param sort by — and therefore probe — any column on the table.
 */
export const CONTACT_SORTS = ["lastName", "email", "createdAt"] as const;
export const LEAD_SORTS = ["createdAt", "status", "source", "companyName", "score"] as const;
export const COMPANY_SORTS = ["name", "domain", "industry"] as const;

// `.catch` rather than `.default`: a default only covers a *missing* value, so
// an unknown one still threw and blew up the page. A stale bookmark or a
// crafted param must degrade to the default ordering, not to an error boundary.
// The allowlist still decides what can reach `orderBy`.
const sortDir = z.enum(["asc", "desc"]).catch("asc");

export const leadListFilterSchema = z.object({
  status: z.enum(["NEW", "WORKING", "QUALIFIED", "CONVERTED", "JUNK"]).optional(),
  ownerId: z.string().cuid().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(LEAD_SORTS).catch("createdAt"),
  dir: sortDir,
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(25),
});

export const contactListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  ownerId: z.string().cuid().optional(),
  sort: z.enum(CONTACT_SORTS).catch("lastName"),
  dir: sortDir,
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(25),
});

export const companyCreateSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  domain: optionalText(200),
  industry: optionalText(100),
  size: optionalText(50),
  phone: optionalText(50),
  website: optionalText(300),
  ownerId: z.string().cuid().nullish(),
});

export const companyUpdateSchema = companyCreateSchema.partial();

export const companyListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z.enum(COMPANY_SORTS).catch("name"),
  dir: sortDir,
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(25),
});

export const dealCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the deal a name").max(200),
  value: z.coerce.number().min(0, "Value cannot be negative").max(1_000_000_000),
  currency: z.string().trim().length(3).default("USD"),
  pipelineId: z.string().cuid().optional(),
  stageId: z.string().cuid().optional(),
  contactId: z.string().cuid().nullish(),
  companyId: z.string().cuid().nullish(),
  ownerId: z.string().cuid().nullish(),
  expectedCloseDate: z.coerce.date().nullish(),
});

export const dealListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  ownerId: z.string().cuid().optional(),
  open: z.enum(["open", "won", "lost", "all"]).default("open"),
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(25),
});

export const activityCreateSchema = z.object({
  type: z.enum(["CALL", "EMAIL", "MEETING", "NOTE"]),
  subject: optionalText(200),
  body: z.string().trim().max(10_000).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  occurredAt: z.coerce.date().optional(),
  contactId: z.string().cuid().nullish(),
  companyId: z.string().cuid().nullish(),
  dealId: z.string().cuid().nullish(),
  leadId: z.string().cuid().nullish(),
});

export const dealUpdateSchema = z.object({
  title: z.string().trim().min(1, "Give the deal a name").max(200).optional(),
  value: z.coerce.number().min(0, "Value cannot be negative").max(1_000_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  expectedCloseDate: z.coerce.date().nullish(),
  ownerId: z.string().cuid().nullish(),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;
export type DealCreateInput = z.infer<typeof dealCreateSchema>;
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type LeadListFilter = z.infer<typeof leadListFilterSchema>;
export type ContactListFilter = z.infer<typeof contactListFilterSchema>;
