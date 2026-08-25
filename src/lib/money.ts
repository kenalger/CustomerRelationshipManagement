/**
 * Money totals, grouped by currency.
 *
 * Summing amounts across currencies as raw numbers is silently wrong: 1000 USD
 * plus 1000 JPY is not 2000 of anything. We have no FX rates and inventing
 * them would be worse than not converting, so a total is a *set* of
 * per-currency amounts and the UI says so when there is more than one.
 */
export type MoneyTotal = {
  /** Per-currency amounts, largest first. */
  byCurrency: { currency: string; amount: number }[];
  /** The currency holding the most value — what a single figure should show. */
  dominant: { currency: string; amount: number } | null;
  /** True when more than one currency is present, so the UI can disclose it. */
  mixed: boolean;
  /** Sum of every amount, ignoring currency. NEVER display this. */
  unsafeTotal: number;
};

export function sumByCurrency(
  rows: { value: unknown; currency: string }[],
): MoneyTotal {
  const totals = new Map<string, number>();

  for (const row of rows) {
    // Prisma Decimal arrives as an object; toString avoids float drift.
    const amount = Number(
      typeof row.value === "object" && row.value !== null ? row.value.toString() : row.value,
    );
    if (!Number.isFinite(amount)) continue;
    const currency = row.currency || "USD";
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }

  const byCurrency = [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    byCurrency,
    dominant: byCurrency[0] ?? null,
    mixed: byCurrency.length > 1,
    unsafeTotal: byCurrency.reduce((sum, entry) => sum + entry.amount, 0),
  };
}

/** Weighted equivalent — probability applies per deal, before grouping. */
export function weightedByCurrency(
  rows: { value: unknown; currency: string; probability: number }[],
): MoneyTotal {
  return sumByCurrency(
    rows.map((row) => {
      const amount = Number(
        typeof row.value === "object" && row.value !== null ? row.value.toString() : row.value,
      );
      return {
        value: (Number.isFinite(amount) ? amount : 0) * (row.probability / 100),
        currency: row.currency,
      };
    }),
  );
}

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/** One-line summary of a possibly-mixed total. */
export function formatTotal(total: MoneyTotal): string {
  if (!total.dominant) return formatMoney(0);
  if (!total.mixed) return formatMoney(total.dominant.amount, total.dominant.currency);
  const others = total.byCurrency.length - 1;
  return `${formatMoney(total.dominant.amount, total.dominant.currency)} +${others} more`;
}
