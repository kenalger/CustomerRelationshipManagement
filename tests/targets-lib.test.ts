import { describe, expect, it } from "vitest";

import {
  elapsedFraction,
  isMoneyMetric,
  isOutcomeMetric,
  pace,
  periodBounds,
  periodLabel,
  requiredCoverage,
  shiftPeriod,
  successThreshold,
} from "@/lib/targets";

/** Renders an instant as wall-clock in a zone, for readable assertions. */
const wall = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

describe("period bounds", () => {
  it("starts a month at local midnight, not UTC midnight", () => {
    // The whole reason periodStart is not stored as a UTC month boundary: in
    // Manila (UTC+8) that would be 8am on the 1st, so a full working day of
    // the previous month would be counted into this one.
    const { start, end } = periodBounds(
      "MONTH",
      new Date("2026-09-15T00:00:00Z"),
      "Asia/Manila",
    );
    expect(wall(start, "Asia/Manila")).toBe("2026-09-01, 00:00");
    expect(wall(end, "Asia/Manila")).toBe("2026-10-01, 00:00");
    // In UTC that midnight is the previous afternoon.
    expect(start.toISOString()).toBe("2026-08-31T16:00:00.000Z");
  });

  it("agrees with UTC when the org is in UTC", () => {
    const { start, end } = periodBounds("MONTH", new Date("2026-09-15T12:00:00Z"), "UTC");
    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls December into the following January", () => {
    const { start, end } = periodBounds("MONTH", new Date("2026-12-20T12:00:00Z"), "UTC");
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is half-open, so a deal closing at the boundary lands in exactly one period", () => {
    const september = periodBounds("MONTH", new Date("2026-09-15T12:00:00Z"), "UTC");
    const october = periodBounds("MONTH", new Date("2026-10-15T12:00:00Z"), "UTC");
    // The instant that ends September is the instant that starts October.
    expect(september.end.getTime()).toBe(october.start.getTime());

    const boundary = september.end;
    const inSeptember = boundary >= september.start && boundary < september.end;
    const inOctober = boundary >= october.start && boundary < october.end;
    expect(inSeptember).toBe(false);
    expect(inOctober).toBe(true);
  });

  it("brackets a quarter on calendar quarter lines", () => {
    for (const [month, expected] of [
      ["01", "2026-01-01"],
      ["05", "2026-04-01"],
      ["08", "2026-07-01"],
      ["11", "2026-10-01"],
    ] as const) {
      const { start } = periodBounds("QUARTER", new Date(`2026-${month}-15T12:00:00Z`), "UTC");
      expect(start.toISOString().slice(0, 10)).toBe(expected);
    }
  });

  it("ends Q4 in the next year", () => {
    const { start, end } = periodBounds("QUARTER", new Date("2026-11-15T12:00:00Z"), "UTC");
    expect(start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("uses the offset in force at the month start, not the one at 'now'", () => {
    /*
     * The two-pass correction earns its keep here. Lord Howe shifts by 30
     * minutes for DST, which began on 4 October 2026. Asked on 15 November,
     * the naive first guess lands in the +11:00 period while 1 November
     * midnight is also +11:00 — but 1 October midnight is +10:30, and a
     * single-pass offset taken from "now" would put one of them an hour out.
     *
     * Both are asserted, so the pair can only pass if the offset is measured
     * at each month's own boundary. Verified against the IANA database.
     */
    const november = periodBounds(
      "MONTH",
      new Date("2026-11-15T00:00:00Z"),
      "Australia/Lord_Howe",
    );
    expect(wall(november.start, "Australia/Lord_Howe")).toBe("2026-11-01, 00:00");
    expect(november.start.toISOString()).toBe("2026-10-31T13:00:00.000Z"); // +11:00

    const october = periodBounds(
      "MONTH",
      new Date("2026-10-02T00:00:00Z"),
      "Australia/Lord_Howe",
    );
    expect(wall(october.start, "Australia/Lord_Howe")).toBe("2026-10-01, 00:00");
    expect(october.start.toISOString()).toBe("2026-09-30T13:30:00.000Z"); // +10:30
  });

  it("gets a month start right on the day US DST ends", () => {
    // 1 November 2026 is the changeover itself in New York.
    const { start } = periodBounds("MONTH", new Date("2026-11-15T12:00:00Z"), "America/New_York");
    expect(wall(start, "America/New_York")).toBe("2026-11-01, 00:00");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("handles a zone west of UTC", () => {
    const { start } = periodBounds("MONTH", new Date("2026-09-15T12:00:00Z"), "America/New_York");
    expect(wall(start, "America/New_York")).toBe("2026-09-01, 00:00");
    // 00:00 EDT is 04:00 UTC the same day.
    expect(start.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("handles a 45-minute offset zone", () => {
    const { start } = periodBounds("MONTH", new Date("2026-09-15T12:00:00Z"), "Asia/Kathmandu");
    expect(wall(start, "Asia/Kathmandu")).toBe("2026-09-01, 00:00");
    // +05:45 — the case that a whole-hour or whole-day correction cannot fix.
    expect(start.toISOString()).toBe("2026-08-31T18:15:00.000Z");
  });
});

describe("shiftPeriod", () => {
  it("steps back a month", () => {
    const { start } = shiftPeriod("MONTH", new Date("2026-09-15T12:00:00Z"), "UTC", -1);
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("steps back across a year boundary", () => {
    const { start } = shiftPeriod("MONTH", new Date("2026-01-15T12:00:00Z"), "UTC", -1);
    expect(start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });

  it("steps forward a quarter across a year boundary", () => {
    const { start } = shiftPeriod("QUARTER", new Date("2026-11-15T12:00:00Z"), "UTC", 1);
    expect(start.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is a no-op at zero", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(shiftPeriod("MONTH", now, "UTC", 0).start.getTime()).toBe(
      periodBounds("MONTH", now, "UTC").start.getTime(),
    );
  });

  it("round-trips back and forward", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const back = shiftPeriod("QUARTER", now, "UTC", -3);
    const forward = shiftPeriod("QUARTER", back.start, "UTC", 3);
    expect(forward.start.getTime()).toBe(periodBounds("QUARTER", now, "UTC").start.getTime());
  });
});

describe("periodLabel", () => {
  it("labels months zero-padded and quarters by number", () => {
    const sep = periodBounds("MONTH", new Date("2026-09-15T12:00:00Z"), "UTC");
    expect(periodLabel("MONTH", sep.start, "UTC")).toBe("2026-09");

    const q3 = periodBounds("QUARTER", new Date("2026-08-15T12:00:00Z"), "UTC");
    expect(periodLabel("QUARTER", q3.start, "UTC")).toBe("2026-Q3");
  });
});

describe("the committed / aspirational split", () => {
  it("treats the three outcome metrics as committed and the rest as aspirational", () => {
    for (const metric of ["REVENUE_WON", "DEALS_WON", "LEADS_CONVERTED"] as const) {
      expect(isOutcomeMetric(metric)).toBe(true);
      expect(successThreshold(metric)).toBe(1);
    }
    for (const metric of ["CALLS_LOGGED", "MEETINGS_HELD", "FIRST_TOUCHES"] as const) {
      expect(isOutcomeMetric(metric)).toBe(false);
      // 0.7, not 1: an activity target graded like revenue teaches the team
      // that activity is the goal.
      expect(successThreshold(metric)).toBe(0.7);
    }
  });

  it("marks only revenue as carrying a currency", () => {
    expect(isMoneyMetric("REVENUE_WON")).toBe(true);
    expect(isMoneyMetric("DEALS_WON")).toBe(false);
    expect(isMoneyMetric("CALLS_LOGGED")).toBe(false);
  });
});

describe("elapsedFraction", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-10-01T00:00:00Z");

  it("is 0 at the start, 0.5 at the midpoint and 1 at the end", () => {
    expect(elapsedFraction(start, end, start)).toBe(0);
    expect(elapsedFraction(start, end, new Date("2026-09-16T00:00:00Z"))).toBeCloseTo(0.5, 2);
    expect(elapsedFraction(start, end, end)).toBe(1);
  });

  it("clamps outside the period rather than going negative or past 1", () => {
    expect(elapsedFraction(start, end, new Date("2026-08-01T00:00:00Z"))).toBe(0);
    expect(elapsedFraction(start, end, new Date("2026-11-01T00:00:00Z"))).toBe(1);
  });

  it("does not divide by zero on a degenerate period", () => {
    expect(elapsedFraction(start, start, start)).toBe(1);
  });
});

describe("pace", () => {
  it("reads the same attainment differently depending on when it is asked", () => {
    // The point of the whole function: 62% is ahead on day 12 and behind on
    // day 27, and raw attainment cannot tell those apart.
    expect(pace(31_000, 50_000, 12 / 30)).toBe("ahead");
    expect(pace(31_000, 50_000, 27 / 30)).toBe("behind");
  });

  it("calls it on-track inside the band", () => {
    expect(pace(50, 100, 0.5)).toBe("on-track");
    expect(pace(52, 100, 0.5)).toBe("on-track");
    expect(pace(48, 100, 0.5)).toBe("on-track");
  });

  it("does not flicker on either side of the band edge", () => {
    expect(pace(56, 100, 0.5)).toBe("ahead");
    expect(pace(44, 100, 0.5)).toBe("behind");
  });

  it("reports not-started rather than dividing by a zero target", () => {
    expect(pace(10, 0, 0.5)).toBe("not-started");
    expect(pace(0, 100, 0)).toBe("not-started");
  });

  it("is ahead when the target is already met early", () => {
    expect(pace(120, 100, 0.3)).toBe("ahead");
  });
});

describe("requiredCoverage", () => {
  it("derives the multiple from the win rate rather than assuming 3x", () => {
    // A team winning half its deals needs 2x, not the received 3x.
    expect(requiredCoverage(20, 20)).toBe(2);
    expect(requiredCoverage(10, 30)).toBe(4);
    expect(requiredCoverage(12, 18)).toBe(2.5);
  });

  it("returns null on too little history instead of inventing a number", () => {
    // "We don't know yet" and "you need 3x" are different claims, and only one
    // of them is true here.
    expect(requiredCoverage(2, 3)).toBeNull();
    expect(requiredCoverage(0, 0)).toBeNull();
  });

  it("returns null when nothing has ever been won", () => {
    expect(requiredCoverage(0, 40)).toBeNull();
  });

  it("caps the multiple so a struggling team gets advice, not noise", () => {
    // 2% win rate would otherwise demand 50x.
    expect(requiredCoverage(1, 49)).toBe(10);
  });
});
