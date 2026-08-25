import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's `X-Hub-Signature-256` header: an HMAC-SHA256 of the payload
 * keyed by the app secret, prefixed `sha256=`.
 *
 * MUST be given the RAW request body. Parsing to JSON and re-serializing
 * changes whitespace and key order, and the signature will never match.
 * See plan/07-research/meta-lead-ads-api.md.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;

  const [algorithm, provided] = header.split("=");
  if (algorithm !== "sha256" || !provided) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  // Length check first: timingSafeEqual throws on a length mismatch, and that
  // throw would itself be an oracle.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}
