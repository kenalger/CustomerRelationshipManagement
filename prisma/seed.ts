import "dotenv/config";
import bcrypt from "bcryptjs";

import { db } from "../src/lib/db";
import { convertLead } from "../src/server/services/leads";
import { ingestLead } from "../src/server/services/leads";
import { moveDealToStage } from "../src/server/services/deals";
import type { Ctx } from "../src/server/authz";

/**
 * Seeds TWO organizations on purpose. Every tenant-isolation test and every
 * manual check needs a second tenant to prove we cannot reach across.
 */
async function seedOrg(opts: { name: string; slug: string; email: string }) {
  const org = await db.organization.upsert({
    where: { slug: opts.slug },
    update: {},
    create: { name: opts.name, slug: opts.slug },
  });

  const passwordHash = await bcrypt.hash("password123456", 12);
  const owner = await db.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: opts.email } },
    update: {},
    create: {
      organizationId: org.id,
      email: opts.email,
      name: opts.name.split(" ")[0] + " Owner",
      passwordHash,
      role: "OWNER",
    },
  });

  let pipeline = await db.pipeline.findFirst({ where: { organizationId: org.id } });
  if (!pipeline) {
    pipeline = await db.pipeline.create({
      data: { organizationId: org.id, name: "Sales Pipeline", isDefault: true },
    });
    await db.stage.createMany({
      data: [
        { pipelineId: pipeline.id, name: "New", order: 1, probability: 10 },
        { pipelineId: pipeline.id, name: "Qualified", order: 2, probability: 25 },
        { pipelineId: pipeline.id, name: "Proposal", order: 3, probability: 50 },
        { pipelineId: pipeline.id, name: "Negotiation", order: 4, probability: 75 },
        { pipelineId: pipeline.id, name: "Won", order: 5, probability: 100, isWon: true },
        { pipelineId: pipeline.id, name: "Lost", order: 6, probability: 0, isLost: true },
      ],
    });
  }

  return { org, owner, pipeline };
}

async function main() {
  const acme = await seedOrg({ name: "Acme Industrial", slug: "acme", email: "owner@acme.test" });
  const globex = await seedOrg({ name: "Globex Corp", slug: "globex", email: "owner@globex.test" });

  // Inbound leads through the real ingestion path, so the seed exercises
  // dedupe and assignment rather than bypassing them.
  const inbound = [
    {
      externalId: "fb-lead-1001",
      source: "FACEBOOK_LEAD_ADS" as const,
      normalized: {
        firstName: "Dana",
        lastName: "Reyes",
        email: "dana.reyes@northwind.test",
        phone: "+1 415 555 0142",
        companyName: "Northwind Logistics",
        message: "Interested in a demo for a 30-person sales team.",
      },
    },
    {
      externalId: "fb-lead-1002",
      source: "FACEBOOK_LEAD_ADS" as const,
      normalized: {
        firstName: "Samir",
        lastName: "Haddad",
        email: "s.haddad@vertexparts.test",
        companyName: "Vertex Parts",
        message: "Need pricing for 12 seats.",
      },
    },
    {
      externalId: "email-2001",
      source: "EMAIL" as const,
      normalized: {
        firstName: "Priya",
        lastName: "Nair",
        email: "priya@lumenhealth.test",
        companyName: "Lumen Health",
        message: "Forwarded from the website contact form.",
      },
    },
  ];

  for (const item of inbound) {
    const outcome = await ingestLead({
      organizationId: acme.org.id,
      provider: item.source === "EMAIL" ? "GOOGLE" : "FACEBOOK",
      source: item.source,
      externalId: item.externalId,
      rawPayload: { seeded: true, ...item.normalized },
      normalized: item.normalized,
    });
    console.log(`  ${item.externalId} → ${outcome.kind}`);
  }

  // Replay one payload to prove idempotency is real, not theoretical.
  const replay = await ingestLead({
    organizationId: acme.org.id,
    provider: "FACEBOOK",
    source: "FACEBOOK_LEAD_ADS",
    externalId: "fb-lead-1001",
    rawPayload: { seeded: true },
    normalized: { email: "dana.reyes@northwind.test" },
  });
  console.log(`  fb-lead-1001 replayed → ${replay.kind} (expected: replayed)`);

  // Globex gets one lead of its own — the record org A must never see.
  await ingestLead({
    organizationId: globex.org.id,
    provider: "FACEBOOK",
    source: "FACEBOOK_LEAD_ADS",
    externalId: "fb-lead-9001",
    rawPayload: { seeded: true },
    normalized: { firstName: "Confidential", lastName: "Globex Lead", email: "lead@globex-only.test" },
  });

  // Work two of Acme's leads all the way through, so the pipeline board and
  // the dashboard forecast have something real in them on first run.
  const acmeCtx: Ctx = {
    userId: acme.owner.id,
    organizationId: acme.org.id,
    role: "OWNER",
  };

  const workable = await db.lead.findMany({
    where: { organizationId: acme.org.id, status: "NEW" },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: { id: true },
  });

  const dealValues = [48_000, 12_500];
  for (const [i, lead] of workable.entries()) {
    const converted = await convertLead(acmeCtx, lead.id);
    if (!converted.ok) {
      console.log(`  convert failed: ${converted.error}`);
      continue;
    }

    await db.deal.update({
      where: { id: converted.data.dealId },
      data: {
        value: dealValues[i],
        expectedCloseDate: new Date(Date.now() + (i + 1) * 21 * 86_400_000),
      },
    });

    // Push the first deal a couple of stages along.
    if (i === 0) {
      const proposal = await db.stage.findFirst({
        where: { pipelineId: acme.pipeline.id, name: "Proposal" },
        select: { id: true },
      });
      if (proposal) await moveDealToStage(acmeCtx, converted.data.dealId, proposal.id);
    }

    console.log(`  converted lead → deal ${converted.data.dealId}`);
  }

  console.log("\nSeeded:");
  console.log("  Acme Industrial  owner@acme.test   / password123456");
  console.log("  Globex Corp      owner@globex.test / password123456");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
