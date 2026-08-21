---
workflow_id: "WF-09"
name: "Defensa Penal Técnica, Audiencias Concentradas y Juicio Oral (Ley 906)"
category: "penal"
version: "2.0.0"
status: active
---

# WF-09: Defensa Penal Técnica, Audiencias Concentradas y Juicio Oral (Ley 906)

## 🎯 1. Propósito y Alcance
Defensa penal técnica en el Sistema Penal Acusatorio (Ley 906 de 2004), control de garantías, audiencias preliminares, preacuerdos y juicio.

**Disparador / Casos de Activación:**
> Solicitudes de: "Captura de cliente", "Audiencia de imputación", "Medida de aseguramiento", "Defensa en juicio penal".

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Hechos de Imputación y Elementos Probatorios (Flash-Lite / Flash)
- **`01-intake-y-clasificador` (Model: `flash_lite`):** Extrae fecha de captura, términos de 36 horas, delitos imputados y número de SPOA.
- **`04-analista-probatorio-y-pericial` (Model: `flash`):** Examina actas de derechos del capturado, cadena de custodia y EMP/EF.

### Ola 2: Teoría del Caso Penal y Argumentación de Libertad (Pro)
- **`especialista-penal-general-y-litigio` (Model: `pro`):** Diseña la teoría del caso de la defensa (fáctica, jurídica y probatoria) y prepara argumentos de necesidad/proporcionalidad contra la medida carcelaria.
- **`15-estratega-disruptivo-y-negociador` (Model: `pro`):** Evalúa la procedencia de preacuerdos o principio de oportunidad.

### Ola 3: Proyección de Memoriales, Magistratura y Word (Pro / Flash-Lite)
- **`08-redactor-senior-juridico` (Model: `pro`):** Proyecta la argumentación para audiencia o recurso de apelación en `trabajo_interno/md/defensa_penal.md`.
- **`14-magistrado-procesal-y-nulidades` (Model: `pro`):** Audita vulneraciones al debido proceso o causales de nulidad por afectación de derechos fundamentales.
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):** Genera el informe/memorial Word `.docx`.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Verificación de términos perentorios de 36 horas para legalización de captura.
- [ ] Matriz de contradicción probatoria de la acusación de la Fiscalía.
