import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { processLeadgenEvent } from "@/server/integrations/facebook/process";
import {
  listNotifications,
  markAllRead,
  markRead,
  notify,
  notifyAdmins,
  unreadCount,
} from "@/server/services/notifications";
import { ingestLead, recordIngestionEvent } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

describe("notification dedupe", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    org = await makeOrg();
  });
  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  const base = {
    type: "CONNECTION_UNHEALTHY" as const,
    title: "Reconnect required",
    dedupeKey: "connection-unhealthy:abc",
  };

  it("creates the first alert", async () => {
    const id = await notify({ ...base, organizationId: org.org.id, userId: org.user.id });
    expect(id).not.toBeNull();
  });

  it("suppresses a repeat while the first is still unread", async () => {
    const id = await notify({ ...base, organizationId: org.org.id, userId: org.user.id });
    expect(id).toBeNull();

    expect(await unreadCount(org.ctx)).toBe(1);
  });

  it("re-arms once the alert is acknowledged", async () => {
    await markAllRead(org.ctx);

    const id = await notify({ ...base, organizationId: org.org.id, userId: org.user.id });
    expect(id).not.toBeNull();
    expect(await unreadCount(org.ctx)).toBe(1);
  });

  it("does not dedupe notifications that carry no key", async () => {
    const a = await notify({
      organizationId: org.org.id,
      userId: org.user.id,
      type: "LEAD_ASSIGNED",
      title: "New lead: one",
    });
    const b = await notify({
      organizationId: org.org.id,
      userId: org.user.id,
      type: "LEAD_ASSIGNED",
      title: "New lead: two",
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});

describe("admin fan-out", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    org = await makeOrg(); // owner
    await db.user.createMany({
      data: [
        {
          organizationId: org.org.id,
          email: "admin@test.local",
          role: "ADMIN",
          passwordHash: "x",
        },
        { organizationId: org.org.id, email: "rep@test.local", role: "REP", passwordHash: "x" },
      ],
    });
  });
  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("reaches owners and admins but not reps", async () => {
    const sent = await notifyAdmins({
      organizationId: org.org.id,
      type: "INGESTION_DEAD_LETTERED",
      title: "A lead could not be imported",
    });

    expect(sent).toBe(2); // owner + admin

    const rep = await db.user.findFirstOrThrow({ where: { email: "rep@test.local" } });
    const repNotifications = await db.notification.count({ where: { userId: rep.id } });
    // A rep cannot reconnect an OAuth token, so telling them is pure noise.
    expect(repNotifications).toBe(0);
  });
});

describe("notifications from real events", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let connectionId: string;

  beforeAll(async () => {
    org = await makeOrg();
    const connection = await db.connection.create({
      data: {
        organizationId: org.org.id,
        provider: "FACEBOOK",
        externalAccountId: `page-notif-${org.org.id}`,
        displayName: "Acme Page",
        encryptedTokens: encryptSecret("token"),
        scopes: ["leads_retrieval"],
      },
    });
    connectionId = connection.id;
  });
  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("tells the assigned owner when a lead arrives", async () => {
    const outcome = await ingestLead({
      organizationId: org.org.id,
      provider: "GOOGLE",
      source: "EMAIL",
      externalId: "notif-1",
      rawPayload: {},
      normalized: {
        firstName: "Dana",
        lastName: "Reyes",
        email: "dana@northwind.test",
        companyName: "Northwind",
      },
    });
    expect(outcome.kind).toBe("created");

    const notification = await db.notification.findFirstOrThrow({
      where: { organizationId: org.org.id, type: "LEAD_ASSIGNED" },
    });
    expect(notification.userId).toBe(org.user.id);
    expect(notification.title).toBe("New lead: Dana Reyes");
    expect(notification.body).toContain("Northwind");
    expect(notification.entityId).toBe(outcome.leadId);
  });

  it("does not create an alert without a lead, or a lead without an alert", async () => {
    const leads = await db.lead.count({ where: { organizationId: org.org.id } });
    const alerts = await db.notification.count({
      where: { organizationId: org.org.id, type: "LEAD_ASSIGNED" },
    });
    expect(alerts).toBe(leads);
  });

  it("tells admins when a connection needs reconnecting", async () => {
    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "notif-dead-token",
      rawPayload: {},
      connectionId,
    });
    if (recorded.kind !== "recorded") throw new Error("expected a new event");

    const deadToken = async () =>
      new Response(JSON.stringify({ error: { message: "bad token", code: 190 } }), { status: 400 });
    await processLeadgenEvent(recorded.eventId, deadToken);

    const notification = await db.notification.findFirstOrThrow({
      where: { organizationId: org.org.id, type: "CONNECTION_UNHEALTHY" },
    });
    expect(notification.title).toBe("Acme Page needs reconnecting");
    expect(notification.entityId).toBe(connectionId);
  });

  it("stays quiet for a transient failure the sweeper will retry", async () => {
    const before = await db.notification.count({
      where: { organizationId: org.org.id, type: "CONNECTION_UNHEALTHY" },
    });

    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "notif-transient",
      rawPayload: {},
      connectionId,
    });
    if (recorded.kind !== "recorded") throw new Error("expected a new event");

    const serverError = async () => new Response("upstream boom", { status: 503 });
    await processLeadgenEvent(recorded.eventId, serverError);

    const after = await db.notification.count({
      where: { organizationId: org.org.id, type: "CONNECTION_UNHEALTHY" },
    });
    // A 503 is retryable. Waking someone for it trains them to ignore the bell.
    expect(after).toBe(before);
  });

  it("tells admins when an import is finally abandoned", async () => {
    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "notif-giveup",
      rawPayload: {},
      connectionId,
    });
    if (recorded.kind !== "recorded") throw new Error("expected a new event");

    const deadToken = async () =>
      new Response(JSON.stringify({ error: { message: "bad token", code: 190 } }), { status: 400 });
    await processLeadgenEvent(recorded.eventId, deadToken);

    const notification = await db.notification.findFirst({
      where: { organizationId: org.org.id, type: "INGESTION_DEAD_LETTERED" },
    });
    expect(notification).not.toBeNull();
    expect(notification?.body).toContain("90 days");
  });
});

describe("reading notifications", () => {
  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;
  let colleagueId: string;
  let colleagueNotificationId: string;

  beforeAll(async () => {
    a = await makeOrg();
    b = await makeOrg();

    const colleague = await db.user.create({
      data: {
        organizationId: a.org.id,
        email: "colleague@test.local",
        role: "REP",
        passwordHash: "x",
      },
    });
    colleagueId = colleague.id;

    const id = await notify({
      organizationId: a.org.id,
      userId: colleagueId,
      type: "LEAD_ASSIGNED",
      title: "Colleague's private lead",
    });
    colleagueNotificationId = id!;

    await notify({
      organizationId: a.org.id,
      userId: a.user.id,
      type: "LEAD_ASSIGNED",
      title: "My own lead",
    });
  });

  afterAll(async () => {
    await dropOrg(a.org.id);
    await dropOrg(b.org.id);
  });

  it("shows only the caller's own notifications, not a colleague's", async () => {
    const mine = await listNotifications(a.ctx);
    expect(mine.map((n) => n.title)).toEqual(["My own lead"]);
    expect(await unreadCount(a.ctx)).toBe(1);
  });

  it("cannot mark a colleague's notification read", async () => {
    const result = await markRead(a.ctx, colleagueNotificationId);
    expect(result.ok).toBe(false);

    const untouched = await db.notification.findUniqueOrThrow({
      where: { id: colleagueNotificationId },
    });
    expect(untouched.readAt).toBeNull();
  });

  it("mark-all-read does not reach a colleague's notifications", async () => {
    await markAllRead(a.ctx);

    const colleague = await db.notification.findUniqueOrThrow({
      where: { id: colleagueNotificationId },
    });
    expect(colleague.readAt).toBeNull();
  });

  it("cannot read across a tenant boundary", async () => {
    expect(await listNotifications(b.ctx)).toHaveLength(0);
    expect(await unreadCount(b.ctx)).toBe(0);

    const result = await markRead(b.ctx, colleagueNotificationId);
    expect(result.ok).toBe(false);
  });
});
