-- Team-wide targets are stored with `userId = NULL`, and Postgres treats NULLs
-- as DISTINCT in a unique index by default. That meant the constraint Prisma
-- generated did not constrain team targets at all: two identical rows for the
-- same organisation, metric and period both inserted happily, and an upsert
-- keyed on it could never match the existing one.
--
-- Verified against this database before writing the fix — two team targets for
-- (org, REVENUE_WON, MONTH, 2026-09-01) were both accepted.
--
-- NULLS NOT DISTINCT (Postgres 15+) makes NULL compare equal to NULL for
-- uniqueness, so one index now covers both the per-person and the team case.
-- Prisma's schema language cannot express this, so it is applied here by hand;
-- `@@unique` in schema.prisma carries a comment pointing at this migration so
-- nobody regenerates it away.
DROP INDEX IF EXISTS "Target_organizationId_userId_metric_periodStart_key";

CREATE UNIQUE INDEX "Target_organizationId_userId_metric_periodStart_key"
  ON "Target" ("organizationId", "userId", "metric", "periodStart")
  NULLS NOT DISTINCT;
