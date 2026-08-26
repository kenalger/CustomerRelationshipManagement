import type { TagColour } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Maps the enum to the two CSS custom properties that carry the pair.
 *
 * A literal record rather than a template string, because Tailwind's scanner
 * only sees class names that appear whole in the source — `bg-[var(--tag-${c}-bg)]`
 * compiles to nothing. Inline styles sidestep that entirely and keep the pair
 * in one place.
 */
const COLOURS: Record<TagColour, { bg: string; fg: string }> = {
  GRAY: { bg: "var(--tag-gray-bg)", fg: "var(--tag-gray-fg)" },
  BROWN: { bg: "var(--tag-brown-bg)", fg: "var(--tag-brown-fg)" },
  ORANGE: { bg: "var(--tag-orange-bg)", fg: "var(--tag-orange-fg)" },
  YELLOW: { bg: "var(--tag-yellow-bg)", fg: "var(--tag-yellow-fg)" },
  GREEN: { bg: "var(--tag-green-bg)", fg: "var(--tag-green-fg)" },
  BLUE: { bg: "var(--tag-blue-bg)", fg: "var(--tag-blue-fg)" },
  PURPLE: { bg: "var(--tag-purple-bg)", fg: "var(--tag-purple-fg)" },
  PINK: { bg: "var(--tag-pink-bg)", fg: "var(--tag-pink-fg)" },
  RED: { bg: "var(--tag-red-bg)", fg: "var(--tag-red-fg)" },
};

export const TAG_COLOURS = Object.keys(COLOURS) as TagColour[];

export function tagStyle(colour: TagColour) {
  const pair = COLOURS[colour] ?? COLOURS.GRAY;
  return { backgroundColor: pair.bg, color: pair.fg };
}

export function TagChip({
  name,
  colour,
  className,
  onRemove,
}: {
  name: string;
  colour: TagColour;
  className?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      style={tagStyle(colour)}
      className={cn(
        "inline-flex max-w-[220px] items-center gap-1 rounded-sm px-1.5 py-0.5 text-[13px] leading-5",
        className,
      )}
    >
      <span className="truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          // The label names the tag: a row of nine buttons all called "Remove"
          // is unusable with a screen reader.
          aria-label={`Remove tag ${name}`}
          className="-mr-0.5 shrink-0 cursor-pointer rounded-xs px-0.5 leading-4 opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
