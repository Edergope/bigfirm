---
workflow_id: "WF-10"
name: "Derecho Penal Corporativo, Delitos Económicos e Investigaciones Forenses"
category: "penal_corporativo"
version: "2.0.0"
status: active
---

# WF-10: Derecho Penal Corporativo, Delitos Económicos e Investigaciones Forenses

## 🎯 1. Propósito y Alcance
Atención de contingencias penales empresariales, aseguramiento de evidencia digital, estructuración de denuncias penales y mitigación de responsabilidad directiva.

**Disparador / Casos de Activación:**
> Solicitudes de: fraude interno en empresa, denuncia por administración desleal, corrupción privada, soborno o investigación forense corporativa.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Hechos de la Irregularidad y Evidencia Digital (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae cronología de transacciones cuestionadas y personal involucrado.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Audita registros contables, logs informáticos y asegura cadena de custodia digital.

### Ola 2: Tipicidad Penal Corporativa y Compliance (Pro)
- **`especialista-penal-corporativo-y-delitos-economicos` (Model: `pro`):** Analiza tipicidad de delitos (administración desleal, estafa, abuso de confianza, falsedad, corrupción privada).
- **`oficial-compliance-sagrilaft-ptee` (Model: `pro`):** Evalúa fallas en los controles internos y activación de protocolos disciplinarios.

### Ola 3: Redacción de Denuncia Penal, Auditoría y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta la denuncia penal formal con anexos probatorios en `trabajo_interno/md/denuncia_penal_corporativa.md`.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Audita que la denuncia no incurra en falsa denuncia ni afecte la posición de la compañía.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera la denuncia Word `.docx` definitiva.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Evidencia digital recolectada conforme al debido proceso probatorio.
- [ ] Determinación clara del perjuicio patrimonial acreditado con dictamen contable.
