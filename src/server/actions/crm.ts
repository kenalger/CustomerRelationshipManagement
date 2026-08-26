"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCtx } from "@/server/context";
import { ForbiddenError } from "@/server/authz";
import { type Result, err } from "@/server/result";
import { logActivity } from "@/server/services/activities";
import { createCompany } from "@/server/services/companies";
import { createContact } from "@/server/services/contacts";
import { createDeal, moveDealToStage as moveDeal } from "@/server/services/deals";

export type ActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

/**
 * Services throw ForbiddenError for a role violation but return `Result` for
 * everything else. This flattens the two into one Result so the actions below
 * have a single shape to branch on — a permission failure is a form message,
 * not a 500.
 */
async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

function nullable(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  const str = typeof value === "string" ? value.trim() : "";
  return str === "" ? null : str;
}

export async function createContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireCtx();

  const result = await guarded(() =>
    createContact(ctx, {
      firstName: formData.get("firstName") ?? "",
      lastName: formData.get("lastName") ?? "",
      email: formData.get("email") ?? "",
      phone: formData.get("phone") ?? "",
      title: formData.get("title") ?? "",
      companyId: nullable(formData, "companyId"),
    }),
  );
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath("/contacts");
  redirect(`/contacts/${result.data.id}`);
}

export async function createCompanyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireCtx();

  const result = await guarded(() =>
    createCompany(ctx, {
      name: formData.get("name") ?? "",
      domain: formData.get("domain") ?? "",
      industry: formData.get("industry") ?? "",
      phone: formData.get("phone") ?? "",
      website: formData.get("website") ?? "",
    }),
  );
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath("/companies");
  redirect(`/companies/${result.data.id}`);
}

export async function createDealAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireCtx();

  const result = await guarded(() =>
    createDeal(ctx, {
      title: formData.get("title") ?? "",
      value: formData.get("value") ?? 0,
      currency: formData.get("currency") || "USD",
      contactId: nullable(formData, "contactId"),
      companyId: nullable(formData, "companyId"),
      expectedCloseDate: nullable(formData, "expectedCloseDate"),
    }),
  );
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  redirect(`/deals/${result.data.id}`);
}

export async function moveDealAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireCtx();

  const result = await guarded(() =>
    moveDeal(
      ctx,
      String(formData.get("dealId") ?? ""),
      String(formData.get("stageId") ?? ""),
      (formData.get("lostReason") as string) || null,
    ),
  );
  if (!result.ok) return { error: result.error };

  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { message: "Moved" };
}

/**
 * Direct-call variant for the drag-and-drop board, which has no form to submit.
 * Kept alongside the form action rather than replacing it: the deal page's
 * stage picker is a real form and must keep working without JavaScript.
 */
export async function moveDealToStage(
  dealId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireCtx();
  const result = await guarded(() => moveDeal(ctx, dealId, stageId));

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function logActivityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireCtx();

  const result = await guarded(() =>
    logActivity(ctx, {
      type: formData.get("type") ?? "NOTE",
      subject: formData.get("subject") ?? "",
      body: formData.get("body") ?? "",
      // An empty select posts "", which would coerce to 0 minutes and to an
      // invalid enum member. Absent means "not recorded", so send null.
      durationMinutes: formData.get("durationMinutes") || null,
      outcome: formData.get("outcome") || null,
      contactId: nullable(formData, "contactId"),
      companyId: nullable(formData, "companyId"),
      dealId: nullable(formData, "dealId"),
      leadId: nullable(formData, "leadId"),
    }),
  );
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  for (const key of ["contactId", "companyId", "dealId"] as const) {
    const id = nullable(formData, key);
    if (id) revalidatePath(`/${key.replace("Id", "s")}/${id}`);
  }
  return { message: "Logged" };
}
