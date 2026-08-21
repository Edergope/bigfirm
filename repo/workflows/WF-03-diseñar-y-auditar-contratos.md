---
workflow_id: "WF-03"
name: "Diseño, Revisión y Auditoría Contractual Compleja"
category: "contractual"
version: "2.0.0"
status: active
---

# WF-03: Diseño, Revisión y Auditoría Contractual Compleja

## 🎯 1. Propósito y Alcance
Arquitectura contractual civil y comercial, balances de riesgo, indemnidades, garantías reales/mobiliarias y cláusulas penales.

**Disparador / Casos de Activación:**
> Solicitudes de: "Redacta un contrato", "Revisa este contrato", "Audita esta minuta", novación o estructuración de contratos atípicos.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Extracción de Obligaciones y Cotejo Normativo (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Identifica partes, objeto, precio, vigencia y obligaciones de dar/hacer/no hacer.
- **`03-investigador-normativo-jurisprudencial` (Model: `flash`):** Verifica régimen normativo aplicable (típico vs. atípico) y sentencias de la Sala Civil CSJ.

### Ola 2: Estructuración y Asignación de Riesgos (Pro)
- **`especialista-contractual-y-negocios` (Model: `pro`):** Diseña la matriz de riesgos contractuales, límites de responsabilidad, cláusulas penales, garantías y causales de terminación.
- **`15-estratega-disruptivo-y-negociador` (Model: `pro`):** Evalúa asimetrías negociables y cláusulas de escape legítimas.

### Ola 3: Redacción Senior, Magistratura y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta el contrato integral con desarrollo en cascada en `trabajo_interno/md/contrato_borrador.md`.
- **`14-magistrado-procesal-y-nulidades` (Model: `pro`):** Audita la exigibilidad del título ejecutivo (obligaciones claras, expresas y exigibles).
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera el archivo Word `.docx` final en la raíz del caso.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Toda obligación pecuniaria o de entrega presta mérito ejecutivo claro.
- [ ] Cláusula penal y limitación de responsabilidad dentro de los topes legales.
- [ ] Tipografía >= 11 pt en todo el documento final.
