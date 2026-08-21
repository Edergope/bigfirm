---
workflow_id: "WF-12"
name: "Auditoría Adversarial Red Team, Control de Citas y Entrega Final Word"
category: "transversal"
version: "2.0.0"
status: active
---

# WF-12: Auditoría Adversarial Red Team, Control de Citas y Entrega Final Word

## 🎯 1. Propósito y Alcance
Filtro final de calidad del sistema Pisoso Legal AI. Realiza test de estrés adversarial, verifica que no existan alucinaciones normativas y genera el entregable Word con tipografía >= 11 pt.

**Disparador / Casos de Activación:**
> Fase final de cualquier actuación jurídica antes de entregar producto terminado al cliente o socio director.

---

## 🌊 2. Protocolo de Ejecución en Olas (Wave Orchestration)

### Ola 1: Verificación de Citas y Vigencia (Flash)
- **`11-auditor-de-citas-y-vigencia` (Model: `flash`):** Audita 100% de las leyes, decretos, resoluciones y jurisprudencia citada en los borradores de `trabajo_interno/md/`.

### Ola 2: Test de Estrés Judicial y Auditoría Red Team (Pro)
- **`14-magistrado-procesal-y-nulidades` (Model: `pro`):** Examina si un juez rechazaría la pretensión o decretaría nulidad procesal.
- **`10-auditor-juridico-y-red-team` (Model: `pro`):** Realiza control adversarial integral, califica hallazgos (Blocker, Critical, Major, Minor) y emite sello de aprobación.

### Ola 3: Conversión Editorial Word y Limpieza de Raíz (Flash-Lite)
- **`02-compilador-y-entrega-final` (Model: `flash_lite`):**
  1. Toma los textos aprobados de `trabajo_interno/md/`.
  2. Ejecuta `scripts/markdown_to_docx.py` usando la plantilla oficial más adecuada de `Palntillas word/`.
  3. Asegura tipografía >= 11 pt en todos los estilos (títulos, tablas, párrafos).
  4. Deposita el documento `.docx` en la raíz de `cases/CASE-AAAA-NNN/`.
  5. Verifica que en la raíz NO queden archivos `.md` o `.py` sueltos.

---

## 📁 3. Protocolo File-First y Entregables
- **Trabajo Interno (`cases/CASE-AAAA-NNN/trabajo_interno/md/`):** Todos los análisis previos, dictámenes parciales y borradores habitan exclusivamente aquí.
- **Raíz del Caso (`cases/CASE-AAAA-NNN/`):** Al finalizar el workflow, únicamente habitará el entregable final en formato **Word (.docx)** diagramado en plantilla oficial, junto a los PDFs aportados originalmente.

---

## 🛡️ 4. Gates de Calidad y Criterios de Aprobación
- [ ] Cero citas derogadas o alucinadas.
- [ ] Sello 'APPROVED' emitido por el Auditor Jurídico.
- [ ] Archivo .docx generado en raíz con tipografía >= 11 pt y raíz limpia de archivos de trabajo.
