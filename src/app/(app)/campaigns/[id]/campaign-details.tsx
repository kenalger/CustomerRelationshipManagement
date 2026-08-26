"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  deleteCampaignAction,
  enrollListAction,
  updateCampaignAction,
} from "@/server/actions/campaigns";

/** Fixed locale so the server and client render the same string. */
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[7rem]">
      <p className="t-caps text-muted">{label}</p>
      <p className="mt-0.5 text-[15px] tabular-nums">{value}</p>
    </div>
  );
}

/**
 * The campaign's own facts, and the two dangerous things you can do to it.
 *
 * Enrollment counts are org-wide even for a rep, matching `getCampaign` —
 * this is the campaign's health, and two people disagreeing about how many
 * prospects are in it would make the number useless.
 */
export function CampaignDetails({
  campaignId,
  name,
  goal,
  listId,
  lists,
  status,
  statusLabel,
  statusTone,
  ownerName,
  startedAt,
  completedAt,
  counts,
  stepCount,
  canManage,
  canWrite,
  canDelete,
}: {
  campaignId: string;
  name: string;
  goal: string | null;
  listId: string | null;
  lists: { id: string; name: string }[];
  status: string;
  statusLabel: string;
  statusTone: Tone;
  ownerName: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  counts: { ACTIVE: number; PAUSED: number; COMPLETED: number; STOPPED: number };
  stepCount: number;
  canManage: boolean;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftGoal, setDraftGoal] = useState(goal ?? "");
  const [draftList, setDraftList] = useState(listId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, start] = useTransition();

  // Reset the draft when the server sends new values, adjusted during render
  // rather than in an effect — React's own pattern for this.
  const [seen, setSeen] = useState({ name, goal, listId });
  if (seen.name !== name || seen.goal !== goal || seen.listId !== listId) {
    setSeen({ name, goal, listId });
    setDraftName(name);
    setDraftGoal(goal ?? "");
    setDraftList(listId ?? "");
  }

  const attachedList = lists.find((list) => list.id === listId) ?? null;
  const total = counts.ACTIVE + counts.PAUSED + counts.COMPLETED + counts.STOPPED;
  const enrollable = stepCount > 0 && status !== "COMPLETED" && status !== "ARCHIVED";

  const save = () => {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const result = await updateCampaignAction(campaignId, {
        name: draftName.trim(),
        goal: draftGoal,
        listId: draftList,
      });
      if (result.ok) {
        setEditing(false);
        toast.success("Campaign saved");
        return;
      }
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    });
  };

  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone={statusTone}>{statusLabel}</Badge>
          <span className="text-[13px] text-secondary">
            Owned by {ownerName ?? "someone who has left"}
          </span>
          {startedAt ? (
            <span className="text-[13px] text-muted">· Started {DATE.format(startedAt)}</span>
          ) : null}
          {completedAt ? (
            <span className="text-[13px] text-muted">· Ended {DATE.format(completedAt)}</span>
          ) : null}
        </div>

        {canManage && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        ) : null}
      </header>

      {editing ? (
        <form
          className="space-y-4 border-b border-border-subtle p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Field label="Name" htmlFor="detail-name" error={fieldErrors.name}>
            <Input
              id="detail-name"
              value={draftName}
              maxLength={80}
              autoFocus
              aria-invalid={Boolean(fieldErrors.name?.length)}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </Field>

          <Field label="Goal" htmlFor="detail-goal" error={fieldErrors.goal}>
            <Textarea
              id="detail-goal"
              value={draftGoal}
              maxLength={500}
              rows={2}
              onChange={(event) => setDraftGoal(event.target.value)}
            />
          </Field>

          <Field
            label="Prospect list"
            htmlFor="detail-list"
            hint="Whose members can be enrolled in one go. Changing it does not move anyone already enrolled."
            error={fieldErrors.listId}
          >
            <Select
              id="detail-list"
              value={draftList}
              disabled={lists.length === 0}
              onChange={(event) => setDraftList(event.target.value)}
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
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraftName(name);
                setDraftGoal(goal ?? "");
                setDraftList(listId ?? "");
                setError(null);
                setFieldErrors({});
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-x-10 gap-y-4 p-5">
        <Stat label="Steps" value={String(stepCount)} />
        <Stat label="Enrolled" value={String(total)} />
        <Stat label="Still moving" value={String(counts.ACTIVE)} />
        <Stat label="Paused" value={String(counts.PAUSED)} />
        <Stat label="Finished" value={String(counts.COMPLETED)} />
        <Stat label="Stopped" value={String(counts.STOPPED)} />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3.5">
          <div className="min-w-0">
            {attachedList ? (
              <p className="text-[13px] text-secondary">
                Prospect list: <span className="text-foreground">{attachedList.name}</span>
              </p>
            ) : (
              <p className="text-[13px] text-muted">
                No prospect list attached — enrol people from their own record instead.
              </p>
            )}
          </div>

          {canWrite && attachedList ? (
            <Button
              size="sm"
              variant="secondary"
              loading={pending}
              disabled={!enrollable}
              title={
                enrollable
                  ? "Adds everyone on the list who is not already enrolled"
                  : stepCount === 0
                    ? "Add at least one step first"
                    : "This campaign is closed to new enrollments"
              }
              onClick={() =>
                start(async () => {
                  const result = await enrollListAction(campaignId);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  const { enrolled, alreadyEnrolled, skipped } = result.data;
                  toast.success(
                    `${enrolled} enrolled · ${alreadyEnrolled} already on it${
                      skipped > 0 ? ` · ${skipped} skipped` : ""
                    }`,
                  );
                })
              }
            >
              <UserPlus size={14} strokeWidth={2} aria-hidden />
              Enroll everyone on {attachedList.name}
            </Button>
          ) : null}
      </footer>

      {canDelete ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3.5">
          <p className="max-w-xl text-[12px] text-muted">
            Deleting destroys the record of who was contacted through this campaign. Archiving
            keeps it and can be undone by hand; delete cannot.
          </p>
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="danger"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const result = await deleteCampaignAction(campaignId);
                    if (result.ok) router.push("/campaigns");
                    else toast.error(result.error);
                  })
                }
              >
                Delete permanently
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Delete campaign
            </Button>
          )}
        </footer>
      ) : null}
    </section>
  );
}
