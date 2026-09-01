import { describe, expect, it } from "vitest";
import {
  ENVELOPE_CLOSE,
  ENVELOPE_OPEN,
  ENVELOPE_VERSION,
  LAWYER_CONTEXT_REF,
  envelopeFieldsFor,
  extractEnvelope,
  renderEnvelopeContract,
  stripEnvelope,
} from "../execution-envelope.js";
import { PROJECTION_CAPS, projectEnvelope, riskLevelFrom } from "../envelope-projection.js";
import { authorizedRefsOf } from "../work-package.js";

/**
 * Structured Execution Envelope: el contrato que permite que el trabajo del equipo
 * aterrice en el expediente sin tocar un solo `agent.md` canónico y sin una segunda
 * llamada de modelo sobre la prosa.
 */

const fact = (over: Record<string, unknown> = {}) => ({
  fact_id: "F1",
  statement: "El contrato fijó un preaviso de 90 días.",
  certainty: "[D]",
  source_class: "Class A",
  primary_source: "Contrato marco, cláusula 12",
  numbers: [],
  source_refs: ["doc_1#1"],
  ...over,
});

const envelope = (over: Record<string, unknown> = {}) => ({
  envelope_version: ENVELOPE_VERSION,
  conclusion_brief: undefined,
  facts: [],
  authorities: [],
  risks: [],
  tasks: [],
  ...over,
});

const wrap = (json: unknown, narrative = "ANÁLISIS COMPLETO DEL ESPECIALISTA.") =>
  `${narrative}\n\n${ENVELOPE_OPEN}\n${JSON.stringify(json)}\n${ENVELOPE_CLOSE}`;

describe("el contrato se pide por rol, no por agente", () => {
  it("no le pide autoridades a un agente de intake", () => {
    const fields = envelopeFieldsFor("CASE_INTAKE");
    expect(fields).toContain("facts");
    // Pedírselas sería invitarlo a inventarlas.
    expect(fields).not.toContain("authorities");
  });

  it("le pide autoridades al investigador y no hechos", () => {
    const fields = envelopeFieldsFor("LEGAL_RESEARCH");
    expect(fields).toContain("authorities");
    expect(fields).not.toContain("facts");
  });

  it("el orquestador aporta conclusión, riesgos y tareas", () => {
    expect([...envelopeFieldsFor("ORCHESTRATOR")].sort()).toEqual([
      "conclusion_brief",
      "risks",
      "tasks",
    ]);
  });

  it("un rol desconocido sólo declara su propia conclusión", () => {
    expect(envelopeFieldsFor("ROL_QUE_NO_EXISTE")).toEqual(["conclusion_brief"]);
  });
});

describe("el contrato viaja en el WorkPackage, no en el prompt canónico", () => {
  it("enumera exactamente las referencias entregadas", () => {
    const contract = renderEnvelopeContract({
      fields: ["facts"],
      authorizedRefs: [LAWYER_CONTEXT_REF, "doc_1#1"],
    });
    expect(contract).toContain(LAWYER_CONTEXT_REF);
    expect(contract).toContain("doc_1#1");
    expect(contract).toContain(ENVELOPE_OPEN);
    // Y dice de forma explícita que el análisis narrativo NO se sacrifica.
    expect(contract).toContain("ANÁLISIS NARRATIVO COMPLETO");
  });

  it("sin campos pedidos no añade nada al WorkPackage", () => {
    expect(renderEnvelopeContract({ fields: [], authorizedRefs: ["doc_1#1"] })).toBe("");
  });

  it("las referencias autorizadas salen del propio paquete entregado", () => {
    const refs = authorizedRefsOf({
      document_excerpts: [{ ref_id: "doc_1#1" }, { ref_id: "doc_1#2" }],
      source_refs: [{ ref_id: "src_a" }],
      lawyer_provided_context: "El cliente firmó en marzo.",
    });
    expect(refs).toEqual([LAWYER_CONTEXT_REF, "doc_1#1", "doc_1#2", "src_a"]);
  });

  it("sin contexto del abogado no se ofrece la referencia sintética", () => {
    const refs = authorizedRefsOf({ document_excerpts: [], source_refs: [], lawyer_provided_context: "  " });
    expect(refs).toEqual([]);
  });
});

describe("lectura de la salida del agente", () => {
  it("extrae el envelope y conserva la prosa intacta", () => {
    const text = wrap(envelope({ facts: [fact()], conclusion_brief: "Hay incumplimiento." }));
    const out = extractEnvelope(text);
    expect(out.present).toBe(true);
    expect(out.envelope?.facts).toHaveLength(1);
    expect(out.envelope?.conclusion_brief).toBe("Hay incumplimiento.");
    // Lo que lee el abogado no incluye el apéndice de JSON.
    expect(stripEnvelope(text)).toBe("ANÁLISIS COMPLETO DEL ESPECIALISTA.");
  });

  it("tolera que el modelo envuelva el bloque en un fence de markdown", () => {
    const text = `Análisis.\n\n${ENVELOPE_OPEN}\n\`\`\`json\n${JSON.stringify(envelope({ facts: [fact()] }))}\n\`\`\`\n${ENVELOPE_CLOSE}`;
    expect(extractEnvelope(text).envelope?.facts).toHaveLength(1);
  });

  it("un elemento que no cumple el contrato canónico se rechaza, no se repara", () => {
    const text = wrap(
      envelope({
        facts: [fact(), fact({ fact_id: "F2", certainty: "MUY_SEGURO" })],
      }),
    );
    const out = extractEnvelope(text);
    expect(out.envelope?.facts).toHaveLength(1);
    expect(out.rejected).toBe(1);
  });

  it("sin bloque, la ejecución sigue siendo válida y no se proyecta nada", () => {
    const out = extractEnvelope("Un dictamen enteramente narrativo, sin envelope.");
    expect(out.present).toBe(false);
    expect(out.envelope).toBeNull();
    expect(stripEnvelope("Un dictamen enteramente narrativo.")).toBe(
      "Un dictamen enteramente narrativo.",
    );
  });

  it("un envelope de otra versión no se acepta a medias", () => {
    const text = wrap({ ...envelope({ facts: [fact()] }), envelope_version: "iusia.envelope.v9" });
    expect(extractEnvelope(text).present).toBe(false);
  });

  it("JSON corrupto no rompe la ejecución", () => {
    const text = `Análisis.\n${ENVELOPE_OPEN}\n{ facts: [ }\n${ENVELOPE_CLOSE}`;
    expect(extractEnvelope(text).present).toBe(false);
  });
});

describe("proyección al expediente: reglas deterministas", () => {
  const authorizedRefs = [LAWYER_CONTEXT_REF, "doc_1#1"];

  it("proyecta un hecho fundamentado y le quita el metadato de runtime", () => {
    const r = projectEnvelope({ envelope: envelope({ facts: [fact()] }), authorizedRefs });
    expect(r.facts).toHaveLength(1);
    // El ledger recibe el hecho canónico puro: `source_refs` no es parte del hecho.
    expect(r.facts[0]).not.toHaveProperty("source_refs");
    // Pero la procedencia se conserva aparte, que es lo que la hace auditable.
    expect(r.provenance.facts.F1).toEqual(["doc_1#1"]);
  });

  it("DESCARTA un hecho que cita una fuente inexistente", () => {
    const r = projectEnvelope({
      envelope: envelope({ facts: [fact({ source_refs: ["doc_INVENTADO#7"] })] }),
      authorizedRefs,
    });
    expect(r.facts).toHaveLength(0);
    expect(r.dropped.unknown_refs).toBe(1);
    expect(r.dropped.unsourced).toBe(1);
  });

  it("DESCARTA un hecho sin ninguna fuente declarada", () => {
    const r = projectEnvelope({
      envelope: envelope({ facts: [fact({ source_refs: [] })] }),
      authorizedRefs,
    });
    expect(r.facts).toHaveLength(0);
    expect(r.dropped.unsourced).toBe(1);
  });

  it("acepta el contexto del abogado como fuente legítima", () => {
    // Un análisis sin documentos debe poder producir hechos alegados.
    const r = projectEnvelope({
      envelope: envelope({
        facts: [fact({ certainty: "[A]", source_refs: [LAWYER_CONTEXT_REF] })],
      }),
      authorizedRefs,
    });
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]?.certainty).toBe("[A]");
  });

  it("no promueve la certeza declarada por el agente", () => {
    const r = projectEnvelope({
      envelope: envelope({ facts: [fact({ certainty: "[U]" })] }),
      authorizedRefs,
    });
    expect(r.facts[0]?.certainty).toBe("[U]");
  });

  it("deduplica por contenido, no por el id que inventó el modelo", () => {
    const r = projectEnvelope({
      envelope: envelope({
        facts: [
          fact({ fact_id: "F1" }),
          fact({ fact_id: "F99", statement: "el contrato FIJÓ un preaviso de 90 días" }),
        ],
      }),
      authorizedRefs,
    });
    expect(r.facts).toHaveLength(1);
    expect(r.dropped.duplicate).toBe(1);
  });

  it("no vuelve a crear una tarea que el expediente ya tiene abierta", () => {
    const task = {
      task_id: "T1",
      title: "Solicitar el contrato marco firmado",
      description: "Pedirlo a la contraparte.",
      priority: "HIGH",
      source_refs: [LAWYER_CONTEXT_REF],
    };
    const r = projectEnvelope({
      envelope: envelope({ tasks: [task] }),
      authorizedRefs,
      existingTaskTitles: ["Solicitar el contrato marco firmado"],
    });
    expect(r.tasks).toHaveLength(0);
    expect(r.dropped.duplicate).toBe(1);
  });

  it("un modelo desbordado no puede inundar el expediente", () => {
    const facts = Array.from({ length: PROJECTION_CAPS.facts + 12 }, (_, i) =>
      fact({ fact_id: `F${i}`, statement: `Hecho número ${i} del expediente.` }),
    );
    const r = projectEnvelope({ envelope: envelope({ facts }), authorizedRefs });
    expect(r.facts).toHaveLength(PROJECTION_CAPS.facts);
    expect(r.dropped.over_cap).toBe(12);
  });
});

describe("riesgo propuesto a partir de los riesgos proyectados", () => {
  const risk = (severity: string, description: string) => ({
    description,
    severity: severity as never,
    likelihood: "PROBABLE",
    rationale: "Por la cláusula penal pactada.",
    source_refs: ["doc_1#1"],
  });

  it("toma el más alto y arrastra su metodología", () => {
    const out = riskLevelFrom([risk("MEDIUM", "Mora en la entrega"), risk("CRITICAL", "Cláusula penal")]);
    expect(out?.level).toBe("CRITICAL");
    expect(out?.rationale).toContain("Cláusula penal");
    // El expediente exige justificación para mostrar un riesgo.
    expect(out?.rationale).toContain("Por la cláusula penal pactada.");
  });

  it("sin riesgos no afirma nada", () => {
    expect(riskLevelFrom([])).toBeNull();
  });
});
