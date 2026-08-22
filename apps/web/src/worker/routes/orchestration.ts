import { Hono } from "hono";
import { z } from "zod";
import { IusiaError, projectStrategyGraph } from "@iusia/domain";
import type { Materiality } from "@iusia/domain";
import { listAgentDefinitions } from "@iusia/agents";
import { WAVE_GATE, buildRoutingPlan, type Wave } from "@iusia/orchestration";
import type { AppBindings } from "../context.js";

export const orchestrationRoutes = new Hono<AppBindings>();

const StartInput = z.object({
  objective: z.string().min(10).max(4000),
});

/** Estimación conservadora de créditos por ejecución del DAG piloto. */
const ESTIMATED_CREDITS_PER_RUN = 300;

/**
 * Inicia una orquestación real sobre un Matter.
 * Devuelve el `root_execution_id`: es la identidad del grafo en la Strategy Room.
 */
orchestrationRoutes.post("/matters/:matterId/executions", async (c) => {
  const { authz, executions, credits, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "execution:start");

  const parsed = StartInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Objetivo de la orquestación inválido", {
      issues: parsed.error.issues,
    });
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
    detail: { workflow_instance: instance.id },
  });

  return c.json(
    { root_execution_id: rootExecutionId, workflow_instance_id: instance.id },
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
    })),
    // Los 27 restantes existen como conocimiento canónico pero no están habilitados.
    registered: listAgentDefinitions().length,
    canonical_total: 30,
  });
});
