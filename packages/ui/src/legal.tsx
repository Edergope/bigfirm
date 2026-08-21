import type { ExecutionStatus, RiskLevel } from "@iusia/domain";
import { StatusChip } from "./primitives.js";

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
        <p className="text-[13px] text-iusia-mist">
          Se mostrará cuando exista metodología registrada.
        </p>
      )}
    </div>
  );
}

/** Estados de ejecución con el tratamiento cromático fijado en Design System §05. */
export const EXECUTION_STATUS_PRESENTATION: Record<
  ExecutionStatus,
  { label: string; tone: string; color: string }
> = {
  PENDING: { label: "En cola", tone: "neutral", color: "#A7ADB5" },
  RUNNING: { label: "Ejecutando", tone: "intel", color: "#22C7E8" },
  WAITING: { label: "En espera", tone: "info", color: "#2563EB" },
  BLOCKED: { label: "Bloqueado", tone: "warning", color: "#D97706" },
  COMPLETED: { label: "Completado", tone: "success", color: "#16A34A" },
  FAILED: { label: "Fallido", tone: "critical", color: "#DC2626" },
  CANCELLED: { label: "Cancelado", tone: "neutral", color: "#A7ADB5" },
};

export function ExecutionStatusChip({ status }: { status: ExecutionStatus }) {
  const p = EXECUTION_STATUS_PRESENTATION[status];
  return <StatusChip label={p.label} tone={p.tone} />;
}

export function CreditBadge({ balance }: { balance: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-iusia-gold/40 bg-iusia-gold/10 px-3 py-1 text-[13px] font-medium text-[#8a6d24]">
      <span aria-hidden>◆</span>
      {balance.toLocaleString("es-CO")} créditos
    </span>
  );
}
