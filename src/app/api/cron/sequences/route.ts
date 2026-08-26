import { timingSafeEqual } from "node:crypto";

import { sweepDueEnrollments } from "@/server/services/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Advances outreach sequences, invoked by Vercel Cron (see vercel.json).
 *
 * Its own slot rather than sharing `/api/cron/ingestion`: that one runs every
 * five minutes because a lead sitting unworked is expensive by the minute,
 * while a sequence step is scheduled in hours and days. Bolting this onto it
 * would run a heavier sweep twelve times more often than it needs.
 *
 * NOTHING IS SENT HERE. A due step becomes a Task for a human — see
 * `sweepDueEnrollments`.
 *
 * Unauthenticated routes that mutate data are a liability, so this requires a
 * bearer secret. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 * Duplicated from the ingestion route rather than shared: a route module
 * exports HTTP handlers, and importing one route's internals from another
 * makes it a module the router also tries to serve.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Length-check first: timingSafeEqual throws on a length mismatch, and the
  // length of a bearer header is not the secret.
  if (header.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // One sweep, but the same shape as the ingestion route: a throw inside is
  // captured rather than becoming a 500, so a bad tenant shows up in the cron
  // log as an error field instead of an opaque failed invocation.
  let sequences: Awaited<ReturnType<typeof sweepDueEnrollments>> | { error: string };
  try {
    // Bounded per organization per tick — a backlog drains over several runs
    // rather than one run hitting `maxDuration` and losing what it had not
    // committed. The sweep itself is sequential; see the 08P01 note there.
    sequences = await sweepDueEnrollments({ limit: 200 });
  } catch (error) {
    sequences = { error: error instanceof Error ? error.message : String(error) };
  }

  return Response.json({ sequences, ms: Date.now() - started });
}
