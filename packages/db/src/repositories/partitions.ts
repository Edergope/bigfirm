import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { documentPartitions, documents } from "../schema/iusia.js";

/**
 * Particiones de documentos grandes.
 *
 * La identidad de una partición es `(documento, versión, ordinal)`, y la protege un
 * índice único en la base. Eso importa más de lo que parece: con entrega «al menos una
 * vez» el mismo mensaje llega dos veces con normalidad, y sin esa restricción la
 * segunda llegada crearía otra fila, subiría otro item al índice y contaría dos veces
 * la misma parte como disponible. La garantía la da el motor, que es el único sitio
 * donde no depende de que nadie se equivoque.
 */
export class PartitionRepository {
  constructor(private readonly db: IusiaDb) {}

  /**
   * Registra el plan de particiones de un documento.
   *
   * Reprocesar el mismo documento vuelve a insertar las mismas identidades y el índice
   * único las ignora: las filas que ya existen conservan su estado y su item, así que
   * un reproceso no reinicia el progreso de las partes que ya estaban listas.
   */
  async createPlan(input: {
    organizationId: string;
    matterId: string;
    documentId: string;
    documentVersion: number;
    partitions: readonly { ordinal: number; sourceKey: string; bytes: number }[];
  }): Promise<void> {
    if (input.partitions.length === 0) return;
    const now = new Date().toISOString();
    await this.db
      .insert(documentPartitions)
      .values(
        input.partitions.map((p) => ({
          id: newId("documentPartition"),
          organizationId: input.organizationId,
          matterId: input.matterId,
          documentId: input.documentId,
          documentVersion: input.documentVersion,
          ordinal: p.ordinal,
          sourceKey: p.sourceKey,
          bytes: p.bytes,
          state: "PENDING",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();

    await this.db
      .update(documents)
      .set({ partitionCount: input.partitions.length, updatedAt: now })
      .where(
        and(
          eq(documents.organizationId, input.organizationId),
          eq(documents.id, input.documentId),
        ),
      );
  }

  /**
   * Una partición concreta, con su aislamiento revalidado.
   *
   * El mensaje de la cola dice a qué organización y expediente pertenece, pero eso es
   * lo que AFIRMA el mensaje. La autoridad es D1: si las cuatro claves no coinciden
   * exactamente con la fila, no hay partición. Un mensaje forjado desde otra
   * organización no encuentra nada, y ése es el punto.
   */
  async findForJob(input: {
    organizationId: string;
    matterId: string;
    documentId: string;
    documentVersion: number;
    ordinal: number;
  }) {
    const [row] = await this.db
      .select()
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.organizationId, input.organizationId),
          eq(documentPartitions.matterId, input.matterId),
          eq(documentPartitions.documentId, input.documentId),
          eq(documentPartitions.documentVersion, input.documentVersion),
          eq(documentPartitions.ordinal, input.ordinal),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Marca la partición como subida al índice, conservando la identidad del item. */
  async markIndexing(id: string, aiSearchItemId: string): Promise<void> {
    await this.db
      .update(documentPartitions)
      .set({
        state: "INDEXING",
        aiSearchItemId,
        indexConfirmAttempts: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documentPartitions.id, id));
  }

  /**
   * Marca una partición como disponible y actualiza el recuento del documento.
   *
   * El recuento se RECALCULA contando filas, no incrementando un contador. Sumar uno
   * por cada confirmación parece más barato y es exactamente donde una entrega
   * repetida produce «8 de 7 partes listas». Contar es idempotente por construcción.
   */
  async markReady(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(documentPartitions)
      .set({ state: "READY", indexConfirmNextAt: null, updatedAt: now })
      .where(eq(documentPartitions.id, id));
    await this.refreshCounts(id);
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(documentPartitions)
      .set({
        state: "FAILED",
        failureCode: code,
        failureMessage: message.slice(0, 300),
        indexConfirmNextAt: null,
        updatedAt: now,
      })
      .where(eq(documentPartitions.id, id));
    await this.refreshCounts(id);
  }

  /** Recuento del documento al que pertenece la partición, contado desde las filas. */
  private async refreshCounts(partitionId: string): Promise<void> {
    const [p] = await this.db
      .select({
        organizationId: documentPartitions.organizationId,
        documentId: documentPartitions.documentId,
        documentVersion: documentPartitions.documentVersion,
      })
      .from(documentPartitions)
      .where(eq(documentPartitions.id, partitionId))
      .limit(1);
    if (!p) return;

    const rows = await this.db
      .select({ state: documentPartitions.state })
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.documentId, p.documentId),
          eq(documentPartitions.documentVersion, p.documentVersion),
        ),
      );

    const ready = rows.filter((r) => r.state === "READY").length;
    const failed = rows.filter((r) => r.state === "FAILED").length;
    await this.db
      .update(documents)
      .set({ partitionsReady: ready, partitionsFailed: failed, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(documents.organizationId, p.organizationId),
          eq(documents.id, p.documentId),
        ),
      );
  }

  /** Ordinales ya disponibles de un documento. Es lo que puede citarse. */
  async readyOrdinals(
    organizationId: string,
    documentId: string,
    documentVersion: number,
  ): Promise<number[]> {
    const rows = await this.db
      .select({ ordinal: documentPartitions.ordinal })
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.organizationId, organizationId),
          eq(documentPartitions.documentId, documentId),
          eq(documentPartitions.documentVersion, documentVersion),
          eq(documentPartitions.state, "READY"),
        ),
      )
      .orderBy(asc(documentPartitions.ordinal));
    return rows.map((r) => r.ordinal);
  }

  /**
   * Ordinales disponibles de VARIOS documentos, en UNA consulta.
   *
   * Congelar la evidencia de un expediente con cincuenta documentos no puede costar
   * cincuenta viajes a la base. La alternativa obvia —un bucle sobre `readyOrdinals`—
   * es exactamente la consulta N+1 que la auditoría busca.
   */
  async readyOrdinalsFor(
    organizationId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    if (documentIds.length === 0) return out;
    const rows = await this.db
      .select({
        documentId: documentPartitions.documentId,
        ordinal: documentPartitions.ordinal,
      })
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.organizationId, organizationId),
          inArray(documentPartitions.documentId, [...documentIds]),
          eq(documentPartitions.state, "READY"),
        ),
      )
      .orderBy(asc(documentPartitions.ordinal));
    for (const r of rows) {
      const list = out.get(r.documentId) ?? [];
      list.push(r.ordinal);
      out.set(r.documentId, list);
    }
    return out;
  }

  /** Particiones que aún deben trabajarse, para reencolar sólo lo que falta. */
  async listUnfinished(
    organizationId: string,
    documentId: string,
    documentVersion: number,
  ) {
    return this.db
      .select()
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.organizationId, organizationId),
          eq(documentPartitions.documentId, documentId),
          eq(documentPartitions.documentVersion, documentVersion),
          inArray(documentPartitions.state, ["PENDING", "INDEXING", "FAILED"]),
        ),
      )
      .orderBy(asc(documentPartitions.ordinal));
  }

  /** Particiones cuya confirmación está vencida o varada. Red de seguridad del cron. */
  async listAwaitingConfirmation(now: string, staleBefore: string, limit = 25) {
    return this.db
      .select()
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.state, "INDEXING"),
          sql`(${documentPartitions.indexConfirmNextAt} <= ${now}
               OR (${documentPartitions.indexConfirmNextAt} IS NULL
                   AND ${documentPartitions.updatedAt} <= ${staleBefore}))`,
        ),
      )
      .limit(limit);
  }

  /**
   * Partes que se quedaron sin subir.
   *
   * `PENDING` sin item y calladas hace rato: su trabajo murió y nadie va a volver. Es
   * el mismo agujero que dejó siete PDF muertos en el lote de 19, y aquí sería peor —el
   * documento seguiría mostrándose disponible en un 80 %, para siempre—.
   */
  async listStalledUploads(staleBefore: string, limit = 25) {
    return this.db
      .select()
      .from(documentPartitions)
      .where(
        and(
          eq(documentPartitions.state, "PENDING"),
          sql`${documentPartitions.aiSearchItemId} IS NULL`,
          sql`${documentPartitions.updatedAt} <= ${staleBefore}`,
        ),
      )
      .limit(limit);
  }

  async scheduleConfirm(id: string, attempt: number, nextAt: string): Promise<void> {
    await this.db
      .update(documentPartitions)
      .set({
        indexConfirmAttempts: attempt,
        indexConfirmNextAt: nextAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documentPartitions.id, id));
  }
}
