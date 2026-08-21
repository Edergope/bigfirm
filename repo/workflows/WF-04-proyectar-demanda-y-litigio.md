---
workflow_id: "WF-04"
name: "Proyección de Demanda y Litigio Civil / Comercial / Contencioso"
category: "litigio"
version: "2.0.0"
status: active
---

# WF-04: Proyección de Demanda y Litigio Civil / Comercial / Contencioso

## 🎯 1. Propósito y Alcance
Estructuración completa de demandas judiciales bajo CGP o CPACA, pretensiones principales/subsidiarias, acervo probatorio y blindaje contra excepciones.

**Disparador / Casos de Activación:**
> Solicitudes de: "Redacta una demanda", "Proyecta proceso ejecutivo/verbal", "Inicia acción judicial".

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Hechos, Pruebas y Procedibilidad (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae hechos fácticos numerados y verifica términos de prescripción/caducidad.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Construye la Matriz Probatoria (Hecho vs. Prueba vs. Utilidad).
- **`05-analista-procesal-y-procedibilidad` (Model: `flash`):** Verifica conciliación prejudicial (Ley 2220/2022), cuantía y competencia de juez/tribunal.

### Ola 2: Teoría del Caso Dual y Especialidad (Pro)
- **`06-estratega-juridico-convencional` (Model: `pro`):** Formula la Teoría del Caso Principal y jerarquización de pretensiones.
- **`15-estratega-disruptivo-y-negociador` (Model: `pro`):** Formula pretensiones subsidiarias y medidas cautelares innominadas.
- **Especialista de Área Relevante (Model: `pro`):** Aporta la fundamentación sustantiva de fondo.

### Ola 3: Redacción Judicial, Simulación de Magistrado y Word (Pro / Flash / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Redacta la demanda formal completa en `trabajo_interno/md/demanda_borrador.md`.
- **`14-magistrado-procesal-y-nulidades` (Model: `pro`):** Simula las excepciones previas que interpondría el demandado y emite plan de blindaje.
- **`11-auditor-de-citas-y-vigencia` (Model: `flash`):** Audita citas de normas y jurisprudencia.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera la demanda final en Word `.docx` en la raíz.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Requisito de procedibilidad cumplido o justificada su excepción legal.
- [ ] Pretensiones claras, separadas y cuantificadas (juramento estimatorio art. 206 CGP si aplica).
- [ ] No existen riesgos de nulidad procesal.
