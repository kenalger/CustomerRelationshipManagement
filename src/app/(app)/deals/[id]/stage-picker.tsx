"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { type ActionState, moveDealAction } from "@/server/actions/crm";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending || disabled}>
      {pending ? "Moving…" : "Move"}
    </Button>
  );
}

export function StagePicker({
  dealId,
  currentStageId,
  stages,
  currentLostReason,
}: {
  dealId: string;
  currentStageId: string;
  stages: { id: string; name: string; isLost: boolean }[];
  currentLostReason?: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(moveDealAction, {});
  const [selected, setSelected] = useState(currentStageId);
  // The reason field only appears when it is actually required, rather than
  // sitting on the page asking to be filled in for every move.
  const needsReason = stages.find((s) => s.id === selected)?.isLost ?? false;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="dealId" value={dealId} />

      <label className="sr-only" htmlFor="stageId">
        Stage
      </label>
      <div className="flex gap-2">
        <select
          id="stageId"
          name="stageId"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 flex-1 rounded-md border border-border-subtle bg-surface px-2 text-sm"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Submit disabled={stages.length < 2} />
      </div>

      {needsReason ? (
        <div className="space-y-1.5">
          <label htmlFor="lostReason" className="t-label block">
            Why was it lost?
          </label>
          <Textarea
            id="lostReason"
            name="lostReason"
            rows={2}
            required
            defaultValue={currentLostReason ?? ""}
            placeholder="Price, timing, went with a competitor…"
          />
          <p className="text-[12px] text-muted">
            Required. A loss with no reason teaches the team nothing.
          </p>
        </div>
      ) : null}

      <p aria-live="polite" className="text-[12px]">
        {state.error ? <span className="text-danger">{state.error}</span> : null}
      </p>
    </form>
  );
}
