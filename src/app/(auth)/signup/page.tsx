import Link from "next/link";
import { redirect } from "next/navigation";

import { getCtx } from "@/server/context";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create a workspace · CRM" };

export default async function SignupPage() {
  if (await getCtx()) redirect("/dashboard");

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-6">
      <span className="mb-4 flex size-8 items-center justify-center rounded-lg bg-accent text-[14px] font-bold text-accent-fg">
        C
      </span>
      <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Create your workspace</h1>
      <p className="mt-1 text-[12px] text-muted">
        You become the owner and get a default sales pipeline.
      </p>
      <SignupForm />
      <p className="mt-6 border-t border-border-subtle pt-4 text-[12px] text-muted">
        Already have one?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
