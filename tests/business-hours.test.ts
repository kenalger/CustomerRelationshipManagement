import { describe, expect, it } from "vitest";

import { type BusinessHours, businessMinutesBetween, hasBreached } from "@/lib/business-hours";

const MANILA: BusinessHours = {
  timezone: "Asia/Manila", // UTC+8, no DST
  businessHoursEnabled: true,
  businessDays: [1, 2, 3, 4, 5],
  businessStartMinute: 9 * 60,
  businessEndMinute: 17 * 60,
};

/** A Manila wall-clock time, expressed as the UTC instant it really is. */
const manila = (iso: string) => new Date(`${iso}+08:00`);

describe("working-time arithmetic", () => {
  it("counts only the minutes inside a shift", () => {
    // 10:00 -> 10:30 on a Wednesday.
    expect(
      businessMinutesBetween(manila("2026-08-26T10:00"), manila("2026-08-26T10:30"), MANILA),
    ).toBe(30);
  });

  it("ignores time before the day opens", () => {
    // Arrives 07:00, checked at 09:30 — only 30 minutes were working time.
    expect(
      businessMinutesBetween(manila("2026-08-26T07:00"), manila("2026-08-26T09:30"), MANILA),
    ).toBe(30);
  });

  it("stops counting when the day closes", () => {
    // 16:30 -> 20:00 gives the 30 minutes to 17:00 and nothing after.
    expect(
      businessMinutesBetween(manila("2026-08-26T16:30"), manila("2026-08-26T20:00"), MANILA),
    ).toBe(30);
  });

  it("does not run the clock overnight", () => {
    // Tue 16:55 -> Wed 09:05 is 5 minutes Tuesday plus 5 Wednesday.
    expect(
      businessMinutesBetween(manila("2026-08-25T16:55"), manila("2026-08-26T09:05"), MANILA),
    ).toBe(10);
  });

  it("skips the weekend — the case this feature exists for", () => {
    // Friday 17:55 arrival, checked Monday 09:25. Five minutes of Friday were
    // already gone before close, so this is 5 + 25.
    const elapsed = businessMinutesBetween(
      manila("2026-08-28T16:55"),
      manila("2026-08-31T09:25"),
      MANILA,
    );
    expect(elapsed).toBe(30);

    // Wall clock would have called this nearly three days.
    expect(elapsed).toBeLessThan(30 * 60);
  });

  it("adds up whole working days", () => {
    // Mon 09:00 -> Wed 09:00 is two full 8-hour days.
    expect(
      businessMinutesBetween(manila("2026-08-24T09:00"), manila("2026-08-26T09:00"), MANILA),
    ).toBe(2 * 8 * 60);
  });

  it("returns zero across a full weekend with no working time in it", () => {
    // Saturday 10:00 -> Sunday 18:00.
    expect(
      businessMinutesBetween(manila("2026-08-29T10:00"), manila("2026-08-30T18:00"), MANILA),
    ).toBe(0);
  });

  it("falls back to wall clock when business hours are off", () => {
    const off = { ...MANILA, businessHoursEnabled: false };
    expect(
      businessMinutesBetween(manila("2026-08-28T16:55"), manila("2026-08-31T09:25"), off),
    ).toBe(3870); // Fri 16:55 -> Mon 09:25 is 2 days 16h30m
  });

  it("falls back rather than freezing on a broken configuration", () => {
    // No working days, or an end before the start, would otherwise pin every
    // SLA at zero and silence the alerts entirely.
    const noDays = { ...MANILA, businessDays: [] };
    const inverted = { ...MANILA, businessStartMinute: 17 * 60, businessEndMinute: 9 * 60 };

    for (const broken of [noDays, inverted]) {
      expect(
        businessMinutesBetween(manila("2026-08-26T10:00"), manila("2026-08-26T11:00"), broken),
      ).toBe(60);
    }
  });

  it("never reports more working time than real time", () => {
    const elapsed = businessMinutesBetween(
      manila("2026-08-26T09:00"),
      manila("2026-08-26T09:10"),
      MANILA,
    );
    expect(elapsed).toBeLessThanOrEqual(10);
  });

  it("treats a backwards range as zero rather than negative", () => {
    expect(
      businessMinutesBetween(manila("2026-08-26T11:00"), manila("2026-08-26T10:00"), MANILA),
    ).toBe(0);
  });

  describe("daylight saving", () => {
    const NY: BusinessHours = { ...MANILA, timezone: "America/New_York" };

    it("is correct across the spring-forward day", () => {
      // 2026-03-08 is the US DST transition. A 09:00->17:00 Monday is still
      // 8 working hours regardless of what the offset did on Sunday.
      expect(
        businessMinutesBetween(
          new Date("2026-03-09T13:00:00Z"), // 09:00 EDT
          new Date("2026-03-09T21:00:00Z"), // 17:00 EDT
          NY,
        ),
      ).toBe(8 * 60);
    });

    it("is correct across the autumn fall-back day", () => {
      expect(
        businessMinutesBetween(
          new Date("2026-11-02T14:00:00Z"), // 09:00 EST
          new Date("2026-11-02T22:00:00Z"), // 17:00 EST
          NY,
        ),
      ).toBe(8 * 60);
    });
  });

  describe("breach helper", () => {
    it("does not breach a 30-minute target over a weekend", () => {
      expect(
        hasBreached(manila("2026-08-28T16:50"), manila("2026-08-31T09:00"), 30, MANILA),
      ).toBe(false);
    });

    it("does breach once the working minutes are used up", () => {
      expect(
        hasBreached(manila("2026-08-28T16:50"), manila("2026-08-31T09:30"), 30, MANILA),
      ).toBe(true);
    });
  });
});
