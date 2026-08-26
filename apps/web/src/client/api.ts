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
  /** Capacidad de sistema resuelta server-side. La UI la lee; nunca autoriza con ella. */
  system_role: string | null;
  is_system_superadmin: boolean;
}

export interface DocumentEntry {
  id: string;
  name: string;
  mime_type: string;
  status: string;
  classification: string;
  drive_file_id: string | null;
  current_version: number;
  size_bytes: number | null;
  ingestion_status: string;
  updated_at: string;
}

export interface DocumentVersionEntry {
  id: string;
  version_number: number;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  checksum: string | null;
  created_by: string;
  created_at: string;
  change_type: string;
  change_summary: string;
  ingestion_status: string;
  is_current: boolean;
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
  members: Array<{
    userId: string;
    role: string;
    delegatedByUserId: string | null;
    name: string;
    email: string;
  }>;
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

  activeAnalyses: () =>
    request<{
      active: Array<{
        root_execution_id: string;
        matter_id: string;
        matter_title: string;
        status: string;
        started_at: string;
      }>;
    }>("/api/executions/active"),

  executionResult: (rootExecutionId: string) =>
    request<ExecutionResult>(`/api/executions/${rootExecutionId}/result`),

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
        runtime_role: string;
        planner_eligible: boolean;
        specialty: string;
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

  setTaskStatus: (
    matterId: string,
    taskId: string,
    status: "PENDIENTE" | "EN_CURSO" | "COMPLETADA" | "CANCELADA",
  ) =>
    request<{ ok: boolean }>(`/api/matters/${matterId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  cancelExecution: (rootExecutionId: string) =>
    request<{ ok: boolean; status: string }>(`/api/executions/${rootExecutionId}/cancel`, {
      method: "POST",
    }),

  firmMembers: () =>
    request<{ members: Array<{ userId: string; role: string; name: string; email: string; createdAt: string }> }>(
      "/api/admin/members",
    ),

  firmInvitations: () =>
    request<{
      invitations: Array<{ id: string; email: string; role: string | null; status: string; expires_at: string; created_at: string }>;
    }>("/api/admin/invitations"),

  setMemberRole: (userId: string, role: string) =>
    request<{ ok: boolean }>("/api/admin/members/role", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role }),
    }),

  removeMember: (userId: string) =>
    request<{ ok: boolean }>("/api/admin/members/remove", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),

  matterAccess: () =>
    request<{
      matters: Array<{
        matter_id: string;
        reference: string;
        title: string;
        members: Array<{ user_id: string; name: string; email: string; role: string }>;
      }>;
    }>("/api/admin/matter-access"),

  systemExecutions: () =>
    request<{
      executions: Array<{
        root_execution_id: string; matter_id: string; matter_title: string;
        status: string; started_at: string; completed_at: string | null;
        error_code: string | null; agents: number; credits: number;
      }>;
    }>("/api/admin/system/executions"),

  firmIntegrations: () =>
    request<Record<string, unknown>>("/api/admin/integrations"),

  driveStatus: () =>
    request<{ connected: boolean; write?: boolean; reason?: string }>(
      "/api/integrations/drive/status",
    ),

  integrationsStatus: () =>
    request<{
      storage: { id: string; status: string };
      retrieval: { id: string; status: string };
      notes: Record<string, string>;
    }>("/api/integrations/status"),

  matterWorkspace: (matterId: string) =>
    request<{
      uploaded: DocumentEntry[];
      generated: DocumentEntry[];
    }>(`/api/matters/${matterId}/workspace`),

  /** Sube documentos aportados a Drive vía multipart. No usa el helper JSON. */
  uploadDocuments: async (matterId: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const res = await fetch(`/api/matters/${matterId}/documents/upload`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code: string; message: string } })?.error;
      throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? "No fue posible subir", res.status);
    }
    return body as { uploaded: Array<{ document_id: string; name: string; status: string }> };
  },

  documentVersions: (matterId: string, documentId: string) =>
    request<{ versions: DocumentVersionEntry[] }>(
      `/api/matters/${matterId}/documents/${documentId}/versions`,
    ),

  documentContentUrl: (matterId: string, documentId: string, version?: number, download = false) => {
    const params = new URLSearchParams();
    if (version) params.set("version", String(version));
    if (download) params.set("download", "1");
    const query = params.size > 0 ? `?${params}` : "";
    return `/api/matters/${matterId}/documents/${documentId}/content${query}`;
  },

  uploadDocumentVersion: async (
    matterId: string,
    documentId: string,
    input: { file: File; changeType: string; changeSummary: string },
  ) => {
    const form = new FormData();
    form.append("file", input.file);
    form.append("change_type", input.changeType);
    form.append("change_summary", input.changeSummary);
    const res = await fetch(`/api/matters/${matterId}/documents/${documentId}/versions`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code: string; message: string } })?.error;
      throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? "No fue posible subir la versión", res.status);
    }
    return body as { version_number: number; ingestion_status: string };
  },

  listTemplates: () =>
    request<{
      templates: Array<{
        id: string;
        name: string;
        document_type: string;
        version: number;
        status: string;
        scope: string;
        family_id: string;
        category: string;
        description: string | null;
        mime_type: string;
        original_filename: string | null;
        variables: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
      }>;
    }>("/api/templates"),

  templateContentUrl: (templateId: string, download = false) =>
    `/api/templates/${templateId}/content${download ? "?download=1" : ""}`,

  adminTemplates: () =>
    request<{
      templates: Array<{
        id: string; family_id: string; name: string; document_type: string;
        category: string; description: string | null; version: number; status: string;
        scope: string; mime_type: string; checksum: string | null;
        original_filename: string | null; variables: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
        created_by: string | null; created_at: string; updated_at: string;
      }>;
    }>("/api/admin/templates"),

  createTemplate: async (input: {
    file: File; name: string; documentType: string; category: string;
    description: string; familyId?: string; activate?: boolean;
    variables?: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
  }) => {
    const form = new FormData();
    form.append("file", input.file);
    form.append("name", input.name);
    form.append("document_type", input.documentType);
    form.append("category", input.category);
    form.append("description", input.description);
    if (input.familyId) form.append("family_id", input.familyId);
    form.append("activate", String(input.activate !== false));
    form.append("variables", JSON.stringify(input.variables ?? []));
    const res = await fetch("/api/admin/templates", { method: "POST", credentials: "include", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code: string; message: string } })?.error;
      throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? "No fue posible registrar la plantilla", res.status);
    }
    return body as { id: string; familyId: string; version: number };
  },

  importOfficialTemplates: () =>
    request<{
      imported: Array<{ id: string; name: string; version: number; checksum: string }>;
      skipped: Array<{ name: string; checksum: string; reason: string }>;
    }>("/api/admin/templates/import-official", { method: "POST" }),

  setTemplateStatus: (templateId: string, status: "ACTIVE" | "INACTIVE" | "RETIRED") =>
    request<{ ok: true; status: string }>(`/api/admin/templates/${templateId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  generateDocument: (
    matterId: string,
    documentType: string,
    // Sin `values` → IUSIA redacta el contenido con el agente 08; `instructions` lo orienta.
    opts: { values?: Record<string, string>; instructions?: string } = {},
  ) =>
    request<{
      docx: { name: string; document_id: string };
      pdf: { name: string; document_id: string };
      content_source: "AGENT" | "MANUAL";
      drafted_by?: string;
    }>(`/api/matters/${matterId}/generate`, {
      method: "POST",
      body: JSON.stringify({
        document_type: documentType,
        ...(opts.values ? { values: opts.values } : {}),
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
      }),
    }),

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
    workload: () =>
      request<{ workload: Array<{ assignedTo: string | null; name: string | null; openTasks: number }> }>(
        "/api/intelligence/workload",
      ),
    inactive: (firm: boolean) =>
      request<{ matters: IntelInactive[] }>(
        `/api/intelligence/inactive-matters${firm ? "?scope=firm" : ""}`,
      ),
  },
};

export interface ExecutionResult {
  root_execution_id: string;
  status: string;
  outcome: "RUNNING" | "COMPLETED" | "INSUFFICIENT_EVIDENCE" | "BLOCKED" | "FAILED" | "CANCELLED";
  outputs: Array<{
    execution_id: string;
    agent_id: string;
    node_code: string;
    agent_name: string;
    summary: string;
    text: string;
    provider: string | null;
    model: string | null;
    produced_at: string | null;
  }>;
  evidence: {
    chunk_count: number;
    documents: Array<{ document_id: string; document_name: string }>;
  };
}

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
