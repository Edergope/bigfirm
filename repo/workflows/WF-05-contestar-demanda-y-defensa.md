---
workflow_id: "WF-05"
name: "Contestación de Demanda, Excepciones y Estrategia de Defensa"
category: "litigio"
version: "2.0.0"
status: active
---

# WF-05: Contestación de Demanda, Excepciones y Estrategia de Defensa

## 🎯 1. Propósito y Alcance
Defensa procesal inmediata, pronunciamiento sobre hechos (cierto, no es cierto, no me consta), formulación de excepciones previas y de mérito, y demanda de reconvención.

**Disparador / Casos de Activación:**
> Solicitudes de: "Contesta esta demanda", "Nos llegó una notificación judicial", "Prepara excepciones".

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Desglose de Notificación y Términos (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Calcula con rigor milimétrico el término de traslado (días hábiles según CGP/CPACA).
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Examina las pruebas aportadas por el demandante en busca de tachas, falsedad o falta de mérito.

### Ola 2: Excepciones Previas, de Mérito y Reconvención (Pro)
- **`14-magistrado-procesal-y-nulidades` (Model: `pro`):** Formula excepciones previas (falta de competencia, cláusula compromisoria, indebida representación, pleito pendiente).
- **`06-estratega-juridico-convencional` (Model: `pro`):** Diseña excepciones de mérito de fondo (prescripción, pago, compensación, inexistencia de la obligación).
- **`15-estratega-disruptivo-y-negociador` (Model: `pro`):** Evalúa la viabilidad de demanda de reconvención (contrademanda) o acuerdo transaccional.

### Ola 3: Redacción de Memorial, Auditoría y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta el memorial de contestación en `trabajo_interno/md/contestacion_borrador.md`.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Realiza control adversarial final.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera el archivo Word `.docx` en la raíz del caso.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Pronunciamiento expreso sobre todos y cada uno de los hechos de la demanda.
- [ ] Excepciones previas radicadas dentro del término estricto de ley.
- [ ] Pruebas de descargo y solicitud de pruebas decretadas.
