import type { NormalizedLead } from "@/server/services/leads";
import type { LeadDetail } from "./schema";

/**
 * Maps Meta's `field_data` onto our lead shape.
 *
 * Form field names are chosen by whoever built the form, so these are
 * conventions and not guarantees — a real customer's form will have names we
 * have never seen. Everything unmatched is preserved in `message` rather than
 * discarded, and the per-connection mapping UI (M3a) is what makes this
 * correct rather than merely lucky.
 */
const ALIASES: Record<keyof Omit<NormalizedLead, "message">, string[]> = {
  firstName: ["first_name", "firstname", "given_name"],
  lastName: ["last_name", "lastname", "family_name", "surname"],
  email: ["email", "email_address", "work_email"],
  phone: ["phone_number", "phone", "mobile_number", "telephone"],
  companyName: ["company_name", "company", "organization", "business_name"],
};

const FULL_NAME = ["full_name", "name", "fullname"];
const MESSAGE = ["message", "comments", "notes", "how_can_we_help", "enquiry"];

function splitFullName(value: string): { firstName: string; lastName: string | null } {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * A per-connection override, stored on `Connection.fieldMapping`.
 * Shape: `{ "firstName": ["vorname"], "email": ["e_mail", "kontakt"] }`.
 * Overrides are tried BEFORE the built-in aliases, so a customer whose form
 * uses names we have never seen can be fixed without a deploy.
 */
export type FieldMapping = Partial<Record<keyof NormalizedLead, string[]>>;

/** Parses whatever is on the Connection row, tolerating junk. */
export function parseFieldMapping(raw: unknown): FieldMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const allowed = new Set([...Object.keys(ALIASES), "message"]);
  const mapping: FieldMapping = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    const names = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
      : typeof value === "string" && value.trim() !== ""
        ? [value]
        : [];
    if (names.length > 0) {
      mapping[key as keyof NormalizedLead] = names.map((n) => n.trim().toLowerCase());
    }
  }

  return mapping;
}

export function normalizeFacebookLead(
  detail: LeadDetail,
  mapping: FieldMapping = {},
): NormalizedLead {
  const byName = new Map<string, string>();
  for (const field of detail.field_data) {
    const value = field.values.find((v) => v.trim() !== "");
    if (value) byName.set(field.name.toLowerCase(), value.trim());
  }

  const pick = (names: string[]) => names.map((n) => byName.get(n)).find(Boolean) ?? null;
  // Customer overrides win; built-in aliases are the fallback.
  const pickFor = (field: keyof NormalizedLead, fallback: string[]) =>
    pick([...(mapping[field] ?? []), ...fallback]);

  const normalized: NormalizedLead = {
    firstName: pickFor("firstName", ALIASES.firstName),
    lastName: pickFor("lastName", ALIASES.lastName),
    email: pickFor("email", ALIASES.email),
    phone: pickFor("phone", ALIASES.phone),
    companyName: pickFor("companyName", ALIASES.companyName),
    message: pickFor("message", MESSAGE),
  };

  // Forms very often ask for one full name rather than two fields.
  if (!normalized.firstName) {
    const full = pick(FULL_NAME);
    if (full) {
      const split = splitFullName(full);
      normalized.firstName = split.firstName;
      normalized.lastName = normalized.lastName ?? split.lastName;
    }
  }

  // Anything we could not map is appended rather than dropped — a custom
  // qualifying question is often the most valuable thing on the form.
  const known = new Set([
    ...Object.values(ALIASES).flat(),
    ...Object.values(mapping).flat(),
    ...FULL_NAME,
    ...MESSAGE,
  ]);
  const extras = [...byName.entries()]
    .filter(([name]) => !known.has(name))
    .map(([name, value]) => `${name.replaceAll("_", " ")}: ${value}`);

  if (extras.length > 0) {
    normalized.message = [normalized.message, ...extras].filter(Boolean).join("\n");
  }

  return normalized;
}
