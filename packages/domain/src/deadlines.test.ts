import { describe, expect, it } from "vitest";
import { calculateDeadline, DeadlineCalculationInput } from "./deadlines.js";

describe("cálculo jurídico de términos", () => {
  it("cuenta días calendario incluyendo fines de semana", () => {
    const r = calculateDeadline({
      rule: "Regla X",
      source: "Fuente X",
      start_date: "2026-08-21", // viernes
      term_length: 3,
      day_kind: "CALENDAR",
      holidays: [],
    });
    expect(r.due_date).toBe("2026-08-24"); // +3 calendario
    expect(r.skipped_days).toBe(0);
  });

  it("cuenta días hábiles saltando fines de semana", () => {
    const r = calculateDeadline({
      rule: "CGP art. 118",
      source: "Código General del Proceso",
      start_date: "2026-08-21", // viernes
      term_length: 3,
      day_kind: "BUSINESS",
      holidays: [],
    });
    // vie→ salta sáb/dom → lun(1), mar(2), mié(3)
    expect(r.due_date).toBe("2026-08-26");
    expect(r.skipped_days).toBeGreaterThanOrEqual(2);
  });

  it("excluye festivos en el cómputo hábil", () => {
    const r = calculateDeadline({
      rule: "Regla",
      source: "Fuente",
      start_date: "2026-08-21",
      term_length: 3,
      day_kind: "BUSINESS",
      holidays: ["2026-08-24"], // lunes festivo
    });
    // salta sáb/dom + lun festivo → mar(1), mié(2), jue(3)
    expect(r.due_date).toBe("2026-08-27");
  });

  it("nunca se auto-marca como validado por humano", () => {
    const r = calculateDeadline({
      rule: "R",
      source: "S",
      start_date: "2026-01-01",
      term_length: 1,
      day_kind: "CALENDAR",
      holidays: [],
    });
    expect(r.validation_status).toBe("CALCULATED");
  });

  it("rechaza un término sin regla o sin fuente", () => {
    expect(
      DeadlineCalculationInput.safeParse({
        rule: "",
        source: "",
        start_date: "2026-01-01",
        term_length: 5,
        day_kind: "CALENDAR",
      }).success,
    ).toBe(false);
  });
});
