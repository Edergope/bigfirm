import { beforeEach, describe, expect, it } from "vitest";
import { isIusiaError } from "@iusia/domain";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * IDEMPOTENCIA DEL CREDIT LEDGER.
 *
 * Los Workflows y las Queues reintentan. Un reintento nunca puede cobrar dos veces:
 * la clave de idempotencia por execution_id garantiza exactamente-una-vez.
 */
describe("Credit Ledger idempotente contra SQL real", () => {
  let t: TestDb;
  let org: string;

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma C", directorEmail: "c@c.test" });
    org = seed.organizationId;
    await t.credits.ensureWallet(org, 1000);
  });

  it("un consumo repetido con la misma clave no debita dos veces", async () => {
    const key = "execution:exe_repetida";
    const first = await t.credits.post({
      organizationId: org,
      kind: "CONSUMPTION",
      amount: -100,
      idempotencyKey: key,
      allowNegative: true,
    });
    expect(first.applied).toBe(true);
    expect(first.balance).toBe(900);

    // Reintento del mismo trabajo: mismo idempotencyKey.
    const retry = await t.credits.post({
      organizationId: org,
      kind: "CONSUMPTION",
      amount: -100,
      idempotencyKey: key,
      allowNegative: true,
    });
    expect(retry.applied).toBe(false);
    expect(retry.balance).toBe(900);
    expect(await t.credits.balance(org)).toBe(900);
  });

  it("rechaza un débito que dejaría el saldo negativo sin allowNegative", async () => {
    await expect(
      t.credits.post({
        organizationId: org,
        kind: "CONSUMPTION",
        amount: -5000,
        idempotencyKey: "execution:sin_saldo",
      }),
    ).rejects.toSatisfy((e: unknown) => isIusiaError(e) && e.code === "INSUFFICIENT_CREDITS");
  });

  it("mantiene un balance consistente ante múltiples transacciones", async () => {
    await t.credits.post({ organizationId: org, kind: "GRANT", amount: 500, idempotencyKey: "g1" });
    await t.credits.post({ organizationId: org, kind: "CONSUMPTION", amount: -200, idempotencyKey: "c1", allowNegative: true });
    await t.credits.post({ organizationId: org, kind: "CONSUMPTION", amount: -50, idempotencyKey: "c2", allowNegative: true });
    expect(await t.credits.balance(org)).toBe(1000 + 500 - 200 - 50);
  });
});
