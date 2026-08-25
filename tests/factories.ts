import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import type { Role } from "@/generated/prisma/enums";

/** Creates an isolated organization with an owner and a default pipeline. */
export async function makeOrg(role: Role = "OWNER") {
  const suffix = randomUUID().slice(0, 8);

  const org = await db.organization.create({
    data: { name: `Test Org ${suffix}`, slug: `test-${suffix}` },
  });

  const user = await db.user.create({
    data: {
      organizationId: org.id,
      email: `user-${suffix}@test.local`,
      name: `User ${suffix}`,
      passwordHash: "not-used-in-these-tests",
      role,
    },
  });

  const pipeline = await db.pipeline.create({
    data: { organizationId: org.id, name: "Sales Pipeline", isDefault: true },
  });

  await db.stage.createMany({
    data: [
      { pipelineId: pipeline.id, name: "New", order: 1, probability: 10 },
      { pipelineId: pipeline.id, name: "Won", order: 2, probability: 100, isWon: true },
    ],
  });

  const ctx: Ctx = { userId: user.id, organizationId: org.id, role };
  return { org, user, pipeline, ctx };
}

/** Cascades through every tenant-owned table. */
export async function dropOrg(organizationId: string) {
  await db.organization.deleteMany({ where: { id: organizationId } });
}
