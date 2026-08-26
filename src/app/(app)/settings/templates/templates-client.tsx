"use client";

import { Mail, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { renderCopy } from "@/lib/merge-fields";
import { cn } from "@/lib/utils";
import {
  createTemplateAction,
  deleteTemplateAction,
  deleteVariantAction,
  updateTemplateAction,
  upsertVariantAction,
} from "@/server/actions/templates";


type Summary = {
  id: string;
  name: string;
  subject: string;
  variantLabels: string[];
  usedBySteps: number;
};

type Variant = { id: string; label: string; subject: string; body: string };

type Selected = {
  id: string;
  name: string;
  subject: string;
  body: string;
  variants: Variant[];
} | null;

/**
 * The fields `sweepDueEnrollments` actually substitutes.
 *
 * Kept in step with `renderCopy`'s callers in `campaigns.ts` — anything not on
 * this list collapses to an empty string rather than reaching a prospect as a
 * literal `{{whatever}}`, so listing them here is the only way an author knows
 * which ones do something.
 */
const MERGE_FIELDS = [
  { token: "{{first_name}}", sample: "Alex" },
  { token: "{{last_name}}", sample: "Rivera" },
  { token: "{{email}}", sample: "alex@northwind.test" },
  { token: "{{company}}", sample: "Northwind" },
] as const;

const SAMPLE = Object.fromEntries(
  MERGE_FIELDS.map((f) => [f.token.slice(2, -2), f.sample]),
) as Record<string, string>;

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
        <div>
          <h3 className="t-heading">{title}</h3>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

/** Subject and body as a prospect would receive them, with sample values. */
function Preview({ subject, body }: { subject: string; body: string }) {
  const rendered = renderCopy({ subject, body }, SAMPLE);

  return (
    <div className="rounded-md border border-border-subtle bg-page p-4">
      <p className="t-caps mb-2 text-muted">Preview with sample values</p>
      <p className="text-[14px] font-[560]">{rendered.subject || "(no subject)"}</p>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-[1.6] text-secondary">
        {rendered.body || "(no body)"}
      </p>
    </div>
  );
}

function CopyFields({
  idPrefix,
  subject,
  body,
  onSubject,
  onBody,
}: {
  idPrefix: string;
  subject: string;
  body: string;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
}) {
  return (
    <>
      <Field label="Subject" htmlFor={`${idPrefix}-subject`}>
        <Input
          id={`${idPrefix}-subject`}
          value={subject}
          maxLength={200}
          onChange={(e) => onSubject(e.target.value)}
        />
      </Field>
      <Field
        label="Body"
        htmlFor={`${idPrefix}-body`}
        hint={`Merge fields: ${MERGE_FIELDS.map((f) => f.token).join(" · ")}. An unknown field becomes empty text rather than reaching someone as a literal placeholder.`}
      >
        <Textarea
          id={`${idPrefix}-body`}
          value={body}
          rows={8}
          onChange={(e) => onBody(e.target.value)}
        />
      </Field>
      <Preview subject={subject} body={body} />
    </>
  );
}

function VariantEditor({
  templateId,
  variant,
  canWrite,
  canDelete,
  onDone,
}: {
  templateId: string;
  variant: Variant | { label: string; subject: string; body: string };
  canWrite: boolean;
  canDelete: boolean;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(variant.label);
  const [subject, setSubject] = useState(variant.subject);
  const [body, setBody] = useState(variant.body);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const result = await upsertVariantAction(templateId, { label, subject, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Variant ${result.data.label} saved`);
      onDone();
    });

  const remove = () =>
    start(async () => {
      const result = await deleteVariantAction(templateId, variant.label);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Variant ${variant.label} removed`);
      onDone();
    });

  return (
    <div className="space-y-4 rounded-md border border-border-subtle p-4">
      <Field
        label="Label"
        htmlFor={`variant-${variant.label}-label`}
        hint="Short and stable — it is what the response-rate report is grouped by."
      >
        <Input
          id={`variant-${variant.label}-label`}
          value={label}
          maxLength={8}
          onChange={(e) => setLabel(e.target.value)}
          className="w-24"
        />
      </Field>
      <CopyFields
        idPrefix={`variant-${variant.label}`}
        subject={subject}
        body={body}
        onSubject={setSubject}
        onBody={setBody}
      />
      {canWrite ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={save} loading={pending}>
            Save variant
          </Button>
          {canDelete ? (
            <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TemplatesClient({
  templates,
  selected,
  canWrite,
  canDelete,
}: {
  templates: Summary[];
  selected: Selected;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, start] = useTransition();

  // Reset the editor when a different template is selected. Adjusted during
  // render rather than in an effect — React's own pattern, and it avoids a
  // frame showing the previous template's copy under the new one's name.
  const [seenId, setSeenId] = useState(selected?.id ?? null);
  const [name, setName] = useState(selected?.name ?? "");
  const [subject, setSubject] = useState(selected?.subject ?? "");
  const [body, setBody] = useState(selected?.body ?? "");
  const [addingVariant, setAddingVariant] = useState(false);

  if (seenId !== (selected?.id ?? null)) {
    setSeenId(selected?.id ?? null);
    setName(selected?.name ?? "");
    setSubject(selected?.subject ?? "");
    setBody(selected?.body ?? "");
    setAddingVariant(false);
  }

  const create = () =>
    start(async () => {
      const result = await createTemplateAction({
        name: newName.trim(),
        subject: "A quick question about {{company}}",
        body: "Hi {{first_name}},\n\n\n\nBest,\n",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCreating(false);
      setNewName("");
      router.push(`/settings/templates?template=${result.data.id}`);
    });

  const save = () => {
    if (!selected) return;
    start(async () => {
      const result = await updateTemplateAction(selected.id, { name, subject, body });
      if (!result.ok) toast.error(result.error);
      else toast.success("Template saved");
    });
  };

  const remove = () => {
    if (!selected) return;
    start(async () => {
      const result = await deleteTemplateAction(selected.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Steps keep their instruction and lose the copy, so say how many.
      const { stepsAffected } = result.data;
      toast.success(
        stepsAffected === 0
          ? "Template deleted"
          : `Template deleted — ${stepsAffected} ${stepsAffected === 1 ? "step" : "steps"} lost their copy`,
      );
      router.push("/settings/templates");
    });
  };

  const nextLabel = () => {
    const used = new Set((selected?.variants ?? []).map((v) => v.label));
    for (const letter of "ABCDEFGH") if (!used.has(letter)) return letter;
    return "Z";
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <div className="space-y-2">
        {canWrite ? (
          creating ? (
            <div className="flex gap-1.5">
              <Input
                autoFocus
                value={newName}
                maxLength={60}
                placeholder="Template name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                  if (e.key === "Escape") setCreating(false);
                }}
                aria-label="Template name"
                className="h-8"
              />
              <Button size="sm" onClick={create} loading={pending} disabled={newName.trim() === ""}>
                Add
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => setCreating(true)}
            >
              <Plus size={13} strokeWidth={2} />
              New template
            </Button>
          )
        ) : null}

        {templates.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No templates"
            hint="A sequence step without a template still creates a task — the template just gives the rep the words."
          />
        ) : (
          <nav
            aria-label="Templates"
            className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle bg-surface"
          >
            {templates.map((template) => {
              const active = template.id === selected?.id;
              return (
                <Link
                  key={template.id}
                  href={`/settings/templates?template=${template.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block px-3 py-2.5 transition-colors",
                    active ? "bg-accent-soft text-accent" : "text-secondary hover:bg-hover",
                  )}
                >
                  <span className="block truncate text-[14px] font-[510]">{template.name}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {template.variantLabels.length === 0
                      ? "No variants"
                      : template.variantLabels.length === 1
                        ? `Variant ${template.variantLabels[0]}`
                        : `Variants ${template.variantLabels.join(", ")}`}
                    {template.usedBySteps > 0 ? ` · ${template.usedBySteps} in use` : null}
                  </span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {selected ? (
        <div className="space-y-5">
          <Section title="Copy" description="Used when a step has no matching variant.">
            <Field label="Name" htmlFor="template-name">
              <Input
                id="template-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <CopyFields
              idPrefix="template"
              subject={subject}
              body={body}
              onSubject={setSubject}
              onBody={setBody}
            />
            {canWrite ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={save} loading={pending}>
                  Save template
                </Button>
                {canDelete ? (
                  <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
                    Delete
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Section>

          <Section
            title="Variants"
            description="A prospect is assigned one variant when they are enrolled and keeps it, so a retry can never flip them between arms."
            action={
              canWrite && !addingVariant ? (
                <Button size="sm" variant="secondary" onClick={() => setAddingVariant(true)}>
                  Add variant
                </Button>
              ) : null
            }
          >
            {selected.variants.length === 0 && !addingVariant ? (
              <p className="text-[13px] text-muted">
                No variants. Every prospect gets the copy above.
              </p>
            ) : null}

            {selected.variants.map((variant) => (
              <VariantEditor
                key={variant.id}
                templateId={selected.id}
                variant={variant}
                canWrite={canWrite}
                canDelete={canDelete}
                onDone={() => router.refresh()}
              />
            ))}

            {addingVariant ? (
              <VariantEditor
                templateId={selected.id}
                variant={{ label: nextLabel(), subject, body }}
                canWrite={canWrite}
                canDelete={false}
                onDone={() => {
                  setAddingVariant(false);
                  router.refresh();
                }}
              />
            ) : null}
          </Section>
        </div>
      ) : (
        <div className="rounded-md border border-border-subtle bg-surface p-5">
          <EmptyState
            icon={Mail}
            title="Pick a template"
            hint="Choose one on the left, or create a new one to start writing."
          />
        </div>
      )}
    </div>
  );
}
