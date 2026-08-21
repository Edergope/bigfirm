---
workflow_id: "WF-01"
name: "Análisis Inicial de Caso, Intake y Delimitación Jurídica"
category: "transversal"
version: "2.0.0"
status: active
---

# WF-01: Análisis Inicial de Caso, Intake y Delimitación Jurídica

## 🎯 1. Propósito y Alcance
Puerta de entrada del sistema. Extrae hechos, cronología fáctica, partes involucradas, plazos de caducidad, delimita materias jurídicas y recomienda la ruta de acción.

**Disparador / Casos de Activación:**
> Solicitudes iniciales: "Analiza este caso", "Dime qué hacer", o recepción de un nuevo expediente.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Extracción Fáctica y Triaje (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae partes (Demandante/Demandado/Cliente/Contraparte), NIT, cronología fáctica detallada, términos perentorios y crea `cases/CASE-AAAA-NNN/CASE_METADATA.md`.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Revisa todos los documentos adjuntos y levanta el inventario preliminar de pruebas.

### Ola 2: Diagnóstico Jurídico Multidisciplinario (Pro)
- **`00-orquestador-general-juridico` (Model: `pro`):** Delimita el problema jurídico principal y conexos. Convoca a los especialistas de área pertinentes (`especialista-societario-y-mna`, `especialista-contractual-y-negocios`, `especialista-civil-bienes-e-inmobiliario`, etc.).
- **Especialistas Sustanciales (Model: `pro`):** Emiten dictamen preliminar sobre riesgos, fortalezas y opciones de actuación.

### Ola 3: Hoja de Ruta y Consolidación (Pro / Flash-Lite)
- **`06-estratega-juridico-convencional` (Model: `pro`):** Proyecta la hoja de ruta y sugiere el siguiente workflow operativo (`WF-02`, `WF-03`, `WF-04`, etc.).
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Compila el informe de diagnóstico en `trabajo_interno/md/diagnostico_inicial.md`.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Hechos fácticos 100% basados en documentos aportados (sin vacíos no identificados).
- [ ] Términos perentorios de caducidad o contestación identificados con fecha exacta.
- [ ] Workflow siguiente definido formalmente.
