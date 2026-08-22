import { beforeEach, describe, expect, it } from "vitest";
import { NotificationService } from "../services/notifications.js";
import { FakeNotificationProvider } from "../integrations/notifications.js";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * Notification Ledger: trazabilidad persistente de todo envío, incluso cuando el
 * proveedor está NOT_CONFIGURED o falla. Aislado por organización.
 */
describe("Notification Ledger", () => {
  let t: TestDb;
  let org: string;

  const baseReq = (over: Record<string, unknown> = {}) => ({
    firm_id: org,
    matter_id: "mtr_1",
    recipient: "abogado@firma.test",
    event: "EXECUTION_COMPLETED" as const,
    execution_id: "exe_9",
    correlation_id: "wf_9",
    payload: { matter_reference: "IUS-2026-001" },
    ...over,
  });

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma N", directorEmail: "n@n.test" });
    org = seed.organizationId;
  });

  it("registra un envío SENT con provider_message_id y timestamps", async () => {
    const svc = new NotificationService(new FakeNotificationProvider(), t.notifications);
    const n = await svc.notify(baseReq());
    const row = await t.notifications.findById(org, n.notification_id);
    expect(row?.status).toBe("SENT");
    expect(row?.providerMessageId).toBe("fake_1");
    expect(row?.attemptedAt).not.toBeNull();
    expect(row?.sentAt).not.toBeNull();
    expect(row?.executionId).toBe("exe_9");
    expect(row?.correlationId).toBe("wf_9");
  });

  it("registra NOT_CONFIGURED cuando el proveedor no está configurado", async () => {
    const svc = new NotificationService(
      new FakeNotificationProvider({ configured: false }),
      t.notifications,
    );
    const n = await svc.notify(baseReq());
    const row = await t.notifications.findById(org, n.notification_id);
    expect(row?.status).toBe("NOT_CONFIGURED");
    expect(row?.sentAt).toBeNull();
  });

  it("registra FAILED con el error normalizado", async () => {
    const svc = new NotificationService(
      new FakeNotificationProvider({ fail: { status: "FAILED", error: "HTTP 500" } }),
      t.notifications,
    );
    const n = await svc.notify(baseReq());
    const row = await t.notifications.findById(org, n.notification_id);
    expect(row?.status).toBe("FAILED");
    expect(row?.normalizedError).toBe("HTTP 500");
    expect(row?.sentAt).toBeNull();
  });

  it("aísla por organización: otra firma no ve la notificación", async () => {
    const svc = new NotificationService(new FakeNotificationProvider(), t.notifications);
    const n = await svc.notify(baseReq());
    expect(await t.notifications.findById("org_ajena", n.notification_id)).toBeNull();
    expect(await t.notifications.findById(org, n.notification_id)).not.toBeNull();
  });

  it("lista las notificaciones de un matter", async () => {
    const svc = new NotificationService(new FakeNotificationProvider(), t.notifications);
    await svc.notify(baseReq());
    await svc.notify(baseReq({ event: "EXECUTION_FAILED" }));
    const rows = await t.notifications.listForMatter(org, "mtr_1");
    expect(rows).toHaveLength(2);
  });

  it("recordPending es idempotente por id (no duplica)", async () => {
    const input = {
      id: "evt_dup",
      organizationId: org,
      matterId: "mtr_1",
      executionId: null,
      recipient: "a@b.co",
      channel: "EMAIL",
      event: "TASK_ASSIGNED",
      subject: "s",
      provider: "fake",
      correlationId: null,
    };
    await t.notifications.recordPending(input);
    await t.notifications.recordPending(input);
    const rows = await t.notifications.listForMatter(org, "mtr_1");
    expect(rows.filter((r) => r.id === "evt_dup")).toHaveLength(1);
  });
});
