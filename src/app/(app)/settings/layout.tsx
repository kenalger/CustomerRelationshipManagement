import { AccountMenu } from "@/components/account-menu";
import { SettingsNav } from "@/components/settings-nav";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/context";
import { countDeadLettered } from "@/server/services/ingestion-queue";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await requireCtx();
  const [stuck, user] = await Promise.all([
    countDeadLettered(ctx.organizationId),
    db.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
  ]);

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-page">
        <div className="mx-auto flex min-h-[var(--header-h)] w-full max-w-5xl items-center justify-between gap-6 px-8 py-3">
          <h1 className="text-[18px] font-[590] leading-6 tracking-[-0.014em]">Settings</h1>
          <AccountMenu
            userName={user?.name ?? null}
            userEmail={user?.email ?? ""}
            role={ctx.role}
          />
        </div>
      </header>

      <SettingsNav alert={stuck} />

      {children}
    </div>
  );
}
