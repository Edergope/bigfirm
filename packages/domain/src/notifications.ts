import { z } from "zod";

/**
 * Notificaciones. Puerto de dominio desacoplado del proveedor.
 *
 * IUSIA Domain / Workflows → NotificationService → NotificationProvider → ResendAdapter.
 * El dominio NUNCA importa el SDK/API de Resend: sólo conoce este contrato.
 */

export const NOTIFICATION_CHANNELS = ["EMAIL"] as const;
export const NotificationChannel = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/** Eventos MVP que ya existen en el dominio y tienen sentido notificar. */
export const NOTIFICATION_EVENTS = [
  "DEADLINE_UPCOMING",
  "TASK_ASSIGNED",
  "APPROVAL_REQUIRED",
  "EXECUTION_BLOCKED",
  "EXECUTION_FAILED",
  "EXECUTION_COMPLETED",
] as const;
export const NotificationEvent = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof NotificationEvent>;

export const NOTIFICATION_STATUSES = [
  "PENDING",
  "SENT",
  "NOT_CONFIGURED",
  "FAILED",
  "SKIPPED",
] as const;
export const NotificationStatus = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

/** Contrato canónico de una notificación. `payload` nunca incluye contenido jurídico sensible. */
export const Notification = z.object({
  notification_id: z.string().min(1),
  firm_id: z.string().min(1),
  matter_id: z.string().nullable(),
  recipient: z.string().min(1),
  channel: NotificationChannel,
  event: NotificationEvent,
  subject: z.string().nullable(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  correlation_id: z.string().nullable(),
  execution_id: z.string().nullable(),
  created_at: z.string().datetime(),
  provider: z.string(),
  provider_message_id: z.string().nullable(),
  status: NotificationStatus,
  error: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;

/** Solicitud de envío que recibe el NotificationService. */
export interface NotificationRequest {
  firm_id: string;
  matter_id?: string | null;
  recipient: string;
  event: NotificationEvent;
  payload?: Record<string, string | number | boolean>;
  correlation_id?: string | null;
  execution_id?: string | null;
  channel?: NotificationChannel;
}

/** Error normalizado del proveedor. */
export type NotificationFailureKind =
  | "not_configured"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "network"
  | "invalid_recipient";

export interface ProviderSendResult {
  status: Extract<NotificationStatus, "SENT" | "NOT_CONFIGURED" | "FAILED">;
  provider_message_id?: string | null;
  error?: string | null;
  failure_kind?: NotificationFailureKind;
}

/**
 * Puerto de proveedor. Implementado por ResendNotificationProvider (prod) y
 * FakeNotificationProvider (tests). Nunca lanza por falta de configuración:
 * devuelve `NOT_CONFIGURED` para que el flujo continúe sin bloquearse.
 */
export interface NotificationProvider {
  readonly id: string;
  status(): "CONNECTED" | "NOT_CONFIGURED";
  send(input: {
    to: string;
    subject: string;
    text: string;
    /** HTML opcional: `text` siempre es el fallback universal. */
    html?: string;
    tags: Record<string, string>;
  }): Promise<ProviderSendResult>;
}

/**
 * Plantillas mínimas por evento. Devuelven asunto y cuerpo en es-CO.
 * No incluyen contenido confidencial: sólo referencias y metadata operativa.
 */
export function renderNotification(
  event: NotificationEvent,
  payload: Record<string, string | number | boolean>,
): { subject: string; text: string } {
  const ref = String(payload.matter_reference ?? payload.matter_id ?? "");
  const title = String(payload.title ?? "");
  switch (event) {
    case "DEADLINE_UPCOMING":
      return {
        subject: `IUSIA · Término próximo${ref ? ` · ${ref}` : ""}`,
        text: `Se aproxima un término: ${title}. Revisa el expediente en IUSIA.`,
      };
    case "TASK_ASSIGNED":
      return {
        subject: `IUSIA · Tarea asignada${ref ? ` · ${ref}` : ""}`,
        text: `Se te asignó una tarea: ${title}.`,
      };
    case "APPROVAL_REQUIRED":
      return {
        subject: `IUSIA · Aprobación requerida${ref ? ` · ${ref}` : ""}`,
        text: `Una orquestación requiere tu aprobación de gate para continuar.`,
      };
    case "EXECUTION_BLOCKED":
      return {
        subject: `IUSIA · Orquestación bloqueada${ref ? ` · ${ref}` : ""}`,
        text: `Una orquestación quedó bloqueada y requiere atención.`,
      };
    case "EXECUTION_FAILED":
      return {
        subject: `IUSIA · Orquestación con fallos${ref ? ` · ${ref}` : ""}`,
        text: `Una orquestación finalizó con ejecuciones fallidas. Revisa el Strategy Room.`,
      };
    case "EXECUTION_COMPLETED":
      return {
        subject: `IUSIA · Orquestación completada${ref ? ` · ${ref}` : ""}`,
        text: `Una orquestación finalizó. El resultado está disponible en el expediente.`,
      };
  }
}
