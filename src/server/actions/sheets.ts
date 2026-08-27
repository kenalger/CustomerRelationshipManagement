"use server";

import { SHEET_URL_MESSAGE, isAllowedRedirectHost, parseSheetUrl } from "@/lib/google-sheet-url";
import { requireCtx } from "@/server/context";
import { hasRole } from "@/server/authz";

/** A CSV big enough for a real list, small enough not to be a memory problem. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type SheetFetchResult =
  | { ok: true; csv: string }
  | { ok: false; error: string };

/**
 * Fetches a Google Sheet as CSV, server-side.
 *
 * Server-side for two reasons. The browser cannot read docs.google.com
 * cross-origin, so a client fetch would fail on CORS regardless. And the URL is
 * user input that the server then requests, which is a server-side request
 * forgery primitive unless it is constrained — so the URL is parsed and REBUILT
 * by `lib/google-sheet-url`, never appended to, and `redirect: "follow"` is
 * deliberately not used: a 302 to an internal address would walk straight past
 * the host allowlist.
 *
 * No OAuth. This reads sheets that are already shared by link or published,
 * which covers the real case without a Google verification review. A private
 * sheet returns HTML sign-in page, which is detected below and reported as
 * "not shared" rather than parsed into nonsense.
 */
export async function fetchSheetAction(rawUrl: string): Promise<SheetFetchResult> {
  const ctx = await requireCtx();
  // Importing is a write, so it takes a writer.
  if (!hasRole(ctx, "REP")) return { ok: false, error: "You do not have permission to import" };

  const parsed = parseSheetUrl(rawUrl);
  if (!parsed.ok) return { ok: false, error: SHEET_URL_MESSAGE[parsed.reason] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    /*
     * Redirects are followed by hand, one hop at a time, with every hop's host
     * re-checked.
     *
     * `redirect: "follow"` would let a crafted response walk the allowlist;
     * `redirect: "manual"` refuses the redirect a SHARED sheet legitimately
     * returns — `/export?format=csv` answers 307 and points at a one-time
     * googleusercontent.com URL, so refusing it reports "not shared" for every
     * sheet that is actually shared. Neither built-in mode is correct, so the
     * loop below is.
     */
    let target = parsed.ref.exportUrl;
    let response: Response | null = null;

    for (let hop = 0; hop < 4; hop += 1) {
      response = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/csv,text/plain" },
        cache: "no-store",
      });

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, error: "Google redirected us nowhere. Try again." };
      }

      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        return { ok: false, error: "Google redirected us somewhere unreadable." };
      }
      if (next.protocol !== "https:" || !isAllowedRedirectHost(next.hostname)) {
        // Either an unshared sheet bouncing to a sign-in page on a different
        // host, or something we should not be following either way.
        return {
          ok: false,
          error:
            "That sheet is not shared. Set it to “Anyone with the link can view”, then try again.",
        };
      }
      target = next.toString();
      response = null;
    }

    if (!response) {
      return { ok: false, error: "That sheet redirected too many times." };
    }
    if (!response.ok) {
      return { ok: false, error: `Google returned ${response.status} for that sheet.` };
    }

    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/html")) {
      return {
        ok: false,
        error: "That link returned a web page rather than data — the sheet is probably not shared.",
      };
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BYTES) {
      return { ok: false, error: "That sheet is too large to import in one go." };
    }

    const csv = new TextDecoder().decode(body);
    if (csv.trim() === "") return { ok: false, error: "That sheet is empty." };

    return { ok: true, csv };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Google did not answer in time. Try again." };
    }
    return { ok: false, error: "Could not reach Google Sheets." };
  } finally {
    clearTimeout(timer);
  }
}
