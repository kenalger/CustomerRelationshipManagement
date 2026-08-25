import { timingSafeEqual } from "node:crypto";

import { sweepPendingIngestion } from "@/server/services/ingestion-queue";
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
  const [ingestion, sla] = await Promise.allSettled([
    sweepPendingIngestion(),
    sweepSlaBreaches(),
  ]);

  return Response.json({
    ingestion: ingestion.status === "fulfilled" ? ingestion.value : { error: String(ingestion.reason) },
    sla: sla.status === "fulfilled" ? sla.value : { error: String(sla.reason) },
    ms: Date.now() - started,
  });
}
