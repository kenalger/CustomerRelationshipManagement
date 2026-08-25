"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Datum = { date: string; label: string; count: number };

/**
 * Question this answers: are leads still arriving, and is the rate changing?
 *
 * Area rather than bars: the shape of a 14-day run matters more than any single
 * day's exact count. Single series, so no legend — the panel title names it.
 */
export function LeadsTrend({ data }: { data: Datum[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <p className="py-10 text-center text-[12px] text-muted">
        No leads in the last 14 days.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <defs>
          <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          width={40}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--ink)",
            boxShadow: "var(--shadow-[var(--shadow-overlay)])",
          }}
          labelStyle={{ color: "var(--ink-2)", marginBottom: 2 }}
          formatter={(value) => {
            const n = Number(value ?? 0);
            return [`${n}`, n === 1 ? "lead" : "leads"];
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#leadsFill)"
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
