"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createCampaignAction } from "@/server/actions/campaigns";

/**
 * The new-campaign form, opened by `/campaigns?new=1`.
 *
 * Open state lives in the URL rather than in React: the page bar and this
 * panel are rendered by different components, and routing the toggle through
 * a shared client parent to link them would be a worse trade than a query
 * string that is also shareable and undone by the Back button.
 *
 * A campaign is always created as a DRAFT — the service refuses to start one
 * with no steps — so this asks for the least it can and sends the user
 * straight to the screen where the sequence is built.
 */
export function NewCampaignForm({ lists }: { lists: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [listId, setListId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setFieldErrors({ name: ["Give the campaign a name"] });
      return;
    }

    start(async () => {
      const result = await createCampaignAction({ name: trimmed, goal, listId });
      if (result.ok) {
        router.push(`/campaigns/${result.data.id}`);
        return;
      }
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    });
  };

  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="border-b border-border-subtle px-5 py-3.5">
        <h2 className="t-heading">New campaign</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          It starts as a draft. Add the steps first — a campaign with no steps cannot be started.
        </p>
      </header>

      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Name" htmlFor="campaign-name" error={fieldErrors.name}>
          <Input
            id="campaign-name"
            value={name}
            maxLength={80}
            autoFocus
            placeholder="e.g. Q3 outbound — agencies"
            aria-invalid={Boolean(fieldErrors.name?.length)}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Goal"
          htmlFor="campaign-goal"
          hint="Optional. What a reply is supposed to lead to — it shows up beside the name everywhere."
          error={fieldErrors.goal}
        >
          <Textarea
            id="campaign-goal"
            value={goal}
            maxLength={500}
            rows={2}
            placeholder="Book a 20-minute call about the new onboarding flow"
            onChange={(event) => setGoal(event.target.value)}
          />
        </Field>

        <Field
          label="Prospect list"
          htmlFor="campaign-list"
          hint={
            lists.length === 0
              ? "No prospect lists exist yet. You can attach one later."
              : "Optional. Attaching a list lets you enroll everyone on it in one go."
          }
          error={fieldErrors.listId}
        >
          <Select
            id="campaign-list"
            value={listId}
            disabled={lists.length === 0}
            onChange={(event) => setListId(event.target.value)}
          >
            <option value="">No list</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </Select>
        </Field>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={pending}>
            Create campaign
          </Button>
          <Link href="/campaigns">
            <Button type="button" size="sm" variant="ghost">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </section>
  );
}
