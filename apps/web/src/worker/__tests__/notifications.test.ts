import { describe, expect, it, vi } from "vitest";
import { NotificationService } from "../services/notifications.js";
import {
  FakeNotificationProvider,
  ResendNotificationProvider,
} from "../integrations/notifications.js";

/**
 * NotificationService: envío exitoso, no configurado, fallo del proveedor,
 * normalización de errores, metadata/correlación y aislamiento por firma/matter.
 */
describe("NotificationService con proveedor fake", () => {
  const req = {
    firm_id: "org_1",
    matter_id: "mtr_1",
    recipient: "abogado@firma.test",
    event: "EXECUTION_COMPLETED" as const,
    execution_id: "exe_9",
    correlation_id: "wf_9",
    payload: { matter_reference: "IUS-2026-001", completed: 3, failed: 0 },
  };

  it("envía y devuelve el contrato canónico con estado SENT", async () => {
    const fake = new FakeNotificationProvider();
    const svc = new NotificationService(fake);
    const n = await svc.notify(req);
    expect(n.status).toBe("SENT");
    expect(n.provider).toBe("fake");
    expect(n.provider_message_id).toBe("fake_1");
    expect(n.subject).toContain("IUS-2026-001");
    expect(n.firm_id).toBe("org_1");
    expect(n.matter_id).toBe("mtr_1");
    expect(n.execution_id).toBe("exe_9");
    expect(n.correlation_id).toBe("wf_9");
  });

  it("propaga firma/matter/execution como tags de correlación (aislamiento)", async () => {
    const fake = new FakeNotificationProvider();
    await new NotificationService(fake).notify(req);
    expect(fake.sent[0]?.tags).toMatchObject({
      firm_id: "org_1",
      matter_id: "mtr_1",
      execution_id: "exe_9",
      event: "EXECUTION_COMPLETED",
    });
  });

  it("proveedor no configurado devuelve NOT_CONFIGURED sin lanzar", async () => {
    const fake = new FakeNotificationProvider({ configured: false });
    const svc = new NotificationService(fake);
    expect(svc.isConfigured()).toBe(false);
    const n = await svc.notify(req);
    expect(n.status).toBe("NOT_CONFIGURED");
    expect(fake.sent).toHaveLength(0);
  });

  it("un fallo del proveedor se refleja como FAILED con error", async () => {
    const fake = new FakeNotificationProvider({
      fail: { status: "FAILED", failure_kind: "http_5xx", error: "HTTP 503" },
    });
    const n = await new NotificationService(fake).notify(req);
    expect(n.status).toBe("FAILED");
    expect(n.error).toBe("HTTP 503");
  });
});

describe("ResendNotificationProvider (adapter, sin SDK)", () => {
  const cfg = (over = {}) => ({
    apiKey: "re_test",
    from: "IUSIA <n@iusia.legal>",
    ...over,
  });

  it("NOT_CONFIGURED cuando falta la API key", async () => {
    const p = new ResendNotificationProvider(cfg({ apiKey: null }));
    expect(p.status()).toBe("NOT_CONFIGURED");
    const r = await p.send({ to: "a@b.co", subject: "s", text: "t", tags: {} });
    expect(r.status).toBe("NOT_CONFIGURED");
  });

  it("rechaza destinatarios inválidos sin llamar a la red", async () => {
    const fetchImpl = vi.fn();
    const p = new ResendNotificationProvider(cfg({ fetchImpl }));
    const r = await p.send({ to: "no-es-email", subject: "s", text: "t", tags: {} });
    expect(r.status).toBe("FAILED");
    expect(r.failure_kind).toBe("invalid_recipient");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("envía y devuelve provider_message_id en éxito", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "resend_123" }), { status: 200 }),
    );
    const p = new ResendNotificationProvider(cfg({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    const r = await p.send({ to: "a@b.co", subject: "s", text: "t", tags: { firm_id: "org_1" } });
    expect(r.status).toBe("SENT");
    expect(r.provider_message_id).toBe("resend_123");
  });

  it("normaliza un 4xx del proveedor como FAILED http_4xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad", { status: 422 }));
    const p = new ResendNotificationProvider(cfg({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    const r = await p.send({ to: "a@b.co", subject: "s", text: "t", tags: {} });
    expect(r.status).toBe("FAILED");
    expect(r.failure_kind).toBe("http_4xx");
  });
});
