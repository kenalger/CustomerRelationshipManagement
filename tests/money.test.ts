import { describe, expect, it } from "vitest";

import { formatTotal, sumByCurrency, weightedByCurrency } from "@/lib/money";

describe("money totals", () => {
  it("groups by currency instead of adding unlike amounts", () => {
    const total = sumByCurrency([
      { value: 1000, currency: "USD" },
      { value: 1000, currency: "JPY" },
      { value: 500, currency: "USD" },
    ]);

    expect(total.mixed).toBe(true);
    expect(total.byCurrency).toEqual([
      { currency: "USD", amount: 1500 },
      { currency: "JPY", amount: 1000 },
    ]);
    // The dominant figure is a real amount in a real currency.
    expect(total.dominant).toEqual({ currency: "USD", amount: 1500 });
  });

  it("looks exactly like a plain sum in the single-currency case", () => {
    const total = sumByCurrency([
      { value: 48000, currency: "USD" },
      { value: 12500, currency: "USD" },
    ]);
    expect(total.mixed).toBe(false);
    expect(formatTotal(total)).toBe("$60,500");
  });

  it("discloses the mix rather than hiding it", () => {
    const total = sumByCurrency([
      { value: 100, currency: "USD" },
      { value: 90, currency: "EUR" },
    ]);
    expect(formatTotal(total)).toBe("$100 +1 more");
  });

  it("handles Prisma Decimal objects without float drift", () => {
    const decimalLike = { toString: () => "1234.56" };
    const total = sumByCurrency([{ value: decimalLike, currency: "USD" }]);
    expect(total.dominant?.amount).toBe(1234.56);
  });

  it("applies probability per deal, before grouping", () => {
    const total = weightedByCurrency([
      { value: 48000, currency: "USD", probability: 50 },
      { value: 12500, currency: "USD", probability: 10 },
    ]);
    expect(total.dominant?.amount).toBe(25250);
  });

  it("ignores unparseable amounts rather than producing NaN", () => {
    const total = sumByCurrency([
      { value: "not a number", currency: "USD" },
      { value: 10, currency: "USD" },
    ]);
    expect(total.dominant?.amount).toBe(10);
  });

  it("returns a zero-safe empty total", () => {
    const total = sumByCurrency([]);
    expect(total.dominant).toBeNull();
    expect(formatTotal(total)).toBe("$0");
  });
});
