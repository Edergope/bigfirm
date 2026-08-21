# Estándar de calidad

## Precisión

Toda afirmación relevante debe ser verificable o marcarse como pendiente.

## Trazabilidad

Las salidas deben relacionar hechos, documentos, fuentes y agentes intervinientes.

## Coherencia

Nombres, fechas, hechos, pretensiones, anexos y conclusiones deben ser consistentes.

## Completitud

No cerrar análisis cuando existan vacíos críticos sin advertencia.

## Claridad

Separar hechos, inferencias, riesgos, conclusiones y tareas pendientes.

## Prohibición de alucinaciones

Está prohibido inventar normas, jurisprudencia, citas, hechos o pruebas.

## Marcadores de información pendiente

Usar etiquetas claras como `PENDIENTE`, `POR VERIFICAR` o `REQUIERE SOPORTE`.

## Revisión por nivel senior

Todo borrador jurídico requiere revisión senior antes de auditoría.

## Auditorías

Deben aplicarse auditoría jurídica, auditoría de citas y auditoría de coherencia.

## Aprobación final

La entrega final requiere consolidación y control por el agente autorizado.

## Alineación Sprint 02 — trazabilidad y auditorías

Los workflows activos exigen separar hechos, pruebas, normas, jurisprudencia, interpretación, inferencia, estrategia, recomendación y redacción final. Cada conclusión debe ser trazable a fuente, documento, evidencia o supuesto identificado.

Toda salida debe declarar que requiere revisión del abogado director, no se radica automáticamente y no debe enviarse a clientes o autoridades sin aprobación humana.

## Micro Sprint 03A — calidad interdisciplinaria

Los análisis interdisciplinarios deben distinguir conclusión jurídica, observación sectorial, estimación económica, inferencia dogmática, antecedente histórico, comparación extranjera y propuesta de política pública. Ningún agente no jurídico puede cerrar una conclusión jurídica final sin validación. Todo dato económico requiere fuente, método o marcador `[INFORMACIÓN PENDIENTE]`. El derecho comparado debe declarar límites de trasplante jurídico.


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

## Jerarquía Textual y Formato Visual

Toda redacción documental del sistema orientada al usuario humano debe entregarse en formato Word (.docx), respetando rigurosamente la estructura y nivelación visual del contenido. No se permite mezclar estilos tipográficos ni dejar marcas tipográficas de Markdown residuales (como asteriscos `**` o guiones de viñeta no procesados en el texto final). Se debe aplicar el siguiente orden jerárquico estandarizado en el archivo Word:
1.  **Título Principal (Heading 1 / H1):** Utilizado únicamente para el nombre del documento o título del caso (Centrado, negrita, tamaño grande).
2.  **Secciones Principales (Heading 2 / H2):** Para las divisiones troncales del documento (Hechos, Pretensiones, Consideraciones, Anexos).
3.  **Subsecciones (Heading 3 / H3):** Para desglosar temas dentro de una sección (ej. Hechos de la parte demandante, Hechos de la parte demandada).
4.  **Cuerpo de Texto y Párrafos:** Texto justificado, interlineado regular y separación clara entre párrafos sin usar tabulaciones innecesarias, preservando la tipografía de la plantilla de Word original.

## Estándar de Tablas y Márgenes en Word (.docx)

Para garantizar que la información tabular esté perfectamente organizada en el archivo Word final y no se desborde ni se salga de los límites físicos del documento (márgenes laterales de la plantilla .docx):
1.  **Límite de Columnas:** Las tablas en documentos estándar deben tener un máximo de 6 columnas. Si se requiere presentar información con mayor número de atributos, se debe reestructurar el contenido en múltiples tablas sucesivas o listas jerárquicas.
2.  **Ancho Adaptativo:** El ancho total de las tablas en Word debe ajustarse al 100% del área de texto disponible entre los márgenes predeterminados de la plantilla.
3.  **Ajuste Automático de Celdas:** El texto dentro de las celdas de Word debe tener activado el ajuste de línea automático (*word wrap*). Ningún texto debe extenderse horizontalmente fuera de los bordes de la celda.
4.  **Organización y Legibilidad:** Las tablas deben contar con una fila de cabecera en negrita, bordes de cuadrícula uniformes (`Table Grid`) y márgenes internos mínimos de celda (`padding`) para asegurar una lectura cómoda, respetando el formato nativo de la plantilla.

## Alineación BigFirm & Venture Capital Law (Protocolo BIGFIRM_STANDARD.md)

Todo trabajo contractual, estatutario o societario en Pisoso Legal AI debe cumplir estrictamente con **`BIGFIRM_STANDARD.md`**:
- **Prohibición Absoluta de Síntesis:** Queda rechazado cualquier borrador que entregue resúmenes compendiados, esquemas acortados o menos de 75 artículos en constituciones de SAS de alta complejidad.
- **Exigencia de Arquitectura Completa:** Se debe incorporar de forma imperativa el desglose multiclase (10 series/clases accionarias), la imputación de pago por tercero para exención fiscal DIAN, la matriz de 15 Materias Reservadas, el Consentimiento Especial de Fundador E, el Piso Anti-Dilución al 20% en Base Totalmente Diluida, el Deadlock con Fair Market Value y el procedimiento de exclusión sin descuentos punitivos.
- **Tipografía y Jerarquía:** Aplicación obligatoria de los estilos nativos Word: `Doc Título`, `Doc Subtítulo`, `H1`, `Artículo Legal`, `Subcláusula Legal`, `Nota Legal` y `Body Legal`.



