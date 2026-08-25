import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const TONES = {
  info: { cls: "border-info/25 bg-info-muted text-info", Icon: Info },
  success: { cls: "border-success/25 bg-success-muted text-success", Icon: CheckCircle2 },
  warning: { cls: "border-warning/25 bg-warning-muted text-warning", Icon: TriangleAlert },
  danger: { cls: "border-danger/25 bg-danger-muted text-danger", Icon: AlertCircle },
} as const;

/**
 * An icon rides along with the colour so the meaning survives colourblindness,
 * greyscale printing, and forced-colors mode.
 */
export function Callout({
  tone = "info",
  children,
  className,
  role,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const { cls, Icon } = TONES[tone];
  return (
    <p
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]",
        cls,
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
