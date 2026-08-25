import type { ExecutionStatus, RiskLevel } from "@iusia/domain";
import { StatusChip } from "./primitives.js";
import { colors } from "./tokens/index.js";

/**
 * Componentes de dominio jurídico. Encapsulan las reglas del Design System para
 * que ninguna vista tenga que reinterpretarlas.
 */

const MATTER_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  INTAKE: { label: "En intake", tone: "info" },
  ACTIVE: { label: "En curso", tone: "intel" },
  WAITING_CLIENT: { label: "Espera cliente", tone: "warning" },
  IN_REVIEW: { label: "En revisión", tone: "info" },
  ON_HOLD: { label: "En pausa", tone: "warning" },
  CLOSED: { label: "Cerrado", tone: "success" },
  ARCHIVED: { label: "Archivado", tone: "neutral" },
};

export function MatterStatusChip({ status }: { status: string }) {
  const s = MATTER_STATUS_LABELS[status] ?? { label: status, tone: "neutral" };
  return <StatusChip label={s.label} tone={s.tone} />;
}

/**
 * Indicador de riesgo. Exige justificación: sin metodología no se pinta el nivel
 * (Design System §06 — "no generar riesgo ficticio").
 */
const RISK_LABELS: Record<RiskLevel, { label: string; tone: string }> = {
  LOW: { label: "Riesgo bajo", tone: "success" },
  MEDIUM: { label: "Riesgo medio", tone: "warning" },
  HIGH: { label: "Riesgo alto", tone: "critical" },
  CRITICAL: { label: "Riesgo crítico", tone: "critical" },
  UNASSESSED: { label: "Riesgo sin evaluar", tone: "neutral" },
};

export function RiskIndicator({
  level,
  rationale,
}: {
  level: RiskLevel;
  rationale: string | null;
}) {
  // Un nivel sin justificación se degrada a "sin evaluar" en vez de mostrar un
  // indicador que el usuario no puede auditar.
  const effective: RiskLevel = level !== "UNASSESSED" && !rationale ? "UNASSESSED" : level;
  const r = RISK_LABELS[effective];
  return (
    <div className="flex flex-col gap-1">
      <StatusChip label={r.label} tone={r.tone} />
      {rationale && effective !== "UNASSESSED" ? (
        <p className="text-[13px] leading-snug text-iusia-carbon/70">{rationale}</p>
      ) : (
        <p className="text-[13px] text-iusia-mist-text">
          Se mostrará cuando exista metodología registrada.
        </p>
      )}
    </div>
  );
}

/**
 * Estados de ejecución con el tratamiento cromático fijado en Design System §05.
 * `color` se usa como texto Y como borde/dot en Strategy Room (StrategyRoom.tsx) —
 * por eso usa las variantes "-text" (≥4.5:1 AA), que también superan el ≥3:1 no-texto.
 * WAITING/FAILED usan el tono base porque ya cumplen ≥4.5:1 sin oscurecer.
 */
export const EXECUTION_STATUS_PRESENTATION: Record<
  ExecutionStatus,
  { label: string; tone: string; color: string }
> = {
  PENDING: { label: "En cola", tone: "neutral", color: colors.mistText },
  RUNNING: { label: "Ejecutando", tone: "intel", color: colors.intelText },
  WAITING: { label: "En espera", tone: "info", color: colors.info },
  BLOCKED: { label: "Bloqueado", tone: "warning", color: colors.warningText },
  COMPLETED: { label: "Completado", tone: "success", color: colors.successText },
  FAILED: { label: "Fallido", tone: "critical", color: colors.critical },
  CANCELLED: { label: "Cancelado", tone: "neutral", color: colors.mistText },
};

export function ExecutionStatusChip({ status }: { status: ExecutionStatus }) {
  const p = EXECUTION_STATUS_PRESENTATION[status];
  return <StatusChip label={p.label} tone={p.tone} />;
}

export function CreditBadge({ balance }: { balance: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-iusia-gold/40 bg-iusia-gold/10 px-3 py-1 text-[13px] font-medium text-iusia-gold-text">
      <span aria-hidden>◆</span>
      {balance.toLocaleString("es-CO")} créditos
    </span>
  );
}

/**
 * Roles de firma en el idioma del despacho.
 *
 * El enum es el contrato con el servidor y no se toca; lo que no puede ser es que
 * una directora lea "EXTERNAL_LAWYER" en un desplegable para decidir el acceso de
 * una persona. La descripción acompaña porque el rol determina qué verá esa
 * persona, y eso no se adivina por el nombre.
 */
export const FIRM_ROLE_PRESENTATION: Record<string, { label: string; hint: string }> = {
  FIRM_DIRECTOR: { label: "Dirección", hint: "Administra la firma y supervisa toda la cartera." },
  PARTNER: { label: "Socio", hint: "Administra la firma y supervisa toda la cartera." },
  LAWYER: { label: "Abogado", hint: "Trabaja en los expedientes que se le asignen." },
  EXTERNAL_LAWYER: { label: "Abogado externo", hint: "Colabora sólo en expedientes concretos." },
  ASSISTANT: { label: "Asistente", hint: "Apoya la gestión de los expedientes asignados." },
  PARALEGAL: { label: "Paralegal", hint: "Apoyo jurídico en los expedientes asignados." },
  READ_ONLY: { label: "Sólo lectura", hint: "Consulta sin capacidad de modificar." },
};

export function firmRoleLabel(role: string): string {
  return FIRM_ROLE_PRESENTATION[role]?.label ?? role;
}
