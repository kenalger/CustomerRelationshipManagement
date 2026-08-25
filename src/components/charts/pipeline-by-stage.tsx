"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/money";

type Datum = { name: string; value: number; count: number };

/**
 * Question this answers: where is the open pipeline concentrated?
 *
 * Horizontal bars because stage names are words, not dates — rotated labels on
 * a vertical chart are unreadable. Single series, so one hue and no legend:
 * identity comes from the axis label, never from colour.
 */
export function PipelineByStage({
  data,
  currency = "USD",
}: {
  data: Datum[];
  currency?: string;
}) {
  if (data.every((d) => d.value === 0)) {
    return (
      <p className="py-10 text-center text-[12px] text-muted">
        No open deals yet. Convert a lead to start the pipeline.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
        <CartesianGrid
          horizontal={false}
          stroke="var(--border)"
          strokeDasharray="2 4"
        />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={92}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--ink-2)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "var(--accent-soft)" }}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--ink)",
            boxShadow: "var(--shadow-[var(--shadow-overlay)])",
          }}
          labelStyle={{ color: "var(--ink-2)", marginBottom: 2 }}
          formatter={(value, _name, item) => {
            const datum = item?.payload as Datum | undefined;
            const deals = datum?.count ?? 0;
            return [
              `${formatMoney(Number(value ?? 0), currency)} · ${deals} ${deals === 1 ? "deal" : "deals"}`,
              "Open value",
            ];
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.name} fill="var(--accent)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
