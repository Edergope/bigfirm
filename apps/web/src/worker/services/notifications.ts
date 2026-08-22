import {
  newId,
  renderNotification,
  type Notification,
  type NotificationProvider,
  type NotificationRequest,
} from "@iusia/domain";
import type { Env } from "../env.js";
import { ResendNotificationProvider } from "../integrations/notifications.js";

/**
 * NotificationService — orquesta el envío de notificaciones a través de un
 * NotificationProvider, construyendo el contrato canónico y normalizando el estado.
 *
 * NO bloquea el flujo: si el proveedor no está configurado, devuelve una
 * notificación con estado NOT_CONFIGURED en lugar de lanzar. La firma/matter
 * viajan en el contrato y como tags de correlación (aislamiento operativo).
 */
export class NotificationService {
  constructor(private readonly provider: NotificationProvider) {}

  static forEnv(env: Env): NotificationService {
    return new NotificationService(
      new ResendNotificationProvider({
        apiKey: env.RESEND_API_KEY ?? null,
        from: env.RESEND_FROM ?? "IUSIA <notificaciones@iusia.legal>",
      }),
    );
  }

  isConfigured(): boolean {
    return this.provider.status() === "CONNECTED";
  }

  async notify(request: NotificationRequest): Promise<Notification> {
    const payload = request.payload ?? {};
    const { subject, text } = renderNotification(request.event, payload);
    const base: Omit<Notification, "status" | "provider_message_id" | "error"> = {
      notification_id: newId("event"),
      firm_id: request.firm_id,
      matter_id: request.matter_id ?? null,
      recipient: request.recipient,
      channel: request.channel ?? "EMAIL",
      event: request.event,
      subject,
      payload,
      correlation_id: request.correlation_id ?? null,
      execution_id: request.execution_id ?? null,
      created_at: new Date().toISOString(),
      provider: this.provider.id,
    };

    const result = await this.provider.send({
      to: request.recipient,
      subject,
      text,
      tags: {
        firm_id: request.firm_id,
        ...(request.matter_id ? { matter_id: request.matter_id } : {}),
        ...(request.execution_id ? { execution_id: request.execution_id } : {}),
        event: request.event,
      },
    });

    return {
      ...base,
      status: result.status,
      provider_message_id: result.provider_message_id ?? null,
      error: result.error ?? null,
    };
  }
}
