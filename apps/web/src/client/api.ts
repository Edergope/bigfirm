/**
 * Cliente HTTP del frontend. Toda la autorización ocurre en el servidor:
 * este cliente nunca decide qué puede ver el usuario, sólo muestra lo que la API
 * le devuelve dentro de su alcance.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code: string; message: string; details?: Record<string, unknown> } })?.error;
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? `Error ${response.status}`,
      response.status,
      error?.details ?? {},
    );
  }
  return body as T;
}

export interface MeResponse {
  user: { id: string; name: string };
  organization_id: string;
  firm_role: string;
  credits: number;
}

export interface MatterSummary {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  status: string;
  materiality: string;
  practiceAreas: string[];
  jurisdiction: string;
  riskLevel: string;
  riskRationale: string | null;
  objective: string | null;
  updatedAt: string;
}

export interface ExecutionRow {
  id: string;
  agentId: string;
  rootExecutionId: string;
  parentExecutionId: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  creditsConsumed: number | null;
  createdAt: string;
}

export interface ExecutionEventRow {
  event_id: string;
  execution_id: string;
  root_execution_id: string;
  type: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  status: string | null;
  detail: Record<string, string | number | boolean>;
  sequence: number;
  occurred_at: string;
}

export interface MatterDetail {
  matter: MatterSummary;
  members: Array<{ userId: string; role: string; delegatedByUserId: string | null }>;
  documents: Array<{
    id: string;
    name: string;
    mimeType: string;
    classification: string;
    status: string;
    driveFileId: string | null;
    updatedAt: string;
  }>;
  executions: ExecutionRow[];
  facts: Array<{
    id: string;
    factKey: string;
    statement: string;
    certainty: string;
    primarySource: string;
  }>;
  authorities: Array<{
    id: string;
    citation: string;
    type: string;
    status: string;
    ruleSummary: string;
  }>;
  activity: Array<{
    id: string;
    action: string;
    resourceType: string;
    outcome: string;
    reason: string | null;
    occurredAt: string;
  }>;
  access: { via_supervision: boolean; reason: string };
}

export const api = {
  me: () => request<MeResponse>("/api/me"),

  listMatters: () =>
    request<{ matters: MatterSummary[]; scope: "FIRM" | "ASSIGNED" }>("/api/matters"),

  getMatter: (id: string) => request<MatterDetail>(`/api/matters/${id}`),

  createMatter: (input: {
    title: string;
    client_name: string;
    materiality: string;
    practice_areas: string[];
    jurisdiction: string;
    objective?: string;
  }) =>
    request<{ matter: MatterSummary }>("/api/matters", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  startOrchestration: (matterId: string, objective: string) =>
    request<{ root_execution_id: string; workflow_instance_id: string }>(
      `/api/matters/${matterId}/executions`,
      { method: "POST", body: JSON.stringify({ objective }) },
    ),

  executionEvents: (rootExecutionId: string, since = -1) =>
    request<{
      events: ExecutionEventRow[];
      graph: {
        nodes: Array<{
          execution_id: string;
          agent_id: string;
          status: string;
          last_event: string;
          last_event_at: string;
        }>;
        edges: Array<{
          from_agent_id: string;
          to_agent_id: string;
          event_type: string;
          occurred_at: string;
        }>;
      };
      executions: ExecutionRow[];
      last_sequence: number;
    }>(`/api/executions/${rootExecutionId}/events?since=${since}`),

  agents: () =>
    request<{
      agents: Array<{
        agent_id: string;
        node_code: string;
        name: string;
        role: string;
        domain: string;
        enabled: boolean;
        dependencies: string[];
      }>;
      registered: number;
      canonical_total: number;
    }>("/api/agents"),

  devBootstrap: () =>
    request<{ agents_registered: number; credits_balance: number; notice: string }>(
      "/api/dev/bootstrap",
      { method: "POST" },
    ),

  caseBrief: (matterId: string) =>
    request<{ brief: CaseBriefData }>(`/api/matters/${matterId}/brief`),

  routingPreview: (matterId: string) =>
    request<{ plan: RoutingPlanData }>(`/api/matters/${matterId}/routing`),

  listTasks: (matterId: string) =>
    request<{ tasks: TaskRow[] }>(`/api/matters/${matterId}/tasks`),

  createTask: (matterId: string, input: CreateTaskBody) =>
    request<{ task_id: string }>(`/api/matters/${matterId}/tasks`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  integrationsStatus: () =>
    request<{
      storage: { id: string; status: string };
      retrieval: { id: string; status: string };
      notes: Record<string, string>;
    }>("/api/integrations/status"),

  intelligence: {
    caseHealth: (firm: boolean) =>
      request<{ total: number; by_status: Record<string, number>; at_risk: number }>(
        `/api/intelligence/case-health${firm ? "?scope=firm" : ""}`,
      ),
    overdue: (firm: boolean) =>
      request<{ tasks: IntelTask[] }>(
        `/api/intelligence/overdue-tasks${firm ? "?scope=firm" : ""}`,
      ),
    upcoming: (firm: boolean, days = 15) =>
      request<{ deadlines: IntelDeadline[] }>(
        `/api/intelligence/upcoming-deadlines?days=${days}${firm ? "&scope=firm" : ""}`,
      ),
    risks: (firm: boolean) =>
      request<{ risks: IntelRisk[] }>(
        `/api/intelligence/case-risks${firm ? "?scope=firm" : ""}`,
      ),
    inactive: (firm: boolean) =>
      request<{ matters: IntelInactive[] }>(
        `/api/intelligence/inactive-matters${firm ? "?scope=firm" : ""}`,
      ),
  },
};

export interface CaseBriefData {
  matter_id: string;
  objective: string | null;
  matter_type: string[];
  status: string;
  materiality: string;
  parties: Array<{ kind: string; name: string }>;
  risk: { level: string; rationale: string | null };
  facts: Array<{ fact_id: string; statement: string; certainty: string; primary_source: string }>;
  authorities: Array<{ authority_id: string; citation: string; type: string; status: string }>;
  document_count: number;
  deadlines: Array<{ task_id: string; title: string; due_at: string | null; rule: string | null; source: string | null }>;
  open_task_count: number;
  ai_executions: { total: number; completed: number; failed: number };
  open_questions: string[];
  sources: string[];
}

export interface RoutingPlanData {
  materiality: string;
  agents: Array<{ agent_id: string; wave: string; reason: string; executable_now: boolean }>;
  planned_disabled: string[];
  signature: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  dueAt: string | null;
  deadlineRule: string | null;
  deadlineSource: string | null;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  kind?: "TASK" | "PROCEDURAL_DEADLINE" | "HEARING";
  due_at?: string;
  deadline?: {
    rule: string;
    source: string;
    start_date: string;
    term_length: number;
    day_kind: "CALENDAR" | "BUSINESS";
    holidays?: string[];
  };
}

export interface IntelTask {
  task_id: string;
  matter_id: string;
  title: string;
  due_at: string | null;
  kind: string;
}
export interface IntelDeadline {
  task_id: string;
  matter_id: string;
  title: string;
  due_at: string | null;
  rule: string | null;
  source: string | null;
}
export interface IntelRisk {
  matter_id: string;
  title: string;
  risk_level: string;
  rationale: string | null;
}
export interface IntelInactive {
  matter_id: string;
  title: string;
  updated_at: string;
}
