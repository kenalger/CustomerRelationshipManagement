import Link from "next/link";
import { redirect } from "next/navigation";

import { getCtx } from "@/server/context";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · CRM" };

export default async function LoginPage() {
  if (await getCtx()) redirect("/dashboard");

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-6">
      <span className="mb-4 flex size-8 items-center justify-center rounded-lg bg-accent text-[14px] font-bold text-accent-fg">
        C
      </span>
      <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Sign in</h1>
      <p className="mt-1 text-[12px] text-muted">Pick up where your pipeline left off.</p>
      <LoginForm />
      <p className="mt-6 border-t border-border-subtle pt-4 text-[12px] text-muted">
        No workspace yet?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
