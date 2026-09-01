import { describe, expect, it } from "vitest";
import {
  ENVELOPE_CLOSE,
  ENVELOPE_OPEN,
  ENVELOPE_VERSION,
  LAWYER_CONTEXT_REF,
  extractEnvelope,
  renderEnvelopeContract,
  type StructuredExecutionEnvelope,
} from "../execution-envelope.js";
import { projectEnvelope } from "../envelope-projection.js";
import {
  documentTypeForIntent,
  isTaskCompleted,
  producesDocument,
  statusAfterDraftGenerated,
  taskGroupOf,
  taskPrimaryAction,
} from "../task-action.js";

/**
 * Tareas ejecutables. La estrategia ya producía 12 tareas reales por ejecución, pero
 * eran texto con una casilla: redactar el requerimiento que la propia tarea pedía era
 * trabajo que el sistema sabe hacer y que el abogado empezaba desde cero en otra
 * pantalla.
 */

describe("acción primaria según la clase de actuación", () => {
  it("una tarea de redacción ofrece generar el borrador", () => {
    const action = taskPrimaryAction({ actionType: "DOCUMENT_DRAFT" });
    expect(action.kind).toBe("GENERATE_DRAFT");
    expect(action.label).toBe("Generar borrador");
  });

  it("generado el borrador, la acción pasa a abrirlo", () => {
    const action = taskPrimaryAction({
      actionType: "DOCUMENT_DRAFT",
      generatedDocumentId: "doc_1",
    });
    expect(action.kind).toBe("OPEN_DRAFT");
    expect(action.label).toBe("Abrir borrador");
  });

  it("una tarea de prueba NO ofrece generar borrador", () => {
    // Ofrecerlo invitaría a fabricar justamente lo que hay que conseguir.
    const action = taskPrimaryAction({ actionType: "EVIDENCE_COLLECTION" });
    expect(action.kind).toBe("ATTACH_EVIDENCE");
    expect(action.kind).not.toBe("GENERATE_DRAFT");
  });

  it("cada clase restante tiene una acción propia y en lenguaje humano", () => {
    expect(taskPrimaryAction({ actionType: "LEGAL_RESEARCH" }).label).toBe("Investigar con IUSIA");
    expect(taskPrimaryAction({ actionType: "CLIENT_ACTION" }).label).toBe("Registrar gestión");
    expect(taskPrimaryAction({ actionType: "FILING" }).label).toBe("Preparar radicación");
    expect(taskPrimaryAction({ actionType: "INTERNAL_REVIEW" }).label).toBe("Revisar");
  });

  it("una tarea antigua sin clase sigue siendo válida", () => {
    // Las tareas creadas antes de la migración no tienen `action_type`.
    expect(taskPrimaryAction({}).kind).toBe("OPEN_DETAIL");
    expect(producesDocument(null)).toBe(false);
  });
});

describe("selección de plantilla por intención documental", () => {
  it("resuelve el tipo oficial para una intención conocida", () => {
    expect(documentTypeForIntent("REQUIREMENT")).toBe("REQUERIMIENTO");
    expect(documentTypeForIntent("LEGAL_OPINION")).toBe("OPINION_LEGAL");
  });

  it("sin correspondencia NO inventa un tipo", () => {
    // Un borrador con la plantilla equivocada es peor que ningún borrador.
    expect(documentTypeForIntent("OTHER")).toBeNull();
    expect(documentTypeForIntent(null)).toBeNull();
    expect(documentTypeForIntent("INTENCION_QUE_NO_EXISTE")).toBeNull();
  });
});

describe("generar un borrador NO cierra la tarea", () => {
  it("la deja lista para revisar, no completada", () => {
    const status = statusAfterDraftGenerated();
    expect(status).toBe("BORRADOR_LISTO");
    // La responsabilidad de darla por buena sigue siendo del abogado.
    expect(isTaskCompleted(status)).toBe(false);
  });

  it("sólo COMPLETADA significa completada", () => {
    expect(isTaskCompleted("COMPLETADA")).toBe(true);
    for (const s of ["PENDIENTE", "BORRADOR_GENERANDO", "BORRADOR_LISTO", "EN_REVISION"]) {
      // Una tarea pendiente no puede aparecer con estado de completada.
      expect(isTaskCompleted(s)).toBe(false);
    }
  });

  it("agrupa por avance real del trabajo", () => {
    expect(taskGroupOf("PENDIENTE")).toBe("todo");
    expect(taskGroupOf("BORRADOR_GENERANDO")).toBe("in_progress");
    expect(taskGroupOf("BORRADOR_LISTO")).toBe("review");
    expect(taskGroupOf("EN_REVISION")).toBe("review");
    expect(taskGroupOf("COMPLETADA")).toBe("done");
    expect(taskGroupOf(null)).toBe("todo");
  });
});

describe("la semántica viaja en el envelope del estratega", () => {
  const wrap = (json: unknown) =>
    `Estrategia.\n\n${ENVELOPE_OPEN}\n${JSON.stringify(json)}\n${ENVELOPE_CLOSE}`;

  const envelope = (tasks: unknown[]) => ({
    envelope_version: ENVELOPE_VERSION,
    facts: [],
    authorities: [],
    risks: [],
    tasks,
  });

  const task = (over: Record<string, unknown> = {}) => ({
    task_id: "T1",
    title: "Enviar requerimiento de incumplimiento",
    description: "Comunicación formal con 30 días de subsanación.",
    priority: "HIGH",
    action_type: "DOCUMENT_DRAFT",
    document_intent: "REQUIREMENT",
    source_refs: [LAWYER_CONTEXT_REF],
    ...over,
  });

  it("el contrato pide la clase de actuación", () => {
    const contract = renderEnvelopeContract({
      fields: ["tasks"],
      authorizedRefs: [LAWYER_CONTEXT_REF],
    });
    expect(contract).toContain("action_type");
    expect(contract).toContain("DOCUMENT_DRAFT");
    expect(contract).toContain("document_intent");
  });

  it("proyecta la clase y la intención documental", () => {
    const out = extractEnvelope(wrap(envelope([task()])));
    const r = projectEnvelope({
      envelope: out.envelope as StructuredExecutionEnvelope,
      authorizedRefs: [LAWYER_CONTEXT_REF],
    });
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]?.action_type).toBe("DOCUMENT_DRAFT");
    expect(r.tasks[0]?.document_intent).toBe("REQUIREMENT");
  });

  it("descarta la intención documental en una tarea que no redacta", () => {
    // Conservarla ofrecería una redacción que nadie pidió.
    const out = extractEnvelope(
      wrap(envelope([task({ action_type: "EVIDENCE_COLLECTION", document_intent: "REQUIREMENT" })])),
    );
    const r = projectEnvelope({
      envelope: out.envelope as StructuredExecutionEnvelope,
      authorizedRefs: [LAWYER_CONTEXT_REF],
    });
    expect(r.tasks[0]?.document_intent).toBeNull();
    expect(producesDocument(r.tasks[0]?.action_type)).toBe(false);
  });

  it("una tarea sin clase declarada se proyecta como OTHER, no se rechaza", () => {
    const out = extractEnvelope(wrap(envelope([{ ...task(), action_type: undefined }])));
    const r = projectEnvelope({
      envelope: out.envelope as StructuredExecutionEnvelope,
      authorizedRefs: [LAWYER_CONTEXT_REF],
    });
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]?.action_type).toBe("OTHER");
  });
});
