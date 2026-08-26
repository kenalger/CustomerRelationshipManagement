import "dotenv/config";
import bcrypt from "bcryptjs";

import { db } from "../src/lib/db";
import { periodBounds } from "../src/lib/targets";

/**
 * Fills the Acme workspace with a plausible quarter of an agency's work.
 *
 * Separate from `seed.ts` on purpose. That seed is the minimum two tenants the
 * isolation tests need, and it stays small so a failing test points at the
 * test rather than at a hundred rows of scenery. This one is for *looking at*
 * the product: every column populated, every state represented, and enough
 * history behind it that the reports have something to say.
 *
 * Idempotent. Re-running updates in place rather than duplicating, so it is
 * safe to run against a database you have already clicked around in.
 *
 * Dates are all relative to now, so the demo never goes stale — the SLA banner
 * still fires and "82% of the month gone" still moves.
 */

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "acme" } });
  if (!org) throw new Error("Run `npm run db:seed` first — the acme org does not exist.");

  const owner = await db.user.findFirstOrThrow({
    where: { organizationId: org.id, email: "owner@acme.test" },
  });

  // The base seed names this account "Acme Owner" after its ROLE. Now that the
  // record-ownership column is labelled "Sales rep", that read as
  // "Sales rep: Acme Owner". A person on a sales floor has a name.
  await db.user.update({ where: { id: owner.id }, data: { name: "Elena Marquez" } });

  // ─────────────────────────── workspace settings ───────────────────────────
  // Every field on Settings → General filled, so the page shows what it is for
  // rather than a column of placeholders.
  await db.organization.update({
    where: { id: org.id },
    data: {
      name: "Acme Industrial",
      industry: "Marketing agency",
      website: "https://acme-industrial.test",
      timezone: "Asia/Manila",
      businessHoursEnabled: true,
      businessDays: [1, 2, 3, 4, 5],
      businessStartMinute: 9 * 60,
      businessEndMinute: 18 * 60,
      rawPayloadRetentionDays: 30,
      slaFirstTouchMinutes: 60,
      slaEscalateMinutes: 240,
    },
  });

  // ─────────────────────────── the team ───────────────────────────
  // One of every role, so the role-scoped views are inspectable by logging in
  // as each of them rather than by reading authz.ts and taking it on trust.
  const passwordHash = await bcrypt.hash("password123456", 12);
  const people = [
    { email: "maya@acme.test", name: "Maya Ortega", role: "ADMIN" as const },
    { email: "tom@acme.test", name: "Tom Reyes", role: "MANAGER" as const },
    { email: "iris@acme.test", name: "Iris Chen", role: "REP" as const },
    { email: "dev@acme.test", name: "Dev Kapoor", role: "REP" as const },
    { email: "auditor@acme.test", name: "Fin Auditor", role: "READ_ONLY" as const },
  ];

  const team: Record<string, string> = {};
  for (const person of people) {
    const user = await db.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email: person.email } },
      update: { name: person.name, role: person.role },
      create: {
        organizationId: org.id,
        email: person.email,
        name: person.name,
        role: person.role,
        passwordHash,
      },
      select: { id: true },
    });
    team[person.email] = user.id;
  }
  const iris = team["iris@acme.test"];
  const dev = team["dev@acme.test"];
  const manager = team["tom@acme.test"];

  console.log(`  team: ${people.length} people across every role`);

  // ─────────────────────────── companies ───────────────────────────
  // Every column filled. A demo where half the cells read "—" teaches the
  // reader that the column is useless rather than that it is empty.
  const companySpecs = [
    { name: "Northwind Logistics", domain: "northwind.test", industry: "Freight & logistics", size: "200-500", phone: "+63 2 8555 0142", website: "https://northwind.test", ownerId: iris },
    { name: "Vertex Parts", domain: "vertexparts.test", industry: "Manufacturing", size: "50-200", phone: "+63 2 8555 0198", website: "https://vertexparts.test", ownerId: dev },
    { name: "Lumen Health", domain: "lumenhealth.test", industry: "Healthcare", size: "500-1000", phone: "+63 2 8555 0110", website: "https://lumenhealth.test", ownerId: iris },
    { name: "Harbour & Co", domain: "harbourco.test", industry: "Professional services", size: "10-50", phone: "+63 2 8555 0177", website: "https://harbourco.test", ownerId: dev },
    { name: "Bright Cotton", domain: "brightcotton.test", industry: "Retail & apparel", size: "50-200", phone: "+63 2 8555 0123", website: "https://brightcotton.test", ownerId: iris },
    { name: "Sable Interiors", domain: "sableinteriors.test", industry: "Interior design", size: "10-50", phone: "+63 2 8555 0166", website: "https://sableinteriors.test", ownerId: owner.id },
  ];

  const companies: Record<string, string> = {};
  for (const spec of companySpecs) {
    const existing = await db.company.findFirst({
      where: { organizationId: org.id, name: spec.name },
      select: { id: true },
    });
    const row = existing
      ? await db.company.update({ where: { id: existing.id }, data: spec, select: { id: true } })
      : await db.company.create({
          data: { organizationId: org.id, ...spec },
          select: { id: true },
        });
    companies[spec.name] = row.id;
  }
  console.log(`  companies: ${companySpecs.length}, every column populated`);

  // ─────────────────────────── contacts ───────────────────────────
  const contactSpecs = [
    { firstName: "Dana", lastName: "Reyes", email: "dana.reyes@northwind.test", phone: "+63 917 555 0142", title: "Head of Operations", company: "Northwind Logistics", ownerId: iris },
    { firstName: "Samir", lastName: "Haddad", email: "s.haddad@vertexparts.test", phone: "+63 917 555 0198", title: "Procurement Lead", company: "Vertex Parts", ownerId: dev },
    { firstName: "Priya", lastName: "Nair", email: "priya@lumenhealth.test", phone: "+63 917 555 0110", title: "CTO", company: "Lumen Health", ownerId: iris },
    { firstName: "Grace", lastName: "Hopper", email: "grace@harbourco.test", phone: "+63 917 555 0177", title: "Managing Partner", company: "Harbour & Co", ownerId: dev },
    { firstName: "Noel", lastName: "Batac", email: "noel@brightcotton.test", phone: "+63 917 555 0123", title: "Marketing Director", company: "Bright Cotton", ownerId: iris },
    { firstName: "Amara", lastName: "Silva", email: "amara@sableinteriors.test", phone: "+63 917 555 0166", title: "Founder", company: "Sable Interiors", ownerId: owner.id },
    { firstName: "Ken", lastName: "Villanueva", email: "ken@northwind.test", phone: "+63 917 555 0144", title: "Finance Manager", company: "Northwind Logistics", ownerId: manager },
  ];

  const contacts: Record<string, string> = {};
  for (const spec of contactSpecs) {
    const { company, ...fields } = spec;
    const data = { ...fields, companyId: companies[company] };
    const existing = await db.contact.findFirst({
      where: { organizationId: org.id, email: spec.email },
      select: { id: true },
    });
    const row = existing
      ? await db.contact.update({ where: { id: existing.id }, data, select: { id: true } })
      : await db.contact.create({
          data: { organizationId: org.id, ...data },
          select: { id: true },
        });
    contacts[spec.email] = row.id;
  }
  console.log(`  contacts: ${contactSpecs.length}, with title, phone, company and owner`);

  // ─────────────────────────── tags ───────────────────────────
  const tagSpecs = [
    { name: "Retainer client", colour: "GREEN" as const },
    { name: "Enterprise", colour: "PURPLE" as const },
    { name: "Inbound", colour: "BLUE" as const },
    { name: "Referral", colour: "YELLOW" as const },
    { name: "Price sensitive", colour: "ORANGE" as const },
    { name: "Do not chase", colour: "RED" as const },
  ];
  const tags: Record<string, string> = {};
  for (const spec of tagSpecs) {
    const existing = await db.tag.findFirst({
      where: { organizationId: org.id, name: { equals: spec.name, mode: "insensitive" } },
      select: { id: true },
    });
    const row = existing
      ? await db.tag.update({ where: { id: existing.id }, data: { colour: spec.colour }, select: { id: true } })
      : await db.tag.create({ data: { organizationId: org.id, ...spec }, select: { id: true } });
    tags[spec.name] = row.id;
  }

  // Applied, so the chips are visible on records rather than only in settings.
  const taggings = [
    { tag: "Retainer client", contact: "dana.reyes@northwind.test" },
    { tag: "Enterprise", contact: "priya@lumenhealth.test" },
    { tag: "Inbound", contact: "priya@lumenhealth.test" },
    { tag: "Referral", contact: "grace@harbourco.test" },
    { tag: "Price sensitive", contact: "s.haddad@vertexparts.test" },
    { tag: "Retainer client", contact: "noel@brightcotton.test" },
    { tag: "Inbound", contact: "noel@brightcotton.test" },
    { tag: "Do not chase", contact: "amara@sableinteriors.test" },
  ];
  for (const t of taggings) {
    const contactId = contacts[t.contact];
    const tagId = tags[t.tag];
    const existing = await db.tagging.findFirst({
      where: { organizationId: org.id, tagId, contactId },
      select: { id: true },
    });
    if (!existing) {
      await db.tagging.create({
        data: { organizationId: org.id, tagId, contactId, companyId: null, leadId: null },
      });
    }
  }
  // And on companies, so both surfaces show something.
  for (const [tag, company] of [
    ["Retainer client", "Northwind Logistics"],
    ["Enterprise", "Lumen Health"],
  ] as const) {
    const companyId = companies[company];
    const tagId = tags[tag];
    const existing = await db.tagging.findFirst({
      where: { organizationId: org.id, tagId, companyId },
      select: { id: true },
    });
    if (!existing) {
      await db.tagging.create({
        data: { organizationId: org.id, tagId, companyId, contactId: null, leadId: null },
      });
    }
  }
  console.log(`  tags: ${tagSpecs.length}, applied across contacts and companies`);

  // ─────────────────────────── leads ───────────────────────────
  // Every source, every status, and a spread of ages — so the SLA banner, the
  // score column and the "untouched" figures all have something real behind
  // them instead of one row that happens to be new.
  const leadSpecs = [
    { key: "l1", firstName: "Rosa", lastName: "Delgado", email: "rosa@fernvale.test", phone: "+63 917 555 0201", companyName: "Fernvale Studio", source: "FACEBOOK_LEAD_ADS" as const, status: "NEW" as const, ownerId: iris, createdDaysAgo: 0.02, touched: false, score: 78 },
    { key: "l2", firstName: "Miguel", lastName: "Santos", email: "miguel@corepoint.test", phone: "+63 917 555 0202", companyName: "Corepoint", source: "WEB_FORM" as const, status: "NEW" as const, ownerId: dev, createdDaysAgo: 0.4, touched: false, score: 71 },
    { key: "l3", firstName: "Anne", lastName: "Cruz", email: "anne@driftbay.test", phone: null, companyName: "Driftbay", source: "FACEBOOK_MESSENGER" as const, status: "WORKING" as const, ownerId: iris, createdDaysAgo: 3, touched: true, score: 55 },
    { key: "l4", firstName: "Paolo", lastName: "Rivera", email: "paolo@stonelark.test", phone: "+63 917 555 0204", companyName: "Stonelark", source: "EMAIL" as const, status: "QUALIFIED" as const, ownerId: dev, createdDaysAgo: 9, touched: true, score: 88 },
    { key: "l5", firstName: "Tess", lastName: "Alonzo", email: null, phone: "+63 917 555 0205", companyName: "Ridgeway Co", source: "CSV_IMPORT" as const, status: "WORKING" as const, ownerId: iris, createdDaysAgo: 26, touched: true, score: 34 },
    { key: "l6", firstName: "Bram", lastName: "Ocampo", email: "bram@quietfox.test", phone: null, companyName: "Quietfox", source: "FACEBOOK_COMMENT" as const, status: "JUNK" as const, ownerId: dev, createdDaysAgo: 40, touched: true, score: 0 },
    { key: "l7", firstName: "Hana", lastName: "Lim", email: "hana@marisol.test", phone: "+63 917 555 0207", companyName: "Marisol Group", source: "MANUAL" as const, status: "NEW" as const, ownerId: manager, createdDaysAgo: 0.12, touched: false, score: 64 },
  ];

  for (const spec of leadSpecs) {
    const { key, createdDaysAgo, touched, ...fields } = spec;
    const createdAt = ago(createdDaysAgo);
    const data = {
      ...fields,
      createdAt,
      scoredAt: new Date(),
      firstTouchedAt: touched ? new Date(createdAt.getTime() + 40 * 60_000) : null,
      lastActivityAt: touched ? ago(Math.max(0, createdDaysAgo - 1)) : null,
    };
    const dedupeKey = `demo-${key}`;
    const existing = await db.lead.findFirst({
      where: { organizationId: org.id, dedupeKey },
      select: { id: true },
    });
    if (existing) {
      await db.lead.update({ where: { id: existing.id }, data });
    } else {
      await db.lead.create({ data: { organizationId: org.id, dedupeKey, ...data } });
    }
  }
  console.log(`  leads: ${leadSpecs.length} across every source and status`);

  // ─────────────────────────── deals ───────────────────────────
  const pipeline = await db.pipeline.findFirstOrThrow({
    where: { organizationId: org.id },
    select: { id: true, stages: { select: { id: true, name: true } } },
  });
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)?.id;

  /*
   * Won and lost deals stretching back a quarter, because several reports say
   * nothing without closed history: the win rate, the lost-reason breakdown,
   * the derived pipeline-coverage multiple, and forecast accuracy all need a
   * population to divide by.
   *
   * The expectedCloseDate values are deliberately not all met — two land on
   * time, several slip, one closes early. A forecast-accuracy report against
   * perfectly-forecast data would show a flat zero and teach nothing.
   */
  const dealSpecs = [
    { title: "Northwind — Q3 retainer", value: 48000, currency: "USD", company: "Northwind Logistics", contact: "dana.reyes@northwind.test", stageName: "Won", ownerId: iris, createdDaysAgo: 78, expectedInDays: -46, closedDaysAgo: 44, lostReason: null },
    // Closed inside the current month on purpose, so Iris reads "ahead" while
    // Dev reads "behind" — a board where every badge says the same word
    // demonstrates nothing about what the badges are for.
    { title: "Lumen Health — brand refresh", value: 62000, currency: "USD", company: "Lumen Health", contact: "priya@lumenhealth.test", stageName: "Won", ownerId: iris, createdDaysAgo: 66, expectedInDays: -36, closedDaysAgo: 4, lostReason: null },
    { title: "Harbour & Co — launch campaign", value: 21000, currency: "USD", company: "Harbour & Co", contact: "grace@harbourco.test", stageName: "Won", ownerId: dev, createdDaysAgo: 52, expectedInDays: -24, closedDaysAgo: 27, lostReason: null },
    { title: "Bright Cotton — paid social", value: 18500, currency: "USD", company: "Bright Cotton", contact: "noel@brightcotton.test", stageName: "Won", ownerId: dev, createdDaysAgo: 40, expectedInDays: -18, closedDaysAgo: 12, lostReason: null },
    { title: "Sable Interiors — website", value: 15000, currency: "USD", company: "Sable Interiors", contact: "amara@sableinteriors.test", stageName: "Lost", ownerId: owner.id, createdDaysAgo: 70, expectedInDays: -40, closedDaysAgo: 33, lostReason: "Went with a competitor" },
    { title: "Vertex Parts — content programme", value: 26000, currency: "USD", company: "Vertex Parts", contact: "s.haddad@vertexparts.test", stageName: "Lost", ownerId: dev, createdDaysAgo: 58, expectedInDays: -30, closedDaysAgo: 21, lostReason: "Budget cut" },
    { title: "Ridgeway — SEO audit", value: 9000, currency: "USD", company: "Harbour & Co", contact: null, stageName: "Lost", ownerId: iris, createdDaysAgo: 48, expectedInDays: -22, closedDaysAgo: 16, lostReason: "Went with a competitor" },
    { title: "Marisol — rebrand", value: 54000, currency: "USD", company: "Lumen Health", contact: null, stageName: "Negotiation", ownerId: iris, createdDaysAgo: 22, expectedInDays: 11, closedDaysAgo: null, lostReason: null },
    { title: "Corepoint — retainer pitch", value: 36000, currency: "USD", company: "Vertex Parts", contact: "s.haddad@vertexparts.test", stageName: "Proposal", ownerId: dev, createdDaysAgo: 14, expectedInDays: 19, closedDaysAgo: null, lostReason: null },
    { title: "Northwind — expansion", value: 30000, currency: "EUR", company: "Northwind Logistics", contact: "ken@northwind.test", stageName: "Qualified", ownerId: manager, createdDaysAgo: 8, expectedInDays: 34, closedDaysAgo: null, lostReason: null },
    { title: "Bright Cotton — Q4 renewal", value: 22000, currency: "USD", company: "Bright Cotton", contact: "noel@brightcotton.test", stageName: "Qualified", ownerId: iris, createdDaysAgo: 5, expectedInDays: 41, closedDaysAgo: null, lostReason: null },
    { title: "Driftbay — discovery", value: 12500, currency: "USD", company: "Sable Interiors", contact: null, stageName: "New", ownerId: dev, createdDaysAgo: 2, expectedInDays: 55, closedDaysAgo: null, lostReason: null },
  ];

  for (const spec of dealSpecs) {
    const { company, contact, stageName, createdDaysAgo, expectedInDays, closedDaysAgo, ...fields } = spec;
    const stageId = stage(stageName);
    if (!stageId) continue;

    const createdAt = ago(createdDaysAgo);
    const data = {
      ...fields,
      stageId,
      pipelineId: pipeline.id,
      companyId: companies[company],
      contactId: contact ? contacts[contact] : null,
      createdAt,
      expectedCloseDate: ahead(expectedInDays),
      closedAt: closedDaysAgo === null ? null : ago(closedDaysAgo),
      stageEnteredAt: ago(Math.max(0, createdDaysAgo - 4)),
    };

    const existing = await db.deal.findFirst({
      where: { organizationId: org.id, title: spec.title },
      select: { id: true },
    });
    if (existing) {
      await db.deal.update({ where: { id: existing.id }, data });
    } else {
      await db.deal.create({ data: { organizationId: org.id, ...data } });
    }
  }
  console.log(`  deals: ${dealSpecs.length} across every stage, with wins, losses and slipped forecasts`);

  // ─────────────────────────── activities ───────────────────────────
  /*
   * Written straight to the table rather than through `logActivity`, because
   * the service stamps `occurredAt` forward-only and refuses to backdate the
   * derived recency — correct for the product, useless for building a quarter
   * of history in one pass.
   *
   * Calls and meetings carry an outcome, which is what makes the KPI columns
   * mean anything: MEETINGS_HELD counts HELD and ignores NO_SHOW, so a demo
   * with only held meetings would hide the distinction the metric exists for.
   */
  const activitySpecs = [
    { type: "CALL" as const, subject: "Intro call", contact: "dana.reyes@northwind.test", userId: iris, daysAgo: 62, outcome: "CONNECTED" as const, durationMinutes: 24 },
    { type: "MEETING" as const, subject: "Scoping workshop", contact: "dana.reyes@northwind.test", userId: iris, daysAgo: 55, outcome: "HELD" as const, durationMinutes: 60 },
    { type: "EMAIL" as const, subject: "Proposal sent", contact: "dana.reyes@northwind.test", userId: iris, daysAgo: 48, outcome: null, durationMinutes: null },
    { type: "CALL" as const, subject: "Chased proposal", contact: "priya@lumenhealth.test", userId: iris, daysAgo: 40, outcome: "NO_ANSWER" as const, durationMinutes: 1 },
    { type: "CALL" as const, subject: "Follow-up", contact: "priya@lumenhealth.test", userId: iris, daysAgo: 38, outcome: "LEFT_MESSAGE" as const, durationMinutes: 2 },
    { type: "MEETING" as const, subject: "Brand review", contact: "priya@lumenhealth.test", userId: iris, daysAgo: 33, outcome: "HELD" as const, durationMinutes: 45 },
    { type: "MEETING" as const, subject: "Kickoff", contact: "s.haddad@vertexparts.test", userId: dev, daysAgo: 30, outcome: "NO_SHOW" as const, durationMinutes: 0 },
    { type: "MEETING" as const, subject: "Kickoff, retry", contact: "s.haddad@vertexparts.test", userId: dev, daysAgo: 28, outcome: "HELD" as const, durationMinutes: 40 },
    { type: "CALL" as const, subject: "Pricing questions", contact: "grace@harbourco.test", userId: dev, daysAgo: 24, outcome: "CONNECTED" as const, durationMinutes: 18 },
    { type: "NOTE" as const, subject: "Budget confirmed for Q4", contact: "grace@harbourco.test", userId: dev, daysAgo: 22, outcome: null, durationMinutes: null },
    { type: "CALL" as const, subject: "Renewal check-in", contact: "noel@brightcotton.test", userId: iris, daysAgo: 12, outcome: "CONNECTED" as const, durationMinutes: 31 },
    { type: "MEETING" as const, subject: "Q4 planning", contact: "noel@brightcotton.test", userId: iris, daysAgo: 6, outcome: "HELD" as const, durationMinutes: 55 },
    { type: "CALL" as const, subject: "Cold outreach", contact: "amara@sableinteriors.test", userId: dev, daysAgo: 4, outcome: "NO_ANSWER" as const, durationMinutes: 1 },
    { type: "EMAIL" as const, subject: "Sent case study", contact: "amara@sableinteriors.test", userId: dev, daysAgo: 3, outcome: null, durationMinutes: null },
    { type: "CALL" as const, subject: "Discovery", contact: "ken@northwind.test", userId: manager, daysAgo: 2, outcome: "CONNECTED" as const, durationMinutes: 27 },
    { type: "MEETING" as const, subject: "Requirements", contact: "ken@northwind.test", userId: manager, daysAgo: 1, outcome: "HELD" as const, durationMinutes: 50 },
  ];

  for (const spec of activitySpecs) {
    const { contact, daysAgo, ...fields } = spec;
    const contactId = contacts[contact];
    const occurredAt = ago(daysAgo);
    const existing = await db.activity.findFirst({
      where: { organizationId: org.id, contactId, subject: spec.subject },
      select: { id: true },
    });
    const data = { ...fields, contactId, occurredAt, createdAt: occurredAt };
    if (existing) {
      await db.activity.update({ where: { id: existing.id }, data });
    } else {
      await db.activity.create({ data: { organizationId: org.id, ...data } });
    }
  }

  // The derived recency column, brought in line with what was just written —
  // it is what "no contact in 30 days" filters on.
  for (const email of Object.keys(contacts)) {
    const latest = await db.activity.findFirst({
      where: { organizationId: org.id, contactId: contacts[email] },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    await db.contact.update({
      where: { id: contacts[email] },
      data: { lastActivityAt: latest?.occurredAt ?? null },
    });
  }
  console.log(`  activities: ${activitySpecs.length} with call outcomes, durations and a no-show`);

  // ─────────────────────────── tasks ───────────────────────────
  // One overdue, one due today, one ahead, one done — so the badge in the nav
  // has a number and the list shows every state.
  const taskSpecs = [
    { title: "Send Northwind the Q4 scope", dueAt: ago(2), assigneeId: iris, contact: "dana.reyes@northwind.test", completedAt: null },
    { title: "Call Samir about pricing", dueAt: ago(0.2), assigneeId: dev, contact: "s.haddad@vertexparts.test", completedAt: null },
    { title: "Prep Marisol rebrand deck", dueAt: ahead(3), assigneeId: iris, contact: "priya@lumenhealth.test", completedAt: null },
    { title: "Confirm Harbour invoice", dueAt: ahead(9), assigneeId: manager, contact: "grace@harbourco.test", completedAt: null },
    { title: "Chase Bright Cotton renewal", dueAt: ago(6), assigneeId: iris, contact: "noel@brightcotton.test", completedAt: ago(5) },
  ];
  for (const spec of taskSpecs) {
    const { contact, ...fields } = spec;
    const data = { ...fields, contactId: contacts[contact] };
    const existing = await db.task.findFirst({
      where: { organizationId: org.id, title: spec.title },
      select: { id: true },
    });
    if (existing) {
      await db.task.update({ where: { id: existing.id }, data });
    } else {
      await db.task.create({ data: { organizationId: org.id, ...data } });
    }
  }
  console.log(`  tasks: ${taskSpecs.length}, including one overdue and one done`);

  // ─────────────────────────── segments ───────────────────────────
  const segmentSpecs = [
    { name: "Hot inbound leads", entity: "LEAD" as const, shared: true, filter: { status: ["NEW", "WORKING"], scoreMin: 60 } },
    { name: "Stale, nobody touched", entity: "LEAD" as const, shared: true, filter: { noActivityForDays: 21 } },
    { name: "Enterprise contacts", entity: "CONTACT" as const, shared: true, filter: { tagIds: [tags.Enterprise] } },
    { name: "My accounts", entity: "COMPANY" as const, shared: false, filter: { ownerId: iris } },
  ];
  for (const spec of segmentSpecs) {
    const existing = await db.segment.findFirst({
      where: { organizationId: org.id, entity: spec.entity, name: spec.name },
      select: { id: true },
    });
    const data = { ...spec, ownerId: owner.id };
    if (existing) {
      await db.segment.update({ where: { id: existing.id }, data });
    } else {
      await db.segment.create({ data: { organizationId: org.id, ...data } });
    }
  }
  console.log(`  segments: ${segmentSpecs.length} saved views`);

  // ─────────────────────────── prospect list ───────────────────────────
  const list = await (async () => {
    const existing = await db.prospectList.findFirst({
      where: { organizationId: org.id, name: "Q4 agency prospects" },
      select: { id: true },
    });
    if (existing) return existing;
    return db.prospectList.create({
      data: {
        organizationId: org.id,
        name: "Q4 agency prospects",
        description: "Mid-market brands with in-house marketing, built from the hot-inbound segment.",
        ownerId: owner.id,
      },
      select: { id: true },
    });
  })();

  for (const email of ["amara@sableinteriors.test", "grace@harbourco.test", "noel@brightcotton.test"]) {
    const contactId = contacts[email];
    const existing = await db.prospectListMember.findFirst({
      where: { organizationId: org.id, listId: list.id, contactId },
      select: { id: true },
    });
    if (!existing) {
      await db.prospectListMember.create({
        data: { organizationId: org.id, listId: list.id, contactId, leadId: null },
      });
    }
  }

  // ─────────────────────────── templates ───────────────────────────
  const template = await (async () => {
    const existing = await db.emailTemplate.findFirst({
      where: { organizationId: org.id, name: "Agency intro" },
      select: { id: true },
    });
    const data = {
      subject: "A quick thought on {{company}}'s campaigns",
      body:
        "Hi {{first_name}},\n\n" +
        "I had a look at what {{company}} is running at the moment and spotted two things " +
        "we could probably tighten up without touching your budget.\n\n" +
        "Worth fifteen minutes next week?\n\nBest,\nMaya",
    };
    if (existing) {
      return db.emailTemplate.update({ where: { id: existing.id }, data, select: { id: true } });
    }
    return db.emailTemplate.create({
      data: { organizationId: org.id, name: "Agency intro", ...data },
      select: { id: true },
    });
  })();

  // A variant, so the A/B machinery has two arms to assign between.
  const variantB = {
    subject: "{{company}} — two quick wins",
    body:
      "Hi {{first_name}},\n\nTwo things I would change about {{company}}'s current campaigns, " +
      "both cheap:\n\n1. \n2. \n\nHappy to send the detail over email if a call is not useful.\n\nMaya",
  };
  const existingVariant = await db.templateVariant.findFirst({
    where: { templateId: template.id, label: "B" },
    select: { id: true },
  });
  if (existingVariant) {
    await db.templateVariant.update({ where: { id: existingVariant.id }, data: variantB });
  } else {
    await db.templateVariant.create({
      data: { organizationId: org.id, templateId: template.id, label: "B", ...variantB },
    });
  }
  console.log("  templates: 1 with an A/B variant");

  // ─────────────────────────── campaign ───────────────────────────
  const campaign = await (async () => {
    const existing = await db.campaign.findFirst({
      where: { organizationId: org.id, name: "Q4 agency outreach" },
      select: { id: true },
    });
    const data = {
      goal: "Book 12 intro calls with mid-market brands",
      status: "ACTIVE" as const,
      ownerId: owner.id,
      listId: list.id,
      startedAt: ago(9),
    };
    if (existing) {
      return db.campaign.update({ where: { id: existing.id }, data, select: { id: true } });
    }
    return db.campaign.create({
      data: { organizationId: org.id, name: "Q4 agency outreach", ...data },
      select: { id: true },
    });
  })();

  const stepSpecs = [
    { position: 1, delayMinutes: 0, templateId: template.id, instruction: "Send the intro email." },
    { position: 2, delayMinutes: 3 * 24 * 60, templateId: null, instruction: "If no reply, connect on LinkedIn." },
    { position: 3, delayMinutes: 4 * 24 * 60, templateId: template.id, instruction: "Send the second angle, then stop." },
  ];
  for (const spec of stepSpecs) {
    const existing = await db.sequenceStep.findFirst({
      where: { campaignId: campaign.id, position: spec.position },
      select: { id: true },
    });
    if (existing) {
      await db.sequenceStep.update({ where: { id: existing.id }, data: spec });
    } else {
      await db.sequenceStep.create({
        data: { organizationId: org.id, campaignId: campaign.id, ...spec },
      });
    }
  }

  // Enrollments in three different states, so the table is not one row
  // repeated: one mid-sequence and due, one finished, one stopped on a reply.
  const enrollmentSpecs = [
    { contact: "amara@sableinteriors.test", state: "ACTIVE" as const, currentPosition: 1, nextDueAt: ahead(0.3), variantLabel: "A", stoppedReason: null, completedAt: null },
    { contact: "grace@harbourco.test", state: "COMPLETED" as const, currentPosition: 3, nextDueAt: null, variantLabel: "B", stoppedReason: null, completedAt: ago(2) },
    { contact: "noel@brightcotton.test", state: "STOPPED" as const, currentPosition: 2, nextDueAt: null, variantLabel: "A", stoppedReason: "Replied — booked a call", completedAt: null },
  ];
  for (const spec of enrollmentSpecs) {
    const { contact, ...fields } = spec;
    const contactId = contacts[contact];
    const existing = await db.enrollment.findFirst({
      where: { organizationId: org.id, campaignId: campaign.id, contactId },
      select: { id: true },
    });
    if (existing) {
      await db.enrollment.update({ where: { id: existing.id }, data: fields });
    } else {
      await db.enrollment.create({
        data: { organizationId: org.id, campaignId: campaign.id, contactId, leadId: null, ...fields },
      });
    }
  }
  console.log(`  campaign: 3 steps, 3 enrollments in different states`);

  // ─────────────────────────── suppression ───────────────────────────
  const suppressed = [
    { email: "no-thanks@ridgeway.test", reason: "UNSUBSCRIBED" as const, note: "Asked to be removed after the September send." },
    { email: "bounced@quietfox.test", reason: "BOUNCED" as const, note: null },
    { email: "legal@marisol.test", reason: "COMPLAINED" as const, note: "Marked as spam — do not re-add." },
    { email: "competitor@brightspark.test", reason: "MANUAL" as const, note: "Competitor." },
  ];
  for (const spec of suppressed) {
    await db.suppression.upsert({
      where: { organizationId_email: { organizationId: org.id, email: spec.email } },
      update: { reason: spec.reason, note: spec.note },
      create: { organizationId: org.id, createdById: owner.id, ...spec },
    });
  }
  console.log(`  do-not-contact: ${suppressed.length} addresses, every reason represented`);

  // ─────────────────────────── scoring rules ───────────────────────────
  // A document that differs from the defaults, so the settings screen shows a
  // configured workspace rather than the fallback.
  await db.organization.update({
    where: { id: org.id },
    data: {
      scoringRules: {
        base: 10,
        sourceWeights: { FACEBOOK_LEAD_ADS: 22, FACEBOOK_MESSENGER: 12, FACEBOOK_COMMENT: 6, EMAIL: 14, CSV_IMPORT: 4, WEB_FORM: 24, MANUAL: 10 },
        hasEmail: 16,
        hasPhone: 14,
        hasCompanyName: 10,
        statusWeights: { NEW: 10, WORKING: 16, QUALIFIED: 28, CONVERTED: 0, JUNK: -100 },
        recency: { freshHours: 24, freshPoints: 15, staleDays: 30, stalePenalty: -20 },
      },
    },
  });

  // ─────────────────────────── targets ───────────────────────────
  /*
   * Set for the month AND the quarter, per rep and for the team, so the
   * attainment table has both an outcome and an activity column on every row.
   * A demo with only revenue quotas would hide the whole point of the layout.
   *
   * Numbers are chosen so the pace readings differ from each other — one rep
   * ahead, one behind — because a screen where every badge says the same thing
   * shows nothing about what the badges mean.
   */
  const timeZone = "Asia/Manila";
  const month = periodBounds("MONTH", new Date(), timeZone).start;
  const quarter = periodBounds("QUARTER", new Date(), timeZone).start;

  const targetSpecs = [
    { userId: null, metric: "REVENUE_WON" as const, period: "MONTH" as const, periodStart: month, value: 120000, currency: "USD" },
    { userId: null, metric: "REVENUE_WON" as const, period: "QUARTER" as const, periodStart: quarter, value: 360000, currency: "USD" },
    { userId: iris, metric: "REVENUE_WON" as const, period: "MONTH" as const, periodStart: month, value: 55000, currency: "USD" },
    { userId: iris, metric: "DEALS_WON" as const, period: "MONTH" as const, periodStart: month, value: 3, currency: null },
    { userId: iris, metric: "CALLS_LOGGED" as const, period: "MONTH" as const, periodStart: month, value: 40, currency: null },
    { userId: iris, metric: "MEETINGS_HELD" as const, period: "MONTH" as const, periodStart: month, value: 8, currency: null },
    { userId: dev, metric: "REVENUE_WON" as const, period: "MONTH" as const, periodStart: month, value: 45000, currency: "USD" },
    { userId: dev, metric: "DEALS_WON" as const, period: "MONTH" as const, periodStart: month, value: 3, currency: null },
    { userId: dev, metric: "CALLS_LOGGED" as const, period: "MONTH" as const, periodStart: month, value: 60, currency: null },
    { userId: dev, metric: "MEETINGS_HELD" as const, period: "MONTH" as const, periodStart: month, value: 10, currency: null },
    { userId: manager, metric: "FIRST_TOUCHES" as const, period: "MONTH" as const, periodStart: month, value: 25, currency: null },
  ];

  for (const spec of targetSpecs) {
    // Find-then-write rather than `upsert`: Prisma types `userId` as non-null
    // inside the compound unique input, so the team-wide row (userId null)
    // cannot be addressed through `upsert` at all. `setTarget` in the service
    // works around it the same way.
    const existing = await db.target.findFirst({
      where: {
        organizationId: org.id,
        userId: spec.userId,
        metric: spec.metric,
        period: spec.period,
        periodStart: spec.periodStart,
      },
      select: { id: true },
    });
    if (existing) {
      await db.target.update({
        where: { id: existing.id },
        data: { value: spec.value, currency: spec.currency },
      });
    } else {
      await db.target.create({
        data: { organizationId: org.id, createdById: owner.id, ...spec },
      });
    }
  }
  console.log(`  targets: ${targetSpecs.length} across people, metrics and both period lengths`);

  // ─────────────────────────── notifications ───────────────────────────
  const notificationSpecs = [
    { type: "LEAD_ASSIGNED" as const, title: "Rosa Delgado assigned to you", body: "Facebook lead ad · Fernvale Studio", userId: owner.id, readAt: null, daysAgo: 0.05 },
    { type: "LEAD_UNWORKED" as const, title: "2 leads past the first-touch target", body: "Nobody has contacted them yet.", userId: owner.id, readAt: null, daysAgo: 0.3 },
    { type: "CONNECTION_UNHEALTHY" as const, title: "Facebook connection needs re-authorising", body: "The page token expired.", userId: owner.id, readAt: null, daysAgo: 1 },
    { type: "INGESTION_DEAD_LETTERED" as const, title: "A lead failed to import", body: "One payload could not be normalised after 3 attempts.", userId: owner.id, readAt: ago(2), daysAgo: 2.5 },
  ];
  for (const spec of notificationSpecs) {
    const { daysAgo, ...fields } = spec;
    const existing = await db.notification.findFirst({
      where: { organizationId: org.id, title: spec.title },
      select: { id: true },
    });
    const data = { ...fields, createdAt: ago(daysAgo) };
    if (existing) {
      await db.notification.update({ where: { id: existing.id }, data });
    } else {
      await db.notification.create({ data: { organizationId: org.id, ...data } });
    }
  }
  console.log(`  notifications: ${notificationSpecs.length}, three unread`);

  console.log("\nAcme is populated. Sign in to see it:");
  console.log("  owner@acme.test    / password123456   (owner — sees everything)");
  console.log("  tom@acme.test      / password123456   (manager — sets targets)");
  console.log("  iris@acme.test     / password123456   (rep — own records only)");
  console.log("  auditor@acme.test  / password123456   (read-only — sees all, changes nothing)");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
