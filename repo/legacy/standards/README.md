# Pisoso Legal AI

Pisoso Legal AI es una base estructural para un sistema jurídico multiagente orientado al derecho colombiano.

## Para qué sirve

Sirve para organizar expedientes, agentes, workflows, fuentes, plantillas, esquemas y salidas auditables. En Sprint 01 no ejecuta análisis jurídico productivo.

## Arquitectura general

- `.agents/`: agentes transversales, especialistas por área y niveles profesionales.
- `workflows/`: rutas preliminares de trabajo jurídico.
- `rag/`: futura ubicación de fuentes jurídicas verificadas.
- `rag-index/`: índices JSON para trazabilidad de fuentes.
- `templates/`: futuras plantillas documentales.
- `cases/`: expedientes de trabajo.
- `schemas/`: contratos de datos base.
- `outputs/`: productos finales organizados por tipo.

## Cómo iniciar y gestionar un expediente

1. **Apertura de Expediente**: Todo caso se crea en `cases/CASE-AAAA-NNN_Nombre/`.
2. **Subcarpeta Obligatoria `trabajo_interno/`**: Se crea la subcarpeta `trabajo_interno/` (con `trabajo_interno/md/` y `trabajo_interno/scripts/`). TODOS los archivos intermedios, notas `.md`, scripts de Python `*.py`, logs y borradores residen exclusivamente en `trabajo_interno/`.
3. **Aislamiento de la Raíz del Caso**: En la raíz de la carpeta del expediente **ÚNICAMENTE** habitarán los archivos finales **.docx** terminados para el cliente y los documentos fuente originales en **.pdf**.
4. **Plantillas Word y Diagramación en Cascada**: Todos los entregables finales `.docx` se construyen aplicando la plantilla oficial adecuada de `/Users/edergope/Documents/Pisoso Legal/Palntillas word/`, respetando la diagramación visual, la paleta cromática, la jerarquía de títulos y el desarrollo deductivo en cascada. Las plantillas guían el diseño pero no limitan la profundidad del contenido.
5. **Orquestación Automática de Agentes**: La activación de agentes y subagentes (tanto del núcleo como de los 320+ agentes especializados en `.agents/`) es 100% automática. El usuario no requiere escribir comandos ni solicitar la activación en cada prompt.

## Estado actual: arquitectura RAG lista para ingestión, pero Sprint 06 de corpus real está bloqueado por falta de adquisición oficial; el sistema aún no está autorizado para uso jurídico productivo sin revisión humana.

## Alcance del Sprint 01

Crear estructura, gobernanza, protocolos base, agentes iniciales, workflows preliminares, índices vacíos y esquemas simples.

## Próximos sprints previstos

Sprint 02: diseño y fortalecimiento de workflows jurídicos. Sprint 03: especialización profunda de agentes.


## Sprint 02 implementado

Los once workflows jurídicos fueron activados en versión 0.2.0 con estados uniformes, controles de bloqueo, auditorías obligatorias, trazabilidad y orquestación central en `WORKFLOW_ORCHESTRATION.md`.


## Micro Sprint 03A

Se amplió el equipo con agentes jurídicos, sectoriales, investigativos, estratégicos, económicos, dogmáticos, legislativos, de política pública y de control especializado. Esta expansión no desarrolla aún los workflows 03B ni la especialización profunda definitiva.


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

## Sprint 06 — intento de carga controlada bloqueado

Se intentó iniciar Lote 1 del corpus jurídico colombiano prioritario, pero las fuentes oficiales troncales no pudieron verificarse/descargarse desde el entorno. No se simuló corpus real, no se inventaron URLs, no se cargaron fuentes secundarias como primarias y el sistema sigue no productivo.
