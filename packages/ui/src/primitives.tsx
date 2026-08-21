import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Primitivas del Design System de IUSIA.
 * Reutilizar antes de crear componentes nuevos (Blueprint §09).
 */

export function Card({
  children,
  className,
  as: As = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <As
      className={clsx(
        "rounded-[14px] border border-iusia-mist/40 bg-iusia-paper shadow-[0_1px_2px_rgba(11,29,58,0.06)]",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-iusia-mist/30 px-6 py-4">
      <h2 className="text-[15px] font-semibold text-iusia-navy">{title}</h2>
      {action}
    </header>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "destructive";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[14px] font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-iusia-action text-white hover:bg-iusia-action/90",
        variant === "secondary" &&
          "border border-iusia-mist/60 bg-iusia-paper text-iusia-carbon hover:bg-iusia-surface",
        variant === "destructive" && "bg-iusia-critical text-white hover:bg-iusia-critical/90",
      )}
    >
      {children}
    </button>
  );
}

/** Chip de estado. Siempre lleva texto, nunca sólo color (Design System §07). */
const STATUS_TONE: Record<string, string> = {
  neutral: "bg-iusia-mist/20 text-iusia-carbon border-iusia-mist/50",
  info: "bg-iusia-action/10 text-iusia-action border-iusia-action/30",
  intel: "bg-iusia-intel/15 text-[#0e7f96] border-iusia-intel/40",
  success: "bg-iusia-success/10 text-iusia-success border-iusia-success/30",
  warning: "bg-iusia-warning/10 text-iusia-warning border-iusia-warning/30",
  critical: "bg-iusia-critical/10 text-iusia-critical border-iusia-critical/30",
};

export function StatusChip({
  label,
  tone = "neutral",
  icon,
}: {
  label: string;
  tone?: keyof typeof STATUS_TONE | string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-medium",
        STATUS_TONE[tone] ?? STATUS_TONE.neutral,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[14px] text-iusia-mist">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-iusia-navy">{value}</p>
      {trend ? <p className="mt-1 text-[13px] text-iusia-carbon/70">{trend}</p> : null}
    </Card>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-[15px] font-medium text-iusia-carbon">{title}</p>
      {hint ? <p className="max-w-md text-[14px] text-iusia-mist">{hint}</p> : null}
    </div>
  );
}

/**
 * Aviso de datos de desarrollo. El prompt maestro prohíbe presentar datos
 * sembrados como reales; este componente los marca de forma visible.
 */
export function DevDataNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-iusia-warning/40 bg-iusia-warning/5 px-4 py-3 text-[14px] text-iusia-warning">
      <span aria-hidden>⚠</span>
      <span>{children}</span>
    </div>
  );
}
