import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { account, organization, user } from "./auth.js";

/**
 * Esquema de dominio de IUSIA.
 *
 * Regla multitenancy: toda tabla tenant-bound lleva `organization_id` y sus índices
 * empiezan por esa columna. No existe la fase "single-tenant primero".
 */

const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

// ─────────────────────────────── Matters ───────────────────────────────

export const matters = sqliteTable(
  "matters",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    clientName: text("client_name").notNull(),
    status: text("status").notNull().default("INTAKE"),
    materiality: text("materiality").notNull().default("SIMPLE"),
    /** JSON array de PracticeArea. */
    practiceAreas: text("practice_areas", { mode: "json" })
      .notNull()
      .$type<string[]>(),
    jurisdiction: text("jurisdiction").notNull(),
    /** JSON array de MatterParty. */
    parties: text("parties", { mode: "json" }).notNull().$type<unknown[]>(),
    objective: text("objective"),
    riskLevel: text("risk_level").notNull().default("UNASSESSED"),
    riskRationale: text("risk_rationale"),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    /**
     * Identidad de la convocatoria que creó este expediente. Una acción humana es UNA
     * operación lógica: el doble clic, el reintento de red y el re-submit tras una
     * respuesta incierta comparten clave y devuelven el MISMO expediente.
     */
    creationRequestKey: text("creation_request_key"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("matters_org_reference_uq").on(t.organizationId, t.reference),
    uniqueIndex("matters_creation_request_key_uq").on(t.creationRequestKey),
    index("matters_org_status_idx").on(t.organizationId, t.status),
    index("matters_org_updated_idx").on(t.organizationId, t.updatedAt),
  ],
);

/** ACL por Matter. Es la tabla que hace real la autorización contextual de IUSIA. */
export const matterMembers = sqliteTable(
  "matter_members",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** MatterRole: OWNER | COLLABORATOR | REVIEWER | ASSISTANT | EXTERNAL | READ_ONLY */
    role: text("role").notNull(),
    /** Cuando un asistente actúa por delegación, aquí queda el abogado responsable. */
    delegatedByUserId: text("delegated_by_user_id").references(() => user.id),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    uniqueIndex("matter_members_matter_user_uq").on(t.matterId, t.userId),
    index("matter_members_org_user_idx").on(t.organizationId, t.userId),
  ],
);

// ────────────────────────────── Documentos ─────────────────────────────

/**
 * Metadata documental de IUSIA. El archivo del usuario vive en Google Drive;
 * aquí sólo se guardan referencias, clasificación y estado de revisión.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    /** DRIVE | R2_SYSTEM | UPLOAD */
    source: text("source").notNull().default("DRIVE"),
    driveFileId: text("drive_file_id"),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    /** FUENTE | TRABAJO_INTERNO | ENTREGABLE | ANEXO */
    classification: text("classification").notNull().default("FUENTE"),
    /** PENDIENTE | EN_REVISION | REVISADO | CRITICO | APROBADO | SUSTITUIDO */
    status: text("status").notNull().default("PENDIENTE"),
    contentHash: text("content_hash"),
    /** Espejo normalizado en R2 para indexación; null si aún no se ha generado. */
    r2MirrorKey: text("r2_mirror_key"),
    indexedAt: text("indexed_at"),
    /** Retiro lógico: conserva Drive/R2 e historial, pero lo excluye del workspace y RAG. */
    retiredAt: text("retired_at"),
    retiredBy: text("retired_by").references(() => user.id),
    retiredReason: text("retired_reason"),
    /** Versión vigente del documento lógico. El binario permanece en Drive. */
    currentVersion: integer("current_version").notNull().default(1),
    sizeBytes: integer("size_bytes"),
    /** FILE_STORED | PROCESSING | AI_INDEXED | NOT_INDEXABLE | ERROR */
    ingestionStatus: text("ingestion_status").notNull().default("FILE_STORED"),
    /** Telemetría de ingestión. De operación: nunca se muestra al abogado. */
    ingestionEnqueuedAt: text("ingestion_enqueued_at"),
    ingestionStartedAt: text("ingestion_started_at"),
    /** Duraciones por etapa en ms, como JSON. Se leen juntas o no se leen. */
    ingestionTimings: text("ingestion_timings"),
    ingestionAttempts: integer("ingestion_attempts").notNull().default(0),
    /** Última señal de vida del trabajo. Distingue «trabajando» de «abandonado». */
    ingestionHeartbeatAt: text("ingestion_heartbeat_at"),
    /** Etapa en curso o en la que se detuvo. */
    ingestionStage: text("ingestion_stage"),
    /** Clasificación del fallo. Para soporte; nunca se muestra al abogado. */
    ingestionFailureCode: text("ingestion_failure_code"),
    ingestionFailureMessage: text("ingestion_failure_message"),
    /** PENDING | SYNCED | DEFERRED. Procedencia, no inteligencia: puede ir por detrás. */
    providerSyncState: text("provider_sync_state"),
    providerSyncError: text("provider_sync_error"),
    /** Contador PROPIO: una caída del proveedor no gasta los reintentos de la ingestión. */
    providerSyncAttempts: integer("provider_sync_attempts").notNull().default(0),
    providerSyncNextAt: text("provider_sync_next_at"),
    /** Identidad que asigna Cloudflare al mensaje, y su número de entrega. */
    cfQueueMessageId: text("cf_queue_message_id"),
    cfQueueAttempt: integer("cf_queue_attempt"),
    /** Lote de carga. Correlación, NO transacción: un fallo no toca a los demás. */
    uploadBatchId: text("upload_batch_id"),
    /**
     * Provenance del entregable generado por IUSIA. Vive EN EL DOCUMENTO, no sólo en
     * `audit_events`: de un DOCX debe poder reconstruirse su plantilla, su ejecución,
     * su agente redactor y el hash del prompt canónico sin recorrer la auditoría.
     * Null en documentos aportados por el despacho.
     */
    contentSource: text("content_source"),
    generatedFromTemplateId: text("generated_from_template_id"),
    generatedFromTemplateVersion: integer("generated_from_template_version"),
    generatedByExecutionId: text("generated_by_execution_id"),
    generatedByAgentId: text("generated_by_agent_id"),
    generatedPromptSha256: text("generated_prompt_sha256"),
    generatedModel: text("generated_model"),
    /** Tarea del expediente que originó este borrador, si nació de una. */
    originTaskId: text("origin_task_id"),
    linkedBy: text("linked_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("documents_org_matter_idx").on(t.organizationId, t.matterId),
    index("documents_batch_idx").on(t.organizationId, t.uploadBatchId),
    uniqueIndex("documents_matter_drive_uq").on(t.matterId, t.driveFileId),
  ],
);

/**
 * Historial inmutable de binarios de un documento lógico. Cada versión conserva
 * su propio id de Drive; `documents.drive_file_id` es sólo el puntero vigente.
 */
export const documentVersions = sqliteTable(
  "document_versions",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    /** `null` mientras los bytes viven sólo en el ingreso durable. */
    driveFileId: text("drive_file_id"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes"),
    checksum: text("checksum"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull(),
    changeType: text("change_type").notNull().default("ORIGINAL"),
    changeSummary: text("change_summary").notNull().default("Versión inicial"),
    ingestionStatus: text("ingestion_status").notNull().default("FILE_STORED"),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    uniqueIndex("document_versions_number_uq").on(t.documentId, t.versionNumber),
    uniqueIndex("document_versions_drive_uq").on(t.matterId, t.driveFileId),
    index("document_versions_org_document_idx").on(t.organizationId, t.documentId),
    index("document_versions_org_current_idx").on(t.organizationId, t.matterId, t.isCurrent),
  ],
);

// ──────────────────────────── Tareas y términos ────────────────────────

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** TASK | PROCEDURAL_DEADLINE | HEARING */
    kind: text("kind").notNull().default("TASK"),
    status: text("status").notNull().default("PENDIENTE"),
    dueAt: text("due_at"),
    /** Para términos procesales: regla y fuente del cálculo. Sin fuente no es un término. */
    deadlineRule: text("deadline_rule"),
    deadlineSource: text("deadline_source"),
    assignedTo: text("assigned_to").references(() => user.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    /** Clase de actuación jurídica. Decide la acción primaria de la tarjeta. */
    actionType: text("action_type"),
    /** Documento a producir, sólo para DOCUMENT_DRAFT. Selecciona la plantilla. */
    documentIntent: text("document_intent"),
    /** Análisis que PROPUSO esta tarea. */
    sourceExecutionId: text("source_execution_id"),
    /** Borrador ya generado a partir de la tarea. */
    generatedDocumentId: text("generated_document_id"),
    /** Ejecución que REDACTÓ el borrador. Distinta de la que propuso la tarea. */
    documentGenerationExecutionId: text("document_generation_execution_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("tasks_org_matter_idx").on(t.organizationId, t.matterId),
    index("tasks_org_due_idx").on(t.organizationId, t.dueAt),
    index("tasks_org_matter_status_idx").on(t.organizationId, t.matterId, t.status),
  ],
);

// ───────────────────────────── Fact / Authority ────────────────────────

export const facts = sqliteTable(
  "facts",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    statement: text("statement").notNull(),
    /** Código canónico de certeza: [F] [A] [D] [I] [C] [U] [R] [X] */
    certainty: text("certainty").notNull(),
    sourceClass: text("source_class").notNull(),
    primarySource: text("primary_source").notNull(),
    numbers: text("numbers", { mode: "json" }).$type<unknown[]>(),
    /** Ejecución que estableció el hecho; null si lo capturó una persona. */
    establishedByExecutionId: text("established_by_execution_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("facts_matter_key_uq").on(t.matterId, t.factKey),
    index("facts_org_matter_idx").on(t.organizationId, t.matterId),
  ],
);

export const authorities = sqliteTable(
  "authorities",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    authorityKey: text("authority_key").notNull(),
    citation: text("citation").notNull(),
    type: text("type").notNull(),
    /** VERIFIED_CURRENT | SUPERSEDED | REQUIRES_CALIBRATION */
    status: text("status").notNull().default("REQUIRES_CALIBRATION"),
    ruleSummary: text("rule_summary").notNull(),
    verifiedAt: text("verified_at"),
    establishedByExecutionId: text("established_by_execution_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("authorities_matter_key_uq").on(t.matterId, t.authorityKey),
    index("authorities_org_matter_idx").on(t.organizationId, t.matterId),
  ],
);

// ──────────────────────── Agentes y ejecuciones ────────────────────────

/**
 * Prompt Registry. La metadata del agente vive aquí; el conocimiento jurídico
 * permanece en `agent.md` y su artefacto versionado en R2. Nunca se guarda el
 * texto del prompt en esta tabla.
 */
export const agentDefinitions = sqliteTable(
  "agent_definitions",
  {
    agentId: text("agent_id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    domain: text("domain").notNull(),
    /** Clave R2 del artefacto de prompt desplegado. */
    promptRef: text("prompt_ref").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptSha256: text("prompt_sha256").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    modelPolicy: text("model_policy", { mode: "json" }).notNull().$type<unknown>(),
    toolsPolicy: text("tools_policy", { mode: "json" }).notNull().$type<string[]>(),
    outputType: text("output_type").notNull(),
    outputSchemaId: text("output_schema_id").notNull(),
    parallelizable: integer("parallelizable", { mode: "boolean" })
      .notNull()
      .default(true),
    timeoutMs: integer("timeout_ms").notNull().default(120_000),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("agent_definitions_enabled_idx").on(t.enabled)],
);

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    parentExecutionId: text("parent_execution_id"),
    /** Ejecución raíz del DAG: agrupa el grafo completo de la Strategy Room. */
    rootExecutionId: text("root_execution_id").notNull(),
    workflowInstanceId: text("workflow_instance_id"),
    /**
     * Identidad lógica del despacho (`<root>:plan`, `<root>:task:<id>`, …). Hace que
     * un reintento técnico del Workflow reutilice la MISMA ejecución jurídica, y con
     * ella la misma clave de idempotencia de créditos.
     */
    dispatchKey: text("dispatch_key"),
    status: text("status").notNull().default("PENDING"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    promptSha256: text("prompt_sha256"),
    workPackageRef: text("work_package_ref"),
    outputRef: text("output_ref"),
    outputType: text("output_type"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    providerCostUsd: real("provider_cost_usd"),
    creditsConsumed: integer("credits_consumed"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retries: integer("retries").notNull().default(0),
    startedBy: text("started_by").references(() => user.id),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("executions_org_matter_idx").on(t.organizationId, t.matterId),
    index("executions_root_idx").on(t.rootExecutionId),
    index("executions_parent_idx").on(t.parentExecutionId),
    uniqueIndex("executions_dispatch_key_uq").on(t.dispatchKey),
  ],
);

export const executionEvents = sqliteTable(
  "execution_events",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id").notNull(),
    rootExecutionId: text("root_execution_id").notNull(),
    executionId: text("execution_id").notNull(),
    type: text("type").notNull(),
    fromAgentId: text("from_agent_id"),
    toAgentId: text("to_agent_id"),
    status: text("status"),
    detail: text("detail", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    sequence: integer("sequence").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("execution_events_root_seq_uq").on(t.rootExecutionId, t.sequence),
    index("execution_events_execution_idx").on(t.executionId),
  ],
);

/** Auditoría jurídica. Separada de los logs técnicos: es registro de decisiones. */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id"),
    actorUserId: text("actor_user_id").references(() => user.id),
    /** Cuando el actor es una ejecución de IA y no una persona. */
    actorExecutionId: text("actor_execution_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [
    index("audit_events_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("audit_events_matter_idx").on(t.matterId),
  ],
);

// ─────────────────────────────── Créditos ──────────────────────────────

export const creditWallets = sqliteTable("credit_wallets", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const creditTransactions = sqliteTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    matterId: text("matter_id"),
    executionId: text("execution_id"),
    userId: text("user_id").references(() => user.id),
    provider: text("provider"),
    model: text("model"),
    providerCostUsd: real("provider_cost_usd"),
    /** Impide doble cobro cuando un Workflow o una Queue reintenta. */
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("credit_transactions_idempotency_uq").on(t.idempotencyKey),
    index("credit_transactions_org_idx").on(t.organizationId, t.createdAt),
  ],
);

// ─────────────────────────── Notification Ledger ───────────────────────────

/**
 * Ledger persistente de notificaciones. Fuente de trazabilidad de todo envío,
 * incluso cuando el proveedor está NOT_CONFIGURED o falla. Nunca almacena
 * secretos ni el contenido jurídico completo — sólo metadata suficiente.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    matterId: text("matter_id"),
    executionId: text("execution_id"),
    recipient: text("recipient").notNull(),
    channel: text("channel").notNull().default("EMAIL"),
    event: text("event").notNull(),
    subject: text("subject"),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    /** PENDING | SENT | NOT_CONFIGURED | FAILED */
    status: text("status").notNull().default("PENDING"),
    normalizedError: text("normalized_error"),
    correlationId: text("correlation_id"),
    /** Metadata operativa no sensible (referencias, conteos). */
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull(),
    attemptedAt: text("attempted_at"),
    sentAt: text("sent_at"),
  },
  (t) => [
    index("notifications_org_created_idx").on(t.organizationId, t.createdAt),
    index("notifications_matter_idx").on(t.matterId),
  ],
);

// ──────────────────────── Workspace documental (Drive) ────────────────────────

/**
 * Credencial de almacenamiento de la firma. Sólo referencia la cuenta cifrada de
 * Better Auth: IUSIA nunca copia ni expone access/refresh tokens.
 */
export const organizationStorageConnections = sqliteTable(
  "organization_storage_connections",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    provider: text("provider").notNull().default("GOOGLE_DRIVE"),
    accountId: text("account_id").notNull().references(() => account.id),
    storageOwnerUserId: text("storage_owner_user_id").notNull().references(() => user.id),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("org_storage_connection_uq").on(t.organizationId, t.provider)],
);

/** Conexión técnica global del Template Bank; separada del storage de cada Matter. */
export const platformStorageConnections = sqliteTable(
  "platform_storage_connections",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("GOOGLE_DRIVE"),
    accountId: text("account_id").notNull().references(() => account.id),
    storageOwnerUserId: text("storage_owner_user_id").notNull().references(() => user.id),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("platform_storage_provider_uq").on(t.provider)],
);

/**
 * Carpetas de Drive gestionadas por IUSIA, con su id persistido para idempotencia.
 *
 * No se busca por nombre en cada operación: una vez creada la carpeta, su id vive
 * aquí y se reutiliza. La clave única (org, kind, scopeId) evita duplicados en
 * reintentos —`scopeId` es el matterId para carpetas de expediente, o "" para las
 * de firma (ROOT/FIRM/MATTERS/TEMPLATES), únicas por organización—.
 */
export const driveFolders = sqliteTable(
  "drive_folders",
  {
    id: text("id").primaryKey(),
    organizationId: orgId(),
    /** ROOT | FIRM | MATTERS | TEMPLATES | MATTER | UPLOADED | GENERATED */
    kind: text("kind").notNull(),
    /** matterId para carpetas de expediente; "" para las de firma. */
    scopeId: text("scope_id").notNull().default(""),
    driveFolderId: text("drive_folder_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("drive_folders_uq").on(t.organizationId, t.kind, t.scopeId),
    index("drive_folders_org_idx").on(t.organizationId),
  ],
);

/**
 * Plantillas documentales. La fuente de verdad del CONTENIDO/versión es esta tabla
 * más el repo (definición canónica); el archivo operativo de Google Docs vive en
 * Drive y se referencia por `sourceRef`. Un archivo generado NUNCA es source of
 * truth de la plantilla.
 */
export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    /** SYSTEM (institucional, visible a todas) | ORGANIZATION (propia de la firma). */
    scope: text("scope").notNull().default("SYSTEM"),
    organizationId: text("organization_id"),
    name: text("name").notNull(),
    /** Tipo documental: OPINION | CONTRATO | DEMANDA | MEMORANDO | ... */
    documentType: text("document_type").notNull(),
    version: integer("version").notNull().default(1),
    /** DRAFT | ACTIVE | ARCHIVED */
    status: text("status").notNull().default("ACTIVE"),
    /** GOOGLE_DOCS | DOCXTEMPLATER */
    engine: text("engine").notNull().default("GOOGLE_DOCS"),
    /** Id del Google Doc plantilla en Drive (para files.copy), o clave R2. */
    sourceRef: text("source_ref"),
    /** Id del DOCX original preservado en Drive; sourceRef puede ser su Google Doc operativo. */
    originalSourceRef: text("original_source_ref"),
    familyId: text("family_id").notNull().default(""),
    category: text("category").notNull().default("General"),
    description: text("description"),
    mimeType: text("mime_type").notNull().default("application/vnd.google-apps.document"),
    checksum: text("checksum"),
    originalFilename: text("original_filename"),
    /** Variables requeridas: [{ key, label, required }]. */
    variables: text("variables", { mode: "json" }).$type<
      Array<{ key: string; label: string; required: boolean; placeholder?: string }>
    >(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("templates_scope_type_idx").on(t.scope, t.documentType),
    index("templates_org_idx").on(t.organizationId),
    index("templates_family_version_idx").on(t.familyId, t.version),
  ],
);
