import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { Ctx } from "@/server/authz";

/**
 * Reads the caller's tenant context out of the session. This is the only place
 * a session becomes a `Ctx` — services take the `Ctx` and never touch auth.
 */

/** Null when signed out. Deduped per request by React `cache`. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return null;
  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role,
  };
});

/** Redirects to /login when signed out. Use in pages and server actions. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export type { Ctx };
