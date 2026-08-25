import { cn } from "@/lib/utils";

/**
 * A tag.
 *
 * Colour lives here and almost nowhere else in the chrome — that restraint is
 * what makes a database UI feel calm. Every pair is a pastel ground with a
 * darker ink of the same hue, measured AA in both themes.
 */
const TAG = {
  gray: "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]",
  brown: "bg-[var(--tag-brown-bg)] text-[var(--tag-brown-fg)]",
  orange: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]",
  yellow: "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]",
  green: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]",
  blue: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]",
  purple: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]",
  pink: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]",
  red: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]",
} as const;

export type TagColour = keyof typeof TAG;

/**
 * Semantic names kept as an alias layer so existing call sites do not churn —
 * the API is the same, the look is not.
 */
const TONE_TO_TAG = {
  neutral: "gray",
  accent: "blue",
  info: "blue",
  success: "green",
  warning: "yellow",
  danger: "red",
} as const;

export type Tone = keyof typeof TONE_TO_TAG;

export function Tag({
  children,
  colour = "gray",
  className,
}: {
  children: React.ReactNode;
  colour?: TagColour;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[20px] max-w-full items-center gap-1 rounded-sm px-1.5",
        "text-[12px] font-[510] leading-none",
        // Truncate rather than wrap: a tag that grows two lines tall breaks
        // the row height every other row is holding to.
        "truncate whitespace-nowrap",
        TAG[colour],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Tag colour={TONE_TO_TAG[tone]} className={className}>
      {children}
    </Tag>
  );
}

/** A bare dot, for status shown beside a label where a tag is too loud. */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const colour = {
    neutral: "bg-muted",
    accent: "bg-accent",
    info: "bg-info",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", colour)} aria-hidden />;
}
