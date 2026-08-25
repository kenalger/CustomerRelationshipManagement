"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import {
  type ConnectionActionState,
  retryConnectionAction,
  saveFieldMappingAction,
} from "@/server/actions/connections";

type Connection = {
  id: string;
  provider: string;
  status: string;
  externalAccountId: string;
  displayName: string | null;
  fieldMapping: unknown;
  lastSyncAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  failureCount: number;
  events: {
    processed: number;
    duplicate: number;
    pending: number;
    failed: number;
    deadLettered: number;
  };
};

const STATUS: Record<string, { tone: "success" | "warning" | "danger"; label: string }> = {
  ACTIVE: { tone: "success", label: "Healthy" },
  NEEDS_REAUTH: { tone: "danger", label: "Reconnect required" },
  REVOKED: { tone: "danger", label: "Revoked" },
  ERROR: { tone: "warning", label: "Erroring" },
};

function Pending({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

export function ConnectionCard({
  connection,
  canManage,
}: {
  connection: Connection;
  canManage: boolean;
}) {
  const [retryState, retry] = useActionState<ConnectionActionState, FormData>(
    retryConnectionAction,
    {},
  );
  const [mapState, saveMapping] = useActionState<ConnectionActionState, FormData>(
    saveFieldMappingAction,
    {},
  );

  const status = STATUS[connection.status] ?? { tone: "warning" as const, label: connection.status };
  const mappingJson =
    connection.fieldMapping && Object.keys(connection.fieldMapping).length > 0
      ? JSON.stringify(connection.fieldMapping, null, 2)
      : "";

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {connection.displayName ?? connection.provider}
          </h2>
          <p className="text-xs text-muted">
            {connection.provider.toLowerCase()} · {connection.externalAccountId}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        {(
          [
            ["Imported", connection.events.processed, "neutral"],
            ["Duplicates", connection.events.duplicate, "neutral"],
            ["Pending", connection.events.pending, "neutral"],
            ["Failed", connection.events.failed, connection.events.failed > 0 ? "warning" : "neutral"],
            [
              "Given up",
              connection.events.deadLettered,
              connection.events.deadLettered > 0 ? "danger" : "neutral",
            ],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd
              className={`text-base font-semibold tabular-nums ${
                tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : ""
              }`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-muted">
        {connection.lastSyncAt
          ? `Last successful sync ${timeAgo(connection.lastSyncAt)}.`
          : "Never synced successfully."}
        {connection.failureCount > 0 ? ` ${connection.failureCount} consecutive failures.` : ""}
      </p>

      {connection.lastError ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-danger">
            Last error{connection.lastErrorAt ? ` · ${timeAgo(connection.lastErrorAt)}` : ""}
          </summary>
          <pre className="mt-1 overflow-x-auto rounded border border-border-subtle bg-sunken p-2 text-[12px] whitespace-pre-wrap">
            {connection.lastError}
          </pre>
        </details>
      ) : null}

      {canManage ? (
        <div className="mt-4 space-y-4 border-t border-border-subtle pt-4">
          <form action={retry} className="flex items-center gap-3">
            <input type="hidden" name="connectionId" value={connection.id} />
            <Pending idle="Retry failed imports" busy="Retrying…" />
            <span aria-live="polite" className="text-xs">
              {retryState.error ? (
                <span className="text-danger">{retryState.error}</span>
              ) : retryState.message ? (
                <span className="text-success">{retryState.message}</span>
              ) : null}
            </span>
          </form>

          <form action={saveMapping} className="space-y-2">
            <input type="hidden" name="connectionId" value={connection.id} />
            <label
              htmlFor={`mapping-${connection.id}`}
              className="block text-xs font-medium"
            >
              Field mapping
            </label>
            <p className="text-xs text-muted">
              Form field names are chosen by whoever built the form. Map them here when the
              defaults miss, e.g.{" "}
              <code className="rounded bg-sunken px-1">
                {'{ "email": ["work_email"], "companyName": ["employer"] }'}
              </code>
            </p>
            <textarea
              id={`mapping-${connection.id}`}
              name="fieldMapping"
              rows={4}
              defaultValue={mappingJson}
              spellCheck={false}
              placeholder="{}"
              className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <Pending idle="Save mapping" busy="Saving…" />
              <span aria-live="polite" className="text-xs">
                {mapState.error ? (
                  <span className="text-danger">{mapState.error}</span>
                ) : mapState.message ? (
                  <span className="text-success">{mapState.message}</span>
                ) : null}
              </span>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
