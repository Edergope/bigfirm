---
workflow_id: "WF-06"
name: "Reorganización Empresarial, Insolvencia y Reestructuración de Deudas"
category: "insolvencia"
version: "2.0.0"
status: active
---

# WF-06: Reorganización Empresarial, Insolvencia y Reestructuración de Deudas

## 🎯 1. Propósito y Alcance
Trámite concursal de insolvencia empresarial o persona natural, inventario de activos, graduación y prelación de créditos y propuesta de acuerdo de pagos.

**Disparador / Casos de Activación:**
> Solicitudes de: "Entrar a Ley 1116", "Insolvencia de persona natural", "Acuerdo de reorganización", "Renegociación de pasivos".

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Diagnóstico Contable y Extracción de Pasivos (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae estado de cesación de pagos o incapacidad inminente.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Revisa estados financieros, inventario de acreencias, pasivos laborales y fiscales.

### Ola 2: Régimen Concursal, Prelación y Estrategia (Pro)
- **`especialista-insolvencia-y-reestructuracion` (Model: `pro`):** Estructura la memoria de causas de insolvencia y la graduación de créditos (primera a quinta clase).
- **`especialista-laboral-y-seguridad-social` (Model: `pro`):** Asegura el tratamiento prioritario de pasivos pensionales y laborales.
- **`especialista-tributario-y-aduanero` (Model: `pro`):** Modela la negociación de pasivos fiscales ante la DIAN/Municipios.

### Ola 3: Redacción del Acuerdo, Auditoría y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta la solicitud de admisión o fórmula de acuerdo en `trabajo_interno/md/acuerdo_insolvencia.md`.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Valida cumplimiento estricto de requisitos de admisión de Supersociedades.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera el entregable final Word `.docx`.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Graduación y prelación legal de créditos conforme al Código Civil y Ley 1116.
- [ ] No existen actos revocables o simulación de pasivos.
