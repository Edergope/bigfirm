import { z } from "zod";

/**
 * Cálculo jurídico de términos. Propiedad de IUSIA — NUNCA se delega a FullCalendar,
 * que sólo pinta fechas (Blueprint §27). Un término sin regla ni fuente no es un
 * término válido: es una fecha suelta.
 *
 * El MVP no pretende un motor universal de cómputo procesal colombiano; sí fija la
 * arquitectura correcta: todo término lleva regla, fuente, insumos y validación.
 */

export const DEADLINE_VALIDATION_STATES = [
  "CALCULATED",
  "HUMAN_VALIDATED",
  "REQUIRES_REVIEW",
] as const;
export const DeadlineValidationState = z.enum(DEADLINE_VALIDATION_STATES);
export type DeadlineValidationState = z.infer<typeof DeadlineValidationState>;

export const DAY_KINDS = ["CALENDAR", "BUSINESS"] as const;
export const DayKind = z.enum(DAY_KINDS);
export type DayKind = z.infer<typeof DayKind>;

export const DeadlineCalculationInput = z.object({
  /** Regla jurídica aplicable, p. ej. "CGP art. 118 — traslado 10 días". */
  rule: z.string().min(3),
  /** Fuente verificable de la regla. Sin fuente no se calcula. */
  source: z.string().min(3),
  /** Fecha de inicio del cómputo (ISO date, sin hora). */
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  term_length: z.number().int().positive(),
  day_kind: DayKind,
  /** Festivos a excluir (ISO date) cuando day_kind = BUSINESS. */
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});
export type DeadlineCalculationInput = z.infer<typeof DeadlineCalculationInput>;

export interface DeadlineResult {
  due_date: string;
  rule: string;
  source: string;
  day_kind: DayKind;
  term_length: number;
  validation_status: DeadlineValidationState;
  /** Trazabilidad: días efectivamente contados y saltados. */
  counted_days: number;
  skipped_days: number;
  calculated_at: string;
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calcula la fecha de vencimiento. Determinista y auditable.
 * En BUSINESS excluye fines de semana y los festivos provistos.
 *
 * SIEMPRE devuelve `validation_status = CALCULATED`: un cálculo automático nunca
 * se marca por sí mismo como validado. La validación humana es un paso aparte
 * (los términos son responsabilidad profesional).
 */
export function calculateDeadline(input: DeadlineCalculationInput): DeadlineResult {
  const holidays = new Set(input.holidays);
  const cursor = new Date(`${input.start_date}T00:00:00Z`);
  let counted = 0;
  let skipped = 0;

  while (counted < input.term_length) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (input.day_kind === "BUSINESS") {
      if (isWeekend(cursor) || holidays.has(toIso(cursor))) {
        skipped += 1;
        continue;
      }
    }
    counted += 1;
  }

  return {
    due_date: toIso(cursor),
    rule: input.rule,
    source: input.source,
    day_kind: input.day_kind,
    term_length: input.term_length,
    validation_status: "CALCULATED",
    counted_days: counted,
    skipped_days: skipped,
    calculated_at: new Date().toISOString(),
  };
}
