import { and, desc, eq } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { documentIngestionAttempts } from "../schema/iusia.js";

/**
 * Historial de intentos de ingestión.
 *
 * POR QUÉ EXISTE. `markIngestionStarted` pone el código de fallo a NULL en cada intento,
 * así que el segundo intento de `Cedula extrangeria Maria.pdf` destruyó la causa exacta
 * del primero: sé que fue un vencimiento por el margen de 7,9 s y por `cf_queue_attempt`,
 * pero no tengo el código. La fila del documento conserva el estado ACTUAL, que es lo que
 * la pantalla necesita; el forense necesita lo que pasó ANTES, y eso no cabe en una fila
 * que se sobrescribe.
 *
 * Es una fila por intento con lo mínimo para reconstruirlo. No es un sistema de eventos.
 */
export class IngestionAttemptRepository {
  constructor(private readonly db: IusiaDb) {}

  /** Abre el intento en cuanto el consumidor lo toma. Devuelve su id. */
  async open(input: {
    organizationId: string;
    matterId: string;
    documentId: string;
    attempt: number;
    reason?: string | null;
    cfQueueMessageId?: string | null;
    cfQueueAttempt?: number | null;
  }): Promise<string> {
    const id = newId("ingestionAttempt");
    await this.db.insert(documentIngestionAttempts).values({
      id,
      organizationId: input.organizationId,
      matterId: input.matterId,
      documentId: input.documentId,
      attempt: input.attempt,
      reason: input.reason ?? null,
      cfQueueMessageId: input.cfQueueMessageId ?? null,
      cfQueueAttempt: input.cfQueueAttempt ?? null,
      startedAt: new Date().toISOString(),
    });
    return id;
  }

  /**
   * Cierra el intento con su desenlace.
   *
   * Escribe SOBRE SU PROPIA FILA: el intento anterior queda intacto, que es justamente
   * lo que se perdía antes.
   */
  async close(
    id: string,
    outcome: {
      finalState: string;
      stage?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      timings?: Record<string, number> | null;
    },
  ): Promise<void> {
    await this.db
      .update(documentIngestionAttempts)
      .set({
        completedAt: new Date().toISOString(),
        finalState: outcome.finalState,
        stage: outcome.stage ?? null,
        failureCode: outcome.failureCode ?? null,
        failureMessage: outcome.failureMessage?.slice(0, 300) ?? null,
        timings: outcome.timings ? JSON.stringify(outcome.timings) : null,
      })
      .where(eq(documentIngestionAttempts.id, id));
  }

  /** Historial completo de un documento, del más reciente al más antiguo. */
  async listForDocument(organizationId: string, documentId: string, limit = 20) {
    return this.db
      .select()
      .from(documentIngestionAttempts)
      .where(
        and(
          eq(documentIngestionAttempts.organizationId, organizationId),
          eq(documentIngestionAttempts.documentId, documentId),
        ),
      )
      .orderBy(desc(documentIngestionAttempts.startedAt))
      .limit(limit);
  }
}
