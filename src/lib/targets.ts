import type { TargetMetric, TargetPeriod } from "@/generated/prisma/enums";

/**
 * Period arithmetic in a named timezone, and the committed/aspirational split.
 *
 * Built before anything consumes it, for the same reason `business-hours.ts`
 * was: this is where a feature like this goes wrong. Periods are resolved by
 * asking `Intl.DateTimeFormat` for the wall-clock parts of an instant in an
 * explicit zone, never by adding a fixed offset — which makes DST correct for
 * free, including the two days a year a month boundary would otherwise land an
 * hour out.
 *
 * Nothing here touches a database, so every case below is testable against
 * fixed inputs rather than fixtures.
 */

// ─────────────────────────── the split that matters ───────────────────────────

/**
 * Outcome metrics are graded as *committed*: 100% is the expectation, and
 * missing is a real miss. Activity metrics are graded as *aspirational*, where
 * roughly 70% is success.
 *
 * This function is the only place that distinction is made, so it cannot drift
 * between the settings screen, the dashboard and the report. Grading activity
 * the same way as revenue is how a team learns that activity IS the goal —
 * the Goodhart failure this whole feature is designed around.
 */
export function isOutcomeMetric(metric: TargetMetric): boolean {
  return metric === "REVENUE_WON" || metric === "DEALS_WON" || metric === "LEADS_CONVERTED";
}

/** Only revenue carries a currency; everything else is a count. */
export function isMoneyMetric(metric: TargetMetric): boolean {
  return metric === "REVENUE_WON";
}

/**
 * What "success" means for this metric, as a fraction.
 *
 * 0.7 for aspirational targets is the OKR convention, and it is the number
 * that stops an activity target from being read as a pass/fail bar.
 */
export function successThreshold(metric: TargetMetric): number {
  return isOutcomeMetric(metric) ? 1 : 0.7;
}

// ─────────────────────────── wall-clock parts ───────────────────────────

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/** Local wall-clock parts of an instant, in the given zone. */
function partsIn(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour` formats as "24" at midnight in some locales; normalise it.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** The zone's UTC offset in milliseconds at a given instant. */
function offsetAt(instant: number, timeZone: string): number {
  const seen = partsIn(new Date(instant), timeZone);
  const asUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  // Rounded to the minute, because `asUtc` has no seconds to compare against.
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

/**
 * The instant at which a given local midnight occurs in a zone.
 *
 * Solved by search rather than by offset arithmetic: guess the UTC instant for
 * that wall-clock time, measure how far off the guess lands once formatted
 * back in the zone, and correct. Two passes converge for every real zone
 * including half-hour and 45-minute offsets.
 *
 * The DST edge is deliberate. On a spring-forward day local midnight may not
 * exist in some zones; the correction then lands on the first instant that
 * does exist, which is the only sane answer for "when did this month start".
 */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // Subtract the offset measured at a first guess, then re-measure at the
  // candidate. The second pass is what makes a DST boundary come out right:
  // the offset before the transition is not the offset after it.
  const firstOffset = offsetAt(wanted, timeZone);
  const candidate = wanted - firstOffset;
  const secondOffset = offsetAt(candidate, timeZone);

  return new Date(wanted - secondOffset);
}

// ─────────────────────────── periods ───────────────────────────

/** The quarter (1–4) a 1-indexed month falls in. */
const quarterOf = (month: number) => Math.floor((month - 1) / 3) + 1;

/**
 * The period containing `instant`, as a half-open interval `[start, end)`.
 *
 * Half-open on purpose: a deal closing at exactly midnight on the 1st belongs
 * to the new month, and `lte` on the end would count it in both.
 */
export function periodBounds(
  period: TargetPeriod,
  instant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const { year, month } = partsIn(instant, timeZone);

  if (period === "MONTH") {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return {
      start: zonedMidnight(year, month, 1, timeZone),
      end: zonedMidnight(nextYear, nextMonth, 1, timeZone),
    };
  }

  const startMonth = (quarterOf(month) - 1) * 3 + 1;
  const endMonth = startMonth + 3;
  const endYear = endMonth > 12 ? year + 1 : year;
  return {
    start: zonedMidnight(year, startMonth, 1, timeZone),
    end: zonedMidnight(endYear, endMonth > 12 ? endMonth - 12 : endMonth, 1, timeZone),
  };
}

/** The period `steps` periods away from the one containing `instant`. */
export function shiftPeriod(
  period: TargetPeriod,
  instant: Date,
  timeZone: string,
  steps: number,
): { start: Date; end: Date } {
  const { year, month } = partsIn(instant, timeZone);
  const monthsPerPeriod = period === "MONTH" ? 1 : 3;
  const baseMonth = period === "MONTH" ? month : (quarterOf(month) - 1) * 3 + 1;

  // Month index from year 0, so the arithmetic wraps years without a special
  // case for December.
  const index = year * 12 + (baseMonth - 1) + steps * monthsPerPeriod;
  const anchor = zonedMidnight(Math.floor(index / 12), (index % 12) + 1, 1, timeZone);
  return periodBounds(period, anchor, timeZone);
}

/** A stable key for a period, e.g. "2026-09" or "2026-Q3". */
export function periodLabel(period: TargetPeriod, start: Date, timeZone: string): string {
  const { year, month } = partsIn(start, timeZone);
  return period === "MONTH"
    ? `${year}-${String(month).padStart(2, "0")}`
    : `${year}-Q${quarterOf(month)}`;
}

// ─────────────────────────── pace ───────────────────────────

/**
 * How far through the period we are, 0–1.
 *
 * Clamped at both ends so a target read before its period opens reports 0
 * rather than a negative, and one read after it closes reports 1.
 */
export function elapsedFraction(start: Date, end: Date, now: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
}

export type Pace = "ahead" | "on-track" | "behind" | "not-started";

/**
 * Attainment relative to how much of the period has gone.
 *
 * This is the number a manager acts on, and it is the reason raw attainment on
 * its own is misleading: 62% on day 12 of 30 is comfortably ahead, while the
 * same 62% on day 27 is a miss that can still be rescued. Showing only the 62%
 * makes those two situations look identical.
 *
 * The 5% band stops a target from flickering between "ahead" and "behind" on
 * every page load in the middle of a period.
 */
export function pace(attained: number, target: number, elapsed: number): Pace {
  if (target <= 0) return "not-started";
  if (elapsed <= 0) return "not-started";

  const ratio = attained / target;
  if (ratio >= elapsed + 0.05) return "ahead";
  if (ratio <= elapsed - 0.05) return "behind";
  return "on-track";
}

/**
 * The pipeline coverage a team needs, derived from how often it actually wins.
 *
 * The received wisdom is 3x. The honest answer is 1 / win rate: a team that
 * wins half its deals needs 2x, and telling them to hold 4x makes them chase
 * junk to pad a ratio. Deriving it from real history means the number is
 * arguable rather than magic.
 *
 * Returns null when there is not enough closed history to divide by — "we
 * don't know yet" is a different statement from "you need 3x", and inventing
 * the second is how a made-up number ends up in a board pack.
 */
export function requiredCoverage(wonCount: number, lostCount: number): number | null {
  const closed = wonCount + lostCount;
  // Below this, one deal moves the ratio by more than the ratio is worth.
  if (closed < 10 || wonCount === 0) return null;

  const winRate = wonCount / closed;
  // Capped: a team winning 5% would otherwise be told to hold 20x, which is
  // not advice, it is noise.
  return Math.min(10, Math.round((1 / winRate) * 10) / 10);
}
