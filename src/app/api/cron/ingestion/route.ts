import { timingSafeEqual } from "node:crypto";

import { prunePayloads, sweepPendingIngestion } from "@/server/services/ingestion-queue";
import { sweepSlaBreaches } from "@/server/services/sla";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled maintenance, invoked by Vercel Cron (see vercel.json).
 *
 * Runs two sweeps: retry failed lead imports, and enforce the speed-to-lead
 * SLA. They share one cron slot deliberately — the free plan allows few, and
 * both are cheap indexed scans.
 *
 * Unauthenticated routes that mutate data are a liability, so this requires a
 * bearer secret. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // Independent sweeps: a failure in one must not skip the other.
  /*
   * SEQUENTIAL, not Promise.all.
   *
   * Each sweep opens interactive transactions, and running them concurrently
   * over the pg driver corrupts the protocol —
   * `08P01: bind message supplies N parameters, but prepared statement ""
   * requires 0`. This bit when a third sweep was added here; the runbook in
   * plan/06-ops/local-development.md warns about exactly this.
   *
   * Each is still isolated: one failing must not skip the others, so every
   * result is captured independently rather than letting a throw abort the run.
   */
  async function attempt<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    try {
      return await fn();
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const ingestion = await attempt(() => sweepPendingIngestion());
  const sla = await attempt(() => sweepSlaBreaches());
  const retention = await attempt(() => prunePayloads());

  return Response.json({ ingestion, sla, retention, ms: Date.now() - started });
}
