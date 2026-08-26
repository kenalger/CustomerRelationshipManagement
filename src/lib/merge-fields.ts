/**
 * Merge-field substitution for outbound copy.
 *
 * Lives in `lib/` rather than beside the template service because the template
 * *editor* needs to render a preview in the browser, and importing it from
 * `server/services/templates.ts` would drag Prisma — and with it `fs`, `net`,
 * `tls` and `dns` — into the client bundle. Nothing here touches a database.
 */

export type Copy = { subject: string; body: string };

/**
 * The fields the sequence sweep actually substitutes.
 *
 * Exported so the editor can list them: anything not on this list collapses to
 * empty text, so an author has no other way to know which tokens do something.
 */
export const MERGE_FIELDS = ["first_name", "last_name", "email", "company"] as const;

/**
 * Substitutes `{{first_name}}`-style merge fields.
 *
 * An unknown or empty field collapses to the empty string rather than being
 * left as `{{first_name}}` — a literal placeholder reaching a prospect is the
 * classic embarrassment, and this copy is going to a rep to paste and send.
 * Pure and synchronous so it is testable without a database.
 */
export function renderCopy(copy: Copy, values: Record<string, string | null | undefined>): Copy {
  const substitute = (text: string) =>
    text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => values[key]?.trim() ?? "");

  return { subject: substitute(copy.subject), body: substitute(copy.body) };
}
