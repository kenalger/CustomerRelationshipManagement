import { z } from "zod";

/** The fields a CSV column can be mapped onto. */
export const IMPORT_FIELDS = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: false },
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "title", label: "Job title", required: false },
  { key: "companyName", label: "Company", required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** Header guesses, so a well-formed export maps itself. */
export const HEADER_ALIASES: Record<ImportField, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "fname"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "lname"],
  email: ["email", "e-mail", "email address", "work email", "mail"],
  phone: ["phone", "phone number", "telephone", "mobile", "cell", "tel"],
  title: ["title", "job title", "position", "role", "job"],
  companyName: ["company", "company name", "organisation", "organization", "account", "employer"],
};

// Messages are written for the person holding the spreadsheet, not for a
// developer reading a stack trace. They name the column and say what to do.
export const importRowSchema = z.object({
  firstName: z
    .string({ error: "First name is empty — every contact needs at least a first name" })
    .trim()
    .min(1, "First name is empty — every contact needs at least a first name")
    .max(100, "First name is longer than 100 characters"),
  lastName: z.string().trim().max(100, "Last name is longer than 100 characters").optional().nullable(),
  email: z
    .union([z.email("Email is not a valid address"), z.literal("")])
    .optional()
    .nullable(),
  phone: z.string().trim().max(50, "Phone is longer than 50 characters").optional().nullable(),
  title: z.string().trim().max(100, "Job title is longer than 100 characters").optional().nullable(),
  companyName: z
    .string()
    .trim()
    .max(200, "Company name is longer than 200 characters")
    .optional()
    .nullable(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

/** Hard ceiling per import. Anything dropped is reported, never silent. */
export const MAX_IMPORT_ROWS = 5000;

export const importRequestSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).max(MAX_IMPORT_ROWS),
  /** CSV header → our field. Unmapped columns are ignored. */
  mapping: z.record(z.string(), z.string()),
  onDuplicate: z.enum(["skip", "update"]).default("skip"),
});
