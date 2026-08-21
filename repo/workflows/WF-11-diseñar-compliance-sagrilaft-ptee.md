---
workflow_id: "WF-11"
name: "Diseño e Implementación de Programas SAGRILAFT y PTEE"
category: "compliance"
version: "2.0.0"
status: active
---

# WF-11: Diseño e Implementación de Programas SAGRILAFT y PTEE

## 🎯 1. Propósito y Alcance
Estructuración integral de sistemas preventivos de LA/FT/FPADM, anticorrupción, matrices de riesgo, canales de denuncia y debida diligencia de contrapartes.

**Disparador / Casos de Activación:**
> Solicitudes de: "Manual SAGRILAFT", "Programa de Transparencia y Ética Empresarial", "Auditoría de cumplimiento Supersociedades".

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Datos Financieros y Listas Restrictivas (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae ingresos brutos, activos y sector económico para validar umbrales de obligatoriedad.
- **`analista-debida-diligencia-y-listas` (Model: `flash`):** Revisa matrices de contrapartes, socios, PEPs y beneficiarios finales (RUB).

### Ola 2: Manual de Cumplimiento y Matrices de Riesgo (Pro)
- **`oficial-compliance-sagrilaft-ptee` (Model: `pro`):** Redacta el Manual SAGRILAFT/PTEE, Código de Ética y Matriz de Riesgos por factores.
- **`especialista-societario-y-mna` (Model: `pro`):** Diseña el acta de Junta Directiva o Asamblea de adopción de las políticas.

### Ola 3: Redacción Final, Auditoría y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Consolida el paquete normativo interno en `trabajo_interno/md/manual_compliance.md`.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Audita el cumplimiento estricto del Capítulo X y XIII de la Circular Básica Jurídica de Supersociedades.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera los manuales oficiales en Word `.docx`.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Factores de riesgo identificados (clientes, proveedores, empleados, productos, canales, jurisdicciones).
- [ ] Procedimiento claro de debida diligencia intensificada y reporte interno.
