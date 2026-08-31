import { Hono } from "hono";
import { z } from "zod";
import {
  IusiaError,
  TERMINAL_STATUSES,
  deriveConclusionText,
  deriveOutcome,
  stripInternalProvenance,
  sanitizeLegalOutput,
  projectStrategyGraph,
  resolveEvidenceDocuments,
} from "@iusia/domain";
import type { Materiality } from "@iusia/domain";
import { getAgentDefinition, listAgentDefinitions } from "@iusia/agents";
import { WAVE_GATE, buildRoutingPlan, type Wave } from "@iusia/orchestration";
import type { AppBindings } from "../context.js";

export const orchestrationRoutes = new Hono<AppBindings>();

const StartInput = z.object({
  objective: z.string().min(10).max(4000),
});

type DocumentReadiness = { name: string; ingestionStatus: string };

/**
 * Estados de ingestión que SÍ justifican esperar: el documento está en camino al
 * índice y arrancar ahora daría un análisis ciego sobre él.
 *
 * `PENDIENTE` no es un valor de `ingestion_status` —pertenece al ciclo de revisión
 * jurídica del documento— y se conserva por compatibilidad con datos antiguos.
 */
const BLOCKING_DOCUMENT_STATUSES = new Set(["PENDIENTE", "PROCESSING"]);

/**
 * Documentos cuya ingestión falló definitivamente. NO bloquean: cero documentos
 * utilizables nunca detiene a IUSIA. Pero tampoco desaparecen en silencio — se
 * declaran al abogado, porque creer que un documento se consideró cuando no se pudo
 * leer es peor que saber que faltó.
 */
const UNAVAILABLE_DOCUMENT_STATUSES = new Set(["ERROR"]);

export function blockingDocumentsForAnalysis(docs: DocumentReadiness[]) {
  return docs.filter((doc) => BLOCKING_DOCUMENT_STATUSES.has(doc.ingestionStatus));
}

export function unavailableDocumentsForAnalysis(docs: DocumentReadiness[]) {
  return docs.filter((doc) => UNAVAILABLE_DOCUMENT_STATUSES.has(doc.ingestionStatus));
}

/** Clasificación completa del expediente antes de convocar al equipo. */
export function classifyDocumentsForAnalysis(docs: DocumentReadiness[]) {
  const blocking = blockingDocumentsForAnalysis(docs);
  const unavailable = unavailableDocumentsForAnalysis(docs);
  return {
    blocking,
    unavailable,
    /** Un expediente sin documentos es un caso NORMAL, no un error. */
    textOnly: docs.length === 0,
  };
}

/** Estimación conservadora de créditos por ejecución del DAG piloto. */
const ESTIMATED_CREDITS_PER_RUN = 300;

/**
 * Inicia una orquestación real sobre un Matter.
 * Devuelve el `root_execution_id`: es la identidad del grafo en la Strategy Room.
 */
orchestrationRoutes.post("/matters/:matterId/executions", async (c) => {
  const { authz, executions, credits, audit, documents } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "execution:start");

  const parsed = StartInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Objetivo de la orquestación inválido", {
      issues: parsed.error.issues,
    });
  }

  const readiness = classifyDocumentsForAnalysis(
    await documents.listForMatter(organizationId, matterId),
  );
  // Sólo se espera por lo que realmente está en camino al índice. Un expediente sin
  // documentos —o con documentos que no pudieron procesarse— arranca igual: el
  // análisis se apoya entonces en los hechos informados por el abogado.
  if (readiness.blocking.length > 0) {
    throw new IusiaError(
      "CONFLICT",
      "Hay documentos del expediente que aún no están listos para recuperación RAG",
      { reason: "INGESTION_PENDING", documents: readiness.blocking.map((doc) => doc.name) },
    );
  }

  // Guard de saldo ANTES de despachar. El cobro real ocurre por ejecución.
  const balance = await credits.balance(organizationId);
  if (balance < ESTIMATED_CREDITS_PER_RUN) {
    throw new IusiaError(
      "INSUFFICIENT_CREDITS",
      "Saldo de créditos insuficiente para iniciar la orquestación",
      { balance, estimated: ESTIMATED_CREDITS_PER_RUN },
    );
  }

  // Ejecución raíz: representa el grafo completo, no un agente concreto.
  const rootExecutionId = await executions.create({
    organizationId,
    matterId,
    agentId: "pisoso-orquestador-juridico",
    parentExecutionId: null,
    rootExecutionId: null,
    startedBy: userId,
  });
  await executions.transition(rootExecutionId, "RUNNING");

  const instance = await c.env.MATTER_ORCHESTRATION.create({
    id: rootExecutionId,
    params: {
      organization_id: organizationId,
      matter_id: matterId,
      root_execution_id: rootExecutionId,
      started_by: userId,
      objective: parsed.data.objective,
    },
  });

  await executions.transition(rootExecutionId, "WAITING", {
    workflowInstanceId: instance.id,
  });

  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "execution.start",
    resourceType: "execution",
    resourceId: rootExecutionId,
    outcome: "SUCCESS",
    detail: {
      workflow_instance: instance.id,
      text_only: readiness.textOnly,
      unavailable_documents: readiness.unavailable.length,
    },
  });

  return c.json(
    {
      root_execution_id: rootExecutionId,
      workflow_instance_id: instance.id,
      // Modo del análisis y advertencias, en lenguaje de despacho. El abogado sabe
      // desde el primer momento sobre qué se está trabajando.
      mode: readiness.textOnly ? "TEXT_ONLY" : "DOCUMENT_BACKED",
      warnings: readiness.unavailable.length
        ? [
            `No fue posible procesar ${readiness.unavailable.length} documento(s) del expediente; el análisis no los tendrá en cuenta: ${readiness.unavailable
              .map((d) => d.name)
              .join(", ")}.`,
          ]
        : [],
    },
    202,
  );
});

/**
 * Eventos de una orquestación. Alimenta la Strategy Room.
 * `since` permite polling incremental y replay determinista desde el inicio.
 */
orchestrationRoutes.get("/executions/:rootExecutionId/events", async (c) => {
  const { authz, executions, events } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const rootExecutionId = c.req.param("rootExecutionId");

  const root = await executions.findById(rootExecutionId);
  if (!root || root.organizationId !== organizationId) {
    throw new IusiaError("NOT_FOUND", "Ejecución no encontrada");
  }
  await authz.authorizeMatter(organizationId, userId, root.matterId, "execution:read");

  const since = Number.parseInt(c.req.query("since") ?? "-1", 10);
  const list = await events.listByRoot(rootExecutionId, Number.isFinite(since) ? since : -1);
  const nodes = await executions.listByRoot(rootExecutionId);

  return c.json({
    events: list,
    // El grafo se deriva de los eventos: si no hay evento, no hay nodo ni arista.
    graph: projectStrategyGraph(list),
    executions: nodes,
    last_sequence: list.at(-1)?.sequence ?? since,
  });
});

/**
 * Análisis en curso de la firma, filtrados por acceso real a cada expediente.
 *
 * Alimenta el indicador global de la aplicación: el abogado puede cerrar la vista
 * del análisis y seguir trabajando sin perder el hilo de lo que IUSIA está haciendo.
 * No expone identificadores de workflow ni detalle técnico: sólo lo necesario para
 * volver al análisis.
 */
orchestrationRoutes.get("/executions/active", async (c) => {
  const { executions, matters, authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");

  const roots = await executions.listActiveRoots(organizationId);
  const visible: Array<{
    root_execution_id: string;
    matter_id: string;
    matter_title: string;
    status: string;
    started_at: string;
  }> = [];

  for (const root of roots) {
    // La visibilidad la decide el ACL de expediente, no la pertenencia a la firma.
    try {
      await authz.authorizeMatter(organizationId, userId, root.matterId, "execution:read");
    } catch {
      continue;
    }
    const matter = await matters.findById(organizationId, root.matterId);
    visible.push({
      root_execution_id: root.id,
      matter_id: root.matterId,
      matter_title: matter?.title ?? root.matterId,
      status: root.status,
      started_at: root.createdAt,
    });
  }

  return c.json({ active: visible });
});

/**
 * Read-model del RESULTADO de una orquestación para la experiencia del abogado.
 *
 * Sólo LEE lo que el motor ya produjo: el texto de salida vive en R2 (la tabla
 * guarda el puntero `outputRef`) y este endpoint lo resuelve junto con la evidencia
 * usada y el desenlace de producto. No ejecuta agentes, no toca el DAG, el RAG, los
 * prompts, el gateway ni el wallet: es la capa de lectura que faltaba para la UI.
 */
orchestrationRoutes.get("/executions/:rootExecutionId/result", async (c) => {
  const { authz, executions, events, documents } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const rootExecutionId = c.req.param("rootExecutionId");

  const root = await executions.findById(rootExecutionId);
  if (!root || root.organizationId !== organizationId) {
    throw new IusiaError("NOT_FOUND", "Ejecución no encontrada");
  }
  await authz.authorizeMatter(organizationId, userId, root.matterId, "execution:read");

  const [nodes, eventList, docs] = await Promise.all([
    executions.listByRoot(rootExecutionId),
    events.listByRoot(rootExecutionId),
    documents.listForMatter(organizationId, root.matterId),
  ]);
  const documentNames = new Map(docs.map((d) => [d.id, d.name]));

  // Evidencia: proviene del tool call real de recuperación registrado en el ledger.
  const retrieval = eventList.find(
    (e) => e.type === "agent.tool.called" && e.detail?.tool === "ai_search.retrieval",
  );
  const evidenceChunkCount = Number(retrieval?.detail?.chunk_count ?? 0);
  const rawDocIds = String(retrieval?.detail?.document_ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const evidenceDocuments = resolveEvidenceDocuments(rawDocIds, documentNames);

  // Salidas de agente: se leen de R2 los nodos COMPLETED con puntero de salida.
  // La fila raíz es el contenedor de la orquestación, no tiene salida propia.
  const agentNodes = nodes.filter(
    (n) => n.id !== rootExecutionId && n.status === "COMPLETED" && n.outputRef,
  );
  // Los especialistas citados en el dictamen son los que participaron: basta su
  // nombre humano para devolverle autoría legible a cada hallazgo.
  const agentDisplayNames = new Map<string, string>();
  for (const n of agentNodes) {
    try {
      agentDisplayNames.set(n.agentId, getAgentDefinition(n.agentId).name);
    } catch {
      // Agente no registrado: se deja su id, nunca un nombre inventado.
    }
  }

  const outputs = (
    await Promise.all(
      agentNodes.map(async (n) => {
        const obj = await c.env.ARTIFACTS.get(n.outputRef!);
        if (!obj) return null;
        const stored = await obj.json<{
          text?: string;
          provenance?: { model?: string; provider?: string; produced_at?: string };
        }>();
        let name = n.agentId;
        let nodeCode = "";
        try {
          const def = getAgentDefinition(n.agentId);
          name = def.name;
          nodeCode = def.node_code;
        } catch {
          // Agente no registrado: se muestra el id crudo, sin inventar metadata.
        }
        const text = stored.text ?? "";
        // La ejecución PLAN (00) persiste el TeamPlan (sin `text`), no un dictamen:
        // se excluye del resultado para no competir con el INTEGRATE como titular.
        if (text.trim().length === 0) return null;
        return {
          execution_id: n.id,
          agent_id: n.agentId,
          node_code: nodeCode,
          agent_name: name,
          // Titular humano ya parseado (p.ej. conclusion_brief), saneado de fontanería:
          // sin el encabezado de procedencia ni las referencias internas que algunos
          // agentes intercalan al integrar. Esa trazabilidad vive en el ledger y en
          // `text`, que se entrega íntegro para la vista de salida estructurada.
          summary: sanitizeLegalOutput(
            stripInternalProvenance(deriveConclusionText(text)),
            agentDisplayNames,
            documentNames,
          ),
          text,
          provider: stored.provenance?.provider ?? n.provider ?? null,
          model: stored.provenance?.model ?? n.model ?? null,
          produced_at: stored.provenance?.produced_at ?? n.completedAt ?? null,
        };
      }),
    )
  )
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .sort((a, b) => a.node_code.localeCompare(b.node_code));

  return c.json({
    root_execution_id: rootExecutionId,
    status: root.status,
    outcome: deriveOutcome({ rootStatus: root.status, evidenceChunkCount, documentCount: docs.length }),
    outputs,
    evidence: { chunk_count: evidenceChunkCount, documents: evidenceDocuments },
    mode: docs.length === 0 ? "TEXT_ONLY" : "DOCUMENT_BACKED",
    // Advertencia humana: un análisis sin soporte documental es válido, pero el
    // abogado debe saber sobre qué base se produjo. Nunca se inventa soporte.
    notices: groundingNotices({
      documentCount: docs.length,
      evidenceChunkCount,
      rootStatus: root.status,
    }),
  });
});

/** Avisos de grounding en lenguaje de despacho, derivados de datos reales. */
export function groundingNotices(args: {
  documentCount: number;
  evidenceChunkCount: number;
  rootStatus: string;
}): string[] {
  if (!TERMINAL_STATUSES.includes(args.rootStatus as (typeof TERMINAL_STATUSES)[number])) {
    return [];
  }
  if (args.documentCount === 0) {
    return [
      "El análisis se basa en los hechos informados en el expediente y deberá contrastarse con la documentación que posteriormente se aporte.",
    ];
  }
  if (args.evidenceChunkCount === 0) {
    return [
      "No se recuperó soporte documental relevante para este análisis. Las conclusiones se apoyan en los hechos informados en el expediente.",
    ];
  }
  return [];
}

const ApproveGateInput = z.object({
  wave: z.string().min(1),
  approved: z.boolean(),
});

/** Aprobación humana de un gate. Reanuda el Workflow que está esperando. */
orchestrationRoutes.post("/executions/:rootExecutionId/gates", async (c) => {
  const { authz, executions, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const rootExecutionId = c.req.param("rootExecutionId");

  const root = await executions.findById(rootExecutionId);
  if (!root || root.organizationId !== organizationId) {
    throw new IusiaError("NOT_FOUND", "Ejecución no encontrada");
  }
  await authz.authorizeMatter(organizationId, userId, root.matterId, "gate:approve");

  const parsed = ApproveGateInput.safeParse(await c.req.json());
  if (!parsed.success || !(parsed.data.wave in WAVE_GATE)) {
    throw new IusiaError("VALIDATION_FAILED", "Gate inválido");
  }

  if (!root.workflowInstanceId) {
    throw new IusiaError("CONFLICT", "La ejecución no tiene un workflow asociado");
  }

  const instance = await c.env.MATTER_ORCHESTRATION.get(root.workflowInstanceId);
  await instance.sendEvent({
    type: `gate.approval.${WAVE_GATE[parsed.data.wave as Wave]}`,
    payload: { approved: parsed.data.approved, user_id: userId },
  });

  await audit.record({
    organizationId,
    matterId: root.matterId,
    actorUserId: userId,
    action: "gate.decision",
    resourceType: "gate",
    resourceId: WAVE_GATE[parsed.data.wave as Wave],
    outcome: parsed.data.approved ? "ALLOWED" : "DENIED",
  });

  return c.json({ ok: true });
});

/**
 * Cancela una orquestación en curso: termina el Workflow durable y marca la
 * ejecución raíz como CANCELLED en el ledger, con evento y auditoría.
 */
orchestrationRoutes.post("/executions/:rootExecutionId/cancel", async (c) => {
  const { authz, executions, events, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const rootExecutionId = c.req.param("rootExecutionId");

  const root = await executions.findById(rootExecutionId);
  const systemSuperadmin = await authz.isSystemSuperadmin(userId);
  if (!root || (root.organizationId !== organizationId && !systemSuperadmin)) {
    throw new IusiaError("NOT_FOUND", "Ejecución no encontrada");
  }
  const control = await authz.authorizeExecutionCancel(userId, root);

  if (TERMINAL_STATUSES.includes(root.status as (typeof TERMINAL_STATUSES)[number])) {
    if (root.status === "CANCELLED") {
      return c.json({ ok: true, status: "CANCELLED" });
    }
    throw new IusiaError("CONFLICT", "La ejecución ya finalizó y no puede cancelarse", {
      status: root.status,
    });
  }

  // Termina el motor durable si existe; su ausencia no impide cancelar el ledger.
  if (root.workflowInstanceId) {
    try {
      const instance = await c.env.MATTER_ORCHESTRATION.get(root.workflowInstanceId);
      await instance.terminate();
    } catch {
      // El workflow puede haber terminado por su cuenta; se cancela igual el ledger.
    }
  }

  await executions.transition(rootExecutionId, "CANCELLED", {
    errorCode: control.reason,
    errorMessage: `Cancelada por ${control.actorControlRole}`,
  });
  // Ninguna ejecución hija puede quedar viva en el ledger tras cancelar la raíz: el
  // registro afirmaría trabajo en curso que ya no ocurre, y un resultado tardío no
  // debe encontrar un nodo abierto donde aterrizar.
  const cancelledChildren = await executions.cancelDescendants(rootExecutionId, control.reason);
  await events.append({
    organizationId: root.organizationId,
    matterId: root.matterId,
    rootExecutionId,
    executionId: rootExecutionId,
    type: "agent.cancelled",
    status: "CANCELLED",
    detail: {
      actor_control_role: control.actorControlRole,
      reason: control.reason,
      cancelled_children: cancelledChildren,
    },
  });
  await audit.record({
    organizationId: root.organizationId,
    matterId: root.matterId,
    actorUserId: userId,
    action: "execution.cancel",
    resourceType: "execution",
    resourceId: rootExecutionId,
    outcome: "SUCCESS",
    reason: control.reason,
    detail: {
      actor_control_role: control.actorControlRole,
      root_execution_id: rootExecutionId,
    },
  });

  return c.json({ ok: true, status: "CANCELLED" });
});

/**
 * Preview del plan de routing para un Matter, sin ejecutar. Muestra qué agentes
 * intervendrían según materialidad y áreas de práctica (decisión determinista).
 */
orchestrationRoutes.get("/matters/:matterId/routing", async (c) => {
  const { authz, matters } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "matter:read");
  const matter = await matters.findById(organizationId, matterId);
  if (!matter) throw new IusiaError("NOT_FOUND", "Expediente no encontrado");

  const plan = buildRoutingPlan(
    {
      materiality: matter.materiality as Materiality,
      practice_areas: matter.practiceAreas,
    },
    listAgentDefinitions(),
  );
  return c.json({ plan });
});

/** Agentes registrados. La UI nunca inventa nodos que no existan aquí. */
orchestrationRoutes.get("/agents", (c) => {
  return c.json({
    agents: listAgentDefinitions().map((a) => ({
      agent_id: a.agent_id,
      node_code: a.node_code,
      name: a.name,
      role: a.role,
      domain: a.domain,
      enabled: a.enabled,
      output_type: a.output_type,
      dependencies: a.dependencies,
      parallelizable: a.parallelizable,
      prompt_version: a.prompt_version,
      // Clasificación operacional (Bloque 7.7B). Nunca el prompt ni su hash.
      runtime_role: a.runtime_role,
      planner_eligible: a.planner_eligible,
      specialty: a.specialty,
    })),
    // Los 27 restantes existen como conocimiento canónico pero no están habilitados.
    registered: listAgentDefinitions().length,
    canonical_total: 30,
  });
});
