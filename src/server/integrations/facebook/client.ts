import { leadDetailSchema, type LeadDetail } from "./schema";

// Pinned deliberately. v20.0 stops working 2026-09-24; bumping this is a
// scheduled maintenance task, not something to leave floating.
export const GRAPH_VERSION = "v25.0";

/**
 * Meta's OAuth-family error codes. These arrive with an HTTP 400, NOT a 401 —
 * classifying on HTTP status alone silently mistakes a dead token for a
 * transient server error, so the customer is never told to reconnect.
 * Confirmed live: an invalid token returns `400` with `error.code: 190`.
 */
const AUTH_ERROR_CODES = new Set([102, 190, 458, 459, 460, 463, 467]);

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    /** Meta's own `error.code`, when the body carried one. */
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = "GraphApiError";
  }

  /** True when the connection needs the customer to re-authorize. */
  get needsReauth(): boolean {
    if (this.code !== null) return AUTH_ERROR_CODES.has(this.code);
    return this.status === 401 || this.status === 403;
  }
}

/** Pulls `error.code` out of a Graph error body, if it is there. */
function parseErrorCode(body: string): number | null {
  try {
    const code = JSON.parse(body)?.error?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

/** Injectable so tests never touch the network. */
export type Fetcher = typeof fetch;

/**
 * Reads a lead's field data by `leadgen_id`.
 *
 * Requires the `leads_retrieval` permission on an App-Review-approved app and
 * a page access token. Meta keeps lead data for only 90 days, so a failure
 * here is potential permanent loss — callers must dead-letter, not swallow.
 */
export async function fetchLeadDetail(
  leadgenId: string,
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<LeadDetail> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}`);
  url.searchParams.set("fields", "id,created_time,ad_id,form_id,field_data");
  url.searchParams.set("access_token", accessToken);

  const response = await fetcher(url, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const code = parseErrorCode(body);
    // 4xx other than 429 means the request itself is wrong — retrying will
    // fail identically and just burns the 90-day window. Code 4 and 17 are
    // Meta's rate limits, which do arrive as 400.
    const rateLimited = code === 4 || code === 17 || code === 32 || response.status === 429;
    const retryable = rateLimited || response.status >= 500;
    throw new GraphApiError(
      `Graph API ${response.status}${code === null ? "" : ` (code ${code})`}: ${body.slice(0, 300)}`,
      response.status,
      retryable,
      code,
    );
  }

  return leadDetailSchema.parse(await response.json());
}
