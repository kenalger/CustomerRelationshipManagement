/**
 * Working-time arithmetic in a named timezone.
 *
 * Built before anything consumes it, because this is where a feature like
 * this goes wrong. Two properties matter:
 *
 *  1. It resolves wall-clock parts for an instant with `Intl.DateTimeFormat`
 *     and an explicit `timeZone`, rather than adding a fixed offset. That
 *     makes DST correct for free — each day is asked about independently, so
 *     a 23-hour or 25-hour day needs no special case.
 *  2. With business hours off it degrades to a plain wall-clock difference,
 *     so the toggle is one branch rather than a second implementation that
 *     can drift.
 */
export type BusinessHours = {
  timezone: string;
  businessHoursEnabled: boolean;
  /** ISO weekday numbers, 1 = Monday. */
  businessDays: number[];
  /** Minutes from local midnight. */
  businessStartMinute: number;
  businessEndMinute: number;
};

/** Local wall-clock parts of an instant, in the given zone. */
function partsIn(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const WEEKDAY: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };

  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday] ?? 1,
    // `hour` can be "24" at midnight in some locales; normalise it.
    minuteOfDay: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

function isValid(config: BusinessHours): boolean {
  return (
    config.businessDays.length > 0 &&
    config.businessEndMinute > config.businessStartMinute
  );
}

/**
 * Working minutes elapsed between two instants.
 *
 * Returns whole minutes. `to` before `from` yields 0 rather than a negative,
 * because callers are measuring age and a negative age is never useful.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  config: BusinessHours,
): number {
  if (to <= from) return 0;

  const wallClock = Math.floor((to.getTime() - from.getTime()) / 60_000);

  // A misconfigured window — no working days, or an end before the start —
  // would silently freeze every SLA at zero. Falling back to wall-clock keeps
  // the alerts working while the configuration is wrong.
  if (!config.businessHoursEnabled || !isValid(config)) return wallClock;

  const { businessDays, businessStartMinute, businessEndMinute, timezone } = config;
  const open = new Set(businessDays);

  let total = 0;
  // Walk day by day in the target zone. Stepping by 12 hours and keying on
  // the local date string means a DST shift cannot skip or double-count a day.
  const seen = new Set<string>();
  let cursor = new Date(from.getTime());

  while (cursor <= to) {
    const { ymd, weekday } = partsIn(cursor, timezone);

    if (!seen.has(ymd)) {
      seen.add(ymd);

      if (open.has(weekday)) {
        // Where does this local day's window sit for each endpoint?
        const fromParts = partsIn(from, timezone);
        const toParts = partsIn(to, timezone);

        const startsToday = fromParts.ymd === ymd;
        const endsToday = toParts.ymd === ymd;

        const lower = startsToday
          ? Math.max(businessStartMinute, fromParts.minuteOfDay)
          : businessStartMinute;
        const upper = endsToday
          ? Math.min(businessEndMinute, toParts.minuteOfDay)
          : businessEndMinute;

        if (upper > lower) total += upper - lower;
      }
    }

    cursor = new Date(cursor.getTime() + 12 * 60 * 60_000);
  }

  // The loop can miss the final partial day when `to` lands between steps.
  const toParts = partsIn(to, timezone);
  if (!seen.has(toParts.ymd) && open.has(toParts.weekday)) {
    const upper = Math.min(businessEndMinute, toParts.minuteOfDay);
    if (upper > businessStartMinute) total += upper - businessStartMinute;
  }

  // Guard against the arithmetic ever exceeding real elapsed time.
  return Math.min(total, wallClock);
}

/** Convenience for callers that only need "is this past the target". */
export function hasBreached(
  from: Date,
  now: Date,
  targetMinutes: number,
  config: BusinessHours,
): boolean {
  return businessMinutesBetween(from, now, config) >= targetMinutes;
}
