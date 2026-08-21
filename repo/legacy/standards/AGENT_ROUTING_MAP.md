# Mapa de enrutamiento de agentes

## Reglas de selección

El `00-orquestador-juridico.md` selecciona agentes por materia, jurisdicción, industria, tipo documental, autoridad, prueba, procedimiento, riesgo, impacto económico, dimensión dogmática, necesidad investigativa, política pública o litigio estratégico. 

Cuando la consulta o el caso involucre litigio formal, recursos procesales de alta complejidad, incidentes dilatorios, nulidades procesales, o demandas ante jueces de la república y Superintendencias con funciones jurisdiccionales (Supersociedades, SIC), se debe convocar de forma prioritaria al agente `14-magistrado-procesal.md`.

## Prioridades

Las áreas críticas prevalecen cuando el caso involucra derecho comercial, societario, M&A, civil, procesal civil (bajo el rigor del CGP, CPACA y facultades de Superintendencias), contractual, cambiario, insolvencia, migratorio, constitucional, procesal constitucional, administrativo regulatorio, litigio estratégico, arbitraje, tributario, aduanero, aeronáutico o regulación económica. Para la validación del esquema de litigio judicializado y contención de excepciones previas, el análisis de `14-magistrado-procesal.md` tiene prioridad jerárquica y debe preceder a la estrategia final.


## Especialidad principal

El líder del análisis se nombra según el problema dominante: área jurídica si el núcleo es normativo o litigioso; sectorial si el núcleo es técnico; económico si el núcleo es impacto; dogmático si el núcleo es interpretación constitucional o principios; legislativo/política pública si la solución requiere reforma o incidencia.

## Especialidades relacionadas

Toda especialidad principal debe listar agentes relacionados y explicar por qué intervienen. Las contradicciones se registran y se escalan al socio director si impiden avanzar.

## Agentes incompatibles

No se consideran incompatibles por nombre sino por función: un agente sectorial, económico o comparado no puede cerrar una conclusión jurídica final sin agente jurídico; un redactor no debe actuar antes de aprobar hechos; un auditor no debe auditar sin versión identificada.

## Agentes que deben actuar en paralelo

- Investigador normativo + verificador de vigencia.
- Investigador jurisprudencial + constructor de línea jurisprudencial.
- Analista económico + especialista jurídico cuando exista impacto regulatorio.
- Agente sectorial + especialista jurídico sectorial o área relacionada.
- Auditor de citas + auditor de coherencia.
- Estratega convencional (`06-estratega-juridico.md`) + Estratega disruptivo (`15-estratega-disruptivo.md`) ante cualquier caso.


## Criterios para nombrar líder del análisis

- Mayor riesgo jurídico o institucional.
- Materia que define la procedibilidad.
- Área con plazo crítico.
- Especialidad que controla la pregunta principal.
- Decisión del socio director ante empate.

## Criterios de escalamiento al socio director

Escalar por contradicción interdisciplinaria, bloqueo de tres rondas, riesgo reputacional, cambio de estrategia, incertidumbre crítica, impacto económico alto o decisión de política pública.


## Anexo Micro Sprint 03B — arquitectura contractual, reestructuración e insolvencia

Pisoso Legal AI reconoce la arquitectura contractual como capacidad transversal: auditoría, arquitectura, despliegue e integridad. Antes de redactar contratos complejos debe comprender negocio, objetivo jurídico/económico, partes, obligaciones, restricciones, estructura, elementos típicos y atípicos, riesgos de recalificación, garantías, incumplimiento, adaptación, terminación, consecuencias concursales y ejecutabilidad.

Los casos de startup, inversión, reorganización, insolvencia, salvamento, novación, renegociación y paquetes documentales deben usar órdenes sucesivas de diagnóstico, estrategia, arquitectura documental, redacción y auditoría. Se prohíben estructuras para ocultar activos, defraudar acreedores, simular operaciones o alterar prelaciones.

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
