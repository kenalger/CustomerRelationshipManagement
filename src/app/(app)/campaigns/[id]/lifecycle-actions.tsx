"use client";

import { Archive, Flag, Pause, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  activateCampaignAction,
  archiveCampaignAction,
  completeCampaignAction,
  pauseCampaignAction,
} from "@/server/actions/campaigns";

/**
 * The lifecycle controls, and only the ones the service will actually accept.
 *
 * `services/campaigns.ts` rejects everything else outright — pausing anything
 * but a running campaign, activating a finished or archived one, starting a
 * campaign with no steps or with non-contiguous positions. A button that
 * always returns an error is worse than no button, so those are not rendered:
 *
 *   DRAFT     → Start (needs at least one step)
 *   ACTIVE    → Pause, End
 *   PAUSED    → Resume, End
 *   COMPLETED → nothing but Archive
 *   ARCHIVED  → nothing at all
 *
 * "Start" on a step-less draft is the one exception: it is rendered disabled
 * with the reason on it, because hiding it entirely would leave a draft with
 * no visible route forward.
 */
export function LifecycleActions({
  campaignId,
  status,
  statusLabel,
  stepCount,
  contiguous,
  canManage,
  canDelete,
}: {
  campaignId: string;
  status: string;
  statusLabel: string;
  stepCount: number;
  contiguous: boolean;
  canManage: boolean;
  canDelete: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const result = await fn();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "That did not work");
    });

  // Nothing legal, nothing rendered — but the status still has to be readable
  // beside the title for anyone who cannot change it.
  const showArchive = canDelete && status !== "ARCHIVED";
  const showLifecycle = canManage && status !== "COMPLETED" && status !== "ARCHIVED";

  if (!showArchive && !showLifecycle) {
    return <span className="text-[13px] text-muted">{statusLabel}</span>;
  }

  const blockedReason =
    stepCount === 0
      ? "Add at least one step first"
      : !contiguous
        ? "The steps are numbered wrong — reorder them and try again"
        : undefined;

  return (
    <div className="flex items-center gap-2">
      {showLifecycle && status === "DRAFT" ? (
        <Button
          size="sm"
          loading={pending}
          disabled={Boolean(blockedReason)}
          title={blockedReason}
          onClick={() =>
            run(() => activateCampaignAction(campaignId), "Campaign started")
          }
        >
          <Play size={14} strokeWidth={2} aria-hidden />
          Start campaign
        </Button>
      ) : null}

      {showLifecycle && status === "PAUSED" ? (
        <Button
          size="sm"
          loading={pending}
          disabled={Boolean(blockedReason)}
          title={blockedReason}
          onClick={() =>
            run(
              () => activateCampaignAction(campaignId),
              "Campaign resumed — waiting steps restart their delay from now",
            )
          }
        >
          <Play size={14} strokeWidth={2} aria-hidden />
          Resume
        </Button>
      ) : null}

      {showLifecycle && status === "ACTIVE" ? (
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={() => run(() => pauseCampaignAction(campaignId), "Campaign paused")}
        >
          <Pause size={14} strokeWidth={2} aria-hidden />
          Pause
        </Button>
      ) : null}

      {showLifecycle && (status === "ACTIVE" || status === "PAUSED") ? (
        <Button
          size="sm"
          variant="ghost"
          loading={pending}
          title="Everyone still in the sequence is marked finished"
          onClick={() => run(() => completeCampaignAction(campaignId), "Campaign ended")}
        >
          <Flag size={14} strokeWidth={2} aria-hidden />
          End
        </Button>
      ) : null}

      {showArchive ? (
        confirmingArchive ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={pending}
              onClick={() => {
                setConfirmingArchive(false);
                run(
                  () => archiveCampaignAction(campaignId),
                  "Campaign archived — anyone still in the sequence was stopped",
                );
              }}
            >
              Archive and stop everyone
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingArchive(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmingArchive(true)}
            title="Puts the campaign away and stops every enrollment still in flight"
          >
            <Archive size={14} strokeWidth={2} aria-hidden />
            Archive
          </Button>
        )
      ) : null}
    </div>
  );
}
