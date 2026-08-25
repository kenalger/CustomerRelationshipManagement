import { describe, expect, it } from "vitest";

import {
  companyListFilterSchema,
  contactListFilterSchema,
  leadListFilterSchema,
} from "@/lib/validation/crm";

/**
 * These values come straight from a URL, so they are attacker-controlled and
 * also just plain stale — a bookmark from before a column was renamed. They
 * must degrade to the default ordering rather than throwing, which rendered an
 * error boundary instead of a list.
 */
describe("list filter parsing", () => {
  it("falls back to the default sort for an unknown column", () => {
    const parsed = contactListFilterSchema.parse({ sort: "passwordHash" });
    expect(parsed.sort).toBe("lastName");
  });

  it("never lets an arbitrary column reach orderBy", () => {
    for (const attempt of ["passwordHash", "organizationId", "deletedAt", "'; DROP TABLE"]) {
      expect(contactListFilterSchema.parse({ sort: attempt }).sort).toBe("lastName");
      expect(leadListFilterSchema.parse({ sort: attempt }).sort).toBe("createdAt");
      expect(companyListFilterSchema.parse({ sort: attempt }).sort).toBe("name");
    }
  });

  it("falls back on a junk direction", () => {
    expect(contactListFilterSchema.parse({ dir: "; DROP TABLE" }).dir).toBe("asc");
    expect(contactListFilterSchema.parse({ dir: "DESC" }).dir).toBe("asc");
    // The real values still work.
    expect(contactListFilterSchema.parse({ dir: "desc" }).dir).toBe("desc");
  });

  it("falls back on junk pagination instead of throwing", () => {
    expect(contactListFilterSchema.parse({ page: "-5" }).page).toBe(1);
    expect(contactListFilterSchema.parse({ page: "abc" }).page).toBe(1);
    expect(contactListFilterSchema.parse({ perPage: "99999" }).perPage).toBe(25);
    expect(contactListFilterSchema.parse({ page: "3" }).page).toBe(3);
  });

  it("still rejects a malformed ownerId rather than silently ignoring it", () => {
    // A bad id is a caller bug, not a stale bookmark — it should be visible.
    expect(() => contactListFilterSchema.parse({ ownerId: "not-a-cuid" })).toThrow();
  });

  it("keeps a valid sort untouched", () => {
    const parsed = leadListFilterSchema.parse({ sort: "companyName", dir: "desc" });
    expect(parsed).toMatchObject({ sort: "companyName", dir: "desc" });
  });
});
