/**
 * Lead.dedupeKey — the normalized identity of an inbound lead, unique per org.
 *
 * Precedence is deliberate and conservative: email, then phone, then a
 * name+company fallback. Fuzzy matching is NOT implemented — question Q5 in
 * plan/04-features/lead-ingestion/plan.md is still open, and guessing wrong
 * merges two real prospects into one, which is unrecoverable without the audit
 * log. Exact matching over-creates instead, which a human can merge later.
 */
export function buildDedupeKey(input: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  const email = input.email?.trim().toLowerCase();
  if (email) return `email:${email}`;

  const phone = normalizePhone(input.phone);
  if (phone) return `phone:${phone}`;

  const name = [input.firstName, input.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();
  const company = input.companyName?.trim().toLowerCase() ?? "";
  if (name || company) return `name:${name}|${company}`;

  throw new Error("Cannot build a dedupe key: lead has no email, phone, or name");
}

/** Digits only, keeping a leading +. Not full E.164 — no region inference. */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}
