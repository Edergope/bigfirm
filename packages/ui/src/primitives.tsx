import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Primitivas del Design System de IUSIA. Sobrias, densas, legibles.
 * Reutilizar antes de crear componentes nuevos (Blueprint §09).
 */

// ─────────────────────────────── Superficie ───────────────────────────────

export function Card({
  children,
  className,
  as: As = "section",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  interactive?: boolean;
}) {
  return (
    <As
      className={clsx(
        "rounded-[14px] border border-iusia-mist/35 bg-iusia-paper shadow-[0_1px_2px_rgba(11,29,58,0.06)]",
        interactive &&
          "transition-colors hover:border-iusia-action/40 focus-within:border-iusia-action/50",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-iusia-mist/25 px-6 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-iusia-navy">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-iusia-mist">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

// ─────────────────────────────── Tipografía ───────────────────────────────

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-[13px] text-iusia-action">{eyebrow}</div> : null}
        <h1 className="truncate text-[24px] font-semibold tracking-[-0.01em] text-iusia-navy">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-[14px] text-iusia-mist">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ─────────────────────────────── Controles ───────────────────────────────

export function Button({
  children,
  variant = "primary",
  size = "md",
  type = "button",
  disabled,
  onClick,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45",
        size === "md" ? "h-9 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-iusia-action text-white hover:bg-[#1d4fd0]",
        variant === "secondary" &&
          "border border-iusia-mist/50 bg-iusia-paper text-iusia-carbon hover:bg-iusia-surface",
        variant === "ghost" && "text-iusia-carbon hover:bg-iusia-mist/15",
        variant === "destructive" && "bg-iusia-critical text-white hover:bg-[#b91c1c]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-iusia-carbon">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-iusia-mist">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  "h-10 w-full rounded-[10px] border border-iusia-mist/50 bg-iusia-paper px-3 text-[15px] text-iusia-carbon outline-none transition-colors placeholder:text-iusia-mist focus:border-iusia-action";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(CONTROL, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(CONTROL, "h-auto py-2 leading-relaxed", props.className)}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(CONTROL, "pr-8", props.className)} />;
}

// ─────────────────────────────── Señales ───────────────────────────────

const STATUS_TONE: Record<string, string> = {
  neutral: "bg-iusia-mist/15 text-iusia-carbon ring-iusia-mist/40",
  info: "bg-iusia-action/10 text-iusia-action ring-iusia-action/25",
  intel: "bg-iusia-intel/15 text-[#0c7d95] ring-iusia-intel/40",
  success: "bg-iusia-success/10 text-iusia-success ring-iusia-success/25",
  warning: "bg-iusia-warning/10 text-iusia-warning ring-iusia-warning/25",
  critical: "bg-iusia-critical/10 text-iusia-critical ring-iusia-critical/25",
};

export function StatusChip({
  label,
  tone = "neutral",
  icon,
  dot = false,
}: {
  label: string;
  tone?: keyof typeof STATUS_TONE | string;
  icon?: ReactNode;
  dot?: boolean;
}) {
  const cls = STATUS_TONE[tone] ?? STATUS_TONE.neutral;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ring-1 ring-inset",
        cls,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" /> : null}
      {icon}
      {label}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  tone = "navy",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "navy" | "warning" | "critical" | "success";
}) {
  const valueColor =
    tone === "warning"
      ? "text-iusia-warning"
      : tone === "critical"
        ? "text-iusia-critical"
        : tone === "success"
          ? "text-iusia-success"
          : "text-iusia-navy";
  return (
    <Card className="px-5 py-4">
      <p className="text-[13px] text-iusia-mist">{label}</p>
      <p className={clsx("mt-1.5 text-[28px] font-semibold leading-none tnum", valueColor)}>
        {value}
      </p>
      {hint ? <p className="mt-2 text-[12.5px] text-iusia-carbon/60">{hint}</p> : null}
    </Card>
  );
}

// ─────────────────────────────── Estados ───────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx("animate-pulse rounded-md bg-iusia-mist/20", className)}
      aria-hidden
    />
  );
}

/**
 * Bloque de estado explícito. El prompt maestro prohíbe ceros silenciosos:
 * cada vista conectada distingue loading/empty/not_configured/error.
 */
export function StateBlock({
  kind,
  title,
  hint,
  action,
}: {
  kind: "loading" | "empty" | "not_configured" | "error";
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  const icon =
    kind === "error" ? "⚠" : kind === "not_configured" ? "◌" : kind === "loading" ? "◍" : "—";
  const tone =
    kind === "error"
      ? "text-iusia-critical"
      : kind === "not_configured"
        ? "text-iusia-warning"
        : "text-iusia-mist";
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className={clsx("text-2xl leading-none", tone)} aria-hidden>
        {icon}
      </span>
      <p className="text-[15px] font-medium text-iusia-carbon">{title}</p>
      {hint ? <p className="max-w-md text-[13.5px] text-iusia-mist">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return <StateBlock kind="empty" title={title} hint={hint} />;
}

/** Aviso de datos de desarrollo — nunca se presentan seeds como datos reales. */
export function DevDataNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-iusia-warning/40 bg-iusia-warning/5 px-4 py-2.5 text-[13px] text-iusia-warning">
      <span aria-hidden>⚠</span>
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────── Overlay ───────────────────────────────

/**
 * Drawer lateral accesible. Motion se reserva para cambios espaciales como éste.
 * Cierra con Escape y clic en el fondo; respeta prefers-reduced-motion.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-iusia-navy/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-y-0 right-0 z-50 flex flex-col bg-iusia-paper shadow-[0_24px_60px_-20px_rgba(11,29,58,0.35)]"
            style={{ width }}
            initial={reduce ? { opacity: 0 } : { x: width }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: width }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            <header className="flex items-center justify-between border-b border-iusia-mist/25 px-5 py-4">
              <h2 className="text-[16px] font-semibold text-iusia-navy">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="rounded-md px-2 py-1 text-iusia-mist hover:bg-iusia-surface hover:text-iusia-carbon"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
