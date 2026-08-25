"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type EditableEntity, saveFieldAction } from "@/server/actions/records";

/**
 * Click-to-edit for one field on a record page.
 *
 * Read mode is plain text, not an input: a page of empty boxes reads as a form
 * to fill in, when most of the time the rep is only looking. The field only
 * becomes an input once they mean to change it.
 */
export function EditableField({
  entity,
  id,
  field,
  label,
  value,
  type = "text",
  placeholder = "Empty",
  display = "plain",
  currency = "USD",
  canEdit = true,
}: {
  entity: EditableEntity;
  id: string;
  field: string;
  label: string;
  value: string | null;
  type?: "text" | "email" | "tel" | "url" | "number" | "date";
  placeholder?: string;
  /**
   * How the saved value is presented in read mode. A declarative name rather
   * than a render callback: this is a Client Component, and a Server Component
   * cannot pass a function across the boundary.
   */
  display?: "plain" | "email" | "tel" | "url" | "money" | "date";
  currency?: string;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(value ?? "");
  const [saving, startSave] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function present(raw: string): React.ReactNode {
    switch (display) {
      case "email":
        return (
          <a href={`mailto:${raw}`} className="text-accent hover:underline">
            {raw}
          </a>
        );
      case "tel":
        return (
          <a href={`tel:${raw}`} className="text-accent hover:underline">
            {raw}
          </a>
        );
      case "url": {
        const href = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
        return (
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
            {raw.replace(/^https?:\/\//, "")}
          </a>
        );
      }
      case "money":
        return <span className="tabular-nums">{formatMoney(Number(raw), currency)}</span>;
      case "date": {
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString();
      }
      default:
        return raw;
    }
  }

  function commit() {
    const next = inputRef.current?.value ?? "";
    if (next === (value ?? "")) {
      setEditing(false);
      return;
    }

    startSave(async () => {
      const result = await saveFieldAction(entity, id, field, next);
      if (result.ok) {
        setCurrent(next);
        setEditing(false);
      } else {
        // Snap back rather than leaving a rejected value on screen looking saved.
        setCurrent(value ?? "");
        toast.error(result.error);
      }
    });
  }

  if (!canEdit) {
    return (
      <div className="flex items-baseline justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-[12px] text-muted">{label}</dt>
        <dd className="min-w-0 truncate text-right text-[12px]">
          {current ? present(current) : <span className="text-muted">—</span>}
        </dd>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center justify-between gap-2 py-1">
        <label htmlFor={`${field}-${id}`} className="shrink-0 text-[12px] text-muted">
          {label}
        </label>
        <div className="flex min-w-0 items-center gap-1">
          <Input
            id={`${field}-${id}`}
            ref={inputRef}
            type={type}
            defaultValue={current}
            autoFocus
            disabled={saving}
            className="h-7 w-40 text-[12px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            // Blur saves rather than discards: losing a typed value because you
            // clicked away is the single most annoying thing a CRM can do.
            onBlur={commit}
          />
          <button
            type="button"
            aria-label={`Save ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={commit}
            className="rounded p-1 text-success hover:bg-success-muted"
          >
            <Check size={13} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Cancel editing ${label}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setEditing(false);
            }}
            className="rounded p-1 text-muted hover:bg-hover"
          >
            <X size={13} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "min-w-0 truncate rounded px-1 py-0.5 text-right text-[12px]",
            "hover:bg-hover focus-visible:bg-accent-soft",
            !current && "text-muted italic",
          )}
          title={`Edit ${label}`}
        >
          {current ? present(current) : placeholder}
        </button>
        <Pencil
          size={11}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      </dd>
    </div>
  );
}
