import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { documents, documentVersions } from "../schema/iusia.js";

/**
 * Metadata documental. El archivo del usuario vive en Google Drive; IUSIA guarda
 * la referencia, la clasificación jurídica y el estado de revisión.
 * No se duplica Drive.
 */
/**
 * Origen verificable de un entregable generado por IUSIA. Se persiste en la fila del
 * documento para que la trazabilidad no dependa de recorrer `audit_events`.
 */
export interface DocumentProvenance {
  /** AGENT (lo redactó el agente canónico) | MANUAL (valores del abogado). */
  contentSource: "AGENT" | "MANUAL";
  templateId: string;
  templateVersion: number;
  executionId?: string | null;
  agentId?: string | null;
  promptSha256?: string | null;
  model?: string | null;
  /** Tarea del expediente que originó el borrador, si nació de una. */
  originTaskId?: string | null;
}

export class DocumentRepository {
  constructor(private readonly db: IusiaDb) {}

  async link(input: {
    organizationId: string;
    matterId: string;
    /** `null` mientras los bytes viven sólo en el ingreso durable. */
    driveFileId: string | null;
    name: string;
    mimeType: string;
    classification?: string;
    linkedBy: string;
    sizeBytes?: number | null;
    checksum?: string | null;
    ingestionStatus?: string;
    /** Lote de carga al que pertenece. Correlación, nunca transacción. */
    uploadBatchId?: string | null;
    /** Momento en que el mensaje entró a la cola. Abre la medición de espera. */
    ingestionEnqueuedAt?: string | null;
    /** Provenance del entregable cuando el documento lo generó IUSIA. */
    provenance?: DocumentProvenance | null;
  }): Promise<string> {
    const id = newId("document");
    const now = new Date().toISOString();
    // Idempotente por (matterId, driveFileId): un re-link del MISMO archivo no crea un
    // segundo documento lógico. `returning()` distingue inserción real de conflicto;
    // en conflicto se devuelve el id del documento YA existente (nunca un id fantasma
    // no persistido, que dejaría al caller apuntando a una fila inexistente).
    const inserted = await this.db
      .insert(documents)
      .values({
        id,
        organizationId: input.organizationId,
        matterId: input.matterId,
        source: "DRIVE",
        driveFileId: input.driveFileId,
        name: input.name,
        mimeType: input.mimeType,
        classification: input.classification ?? "FUENTE",
        status: "PENDIENTE",
        contentHash: null,
        r2MirrorKey: null,
        indexedAt: null,
        currentVersion: 1,
        sizeBytes: input.sizeBytes ?? null,
        ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
        uploadBatchId: input.uploadBatchId ?? null,
        ingestionEnqueuedAt: input.ingestionEnqueuedAt ?? null,
        contentSource: input.provenance?.contentSource ?? null,
        generatedFromTemplateId: input.provenance?.templateId ?? null,
        generatedFromTemplateVersion: input.provenance?.templateVersion ?? null,
        generatedByExecutionId: input.provenance?.executionId ?? null,
        generatedByAgentId: input.provenance?.agentId ?? null,
        generatedPromptSha256: input.provenance?.promptSha256 ?? null,
        generatedModel: input.provenance?.model ?? null,
      originTaskId: input.provenance?.originTaskId ?? null,
        linkedBy: input.linkedBy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: documents.id });

    if (inserted[0]) {
      await this.db.insert(documentVersions).values({
        id: newId("documentVersion"),
        organizationId: input.organizationId,
        matterId: input.matterId,
        documentId: inserted[0].id,
        versionNumber: 1,
        driveFileId: input.driveFileId,
        filename: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
        checksum: input.checksum ?? null,
        createdBy: input.linkedBy,
        createdAt: now,
        changeType: "ORIGINAL",
        changeSummary: "Versión inicial",
        ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
        isCurrent: true,
      });
      return inserted[0].id;
    }

    // Sin archivo del proveedor no hay clave de unicidad que pueda chocar: SQLite
    // admite varios NULL en un índice único, así que la inserción no puede haber
    // entrado en conflicto y llegar aquí sería un fallo real, no un re-link.
    if (input.driveFileId === null) {
      throw new Error("link: la inserción del documento no devolvió fila");
    }

    // Conflicto de unicidad: recupera el documento existente para esa clave.
    const [existing] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.matterId, input.matterId),
          eq(documents.driveFileId, input.driveFileId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("link: conflicto sin documento existente resoluble");
    return existing.id;
  }

  /**
   * Documento VIGENTE del expediente cuyo binario coincide exactamente con un
   * checksum. Es lo que impide que un reintento técnico de la subida incorpore dos
   * veces el mismo archivo: el contenido, no el nombre ni el id del proveedor, es lo
   * que decide si ya está.
   */
  async findByChecksum(organizationId: string, matterId: string, checksum: string) {
    const [row] = await this.db
      .select({
        documentId: documentVersions.documentId,
        filename: documentVersions.filename,
        ingestionStatus: documents.ingestionStatus,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.matterId, matterId),
          eq(documentVersions.checksum, checksum),
          isNull(documents.retiredAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listForMatter(organizationId: string, matterId: string) {
    return this.db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.matterId, matterId), isNull(documents.retiredAt)))
      .orderBy(desc(documents.updatedAt));
  }

  async findById(organizationId: string, documentId: string) {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
      .limit(1);
    return row ?? null;
  }

  async listVersions(organizationId: string, documentId: string) {
    return this.db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.documentId, documentId),
        ),
      )
      .orderBy(desc(documentVersions.versionNumber));
  }

  async findVersion(organizationId: string, documentId: string, versionNumber?: number) {
    const clauses = [
      eq(documentVersions.organizationId, organizationId),
      eq(documentVersions.documentId, documentId),
      versionNumber === undefined
        ? eq(documentVersions.isCurrent, true)
        : eq(documentVersions.versionNumber, versionNumber),
    ];
    const [row] = await this.db
      .select()
      .from(documentVersions)
      .where(and(...clauses))
      .limit(1);
    return row ?? null;
  }

  /** Añade una versión sin sobrescribir la anterior; el número se resuelve en servidor. */
  async addVersion(input: {
    organizationId: string;
    matterId: string;
    documentId: string;
    driveFileId: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number | null;
    checksum?: string | null;
    createdBy: string;
    changeType: string;
    changeSummary: string;
    ingestionStatus?: string;
  }) {
    const document = await this.findById(input.organizationId, input.documentId);
    if (!document || document.matterId !== input.matterId || document.retiredAt) return null;

    const nextVersion = document.currentVersion + 1;
    const now = new Date().toISOString();
    const versionId = newId("documentVersion");
    await this.db.batch([
      this.db
        .update(documentVersions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(documentVersions.organizationId, input.organizationId),
            eq(documentVersions.documentId, input.documentId),
            eq(documentVersions.isCurrent, true),
          ),
        ),
      this.db.insert(documentVersions).values({
        id: versionId,
        organizationId: input.organizationId,
        matterId: input.matterId,
        documentId: input.documentId,
        versionNumber: nextVersion,
        driveFileId: input.driveFileId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
        checksum: input.checksum ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        changeType: input.changeType,
        changeSummary: input.changeSummary,
        ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
        isCurrent: true,
      }),
      this.db
        .update(documents)
        .set({
          driveFileId: input.driveFileId,
          name: input.filename,
          mimeType: input.mimeType,
          currentVersion: nextVersion,
          sizeBytes: input.sizeBytes ?? null,
          contentHash: input.checksum ?? null,
          r2MirrorKey: null,
          indexedAt: null,
          ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
          linkedBy: input.createdBy,
          updatedAt: now,
        })
        .where(
          and(eq(documents.organizationId, input.organizationId), eq(documents.id, input.documentId)),
        ),
    ]);
    return { versionId, versionNumber: nextVersion };
  }

  async setStatus(organizationId: string, documentId: string, status: string) {
    await this.db
      .update(documents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /** Retiro lógico durable. No borra el binario, espejo ni versiones auditables. */
  async retire(input: { organizationId: string; documentId: string; retiredBy: string; reason?: string }) {
    const now = new Date().toISOString();
    const result = await this.db.update(documents).set({
      status: "RETIRADO",
      retiredAt: now,
      retiredBy: input.retiredBy,
      retiredReason: input.reason?.trim() || null,
      updatedAt: now,
    }).where(and(eq(documents.organizationId, input.organizationId), eq(documents.id, input.documentId), isNull(documents.retiredAt))).returning({ id: documents.id });
    return result[0] ?? null;
  }

  /** Marca un documento como indexado tras escribir su espejo normalizado en R2. */
  /**
   * Marca el inicio del trabajo real de ingestión.
   *
   * Cierra la espera en cola: `ingestion_enqueued_at` la abre y esto la cierra, así que
   * el tiempo en cola deja de estar mezclado con el tiempo de proceso. También cuenta
   * el intento, lo que distingue un fallo aislado de uno persistente.
   */
  /**
   * Documentos de un lote de carga, con su estado de ingestión.
   *
   * Alimenta el progreso agregado —«12 de 15 preparados»— sin traer el expediente
   * entero: un lote se consulta mientras se está cargando, y en ese momento importa
   * cuánto falta, no qué más hay en el expediente.
   */
  async listByBatch(organizationId: string, uploadBatchId: string) {
    return this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.uploadBatchId, uploadBatchId),
          isNull(documents.retiredAt),
        ),
      )
      .orderBy(desc(documents.createdAt));
  }

  /**
   * Devuelve un documento fallido al estado de proceso para reintentarlo.
   *
   * Idempotente por diseño: NO crea versión, NO toca el binario en el proveedor y NO
   * cambia `drive_file_id`, así que el reintento reescribe el mismo espejo en R2 y
   * reenvía el mismo item al índice con la misma clave. Es el MISMO documento
   * intentándolo otra vez, no uno nuevo.
   *
   * Sólo actúa sobre documentos en ERROR: reencolar uno que ya está indexado o en
   * curso duplicaría trabajo sin motivo.
   */
  async markIngestionRetrying(
    organizationId: string,
    documentId: string,
    fromStatus: string,
  ): Promise<boolean> {
    const updated = await this.db
      .update(documents)
      .set({
        /*
          Se persiste `PROCESSING` y el ciclo de vida lo lee como QUEUED mientras
          `ingestion_attempts` valga 0. El comentario anterior decía «QUEUED, no
          PROCESSING» mientras el código escribía PROCESSING: describía una intención,
          no lo que pasaba.

          La distinción entre encolado y procesando es REAL y la hace `attempts`, que es
          la única señal que prueba que un consumidor empezó. Cambiar el valor crudo
          exigiría migrar 35 filas y todas las comprobaciones que lo comparan, sin ganar
          nada que el ciclo de vida no dé ya. Queda documentado, no disimulado.
        */
        ingestionStatus: "PROCESSING",
        ingestionEnqueuedAt: new Date().toISOString(),
        // El contador vuelve a cero: este reintento aún no lo ha tomado nadie, y es
        // `attempts` lo que distingue «en cola» de «procesando».
        ingestionAttempts: 0,
        ingestionHeartbeatAt: null,
        ingestionStage: null,
        ingestionFailureCode: null,
        ingestionFailureMessage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.id, documentId),
          // La transición desde el estado observado es lo que AUTORIZA el reencolado:
          // si otra pestaña ya reintentó, esta condición no encuentra la fila y no se
          // encola un segundo mensaje para el mismo documento.
          eq(documents.ingestionStatus, fromStatus),
        ),
      )
      .returning({ id: documents.id });
    return updated.length > 0;
  }

  /**
   * La transferencia terminó y los bytes están a salvo en IUSIA.
   *
   * Es el instante que separa «Subiendo» de «Cargado · Procesando», y el que hace que
   * cerrar la pestaña deje de poder perder el archivo.
   */
  async markUploadDurable(organizationId: string, documentId: string, nextStatus: string) {
    await this.db
      .update(documents)
      .set({ ingestionStatus: nextStatus, updatedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /**
   * Los bytes NO llegaron completos.
   *
   * Se declara así y no como «procesando»: un documento que nunca se recibió no puede
   * aparentar estar en camino al índice. Queda reintentable y visible.
   */
  async markUploadFailed(organizationId: string, documentId: string) {
    await this.db
      .update(documents)
      .set({ ingestionStatus: "UPLOAD_FAILED", updatedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /** Persiste el archivo del proveedor definitivo una vez sincronizado en segundo plano. */
  async attachProviderFile(organizationId: string, documentId: string, driveFileId: string) {
    await this.db
      .update(documents)
      .set({
        driveFileId,
        providerSyncState: "SYNCED",
        providerSyncError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /**
   * La sincronización con el proveedor quedó pendiente.
   *
   * NO toca `ingestion_status`: el documento ya es analizable y decir lo contrario sería
   * mentir. Esto es procedencia atrasada, no un fallo de ingestión.
   */
  async markProviderSyncPending(organizationId: string, documentId: string, code: string) {
    await this.db
      .update(documents)
      .set({ providerSyncState: "DEFERRED", providerSyncError: code.slice(0, 120) })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /**
   * Sella que el consumidor recibió el trabajo y EMPEZÓ. Una vez por entrega.
   *
   * Había dos llamadas a este método en el mismo `ingest()`, así que cada entrega de
   * Cloudflare sumaba DOS al contador: `ingestion_attempts = 2` en CC JFRR.pdf no
   * probaba dos entregas, probaba una. Un contador que significa dos cosas distintas no
   * significa ninguna.
   *
   * `delivery` guarda lo que Cloudflare mismo afirma sobre el mensaje, de modo que la
   * próxima autopsia no dependa de leer el código para interpretar un número.
   */
  async markIngestionStarted(
    organizationId: string,
    documentId: string,
    delivery?: { messageId?: string; attempt?: number },
  ) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        ingestionStartedAt: now,
        ingestionHeartbeatAt: now,
        ingestionStage: "INGRESS",
        ingestionAttempts: sql`${documents.ingestionAttempts} + 1`,
        cfQueueMessageId: delivery?.messageId ?? null,
        cfQueueAttempt: delivery?.attempt ?? null,
        ingestionFailureCode: null,
        ingestionFailureMessage: null,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /**
   * Aplaza la sincronización con el proveedor y fija cuándo reintentarla.
   *
   * El backoff vive en la fila y no en la cola porque una caída de Drive puede durar
   * horas: agotar ahí los tres reintentos del mensaje de inteligencia dejaría el
   * documento sin respaldo y sin nadie que volviera. `provider_sync_next_at` es lo que
   * la barrida de reconciliación consulta.
   */
  async deferProviderSync(
    organizationId: string,
    documentId: string,
    code: string,
    nextAt: string,
  ) {
    await this.db
      .update(documents)
      .set({
        providerSyncState: "DEFERRED",
        providerSyncError: code.slice(0, 120),
        providerSyncAttempts: sql`${documents.providerSyncAttempts} + 1`,
        providerSyncNextAt: nextAt,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /** Fallo definitivo de sincronización: deja de reintentarse y queda para soporte. */
  async markProviderSyncTerminal(organizationId: string, documentId: string, code: string) {
    await this.db
      .update(documents)
      .set({
        providerSyncState: "FAILED_TERMINAL",
        providerSyncError: code.slice(0, 120),
        providerSyncNextAt: null,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /**
   * Documentos cuya sincronización con el proveedor toca reintentar.
   *
   * Acotado por diseño: la barrida no puede reencolar un expediente entero de golpe.
   */
  async listProviderSyncDue(now: string, limit = 25) {
    return this.db
      .select({
        id: documents.id,
        organizationId: documents.organizationId,
        matterId: documents.matterId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.providerSyncState, "DEFERRED"),
          isNull(documents.retiredAt),
          lte(documents.providerSyncNextAt, now),
        ),
      )
      .limit(limit);
  }

  /**
   * Subido al índice, pendiente de confirmar que se recupera.
   *
   * El espejo normalizado YA está escrito y el item YA se envió: lo único que falta es
   * la confirmación, que la barrida hace con una recuperación real. Era esta espera la
   * que bloqueaba al consumidor 110 segundos y convertía un índice lento en un falso
   * «error de procesamiento».
   */
  async markIndexing(
    organizationId: string,
    documentId: string,
    r2MirrorKey: string,
    contentHash: string,
    timings?: Record<string, number>,
  ) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        r2MirrorKey,
        contentHash,
        ingestionStatus: "INDEXING",
        ingestionStage: "AI_SEARCH",
        ingestionHeartbeatAt: now,
        ingestionTimings: timings ? JSON.stringify(timings) : null,
        updatedAt: now,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /** Documentos subidos al índice cuya recuperabilidad falta confirmar. */
  async listAwaitingIndexConfirmation(limit = 25) {
    return this.db
      .select({
        id: documents.id,
        organizationId: documents.organizationId,
        matterId: documents.matterId,
        r2MirrorKey: documents.r2MirrorKey,
        contentHash: documents.contentHash,
      })
      .from(documents)
      .where(and(eq(documents.ingestionStatus, "INDEXING"), isNull(documents.retiredAt)))
      .limit(limit);
  }

  /**
   * Latido: la etapa terminó y el trabajo sigue vivo.
   *
   * Sin esto, declarar «detenido» era pura aritmética sobre `updated_at`, y una
   * conversión legítimamente lenta se declaraba muerta mientras trabajaba. Con el
   * latido, la UI sólo llama muerto a lo que de verdad dejó de dar señales.
   */
  async markIngestionProgress(organizationId: string, documentId: string, stage: string) {
    await this.db
      .update(documents)
      .set({ ingestionHeartbeatAt: new Date().toISOString(), ingestionStage: stage })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /** Deja constancia de DÓNDE y POR QUÉ se detuvo. El abogado ve otra cosa. */
  async markIngestionFailedAt(
    organizationId: string,
    documentId: string,
    stage: string,
    code: string,
    safeMessage: string,
  ) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        ingestionStatus: "ERROR",
        ingestionStage: stage,
        ingestionFailureCode: code,
        ingestionFailureMessage: safeMessage.slice(0, 300),
        ingestionHeartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  async markIndexed(
    organizationId: string,
    documentId: string,
    r2MirrorKey: string,
    contentHash: string,
    timings?: Record<string, number>,
  ) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        r2MirrorKey,
        contentHash,
        indexedAt: now,
        ingestionTimings: timings ? JSON.stringify(timings) : null,
        // `status` es el ciclo de revisión JURÍDICA y no lo mueve un hecho técnico:
        // indexar un documento no significa que un abogado lo haya revisado. Pisarlo
        // aquí era el origen del «En revisión» que confundía a un documento indexado.
        ingestionStatus: "AI_INDEXED",
        updatedAt: now,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
    await this.db
      .update(documentVersions)
      // El checksum de la versión es el hash del binario original y es inmutable.
      // `contentHash` corresponde al Markdown normalizado y vive en `documents`.
      .set({ ingestionStatus: "AI_INDEXED" })
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.isCurrent, true),
        ),
      );
  }

  async markIngestionFailed(organizationId: string, documentId: string) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        ingestionStatus: "ERROR",
        updatedAt: now,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
    await this.db
      .update(documentVersions)
      .set({ ingestionStatus: "ERROR" })
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.isCurrent, true),
        ),
      );
  }
}
