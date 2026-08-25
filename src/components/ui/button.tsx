import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const button = cva(
  [
    // Controls get less radius than containers — one radius token everywhere
    // is a tell, and maximum rounding on every button is the loudest version.
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md",
    "text-[13px] font-[510] leading-none",
    "transition-colors duration-100 ease-out",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary:
          "border border-border-subtle-strong bg-surface text-foreground hover:bg-surface hover:border-border-subtle-strong",
        ghost: "text-secondary hover:bg-hover hover:text-foreground",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-3.5",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  loading = false,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof button> & { loading?: boolean }) {
  return (
    <button
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {/* The label stays put while loading so the button never changes width
          and shifts everything around it. */}
      {loading ? <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
