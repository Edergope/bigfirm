import {
  FIRM_ROLE_LABELS,
  firmRoleLabel as domainFirmRoleLabel,
  type ExecutionStatus,
  type RiskLevel,
} from "@iusia/domain";
import { StatusChip } from "./primitives.js";
import { analysisTerm, matterStatusTerm, riskTerm } from "./legal-terminology.js";
import { colors } from "./tokens/index.js";

/**
 * Componentes de dominio jurídico. Encapsulan las reglas del Design System para
 * que ninguna vista tenga que reinterpretarlas.
 */

/* Los rótulos viven en LEGAL_UI_TERMINOLOGY_MAP: una sola fuente para el idioma
   del producto, en vez de una tabla por componente que se desincroniza. */

export function MatterStatusChip({ status }: { status: string }) {
  const t = matterStatusTerm(status);
  return <StatusChip label={t.label} tone={t.tone} title={t.hint} />;
}

/**
 * Indicador de riesgo. Exige justificación: sin metodología no se pinta el nivel
 * (Design System §06 — "no generar riesgo ficticio").
 */
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
  const r = riskTerm(effective);
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
  PENDING: { label: analysisTerm("PENDING").label, tone: "neutral", color: colors.mistText },
  RUNNING: { label: analysisTerm("RUNNING").label, tone: "intel", color: colors.intelText },
  WAITING: { label: analysisTerm("WAITING").label, tone: "info", color: colors.info },
  BLOCKED: { label: analysisTerm("BLOCKED").label, tone: "warning", color: colors.warningText },
  COMPLETED: { label: analysisTerm("COMPLETED").label, tone: "success", color: colors.successText },
  FAILED: { label: analysisTerm("FAILED").label, tone: "critical", color: colors.critical },
  CANCELLED: { label: analysisTerm("CANCELLED").label, tone: "neutral", color: colors.mistText },
};

export function ExecutionStatusChip({ status }: { status: ExecutionStatus }) {
  const p = EXECUTION_STATUS_PRESENTATION[status];
  return <StatusChip label={p.label} tone={p.tone} title={analysisTerm(status).hint} />;
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
  FIRM_DIRECTOR: { label: FIRM_ROLE_LABELS.FIRM_DIRECTOR, hint: "Administra la firma y supervisa toda la cartera." },
  PARTNER: { label: FIRM_ROLE_LABELS.PARTNER, hint: "Administra la firma y supervisa toda la cartera." },
  LAWYER: { label: FIRM_ROLE_LABELS.LAWYER, hint: "Trabaja en los expedientes que se le asignen." },
  EXTERNAL_LAWYER: { label: FIRM_ROLE_LABELS.EXTERNAL_LAWYER, hint: "Colabora sólo en expedientes concretos." },
  ASSISTANT: { label: FIRM_ROLE_LABELS.ASSISTANT, hint: "Apoya la gestión de los expedientes asignados." },
  PARALEGAL: { label: FIRM_ROLE_LABELS.PARALEGAL, hint: "Apoyo jurídico en los expedientes asignados." },
  READ_ONLY: { label: FIRM_ROLE_LABELS.READ_ONLY, hint: "Consulta sin capacidad de modificar." },
};

export function firmRoleLabel(role: string): string {
  return domainFirmRoleLabel(role);
}
