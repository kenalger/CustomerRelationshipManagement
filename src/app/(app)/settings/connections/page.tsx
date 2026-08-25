import { Plug } from "lucide-react";

import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireCtx } from "@/server/context";
import { listConnections } from "@/server/services/connections";
import { ConnectionCard } from "./connection-card";

export const metadata = { title: "Connections · CRM" };

export default async function ConnectionsPage() {
  const ctx = await requireCtx();
  const connections = await listConnections(ctx);
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";

  const unhealthy = connections.filter((c) => c.status !== "ACTIVE").length;
  const stuck = connections.reduce((sum, c) => sum + c.events.deadLettered, 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
        <SectionHeader
          title="Connections"
          description="Where leads come from, and whether they are still arriving."
        />

        {stuck > 0 ? (
          <p
            role="alert"
            className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            <strong>{stuck}</strong> lead{stuck === 1 ? "" : "s"} could not be imported after
            repeated attempts. Meta deletes lead data after 90 days — fix the connection and retry
            before then.
          </p>
        ) : unhealthy > 0 ? (
          <p
            role="alert"
            className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {unhealthy} connection{unhealthy === 1 ? " needs" : "s need"} attention. New leads from
            {unhealthy === 1 ? " it" : " them"} are not arriving.
          </p>
        ) : null}

        {connections.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No connections yet"
            hint="Connecting a Facebook page needs Meta App Review — see plan/04-features/lead-ingestion."
          />
        ) : (
          connections.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} canManage={canManage} />
          ))
        )}

        <p className="text-xs text-muted">
          The retry sweeper runs every 5 minutes. Failed imports back off exponentially and stop
          after 6 attempts, at which point they need a manual retry here.
        </p>
    </div>
  );
}
