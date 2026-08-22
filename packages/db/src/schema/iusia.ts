import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organization, user } from "./auth.js";

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
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("matters_org_reference_uq").on(t.organizationId, t.reference),
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
    linkedBy: text("linked_by")
      .notNull()
      .references(() => user.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("documents_org_matter_idx").on(t.organizationId, t.matterId),
    uniqueIndex("documents_matter_drive_uq").on(t.matterId, t.driveFileId),
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
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("tasks_org_matter_idx").on(t.organizationId, t.matterId),
    index("tasks_org_due_idx").on(t.organizationId, t.dueAt),
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
