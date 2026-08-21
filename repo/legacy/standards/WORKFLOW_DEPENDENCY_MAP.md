# Mapa de dependencias de workflows

## analizar-caso

- Depende de: No iniciar estrategia definitiva ni documento final hasta tener análisis mínimo y vacíos críticos clasificados.
- Participan: `00-orquestador-juridico.md`, `01-receptor-del-caso.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `04-analista-probatorio.md`, `05-analista-procesal.md`, `10-auditor-juridico.md`, `12-auditor-de-coherencia.md`
- Salidas: `analysis/case-analysis-vNN.md`, `analysis/legal-issues-vNN.json`, `analysis/risk-matrix-vNN.md`, `analysis/missing-information-vNN.md`

## definir-estrategia

- Depende de: Requiere análisis mínimo; no puede formular estrategia definitiva si términos, legitimación o prueba indispensable son inciertos.
- Participan: `00-orquestador-juridico.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `04-analista-probatorio.md`, `05-analista-procesal.md`, `06-estratega-juridico.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`
- Salidas: `strategies/legal-strategy-vNN.md`, `strategies/scenario-matrix-vNN.md`, `strategies/action-plan-vNN.md`, `strategies/risk-register-vNN.json`

## proyectar-derecho-peticion

- Depende de: No redactar final si no están claros peticionario, destinatario, solicitudes y notificaciones.
- Participan: `00-orquestador-juridico.md`, `01-receptor-del-caso.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `drafts/derecho-peticion-vNN.md`, `audits/derecho-peticion-audit-vNN.md`, `final/derecho-peticion-final-vNN.md`

## proyectar-demanda

- Depende de: Bloquear redacción final ante incertidumbre crítica sobre término, competencia, legitimación, pretensiones, prueba indispensable o identificación de partes.
- Participan: `00-orquestador-juridico.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `04-analista-probatorio.md`, `05-analista-procesal.md`, `06-estratega-juridico.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `analysis/procedural-feasibility-vNN.md`, `analysis/evidence-matrix-vNN.md`, `drafts/demanda-vNN.md`, `audits/demanda-audit-vNN.md`, `final/demanda-final-vNN.md`

## contestar-demanda

- Depende de: No redactar sin demanda completa y fecha de notificación. Cada hecho debe clasificarse como `admitted`, `denied`, `partially_admitted`, `not_known`, `requires_proof` o `legally_irrelevant`.
- Participan: `00-orquestador-juridico.md`, `01-receptor-del-caso.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `04-analista-probatorio.md`, `05-analista-procesal.md`, `06-estratega-juridico.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `analysis/claim-response-matrix-vNN.md`, `analysis/defense-strategy-vNN.md`, `drafts/contestacion-demanda-vNN.md`, `audits/contestacion-audit-vNN.md`, `final/contestacion-final-vNN.md`

## proyectar-tutela

- Depende de: No avanzar si el caso intenta usar tutela como sustituto automático de acción ordinaria sin justificación.
- Participan: `00-orquestador-juridico.md`, `01-receptor-del-caso.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `04-analista-probatorio.md`, `05-analista-procesal.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `analysis/tutela-admissibility-vNN.md`, `drafts/tutela-vNN.md`, `audits/tutela-audit-vNN.md`, `final/tutela-final-vNN.md`

## proyectar-recurso

- Depende de: Bloquear si no se conoce decisión recurrida, fecha de notificación, recurso procedente o término aplicable.
- Participan: `00-orquestador-juridico.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `05-analista-procesal.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `analysis/resource-admissibility-vNN.md`, `drafts/recurso-vNN.md`, `audits/recurso-audit-vNN.md`, `final/recurso-final-vNN.md`

## elaborar-concepto

- Depende de: No presentar interpretación como conclusión cierta cuando dependa de supuestos o asunto controvertido.
- Participan: `00-orquestador-juridico.md`, `01-receptor-del-caso.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `06-estratega-juridico.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `research/concept-research-vNN.md`, `drafts/concepto-vNN.md`, `audits/concepto-audit-vNN.md`, `final/concepto-final-vNN.md`

## revisar-contrato

- Depende de: No emitir revisión final sin versión contractual identificada y rol del cliente.
- Participan: `00-orquestador-juridico.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `06-estratega-juridico.md`, `08-redactor-senior.md`, `10-auditor-juridico.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `analysis/contract-risk-matrix-vNN.md`, `analysis/clause-review-vNN.md`, `drafts/proposed-changes-vNN.md`, `final/contract-review-vNN.md`

## proyectar-contrato

- Depende de: No redactar sin diseño contractual aprobado y datos mínimos de partes, objeto, obligaciones y pagos.
- Participan: `00-orquestador-juridico.md`, `01-receptor-del-caso.md`, `02-clasificador-juridico.md`, `03-investigador-juridico.md`, `06-estratega-juridico.md`, `07-redactor-junior.md`, `08-redactor-senior.md`, `09-compilador-documental.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `13-entrega-final.md`
- Salidas: `analysis/contract-design-vNN.md`, `analysis/contract-risk-allocation-vNN.md`, `drafts/contrato-vNN.md`, `audits/contrato-audit-vNN.md`, `final/contrato-final-vNN.md`

## auditar-documento

- Depende de: No auditar si no hay versión identificada. No entregar aprobado con `blocker` o `critical` abierto.
- Participan: `00-orquestador-juridico.md`, `10-auditor-juridico.md`, `11-auditor-de-citas.md`, `12-auditor-de-coherencia.md`, `05-analista-procesal.md`, `04-analista-probatorio.md`, `13-entrega-final.md`
- Salidas: `audits/document-audit-vNN.md`, `audits/findings-vNN.json`, `audits/correction-plan-vNN.md`

## Micro Sprint 03C — núcleo empresarial, compliance, LA/FT/FPADM, PI y franquicias

Se incorporan agentes y workflows profundos para M&A, due diligence, tributario, penal empresarial, penal tributario, compliance, LA/FT/FPADM, investigaciones internas, propiedad intelectual, marcas, software, transferencia tecnológica y franquicias. Toda salida requiere revisión humana; ningún agente declara delitos, garantiza registros, reporta a autoridades o aprueba documentos finales automáticamente.

Rutas ejemplo: compra de empresa → fusiones-adquisiciones → due diligence integral → tributario/laboral/compliance/penal empresarial/PI → arquitectura contractual → auditoría M&A. Programa de cumplimiento → diagnóstico → riesgo corporativo → LA/FT/FPADM + anticorrupción + penal empresarial → programa → auditoría. Expansión por franquicia → diagnóstico de franquiciabilidad → marcas + secretos + contractual + tributario → paquete documental → auditoría de franquicia.

## Micro Sprint 03D — certificación pre-RAG de agentes

La arquitectura multiagente incorpora auditoría individual por agente, puntuación sobre 100, seniority, clasificación, control de huérfanos, matriz de diferenciación y prohibición de uso productivo de agentes no certificados. Los agentes deben revisarse periódicamente y ningún agente puede usarse para producción jurídica sin auditoría individual, fuentes verificadas y aprobación humana.

Clasificaciones: `certified`, `approved_with_minor_changes`, `requires_major_revision`, `duplicate_or_overlapping`, `misclassified`, `insufficient`, `deprecated_candidate`, `blocked`. Los agentes críticos no pueden quedar `insufficient` ni huérfanos.

## Sprint 04 — Metodología operativa Pisoso Legal 0.4.0

Se adopta la secuencia OBSERVAR → DELIMITAR → VERIFICAR → DESCOMPONER → DIAGNOSTICAR → DISEÑAR → DECIDIR → DOCUMENTAR → EJECUTAR → AUDITAR → MEDIR → MEJORAR. Los métodos empresariales son auxiliares y no sustituyen liderazgo jurídico certificado ni aprobación humana.

Se incorporan gates 0 a 9, matter management, workstreams, RACI, Kanban jurídico, medición, mejora continua, auditoría metodológica y control de uso indebido de métodos. Queda prohibido usar método sin propósito, datos sin calidad, Pareto sin datos, DMAIC sin proceso repetible, Lean Startup para evadir obligaciones o soluciones sin responsable.

## Sprint 05 — Arquitectura RAG 0.5.0

Se incorpora arquitectura técnica, documental y jurídica del RAG. Los agentes pueden solicitar evidence bundles, citas verificadas, autoridad, vigencia, temporalidad, conflictos y abstención. No se han cargado fuentes jurídicas reales masivamente ni conectado servicios externos. Ninguna fuente es fundamento definitivo sin procedencia, autoridad, integridad, vigencia, versión, ubicación exacta y revisión humana cuando aplique.
