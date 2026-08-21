# Protocolo documental

### Selección de plantilla y Estructura de Entregables

1. **Formato Final Humano (.docx)**: El formato final de todo entregable para el cliente es estrictamente **Word (.docx)**.
2. **Ubicación de Archivos Internos (`trabajo_interno/`)**: Todos los archivos de trabajo que NO son para el cliente final (archivos `.md`, metadatos, minutas preliminares, informes intermedios, notas de investigación y scripts `.py` de generación) DEBEN depositarse de forma obligatoria dentro de la subcarpeta `trabajo_interno/` del expediente (ej. `cases/CASE-AAAA-NNN/trabajo_interno/md/` y `cases/CASE-AAAA-NNN/trabajo_interno/scripts/`).
3. **Filtro de Raíz de Carpeta del Caso**: En la raíz de la carpeta del expediente **ÚNICAMENTE** habitarán los archivos finales **.docx** terminados para el cliente y los documentos fuente originales en **.pdf**.
4. **Respeto a Diagramación, Jerarquía de Títulos y Desarrollo en Cascada**:
   - Cada entregable Word debe construirse utilizando la plantilla más adecuada de la carpeta oficial: `/Users/edergope/Documents/Pisoso Legal/Palntillas word/`.
   - Se debe mantener y respetar estrictamente la diagramación visual, la paleta cromática, los márgenes, tablas, encabezados y la **jerarquía de títulos (Título 1, Título 2, Título 3...)** preestablecida en la plantilla, aplicando un **desarrollo en cascada** (deductivo, claro y estructurado) para máxima legibilidad jurídica.
5. **Las Plantillas NO Son una Limitante de Contenido**:
   - Las plantillas son guías estéticas y de formateo visual. **No limitan la extensión, profundidad o alcance del contenido jurídico**.
   - Queda estrictamente prohibido entregar archivos `.docx` que conserven texto de plantilla sin editar, corchetes de relleno `[NOMBRE DEL CLIENTE]` o bloques genéricos. Se debe sustituir el 100% de la plantilla con el análisis jurídico exhaustivo y sustancial desarrollado por el equipo agéntico.

Toda producción documental parte obligatoriamente de la selección de la plantilla correspondiente:
- **Conceptos jurídicos formales:** `04_Plantilla_Concepto_Juridico_Formal_Pisoso_Legal.docx`
- **Informes de investigación y debida diligencia:** `06_Plantilla_Informe_Debida_Diligencia_Legal_Pisoso_Legal.docx`
- **Estrategia (Convencional y Disruptiva):** `05_Plantilla_Informe_Auditoria_Diagnostico_Legal_Pisoso_Legal.docx`
- **Informes de auditoría y diagnóstico legal:** `05_Plantilla_Informe_Auditoria_Diagnostico_Legal_Pisoso_Legal.docx`
- **Contratos comerciales, civiles y estatutos:** `12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx`
- **Cuentas de Cobro:** `15_Plantilla_Cuenta_Cobro_y_Honorarios_Pisoso_Legal.docx`

**Borradores de Demandas o Peticiones (Bajo Demanda):**
Solo se crearán si el usuario lo solicita explícitamente en el chat. En tal caso, se usarán las plantillas:
- **Actuaciones y memoriales judiciales (Demanda):** `07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx`
- **Actuaciones administrativas (Petición):** `08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx`

El agente compilador o redactor correspondiente debe ejecutar el script automatizado de conversión del repositorio (`scripts/markdown_to_docx.py` o equivalente dentro de `trabajo_interno/scripts/`) para volcar y formatear el contenido estructurado del Markdown interno dentro de la plantilla Word elegida. El archivo `.docx` resultante se depositará directamente en la raíz de la carpeta del caso.

## Destinatario

Identificar autoridad, contraparte, juez, entidad, cliente o destinatario privado.

## Hechos

Usar hechos aprobados del expediente y marcar información pendiente.

## Fundamentos

Incluir solo fundamentos verificados conforme a la política de fuentes.

## Solicitudes o pretensiones

Deben ser claras, congruentes con los hechos y revisadas por nivel senior.

## Anexos

Relacionar anexos disponibles y pendientes.

## Control de versiones

Toda versión debe indicar autoría, fecha, estado y revisión pendiente.

## Revisión jurídica

El redactor senior revisa técnica, estructura y congruencia.

## Auditoría

Debe existir auditoría jurídica, de citas y de coherencia antes de entrega final.

## Compilación

El compilador documental normaliza numeración, términos y anexos.

## Entrega final

Solo `13-entrega-final.md` consolida y entrega el producto aprobado.

## Alineación Sprint 02 — ciclo documental

Todo documento sigue el ciclo `draft → senior_review → audit → correction_required → corrected_draft → re_audit → approved`. Un hallazgo `blocker` impide avanzar; un hallazgo `critical` exige corrección; un hallazgo `major` requiere corrección o justificación; un hallazgo `minor` puede corregirse durante compilación; una observación no impide aprobar.

El límite inicial es de tres rondas de corrección. Después de tres rondas sin aprobación, el orquestador marca `blocked`, escala al socio director y genera informe de conflicto.

## Micro Sprint 03C — núcleo empresarial, compliance, LA/FT/FPADM, PI y franquicias

Se incorporan agentes y workflows profundos para M&A, due diligence, tributario, penal empresarial, penal tributario, compliance, LA/FT/FPADM, investigaciones internas, propiedad intelectual, marcas, software, transferencia tecnológica y franquicias. Toda salida requiere revisión humana; ningún agente declara delitos, garantiza registros, reporta a autoridades o aprueba documentos finales automáticamente.

Rutas ejemplo: compra de empresa → fusiones-adquisiciones → due diligence integral → tributario/laboral/compliance/penal empresarial/PI → arquitectura contractual → auditoría M&A. Programa de cumplimiento → diagnóstico → riesgo corporativo → LA/FT/FPADM + anticorrupción + penal empresarial → programa → auditoría. Expansión por franquicia → diagnóstico de franquiciabilidad → marcas + secretos + contractual + tributario → paquete documental → auditoría de franquicia.

## Sprint 04 — Metodología operativa Pisoso Legal 0.4.0

Se adopta la secuencia OBSERVAR → DELIMITAR → VERIFICAR → DESCOMPONER → DIAGNOSTICAR → DISEÑAR → DECIDIR → DOCUMENTAR → EJECUTAR → AUDITAR → MEDIR → MEJORAR. Los métodos empresariales son auxiliares y no sustituyen liderazgo jurídico certificado ni aprobación humana.

Se incorporan gates 0 a 9, matter management, workstreams, RACI, Kanban jurídico, medición, mejora continua, auditoría metodológica y control de uso indebido de métodos. Queda prohibido usar método sin propósito, datos sin calidad, Pareto sin datos, DMAIC sin proceso repetible, Lean Startup para evadir obligaciones o soluciones sin responsable.

## Sprint 05 — Arquitectura RAG 0.5.0

Se incorpora arquitectura técnica, documental y jurídica del RAG. Los agentes pueden solicitar evidence bundles, citas verificadas, autoridad, vigencia, temporalidad, conflictos y abstención. No se han cargado fuentes jurídicas reales masivamente ni conectado servicios externos. Ninguna fuente es fundamento definitivo sin procedencia, autoridad, integridad, vigencia, versión, ubicación exacta y revisión humana cuando aplique.
