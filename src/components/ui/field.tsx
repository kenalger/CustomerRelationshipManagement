import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const control = [
  "h-8 w-full rounded-sm border border-border-subtle-strong bg-surface px-2.5",
  "text-[14px] text-foreground placeholder:text-muted",
  "transition-colors duration-100 ease-out",
  "hover:border-border-subtle-strong disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-danger",
].join(" ");

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "cursor-pointer pr-7", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(control, "h-auto min-h-20 resize-y py-2 leading-[1.55]", className)} {...props} />
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string[];
  hint?: string;
  children: ReactNode;
}) {
  const invalid = Boolean(error?.length);
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="t-label block text-foreground">
        {label}
      </label>
      {children}
      {/* Colour never carries the message on its own. */}
      {hint && !invalid ? <p className="text-[12px] text-muted">{hint}</p> : null}
      {invalid ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[12px] text-danger">
          {error?.[0]}
        </p>
      ) : null}
    </div>
  );
}
