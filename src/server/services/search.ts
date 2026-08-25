import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";

export type SearchHit = {
  id: string;
  kind: "lead" | "contact" | "company" | "deal";
  title: string;
  subtitle: string | null;
  href: string;
};

/**
 * Cross-entity search for the command palette.
 *
 * Every branch is tenant-scoped independently — this is the one place in the
 * app that queries four tables at once, so a single missed `organizationId`
 * would leak another customer's records into an autocomplete.
 */
export async function searchEverything(ctx: Ctx, term: string, perKind = 5): Promise<SearchHit[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const scope = { organizationId: ctx.organizationId, deletedAt: null };
  const like = { contains: q, mode: "insensitive" as const };

  const [leads, contacts, companies, deals] = await Promise.all([
    db.lead.findMany({
      where: {
        ...scope,
        OR: [{ firstName: like }, { lastName: like }, { email: like }, { companyName: like }],
      },
      take: perKind,
      orderBy: { createdAt: "desc" },
      select: { id: true, firstName: true, lastName: true, email: true, companyName: true },
    }),
    db.contact.findMany({
      where: { ...scope, OR: [{ firstName: like }, { lastName: like }, { email: like }] },
      take: perKind,
      orderBy: { lastName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        company: { select: { name: true } },
      },
    }),
    db.company.findMany({
      where: { ...scope, OR: [{ name: like }, { domain: like }] },
      take: perKind,
      orderBy: { name: "asc" },
      select: { id: true, name: true, domain: true },
    }),
    db.deal.findMany({
      where: { ...scope, title: like },
      take: perKind,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        company: { select: { name: true } },
        stage: { select: { name: true } },
      },
    }),
  ]);

  return [
    ...leads.map((l) => ({
      id: l.id,
      kind: "lead" as const,
      title: [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || "Unnamed lead",
      subtitle: l.companyName ?? l.email,
      href: "/leads",
    })),
    ...contacts.map((c) => ({
      id: c.id,
      kind: "contact" as const,
      title: [c.firstName, c.lastName].filter(Boolean).join(" "),
      subtitle: c.company?.name ?? c.email,
      href: `/contacts/${c.id}`,
    })),
    ...companies.map((c) => ({
      id: c.id,
      kind: "company" as const,
      title: c.name,
      subtitle: c.domain,
      href: `/companies/${c.id}`,
    })),
    ...deals.map((d) => ({
      id: d.id,
      kind: "deal" as const,
      title: d.title,
      subtitle: [d.company?.name, d.stage.name].filter(Boolean).join(" · ") || null,
      href: `/deals/${d.id}`,
    })),
  ];
}
