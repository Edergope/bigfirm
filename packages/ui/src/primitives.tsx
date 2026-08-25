import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { motion, useReducedMotion } from "motion/react";

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
        "rounded-[14px] border border-iusia-line bg-iusia-paper shadow-[0_1px_2px_rgba(11,29,58,0.05)]",
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
    <header className="flex items-start justify-between gap-3 border-b border-iusia-line px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-iusia-navy">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-iusia-mist-text">{subtitle}</p> : null}
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
          <p className="mt-1 max-w-2xl text-[14px] text-iusia-mist-text">{description}</p>
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
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        size === "md" ? "h-9 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-iusia-action text-white hover:bg-[#1d4fd0]",
        variant === "secondary" &&
          "border border-iusia-mist-strong bg-iusia-paper text-iusia-carbon hover:bg-iusia-surface",
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
      {hint ? <span className="text-[12px] text-iusia-mist-text">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  "h-10 w-full rounded-[10px] border border-iusia-mist-strong bg-iusia-paper px-3 text-[15px] text-iusia-carbon outline-none transition-colors placeholder:text-iusia-mist-text focus:border-iusia-action";

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

// Fondo/ring usan el tono decorativo (sólo necesita ≥3:1); el texto usa la
// variante "-text" oscurecida a ≥4.5:1 AA. info/critical ya cumplen con el tono base.
const STATUS_TONE: Record<string, string> = {
  neutral: "bg-iusia-mist/15 text-iusia-carbon ring-iusia-mist/40",
  info: "bg-iusia-action/10 text-iusia-action ring-iusia-action/25",
  intel: "bg-iusia-intel/15 text-iusia-intel-text ring-iusia-intel/40",
  success: "bg-iusia-success/10 text-iusia-success-text ring-iusia-success/25",
  warning: "bg-iusia-warning/10 text-iusia-warning-text ring-iusia-warning/25",
  critical: "bg-iusia-critical/10 text-iusia-critical ring-iusia-critical/25",
  gold: "bg-iusia-gold/12 text-iusia-gold-text ring-iusia-gold/35",
};

/**
 * Señal de estado. Compacta y de una sola línea por defecto: en una cartera de
 * expedientes el estado acompaña al asunto, no compite con él, y una etiqueta que
 * se parte en dos líneas dentro de una fila de tabla destruye el ritmo de lectura.
 */
export function StatusChip({
  label,
  tone = "neutral",
  icon,
  dot = false,
  title,
  size = "sm",
}: {
  label: string;
  tone?: keyof typeof STATUS_TONE | string;
  icon?: ReactNode;
  dot?: boolean;
  /** Explicación al pasar el cursor: el nombre corto rara vez basta para decidir. */
  title?: string;
  size?: "sm" | "md";
}) {
  const cls = STATUS_TONE[tone] ?? STATUS_TONE.neutral;
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset",
        size === "sm" ? "px-2 py-[1px] text-[12px]" : "px-2.5 py-0.5 text-[12.5px]",
        cls,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" /> : null}
      {icon}
      <span className="truncate">{label}</span>
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
      <p className="text-[13px] text-iusia-mist-text">{label}</p>
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
  // Glifos Unicode como iconos: el craft-floor los prohíbe y aquí no aportaban
  // nada —un "—" gigante no informa. La ausencia se comunica con el texto y con
  // el espacio, y el error con su color.
  const icon = null;
  const tone =
    kind === "error"
      ? "text-iusia-critical"
      : kind === "not_configured"
        ? "text-iusia-warning"
        : "text-iusia-mist-text";
  return (
    // Un estado vacío no merece la altura de un panel lleno: anunciar "nada que
    // revisar" con 200px de aire dice que el producto está incompleto, no que la
    // cartera esté tranquila.
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
      {icon}
      <p className={clsx("text-[14.5px] font-medium", kind === "error" ? tone : "text-iusia-carbon")}>
        {title}
      </p>
      {hint ? <p className="max-w-md text-[13.5px] text-iusia-mist-text">{hint}</p> : null}
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
 *
 * La PRESENCIA no depende de la animación. `AnimatePresence` retiene el nodo hasta
 * que termina la salida, y esa salida se mueve con requestAnimationFrame: con la
 * pestaña en segundo plano la animación queda a medias y el panel se quedaba
 * abierto e insensible a Escape y al fondo. Cerrar es una decisión del usuario, no
 * un efecto visual, así que al cerrar se desmonta y punto; la entrada sigue animada
 * porque ahí el movimiento sí explica de dónde viene el panel.
 *
 * El foco queda atrapado dentro mientras está abierto y vuelve a su origen al
 * cerrarse: si no, el teclado se pierde en la página que hay detrás del velo.
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
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-iusia-navy/25"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
      />
      <motion.aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-50 flex max-w-full flex-col bg-iusia-paper shadow-[0_24px_60px_-20px_rgba(11,29,58,0.35)] focus:outline-none"
        style={{ width }}
        initial={reduce ? { opacity: 0 } : { x: width }}
        animate={reduce ? { opacity: 1 } : { x: 0 }}
        transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <header className="flex items-center justify-between border-b border-iusia-mist/25 px-5 py-4">
          <h2 className="text-[16px] font-semibold text-iusia-navy">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md px-2 py-1 text-iusia-mist-text hover:bg-iusia-surface hover:text-iusia-carbon"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </motion.aside>
    </>
  );
}

/**
 * Avisos no bloqueantes. Un análisis que termina mientras el abogado trabaja en otra
 * cosa merece enterarse sin que le roben el foco ni le interrumpan la escritura: por
 * eso nunca es un diálogo modal, se apila abajo a la derecha y se puede descartar.
 *
 * Sin animación de `layout`: medirla en cada render dentro de un contenedor fijo
 * bloqueaba el renderizador mientras el aviso estuviera en pantalla, y un aviso que
 * congela la aplicación es peor que no avisar. La entrada y salida siguen animadas,
 * que es lo que aporta legibilidad al apilarse.
 */
export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  tone?: "success" | "critical" | "navy";
  action?: { label: string; onClick: () => void };
}

const TOAST_BAR: Record<NonNullable<ToastItem["tone"]>, string> = {
  success: "bg-iusia-success",
  critical: "bg-iusia-critical",
  navy: "bg-iusia-navy",
};

export function ToastStack({
  items,
  onDismiss,
  autoDismissMs = 14000,
}: {
  items: readonly ToastItem[];
  onDismiss: (id: string) => void;
  /** 0 desactiva el descarte automático. */
  autoDismissMs?: number;
}) {
  // Un aviso que no se va nunca deja de ser un aviso y pasa a ser ruido fijo en la
  // esquina. Se retira solo; el análisis terminado sigue en el expediente.
  //
  // El temporizador depende de QUÉ avisos hay, no de la identidad del array ni del
  // callback: quien usa este componente los recrea en cada render, y reprogramar el
  // temporizador en cada render equivale a no programarlo nunca.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const ids = items.map((t) => t.id).join("|");
  useEffect(() => {
    if (autoDismissMs <= 0 || ids.length === 0) return;
    const timers = ids
      .split("|")
      .map((id) => setTimeout(() => dismissRef.current(id), autoDismissMs));
    return () => timers.forEach(clearTimeout);
  }, [ids, autoDismissMs]);

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[340px] max-w-[calc(100vw-2.5rem)] flex-col gap-2.5"
      role="region"
      aria-label="Avisos de IUSIA"
    >
      {/* Sin animación de salida, por la misma razón que el Drawer: descartar es una
          decisión, no un efecto, y un aviso retenido por una salida que nunca termina
          se queda pegado en la esquina. */}
      {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex overflow-hidden rounded-[12px] bg-iusia-paper shadow-[0_16px_40px_-12px_rgba(11,29,58,0.32)] ring-1 ring-iusia-mist/25"
          >
            <span className={"w-1 shrink-0 " + TOAST_BAR[t.tone ?? "navy"]} aria-hidden />
            <div className="flex-1 px-4 py-3">
              <p className="text-[14px] font-semibold text-iusia-navy">{t.title}</p>
              {t.body ? <p className="mt-0.5 text-[13px] text-iusia-mist-text">{t.body}</p> : null}
              <div className="mt-2 flex items-center gap-4">
                {t.action ? (
                  <button
                    type="button"
                    onClick={t.action.onClick}
                    className="text-[13px] font-semibold text-iusia-action hover:underline"
                  >
                    {t.action.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDismiss(t.id)}
                  className="text-[13px] font-medium text-iusia-mist-text hover:text-iusia-carbon"
                >
                  Descartar
                </button>
              </div>
            </div>
          </motion.div>
        ))}
    </div>
  );
}

/**
 * Acción destructiva con confirmación en el sitio.
 *
 * Retirar a alguien de la firma o cancelar una invitación no se deshace con
 * Ctrl+Z, y un clic accidental en una lista densa es fácil. Confirmar en línea
 * —sin diálogo modal— mantiene visible la fila sobre la que se decide.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  onConfirm,
  pending = false,
  disabled = false,
  describedBy,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        disabled={disabled || pending}
        aria-describedby={describedBy}
        className="text-[13px] font-medium text-iusia-critical hover:underline disabled:opacity-40"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        autoFocus
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        disabled={pending}
        className="rounded-[7px] bg-iusia-critical px-2.5 py-1 text-[12.5px] font-semibold text-white disabled:opacity-50"
      >
        {pending ? "…" : confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-[12.5px] text-iusia-mist-text hover:text-iusia-carbon"
      >
        No
      </button>
    </span>
  );
}

// ─────────────────────────────── Composición ───────────────────────────────

/**
 * Superficie de trabajo: el contenedor que le faltaba al producto.
 *
 * Sin él, una tabla blanca quedaba flotando sobre un fondo casi blanco y la página
 * se leía como un panel de administración: nada contenía nada. Con el lienzo por
 * debajo (`canvas`) y esta superficie por encima, la jerarquía de §17 existe de
 * verdad —lienzo, workspace, panel, control— y se resuelve con fondo, radio y
 * profundidad, no repartiendo bordes azules.
 */
export function Workspace({
  children,
  className,
  toolbar,
}: {
  children: ReactNode;
  className?: string;
  /** Barra integrada en el borde superior: buscar, filtrar, ordenar. */
  toolbar?: ReactNode;
}) {
  return (
    <section
      className={clsx(
        "overflow-hidden rounded-[16px] border border-iusia-line bg-iusia-paper shadow-[var(--shadow-panel)]",
        className,
      )}
    >
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-iusia-line bg-iusia-surface/60 px-4 py-3">
          {toolbar}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Métrica en línea. Alternativa a convertir cada número en una tarjeta: una fila
 * de tarjetas idénticas es el layout por defecto de un panel de administración, no
 * una composición. Aquí las cifras comparten una sola superficie y se separan con
 * un trazo, que es lo que hace legible una lectura comparativa.
 *
 * Deliberadamente contenida: es un resumen que precede al contenido, no la portada
 * de la página. Cifras a 22px y no a 40 — con carteras pequeñas, un número gigante
 * anunciando "2" convierte el resumen en decoración.
 *
 * Un cero nunca se pinta con color de alarma. Rojo significa "hay algo que atender";
 * un `0` rojo en "Riesgo alto" dice exactamente lo contrario de lo que ocurre.
 */
export function MetricRail({
  items,
  onSelect,
}: {
  items: ReadonlyArray<{
    id: string;
    label: string;
    value: string;
    tone?: "navy" | "warning" | "critical" | "success" | "gold";
    hint?: string;
  }>;
  onSelect?: (id: string) => void;
}) {
  const valueColor: Record<string, string> = {
    navy: "text-iusia-navy",
    warning: "text-iusia-warning-text",
    critical: "text-iusia-critical",
    success: "text-iusia-success-text",
    gold: "text-iusia-gold-text",
  };
  return (
    <div className="grid grid-cols-2 divide-iusia-line overflow-hidden rounded-[12px] border border-iusia-line bg-iusia-paper shadow-[0_1px_2px_rgba(11,29,58,0.04)] sm:grid-cols-4 sm:divide-x">
      {items.map((m) => {
        const empty = m.value === "0";
        const body = (
          <>
            <span className="block text-[11.5px] font-medium uppercase tracking-[0.07em] text-iusia-mist-text">
              {m.label}
            </span>
            <span className="mt-1 flex items-baseline gap-2">
              <span
                className={clsx(
                  "text-[22px] font-semibold leading-none tnum",
                  empty ? "text-iusia-mist-text" : valueColor[m.tone ?? "navy"],
                )}
              >
                {m.value}
              </span>
              {m.hint ? (
                <span className="text-[12px] text-iusia-mist-text">{m.hint}</span>
              ) : null}
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className="border-b border-iusia-line px-4 py-2.5 text-left transition-colors hover:bg-iusia-surface sm:border-b-0"
          >
            {body}
          </button>
        ) : (
          <div key={m.id} className="border-b border-iusia-line px-4 py-2.5 sm:border-b-0">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Etiqueta de sección: estructura sin convertir todo en tarjeta (§18). */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-iusia-mist-text">
        {children}
      </h2>
      {action}
    </div>
  );
}
