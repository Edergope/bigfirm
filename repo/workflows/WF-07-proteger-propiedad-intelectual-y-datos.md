---
workflow_id: "WF-07"
name: "Propiedad Intelectual, Signos Distintivos, Software y Habeas Data"
category: "propiedad_intelectual"
version: "2.0.0"
status: active
---

# WF-07: Propiedad Intelectual, Signos Distintivos, Software y Habeas Data

## 🎯 1. Propósito y Alcance
Protección de intangibles, registro marcario (Decisión 486), derechos de autor (DNDA), secretos comerciales y cumplimiento de Habeas Data (Ley 1581).

**Disparador / Casos de Activación:**
> Solicitudes de: registro de marca, contestar oposición ante la SIC, cesión de software, licencias de patentes, auditoría de bases de datos.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Búsqueda de Antecedentes y Titularidad (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Identifica signo distintivo, clases de Niza, autor de software o base de datos.
- **`03-investigador-normativo-jurisprudencial` (Model: `flash`):** Rastrea antecedentes en la base de datos de la SIC (SIPI) y gacetas de propiedad industrial.

### Ola 2: Diagnóstico de Distintividad y Estrategia de Registro/Defensa (Pro)
- **`especialista-propiedad-intelectual-y-datos` (Model: `pro`):** Evalúa riesgo de confusión o asociación, notoriedad de marca o elabora la Política de Tratamiento de Datos.
- **`06-estratega-juridico-convencional` (Model: `pro`):** Diseña los argumentos de distintividad o causal de oposición.

### Ola 3: Redacción de Memorial/Contrato y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta el memorial de oposición/recurso o contrato de licencia/cesión en `trabajo_interno/md/pi_borrador.md`.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera el documento oficial Word `.docx`.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Clasificación de Niza precisa según el giro del negocio.
- [ ] Cesión de derechos patrimoniales con determinación de alcance, territorio y temporalidad.
