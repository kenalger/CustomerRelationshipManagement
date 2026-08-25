"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import { updateCompany } from "@/server/services/companies";
import { updateContact } from "@/server/services/contacts";
import { updateDeal } from "@/server/services/deals";

export type FieldResult = { ok: true } | { ok: false; error: string };

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

/**
 * Single-field save for inline editing.
 *
 * The field name is checked against a per-entity allowlist here as well as in
 * the service schema — an inline editor sends the field name from the client,
 * and nothing arriving from a client decides which column gets written.
 */
const EDITABLE = {
  contact: ["firstName", "lastName", "email", "phone", "title"],
  company: ["name", "domain", "industry", "size", "phone", "website"],
  deal: ["title", "value", "currency", "expectedCloseDate"],
} as const;

export type EditableEntity = keyof typeof EDITABLE;

export async function saveFieldAction(
  entity: EditableEntity,
  id: string,
  field: string,
  value: string,
): Promise<FieldResult> {
  const ctx = await requireCtx();

  const allowed = EDITABLE[entity] as readonly string[] | undefined;
  if (!allowed?.includes(field)) return { ok: false, error: "That field cannot be edited here" };

  // Empty means "clear it" for nullable fields; the schemas decide what is
  // actually nullable, so an empty required field still fails validation.
  const patch = { [field]: value };

  const result = await guarded(() => {
    switch (entity) {
      case "contact":
        return updateContact(ctx, id, patch);
      case "company":
        return updateCompany(ctx, id, patch);
      case "deal":
        return updateDeal(ctx, id, patch);
    }
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/${entity === "company" ? "companies" : `${entity}s`}/${id}`);
  revalidatePath(`/${entity === "company" ? "companies" : `${entity}s`}`);
  if (entity === "deal") {
    revalidatePath("/deals");
    revalidatePath("/dashboard");
  }
  return { ok: true };
}
