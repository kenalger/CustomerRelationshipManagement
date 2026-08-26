import {
  BarChart3,
  Bell,
  Building2,
  CheckSquare,
  KanbanSquare,
  LayoutDashboard,
  Sparkles,
  Users,
} from "lucide-react";

import { CommandHint, CommandPalette } from "@/components/command-palette";
import { NavLink } from "@/components/nav-link";
import { WorkspaceTile } from "@/components/workspace-tile";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/context";
import { unreadCount } from "@/server/services/notifications";
import { countOverdue } from "@/server/services/tasks";

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export default async function AppLayout({
  children,
  modal,
}: LayoutProps<"/"> & { modal: React.ReactNode }) {
  const ctx = await requireCtx();

  const [org, unread, overdue] = await Promise.all([
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    unreadCount(ctx),
    countOverdue(ctx),
  ]);

  return (
    <div className="flex min-h-dvh bg-page">
      <aside className="sticky top-0 flex h-dvh w-[248px] shrink-0 flex-col border-r border-border-subtle bg-sunken">
        {/*
          Workspace identity only. The account moved to the top-right app bar,
          which is where every comparable product puts it; Notion keeps it in
          the sidebar and copying that hid it somewhere nobody looks.
        */}
        {/*
          Sits in the same band as the page bar so the two line up across the
          divider, instead of the sidebar's identity floating at its own
          height. The tile is coloured from the organisation's name — a flat
          grey square looks identical for every customer.
        */}
        <div className="flex min-h-[var(--header-h)] items-center gap-2.5 border-b border-border-subtle px-4 py-3">
          <WorkspaceTile name={org?.name ?? "Workspace"} size={30} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-[590] leading-5">
              {org?.name ?? "Workspace"}
            </p>
            <p className="truncate text-[12px] leading-4 text-muted">
              {ctx.role.replace("_", " ").toLowerCase()}
            </p>
          </div>
        </div>

        <div className="px-2 pb-1 pt-2">
          <CommandHint />
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="Main">
          <NavLink href="/dashboard" icon={<LayoutDashboard {...ICON} />}>
            Overview
          </NavLink>
          <NavLink href="/notifications" icon={<Bell {...ICON} />} badge={unread}>
            Notifications
          </NavLink>
          <NavLink href="/tasks" icon={<CheckSquare {...ICON} />} badge={overdue} badgeTone="alert">
            Tasks
          </NavLink>

          <p className="t-caps px-2.5 pb-1 pt-5 text-muted">Records</p>
          <NavLink href="/leads" icon={<Sparkles {...ICON} />}>
            Leads
          </NavLink>
          <NavLink href="/deals" icon={<KanbanSquare {...ICON} />}>
            Pipeline
          </NavLink>
          <NavLink href="/contacts" icon={<Users {...ICON} />}>
            Contacts
          </NavLink>
          <NavLink href="/companies" icon={<Building2 {...ICON} />}>
            Companies
          </NavLink>

          <p className="t-caps px-2.5 pb-1 pt-5 text-muted">Insight</p>
          <NavLink href="/reports" icon={<BarChart3 {...ICON} />}>
            Reports
          </NavLink>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 bg-page">{children}</main>

      {modal}
      <CommandPalette />
    </div>
  );
}
