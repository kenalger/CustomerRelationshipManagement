"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tag } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type SettingsState,
  addStageAction,
  createPipelineAction,
  deleteStageAction,
  moveStageAction,
  renamePipelineAction,
  setDefaultPipelineAction,
  updateStageAction,
} from "@/server/actions/settings";

type Stage = {
  id: string;
  name: string;
  probability: number;
  outcome: "open" | "won" | "lost";
  deals: number;
};

type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };

const OUTCOMES = [
  { value: "open", label: "Still in play" },
  { value: "won", label: "Closed won" },
  { value: "lost", label: "Closed lost" },
] as const;

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {children}
    </Button>
  );
}

/* ── One stage, read mode by default ─────────────────────────────────────── */

function StageRow({
  stage,
  step,
  canManage,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  stage: Stage;
  step: number;
  canManage: boolean;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saveState, save] = useActionState<SettingsState, FormData>(updateStageAction, {});
  const [removeState, remove] = useActionState<SettingsState, FormData>(deleteStageAction, {});
  const error = saveState.error ?? removeState.error;

  if (editing) {
    return (
      <li className="bg-sunken px-4 py-3">
        <form action={save} className="space-y-3">
          <input type="hidden" name="stageId" value={stage.id} />

          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem]">
            <div className="space-y-1">
              <label htmlFor={`n-${stage.id}`} className="t-label block">
                Stage name
              </label>
              <Input id={`n-${stage.id}`} name="name" defaultValue={stage.name} required autoFocus />
            </div>

            <div className="space-y-1">
              <label htmlFor={`p-${stage.id}`} className="t-label block">
                Win chance
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={`p-${stage.id}`}
                  name="probability"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={stage.probability}
                />
                <span className="text-[14px] text-muted">%</span>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor={`o-${stage.id}`} className="t-label block">
                What it means
              </label>
              <Select id={`o-${stage.id}`} name="outcome" defaultValue={stage.outcome}>
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Submit>Save stage</Submit>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {error ? (
              <span role="alert" className="text-[13px] text-danger">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      {/* A numbered step, so the sequence reads as a sequence. */}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--tag-gray-bg)] text-[12px] font-[560] tabular-nums text-[var(--tag-gray-fg)]">
        {step}
      </span>

      <span className="min-w-0 flex-1 truncate text-[14px] font-[510]">{stage.name}</span>

      {/* Win chance as a bar plus a number: the bar makes the shape of the
          funnel legible at a glance, the number keeps it exact. */}
      <span className="hidden w-28 items-center gap-2 sm:flex" title={`${stage.probability}% win chance`}>
        <span className="h-1 flex-1 overflow-hidden rounded-sm bg-border-subtle">
          <span
            className="block h-full rounded-sm bg-[var(--tag-blue-fg)] opacity-70"
            style={{ width: `${stage.probability}%` }}
          />
        </span>
        <span className="w-8 text-right text-[13px] tabular-nums text-muted">
          {stage.probability}%
        </span>
      </span>

      <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-muted">
        {stage.deals} {stage.deals === 1 ? "deal" : "deals"}
      </span>

      {canManage ? (
        // Controls stay hidden until hover or keyboard focus, so the list reads
        // as a pipeline rather than as a row of buttons.
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Move ${stage.name} earlier`}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            className="size-7"
          >
            <ChevronUp size={15} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Move ${stage.name} later`}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            className="size-7"
          >
            <ChevronDown size={15} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Edit ${stage.name}`}
            onClick={() => setEditing(true)}
            className="size-7"
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden />
          </Button>
          <form action={remove}>
            <input type="hidden" name="stageId" value={stage.id} />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              aria-label={`Delete ${stage.name}`}
              disabled={stage.deals > 0}
              title={stage.deals > 0 ? "Move its deals to another stage first" : undefined}
              className="size-7"
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden />
            </Button>
          </form>
        </span>
      ) : null}

      {error ? (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      ) : null}
    </li>
  );
}

/* ── Outcome stages, shown separately because they behave differently ────── */

function OutcomeRow({ stage, canManage }: { stage: Stage; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saveState, save] = useActionState<SettingsState, FormData>(updateStageAction, {});

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {stage.outcome === "won" ? (
        <Check size={16} strokeWidth={2.25} aria-hidden className="shrink-0 text-success" />
      ) : (
        <X size={16} strokeWidth={2.25} aria-hidden className="shrink-0 text-danger" />
      )}

      {editing ? (
        <form action={save} className="flex flex-1 items-center gap-2">
          <input type="hidden" name="stageId" value={stage.id} />
          <input type="hidden" name="outcome" value={stage.outcome} />
          <input type="hidden" name="probability" value={stage.probability} />
          <Input name="name" defaultValue={stage.name} className="max-w-48" autoFocus />
          <Submit>Save</Submit>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[14px] font-[510]">{stage.name}</span>
          <Tag colour={stage.outcome === "won" ? "green" : "red"}>
            {stage.outcome === "won" ? "counts as won" : "counts as lost"}
          </Tag>
          <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-muted">
            {stage.deals} {stage.deals === 1 ? "deal" : "deals"}
          </span>
          {canManage ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Rename ${stage.name}`}
              onClick={() => setEditing(true)}
              className="size-7"
            >
              <Pencil size={14} strokeWidth={1.75} aria-hidden />
            </Button>
          ) : null}
        </>
      )}

      {saveState.error ? (
        <span role="alert" className="text-[13px] text-danger">
          {saveState.error}
        </span>
      ) : null}
    </li>
  );
}

/* ── The pipeline ────────────────────────────────────────────────────────── */

export function PipelineEditor({
  pipeline,
  canManage,
}: {
  pipeline: Pipeline;
  canManage: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renameState, rename] = useActionState<SettingsState, FormData>(renamePipelineAction, {});
  const [defaultState, makeDefault] = useActionState<SettingsState, FormData>(
    setDefaultPipelineAction,
    {},
  );
  const [addState, add] = useActionState<SettingsState, FormData>(addStageAction, {});
  const [, startMove] = useTransition();

  // Open stages are the funnel; won/lost are terminal and behave differently.
  const open = pipeline.stages.filter((s) => s.outcome === "open");
  const closed = pipeline.stages.filter((s) => s.outcome !== "open");

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= open.length) return;

    const reordered = [...open];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    // Closed stages keep their position at the end of the pipeline.
    const ids = [...reordered, ...closed].map((s) => s.id);

    startMove(async () => {
      const result = await moveStageAction(pipeline.id, ids);
      if (!result.ok) toast.error(result.error ?? "Could not reorder");
    });
  }

  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
        {renaming ? (
          <form
            action={async (formData) => {
              await rename(formData);
              setRenaming(false);
            }}
            className="flex flex-1 items-center gap-2"
          >
            <input type="hidden" name="pipelineId" value={pipeline.id} />
            <Input name="name" defaultValue={pipeline.name} className="max-w-64" autoFocus />
            <Submit>Save</Submit>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <h3 className="t-heading min-w-0 flex-1 truncate">{pipeline.name}</h3>
            {pipeline.isDefault ? (
              <Tag colour="blue">
                <Star size={10} strokeWidth={2.5} aria-hidden />
                default
              </Tag>
            ) : null}
            {canManage ? (
              <Menu
                label={`Actions for ${pipeline.name}`}
                align="end"
                trigger={() => (
                  <span className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground">
                    <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
                    <span className="sr-only">Actions for {pipeline.name}</span>
                  </span>
                )}
              >
                <MenuItem icon={<Pencil size={15} strokeWidth={1.75} />} onSelect={() => setRenaming(true)}>
                  Rename pipeline
                </MenuItem>
                {!pipeline.isDefault ? (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={<Star size={15} strokeWidth={1.75} />}
                      onSelect={() => {
                        const data = new FormData();
                        data.set("pipelineId", pipeline.id);
                        startMove(async () => makeDefault(data));
                      }}
                    >
                      Make this the default
                    </MenuItem>
                  </>
                ) : null}
              </Menu>
            ) : null}
          </>
        )}
      </header>

      {renameState.error || defaultState.error ? (
        <p role="alert" className="border-b border-border-subtle px-4 py-2 text-[13px] text-danger">
          {renameState.error ?? defaultState.error}
        </p>
      ) : null}

      {/* Open stages — the funnel a deal moves through. */}
      <div className="px-4 pt-3">
        <p className="t-caps text-muted">The funnel</p>
        <p className="mt-1 text-[13px] text-muted">
          A deal moves down this list. <strong className="font-[560]">Win chance</strong> is what
          weights the forecast on your overview — a $10,000 deal at 25% counts as $2,500.
        </p>
      </div>

      <ol className="divide-y divide-border-subtle border-b border-border-subtle">
        {open.length === 0 ? (
          <li className="px-4 py-6 text-center text-[13px] text-muted">
            No open stages yet. Add the first step a new deal lands in.
          </li>
        ) : (
          open.map((stage, index) => (
            <StageRow
              key={stage.id}
              stage={stage}
              step={index + 1}
              canManage={canManage}
              onMove={(direction) => move(index, direction)}
              canMoveUp={index > 0}
              canMoveDown={index < open.length - 1}
            />
          ))
        )}
      </ol>

      {canManage ? (
        <div className="border-b border-border-subtle px-4 py-3">
          {adding ? (
            <form
              action={async (formData) => {
                await add(formData);
                setAdding(false);
              }}
              className="space-y-3"
            >
              <input type="hidden" name="pipelineId" value={pipeline.id} />
              <input type="hidden" name="outcome" value="open" />

              <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                <div className="space-y-1">
                  <label htmlFor={`new-${pipeline.id}`} className="t-label block">
                    Stage name
                  </label>
                  <Input
                    id={`new-${pipeline.id}`}
                    name="name"
                    placeholder="e.g. Demo booked"
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`newp-${pipeline.id}`} className="t-label block">
                    Win chance
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={`newp-${pipeline.id}`}
                      name="probability"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={50}
                    />
                    <span className="text-[14px] text-muted">%</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Submit>Add stage</Submit>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                {addState.error ? (
                  <span role="alert" className="text-[13px] text-danger">
                    {addState.error}
                  </span>
                ) : null}
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={15} strokeWidth={2} aria-hidden />
              Add a stage
            </Button>
          )}
        </div>
      ) : null}

      {/* Closed outcomes — terminal, and not part of the funnel's order. */}
      <div className="px-4 pt-3">
        <p className="t-caps text-muted">How a deal closes</p>
        <p className="mt-1 text-[13px] text-muted">
          These end the deal. Everything else above is still in play.
        </p>
      </div>

      <ul className={cn("divide-y divide-border-subtle", closed.length > 0 && "pb-1")}>
        {closed.length === 0 ? (
          <li className="px-4 py-4 text-[13px] text-danger">
            This pipeline has no won or lost stage, so deals can never be closed. Add one above and
            set “What it means”.
          </li>
        ) : (
          closed.map((stage) => (
            <OutcomeRow key={stage.id} stage={stage} canManage={canManage} />
          ))
        )}
      </ul>
    </section>
  );
}

export function NewPipelineForm() {
  const [state, action] = useActionState<SettingsState, FormData>(createPipelineAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus size={15} strokeWidth={2} aria-hidden />
        New pipeline
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-md border border-border-subtle bg-surface p-4"
    >
      <div className="space-y-1">
        <label htmlFor="new-pipeline" className="t-label block">
          Pipeline name
        </label>
        <Input id="new-pipeline" name="name" placeholder="e.g. Renewals" required autoFocus />
        <p className="text-[13px] text-muted">
          Starts with New, Won and Lost so it works straight away — rename or add stages after.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Submit>Create pipeline</Submit>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {state.error ? (
          <span role="alert" className="text-[13px] text-danger">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
