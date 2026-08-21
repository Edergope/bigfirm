---
workflow_id: "WF-08"
name: "Planeación Patrimonial Familiar, Sucesiones y Capitulaciones"
category: "familia_patrimonio"
version: "2.0.0"
status: active
---

# WF-08: Planeación Patrimonial Familiar, Sucesiones y Capitulaciones

## 🎯 1. Propósito y Alcance
Protección jurídica de patrimonios familiares, liquidación de sociedades conyugales/patrimoniales, asignaciones forzosas y protocolos familiares.

**Disparador / Casos de Activación:**
> Solicitudes de: testamentos, partición en vida (art. 487 CGP), capitulaciones matrimoniales, sucesión notarial/judicial o blindaje de patrimonio.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Árbol Genealógico e Inventario de Activos (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Mapea familiares, herederos forzosos, cónyuge/compañero y estado civil.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Revisa títulos de propiedad de inmuebles, vehículos, acciones y gravámenes.

### Ola 2: Órdenes Hereditarios, Blindaje Fiscal y Acuerdos (Pro)
- **`especialista-familia-y-planeacion-patrimonial` (Model: `pro`):** Modela la partición o testamento respetando legítimas forzosas y diseña afectación a vivienda / patrimonio de familia.
- **`especialista-tributario-y-aduanero` (Model: `pro`):** Optimiza el impacto del impuesto de ganancia ocasional sucesoral.
- **`15-estratega-disruptivo-y-negociador` (Model: `pro`):** Facilita acuerdos de partición voluntaria para evitar litigios sucesorales.

### Ola 3: Redacción Notarial, Auditoría y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta la escritura pública de capitulaciones, partición o testamento en `trabajo_interno/md/particion_patrimonial.md`.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Audita que no se violen asignaciones forzosas ni derechos de terceros acreedores.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera la minuta Word `.docx` final.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Respeto absoluto a las legítimas forzosas (hijos/padres) y porción conyugal.
- [ ] Verificación de certificados de tradición de los bienes a adjudicar.
