import { describe, expect, it } from "vitest";
import {
  ENVELOPE_CLOSE,
  ENVELOPE_OPEN,
  ENVELOPE_VERSION,
  LAWYER_CONTEXT_REF,
  LEGAL_KNOWLEDGE_REF,
  allowsLegalKnowledgeRef,
  extractEnvelope,
  renderEnvelopeContract,
  type StructuredExecutionEnvelope,
} from "../execution-envelope.js";
import { projectEnvelope } from "../envelope-projection.js";
import { assuranceNotice, stripTelemetrySections } from "../lawyer-narrative.js";
import { authorizedRefsOf } from "../work-package.js";

/**
 * Endurecimiento posterior a la E2E de exe_20nf6k8tvj3f44se (2026-09-01).
 * Cada bloque fija una causa MEDIDA en esa ejecución.
 */

const wrap = (json: unknown) =>
  `Análisis narrativo.\n\n${ENVELOPE_OPEN}\n${JSON.stringify(json)}\n${ENVELOPE_CLOSE}`;

const base = (over: Partial<StructuredExecutionEnvelope> = {}) => ({
  envelope_version: ENVELOPE_VERSION,
  facts: [],
  authorities: [],
  risks: [],
  tasks: [],
  ...over,
});

describe("notación de enums: los 12 hechos que el intake perdió", () => {
  // El agente 01 emitió 12 hechos y el sistema proyectó 0, con unsourced=0 y
  // unknown_refs=0: no fue procedencia, fue la forma de escribir los códigos.
  const fact = (over: Record<string, unknown>) => ({
    fact_id: "F1",
    statement: "El contrato fijó un preaviso de 90 días.",
    certainty: "[D]",
    source_class: "Class A",
    primary_source: "Cláusula 12",
    numbers: [],
    source_refs: ["doc_1#1"],
    ...over,
  });

  it("acepta la certeza escrita con su glosa", () => {
    const out = extractEnvelope(wrap(base({ facts: [fact({ certainty: "[F] acreditado" })] as never })));
    expect(out.envelope?.facts[0]?.certainty).toBe("[F]");
    expect(out.rejected).toBe(0);
  });

  it("acepta la certeza sin corchetes", () => {
    const out = extractEnvelope(wrap(base({ facts: [fact({ certainty: "d" })] as never })));
    expect(out.envelope?.facts[0]?.certainty).toBe("[D]");
  });

  it("acepta la clase de fuente abreviada", () => {
    const out = extractEnvelope(wrap(base({ facts: [fact({ source_class: "B" })] as never })));
    expect(out.envelope?.facts[0]?.source_class).toBe("Class B");
  });

  it("descarta una anotación numérica mal formada sin perder el hecho", () => {
    // `numbers` anota el hecho; el hecho es la afirmación. Perder los 12 hechos por
    // una anotación mal escrita era desproporcionado.
    const out = extractEnvelope(
      wrap(base({ facts: [fact({ numbers: [{ value: 90, unit: "días" }] })] as never })),
    );
    expect(out.envelope?.facts).toHaveLength(1);
    expect(out.envelope?.facts[0]?.numbers).toEqual([]);
  });

  it("sigue rechazando un código que no existe", () => {
    // Normalizar la NOTACIÓN no es aceptar cualquier valor.
    const out = extractEnvelope(wrap(base({ facts: [fact({ certainty: "MUY_SEGURO" })] as never })));
    expect(out.envelope?.facts).toHaveLength(0);
    expect(out.rejected).toBe(1);
  });

  it("registra QUÉ campo falló, no sólo cuántos", () => {
    const out = extractEnvelope(wrap(base({ facts: [fact({ statement: "" })] as never })));
    expect(out.rejections).toHaveLength(1);
    expect(out.rejections[0]?.collection).toBe("facts");
    expect(out.rejections[0]?.fields).toContain("statement");
  });
});

describe("fuentes jurídicas: por qué el investigador emitió cero", () => {
  // El agente 03 devolvió un envelope VÁLIDO con 0 autoridades y 0 rechazos. No podía
  // citar nada: `authorized_refs` sólo tenía fragmentos del documento del cliente, y el
  // Código Civil no está en el expediente del cliente.
  it("ofrece la referencia de conocimiento sólo a quien produce autoridades", () => {
    expect(allowsLegalKnowledgeRef("LEGAL_RESEARCH")).toBe(true);
    expect(allowsLegalKnowledgeRef("LEGAL_SPECIALIST")).toBe(true);
    // A intake no: su cometido es lo que consta, no lo que recuerda.
    expect(allowsLegalKnowledgeRef("CASE_INTAKE")).toBe(false);
    expect(allowsLegalKnowledgeRef("PROCESS_STRATEGY")).toBe(false);
  });

  it("el servidor la añade al paquete, nunca el modelo", () => {
    const refs = authorizedRefsOf({
      document_excerpts: [{ ref_id: "doc_1#1" }],
      source_refs: [],
      legal_knowledge_ref: true,
    });
    expect(refs).toContain(LEGAL_KNOWLEDGE_REF);
    const sin = authorizedRefsOf({ document_excerpts: [{ ref_id: "doc_1#1" }], source_refs: [] });
    expect(sin).not.toContain(LEGAL_KNOWLEDGE_REF);
  });

  it("el contrato advierte que esas autoridades quedarán marcadas", () => {
    const contract = renderEnvelopeContract({
      fields: ["authorities"],
      authorizedRefs: [LEGAL_KNOWLEDGE_REF],
    });
    expect(contract).toContain("REQUIERE VERIFICACIÓN");
    expect(contract).toContain("inventes una cita");
  });

  const authority = (over: Record<string, unknown> = {}) => ({
    authority_id: "A1",
    citation: "Código Civil, artículo 1602",
    type: "STATUTE",
    status: "VERIFIED_CURRENT",
    rule_summary: "El contrato es ley para las partes.",
    source_refs: [LEGAL_KNOWLEDGE_REF],
    ...over,
  });

  it("una autoridad sólo recordada ENTRA al ledger, marcada para verificación", () => {
    const r = projectEnvelope({
      envelope: base({ authorities: [authority()] as never }) as StructuredExecutionEnvelope,
      authorizedRefs: [LEGAL_KNOWLEDGE_REF, "doc_1#1"],
    });
    expect(r.authorities).toHaveLength(1);
    // El modelo dijo VERIFIED_CURRENT; el servidor no le cree.
    expect(r.authorities[0]?.status).toBe("REQUIRES_CALIBRATION");
    expect(r.provenance.authorities.A1).toEqual([LEGAL_KNOWLEDGE_REF]);
  });

  it("una autoridad apoyada en el expediente conserva el estado declarado", () => {
    const r = projectEnvelope({
      envelope: base({
        authorities: [authority({ source_refs: ["doc_1#1"] })] as never,
      }) as StructuredExecutionEnvelope,
      authorizedRefs: [LEGAL_KNOWLEDGE_REF, "doc_1#1"],
    });
    expect(r.authorities[0]?.status).toBe("VERIFIED_CURRENT");
  });

  it("una autoridad que cita una fuente inexistente se sigue descartando", () => {
    const r = projectEnvelope({
      envelope: base({
        authorities: [authority({ source_refs: ["https://inventado.example/ley"] })] as never,
      }) as StructuredExecutionEnvelope,
      authorizedRefs: [LEGAL_KNOWLEDGE_REF, "doc_1#1"],
    });
    expect(r.authorities).toHaveLength(0);
    expect(r.dropped.unknown_refs).toBe(1);
  });
});

describe("el dictamen que lee el abogado", () => {
  const output = [
    "CONCLUSIÓN JURÍDICA",
    "El documento aportado no acredita el contrato invocado: declara ser ficticio y",
    "las partes no coinciden con las del expediente.",
    "",
    "AGENT EXECUTION LEDGER",
    "10-auditor-juridico-y-red-team STATUS NOT EXECUTED",
    "11-auditor-de-citas-y-vigencia STATUS NOT EXECUTED",
    "",
    "RECOMENDACIÓN",
    "Requerir el contrato original firmado.",
  ].join("\n");

  it("retira el bloque de telemetría", () => {
    const out = stripTelemetrySections(output);
    expect(out.text).not.toContain("AGENT EXECUTION LEDGER");
    expect(out.text).not.toContain("STATUS NOT EXECUTED");
    expect(out.redactions).toBeGreaterThan(0);
  });

  it("NO suaviza ni recorta la advertencia jurídica", () => {
    // Ésta es la línea roja: el sistema detectó que el documento no correspondía y esa
    // detección es exactamente el comportamiento que se quiere preservar.
    const out = stripTelemetrySections(output);
    expect(out.text).toContain("no acredita el contrato invocado");
    expect(out.text).toContain("declara ser ficticio");
    expect(out.text).toContain("Requerir el contrato original firmado.");
    expect(out.text).toContain("CONCLUSIÓN JURÍDICA");
  });

  it("retira las líneas con jerga de ejecución", () => {
    const out = stripTelemetrySections("Análisis.\nWorkPackage recibido: 3 fuentes.\nFin.");
    expect(out.text).not.toContain("WorkPackage");
    expect(out.text).toContain("Análisis.");
    expect(out.text).toContain("Fin.");
  });

  it("un texto limpio pasa sin tocar", () => {
    const clean = "CONCLUSIÓN\nHay incumplimiento contractual.";
    expect(stripTelemetrySections(clean).text).toBe(clean);
    expect(stripTelemetrySections(clean).redactions).toBe(0);
  });
});

describe("gobierno de la revisión independiente (agentes 10 y 11)", () => {
  // `routing.ts` exige auditoría jurídica y de citas desde materialidad MATERIAL, pero
  // ambos agentes están enabled:false y el planner no puede seleccionarlos. El
  // integrador lo decía con sus identificadores internos y el resultado se presentaba
  // igualmente como concluido.
  it("declara la brecha en lenguaje jurídico, sin identificadores", () => {
    const notice = assuranceNotice({
      materiality: "MATERIAL",
      requiredReviewAgents: ["10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"],
      completedReviewAgents: [],
    });
    expect(notice.cleared).toBe(false);
    expect(notice.statement).toContain("no incluye la revisión independiente");
    expect(notice.statement).not.toContain("10-auditor");
    expect(notice.statement).not.toContain("11-auditor");
  });

  it("confirma cuando la revisión sí se ejecutó", () => {
    const notice = assuranceNotice({
      materiality: "MATERIAL",
      requiredReviewAgents: ["10-auditor-juridico-y-red-team"],
      completedReviewAgents: ["10-auditor-juridico-y-red-team"],
    });
    expect(notice.cleared).toBe(true);
  });

  it("un asunto simple no arrastra una advertencia que no le corresponde", () => {
    const notice = assuranceNotice({
      materiality: "SIMPLE",
      requiredReviewAgents: [],
      completedReviewAgents: [],
    });
    expect(notice.cleared).toBe(true);
    expect(notice.statement).toContain("no se requería");
  });
});

describe("el contexto del abogado sigue siendo fuente para hechos", () => {
  it("un análisis sin documentos puede proyectar hechos alegados", () => {
    const refs = authorizedRefsOf({
      document_excerpts: [],
      source_refs: [],
      lawyer_provided_context: "El cliente afirma que no recibió el pago.",
      legal_knowledge_ref: false,
    });
    expect(refs).toEqual([LAWYER_CONTEXT_REF]);
  });
});
