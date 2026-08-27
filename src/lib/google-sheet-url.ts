/**
 * Turning a Google Sheets link into the CSV export it corresponds to.
 *
 * Pure and dependency-free so the parsing — which is the part with the security
 * consequences — is testable against fixed strings rather than against Google.
 *
 * The server fetches whatever this returns, which makes an unrestricted version
 * of this function a server-side request forgery primitive: paste an internal
 * address, have the server fetch it, read the result. So the host is checked
 * against an allowlist and the output URL is BUILT from a parsed id rather than
 * being the caller's string with a query appended. There is no path through
 * here that reaches a host we did not construct ourselves.
 */

export type SheetRef = { sheetId: string; gid: string | null; exportUrl: string };

/** Only these hosts for the link a person pastes, and only ever over https. */
const ALLOWED_HOSTS = new Set(["docs.google.com"]);

/**
 * Hosts a Google export is allowed to redirect TO.
 *
 * A shared sheet does not serve its own CSV: `/export?format=csv` answers 307
 * and points at a one-time `*.googleusercontent.com` URL. Refusing to follow
 * that reports "not shared" for every sheet that IS shared — verified against a
 * real public sheet, which is the only way this shows up.
 *
 * Following redirects blindly is how a URL allowlist gets walked around, so
 * every hop is re-checked against this list rather than trusted because the
 * first one was fine.
 */
export function isAllowedRedirectHost(hostname: string): boolean {
  return (
    hostname === "docs.google.com" ||
    hostname === "googleusercontent.com" ||
    hostname.endsWith(".googleusercontent.com")
  );
}

/**
 * A spreadsheet id as Google issues them.
 *
 * Deliberately narrow: this string is interpolated into the URL the server
 * fetches, so anything that is not an id must fail here rather than be
 * smuggled through as a path.
 */
const SHEET_ID = /^[A-Za-z0-9_-]{20,120}$/;
const GID = /^[0-9]{1,20}$/;

export type SheetUrlError =
  | "not-a-url"
  | "wrong-host"
  | "not-a-sheet"
  | "published-html";

export function parseSheetUrl(raw: string): { ok: true; ref: SheetRef } | { ok: false; reason: SheetUrlError } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not-a-url" };
  }

  // https only. An http link would be silently upgraded by Google anyway, but
  // accepting it here would mean the allowlist was checked against a scheme we
  // never verified.
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return { ok: false, reason: "wrong-host" };
  }

  // The gid picks the tab. It lives in the fragment on a normal sheet link
  // (#gid=0) and in the query on some shared ones.
  const fromHash = /(?:^|[#&])gid=([0-9]+)/.exec(url.hash);
  const gidRaw = fromHash?.[1] ?? url.searchParams.get("gid");
  const gid = gidRaw && GID.test(gidRaw) ? gidRaw : null;

  // Publish-to-web links (/spreadsheets/d/e/<token>/pub...) are a different
  // shape and a different token. They export CSV too, but only when the sheet
  // was published as CSV — an HTML publish would hand us a web page and the
  // parser would find one enormous column. Told apart here rather than
  // discovered downstream.
  const published = /\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)\/(pubhtml|pub)(?:$|\/)/.exec(url.pathname);
  if (published) {
    const token = published[1];
    if (!SHEET_ID.test(token)) return { ok: false, reason: "not-a-sheet" };
    if (url.searchParams.get("output") === "csv" || published[2] === "pub") {
      const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/e/${token}/pub`);
      exportUrl.searchParams.set("output", "csv");
      if (gid) exportUrl.searchParams.set("gid", gid);
      return { ok: true, ref: { sheetId: token, gid, exportUrl: exportUrl.toString() } };
    }
    return { ok: false, reason: "published-html" };
  }

  const match = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
  if (!match) return { ok: false, reason: "not-a-sheet" };

  const sheetId = match[1];
  if (!SHEET_ID.test(sheetId)) return { ok: false, reason: "not-a-sheet" };

  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  exportUrl.searchParams.set("format", "csv");
  if (gid) exportUrl.searchParams.set("gid", gid);

  return { ok: true, ref: { sheetId, gid, exportUrl: exportUrl.toString() } };
}

/** What to tell the person who pasted the link. */
export const SHEET_URL_MESSAGE: Record<SheetUrlError, string> = {
  "not-a-url": "That does not look like a link.",
  "wrong-host": "That is not a Google Sheets link — it should start with https://docs.google.com/spreadsheets/.",
  "not-a-sheet": "That Google link is not a spreadsheet.",
  "published-html":
    "That sheet is published as a web page rather than as CSV. Re-publish it choosing “Comma-separated values (.csv)”.",
};
