import { SettingsNav } from "@/components/settings-nav";
import { requireCtx } from "@/server/context";
import { countDeadLettered } from "@/server/services/ingestion-queue";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await requireCtx();
  const stuck = await countDeadLettered(ctx.organizationId);

  return (
    <div>
      <header className="sticky top-0 z-20 flex h-[var(--header-h)] items-center border-b border-border-subtle bg-page pl-8 pr-20">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="t-heading">Settings</h1>
        </div>
      </header>

      <SettingsNav alert={stuck} />

      {children}
    </div>
  );
}
