import {
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
import { AccountMenu } from "@/components/account-menu";
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

  const [org, user, unread, overdue] = await Promise.all([
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    db.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
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
        <div className="flex h-[var(--header-h)] items-center gap-2 px-4">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-[var(--tag-gray-bg)] text-[12px] font-semibold text-[var(--tag-gray-fg)]">
            {(org?.name ?? "W").charAt(0).toUpperCase()}
          </span>
          <p className="min-w-0 truncate text-[14px] font-[590]">{org?.name ?? "Workspace"}</p>
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
        </nav>
      </aside>

      {/*
        Pinned into the same 52px band as each page's header, so it reads as one
        app bar: title on the left, page actions, account on the far right.
        Page headers reserve room for it with their right padding.
      */}
      <div className="fixed right-0 top-0 z-30 flex h-[var(--header-h)] items-center pr-6">
        <AccountMenu
          userName={user?.name ?? null}
          userEmail={user?.email ?? ""}
          role={ctx.role}
        />
      </div>

      <main className="min-w-0 flex-1 bg-page">{children}</main>

      {modal}
      <CommandPalette />
    </div>
  );
}
