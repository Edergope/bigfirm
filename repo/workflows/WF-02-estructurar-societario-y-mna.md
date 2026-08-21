---
workflow_id: "WF-02"
name: "Estructuración Corporativa, Acuerdos de Accionistas y M&A"
category: "corporativo"
version: "2.0.0"
status: active
---

# WF-02: Estructuración Corporativa, Acuerdos de Accionistas y M&A

## 🎯 1. Propósito y Alcance
Gobierno corporativo, diseño de estatutos blindados, acuerdos de accionistas (drag-along, tag-along, vetos) y transacciones de M&A.

**Disparador / Casos de Activación:**
> Solicitudes de: reformas estatutarias SAS, pactos de socios, rondas de inversión, debida diligencia de compraventa de empresa o fusión.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Intake y Cap Table (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae estructura societaria actual, accionistas, % de participación y órganos sociales.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Audita actas de asamblea previas, libros de accionistas y estados financieros.

### Ola 2: Arquitectura Societaria, Tributaria y Estrategia (Pro)
- **`especialista-societario-y-mna` (Model: `pro`):** Diseña los estatutos, el acuerdo de accionistas (SHA) o el contrato de compraventa (SPA).
- **`especialista-tributario-y-aduanero` (Model: `pro`):** Evalúa el impacto fiscal de la operación (ganancia ocasional, retenciones, precios de transferencia).
- **`06-estratega-juridico-convencional` (Model: `pro`):** Diseña los mecanismos de resolución de bloqueos societarios (Deadlock, Buy-Sell, Ruleta Rusa).

### Ola 3: Redacción, Auditoría y Conversión Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta la minuta completa sin corchetes de muestra en `trabajo_interno/md/acuerdo_societario.md`.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Audita legalidad frente a la Ley 1258 de 2008 y régimen de administradores.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera el entregable final Word `.docx` en la raíz del caso usando la plantilla oficial con tipografía >= 11 pt.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] No existen pactos estatutarios contrarios al orden público.
- [ ] Se revisó la ejecutabilidad de las cláusulas de restricción a la cesión de acciones.
- [ ] Documento Word generado en la raíz con tipografía >= 11 pt.
