# Protocolo de expediente

## Apertura del expediente

Todo caso debe abrirse con código `CASE-AAAA-NNN`, por ejemplo `CASE-2026-001`. Al registrar un caso nuevo, el sistema debe crear de forma obligatoria la carpeta física en la ruta `cases/` nombrada con el ID del caso y el nombre de las partes (ej. `cases/CASE-2026-001_Demandante_vs_Demandado`).

**Estructura Obligatoria de Carpetas:**
- **Subcarpeta `trabajo_interno/`**: Es de creación OBLIGATORIA. Dentro de ella se alojarán las subcarpetas `trabajo_interno/md/` (para metadatos, investigaciones, estrategias en markdown, conceptos intermedios, notas y auditorías en `.md`) y `trabajo_interno/scripts/` (para scripts en Python `*.py`, scripts de compilación y código auxiliar).
- **Aislamiento de la Raíz del Caso**: En la raíz de la carpeta del caso **ÚNICAMENTE** pueden habitar los entregables finales terminados en formato Word (`.docx`) destinados al cliente final y los documentos fuente originales aportados por el cliente en formato `.pdf`. Queda estrictamente prohibido dejar archivos `.py`, `.md` o borradores sueltos en la raíz del caso.


## Identificación del caso

Registrar cliente, contraparte, área principal, áreas relacionadas, responsable, confidencialidad y estado.

## Clasificación

El clasificador jurídico identifica áreas, jurisdicción, competencia y tipo de actuación.

## Cronología

Separar fechas verificadas, fechas aproximadas y fechas pendientes.

## Partes

Identificar partes, roles, datos incompletos y posibles terceros relevantes.

## Hechos

Separar hechos afirmados, hechos documentados, inferencias y opiniones.

## Documentos

Registrar documentos disponibles, pendientes, fuente, fecha y relación con hechos.

## Pretensiones

Documentar objetivos del cliente, solicitudes preliminares y límites conocidos.

## Preguntas jurídicas

Formular preguntas abiertas que orienten investigación y análisis.

## Términos relevantes

Registrar caducidad, prescripción, vencimientos y oportunidades procesales por verificar.

## Asignación de agentes

El orquestador define agentes, orden de intervención y dependencias.

## Trazabilidad

Cada salida debe indicar entradas usadas, vacíos y revisión pendiente.

## Cierre del expediente

Solo procede con producto final, auditorías, advertencias relevantes y aprobación correspondiente.

## Alineación Sprint 02 — estados y bloqueos

Cada expediente debe registrar el estado activo del workflow, agentes asignados, archivos generados, bloqueos, hallazgos y aprobaciones. Cuando falte información crítica se usará `[INFORMACIÓN PENDIENTE]` y se indicará si el caso puede continuar parcialmente o debe marcarse `blocked`.

Los bloqueos deben incluir causa, agente responsable, información requerida y efecto sobre términos o estrategia. La trazabilidad debe vincular hechos, documentos, evidencia, fuentes, agente, fecha y versión.

## Micro Sprint 03C — núcleo empresarial, compliance, LA/FT/FPADM, PI y franquicias

Se incorporan agentes y workflows profundos para M&A, due diligence, tributario, penal empresarial, penal tributario, compliance, LA/FT/FPADM, investigaciones internas, propiedad intelectual, marcas, software, transferencia tecnológica y franquicias. Toda salida requiere revisión humana; ningún agente declara delitos, garantiza registros, reporta a autoridades o aprueba documentos finales automáticamente.

Rutas ejemplo: compra de empresa → fusiones-adquisiciones → due diligence integral → tributario/laboral/compliance/penal empresarial/PI → arquitectura contractual → auditoría M&A. Programa de cumplimiento → diagnóstico → riesgo corporativo → LA/FT/FPADM + anticorrupción + penal empresarial → programa → auditoría. Expansión por franquicia → diagnóstico de franquiciabilidad → marcas + secretos + contractual + tributario → paquete documental → auditoría de franquicia.

## Sprint 04 — Metodología operativa Pisoso Legal 0.4.0

Se adopta la secuencia OBSERVAR → DELIMITAR → VERIFICAR → DESCOMPONER → DIAGNOSTICAR → DISEÑAR → DECIDIR → DOCUMENTAR → EJECUTAR → AUDITAR → MEDIR → MEJORAR. Los métodos empresariales son auxiliares y no sustituyen liderazgo jurídico certificado ni aprobación humana.

Se incorporan gates 0 a 9, matter management, workstreams, RACI, Kanban jurídico, medición, mejora continua, auditoría metodológica y control de uso indebido de métodos. Queda prohibido usar método sin propósito, datos sin calidad, Pareto sin datos, DMAIC sin proceso repetible, Lean Startup para evadir obligaciones o soluciones sin responsable.

## Sprint 05 — Arquitectura RAG 0.5.0

Se incorpora arquitectura técnica, documental y jurídica del RAG. Los agentes pueden solicitar evidence bundles, citas verificadas, autoridad, vigencia, temporalidad, conflictos y abstención. No se han cargado fuentes jurídicas reales masivamente ni conectado servicios externos. Ninguna fuente es fundamento definitivo sin procedencia, autoridad, integridad, vigencia, versión, ubicación exacta y revisión humana cuando aplique.
