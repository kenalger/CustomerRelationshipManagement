import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { type Result, err, ok } from "@/server/result";

const DEFAULT_STAGES = [
  { name: "New", order: 1, probability: 10, isWon: false, isLost: false },
  { name: "Qualified", order: 2, probability: 25, isWon: false, isLost: false },
  { name: "Proposal", order: 3, probability: 50, isWon: false, isLost: false },
  { name: "Negotiation", order: 4, probability: 75, isWon: false, isLost: false },
  { name: "Won", order: 5, probability: 100, isWon: true, isLost: false },
  { name: "Lost", order: 6, probability: 0, isWon: false, isLost: true },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
}

/**
 * Creates an organization, its first OWNER, and a default pipeline in one
 * transaction. A tenant without a pipeline can't hold a deal, so a partial
 * signup would leave the account unusable.
 */
export async function signUpOrganization(
  raw: unknown,
): Promise<Result<{ organizationId: string; userId: string }>> {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const email = input.email.toLowerCase();

  const existing = await db.user.findFirst({ where: { email }, select: { id: true } });
  if (existing) return err("An account with that email already exists");

  const passwordHash = await bcrypt.hash(input.password, 12);

  // Slug is globally unique; suffix until it lands.
  const base = slugify(input.organizationName);
  let slug = base;
  for (let i = 2; await db.organization.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
    if (i > 50) return err("Could not allocate a workspace URL, try a different company name");
  }

  const result = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.organizationName.trim(), slug },
    });

    const user = await tx.user.create({
      data: {
        organizationId: org.id,
        email,
        name: input.name.trim(),
        passwordHash,
        role: "OWNER",
      },
    });

    const pipeline = await tx.pipeline.create({
      data: { organizationId: org.id, name: "Sales Pipeline", isDefault: true },
    });

    await tx.stage.createMany({
      data: DEFAULT_STAGES.map((s) => ({ ...s, pipelineId: pipeline.id })),
    });

    return { organizationId: org.id, userId: user.id };
  });

  return ok(result);
}
