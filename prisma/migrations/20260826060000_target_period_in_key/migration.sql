-- `period` belongs in the uniqueness key, and its absence was a real bug.
--
-- Every quarter starts on a month boundary, so a MONTH target and a QUARTER
-- target for the same organisation, user and metric share a `periodStart` on
-- 1 January, 1 April, 1 July and 1 October. Under the old key those two rows
-- were the same row: setting the quarterly quota silently overwrote the
-- monthly one, four times a year, and only on those dates — which is exactly
-- the kind of bug that survives to production.
--
-- NULLS NOT DISTINCT is preserved: team-wide targets are stored with
-- `userId = NULL`, and without it Postgres does not constrain them at all.
DROP INDEX IF EXISTS "Target_organizationId_userId_metric_periodStart_key";

CREATE UNIQUE INDEX "Target_organizationId_userId_metric_period_periodStart_key"
  ON "Target" ("organizationId", "userId", "metric", "period", "periodStart")
  NULLS NOT DISTINCT;
