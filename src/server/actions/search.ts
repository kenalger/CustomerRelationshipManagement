"use server";

import { requireCtx } from "@/server/context";
import { searchEverything, type SearchHit } from "@/server/services/search";

export async function searchAction(term: string): Promise<SearchHit[]> {
  const ctx = await requireCtx();
  return searchEverything(ctx, term);
}
