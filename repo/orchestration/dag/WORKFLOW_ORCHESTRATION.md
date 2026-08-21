# Orquestación Maestra de Workflows — Pisoso Legal AI (v5.4.1)

## Propósito
Este documento fija y bloquea de manera definitiva la **Secuencia Canónica Ejecutable de Orquestación Multiagente**, incorporando dependencias estrictas, compuertas duras (*Hard Gates*), síntesis ejecutiva verificable del Managing Partner (`00`), ejecución nativa de compilación (`02`) y endurecimiento de disciplina factual/jurídica (`10/11`).

---

## 🗺️ Mapa de Enrutamiento de Workflows

| Solicitud del Cliente / Abogado Director | Workflow Inicial | Workflow Siguiente Recomendado |
| :--- | :--- | :--- |
| “Analiza este caso” / “Dime qué hacer” | `WF-01-analizar-caso-e-intake` | `WF-02`, `WF-03`, `WF-04` o según materia |
| “Reforma estatutos / Pacto de socios / M&A” | `WF-02-estructurar-societario-y-mna` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Redacta / Revisa / Audita este contrato” | `WF-03-diseñar-y-auditar-contratos` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Redacta una demanda civil / comercial” | `WF-04-proyectar-demanda-y-litigio` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Nos notificaron de una demanda / Contesta” | `WF-05-contestar-demanda-y-defensa` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Reorganización Ley 1116 / Insolvencia” | `WF-06-reorganizar-e-insolvencia` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Registro de marca / Oposición / Software / PI” | `WF-07-proteger-propiedad-intelectual-y-datos` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Sucesión / Testamento / Capitulaciones / Patrimonio” | `WF-08-planeacion-patrimonial-y-familia` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Audiencia penal / Captura / Imputación Ley 906” | `WF-09-defensa-penal-general-y-audiencias` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Fraude corporativo / Delito societario / Denuncia” | `WF-10-penal-corporativo-e-investigaciones` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Manual SAGRILAFT / PTEE / Compliance” | `WF-11-diseñar-compliance-sagrilaft-ptee` | `WF-12-auditoria-adversarial-y-entrega-word` |
| “Audita y genera documento Word final” | `WF-12-auditoria-adversarial-y-entrega-word` | Cierre de expediente (`closed`) |

---

## ⚡ SECUENCIA CANÓNICA DE DEPENDENCIAS ESTRICTAS (DAG)

```text
[00] — CLASIFICACIÓN FÁCTICA + ISSUE MAP + ORCHESTRATION PLAN [Pro]
        ↓
01 [flash_lite] + 03 [flash] + [04] [flash] + [05] [flash]
        ↓
═══════════════════ WAVE 1 HARD GATE (Fact & Evidence Ledger) ═══════════════════
        ↓
ESPECIALISTAS SUSTANTIVOS REQUERIDOS [Pro] [Concurrencia real invoke_subagent]
        ↓
═══════════════════ WAVE 2 HARD GATE (Substantive Alignment) ════════════════════
        ↓
06 — ESTRATEGA JURÍDICO CONVENCIONAL (Teoría Principal y Prescripción) [Pro]
        ↓ (Insumo obligatorio para 15 y 14)
[15] ESTRATEGA DISRUPTIVO / NEGOCIADOR [Pro] + [14] MAGISTRADO PROCESAL [Pro]
        ↓
═══════════════════ WAVE 3 HARD GATE (Dual Strategy & Procedibility) ═════════════
        ↓
10 — AUDITOR JURÍDICO & RED TEAM [Pro] + 11 — AUDITOR DE CITAS Y VIGENCIA [Flash]
        ↓ (Control estricto contra mutación de hipótesis en hechos ciertos)
═══════════════════ FINAL HARD GATE (10 Quality Gates / 0 Blockers) ═════════════
        ↓
00 — SÍNTESIS Y DECISIÓN ESTRATÉGICA DEFINITIVA (Managing Partner) [Pro]
        ↓
[08] — REDACCIÓN FORMAL DE MEMORIAL / CONCEPTO [Pro]
        ↓
[02] — COMPILADOR Y ENTREGA FINAL (Subagente Real Word .docx) [Flash-Lite]
```

---

## 🛡️ LAS CUATRO REGLAS DE ENDURECIMIENTO RESIDUO-CERO
1. **Secuencialidad Estricta `06 → (15 + 14)`:** `06` debe dictaminar primero la teoría del caso convencional y el cómputo de términos; `15` (negociador) y `14` (magistrado) consumen obligatoriamente el artefacto `06_estrategia_convencional.md` para calibrar la mesa y la simulación judicial.
2. **Síntesis Estratégica Verificable de `00`:** Tras el visto bueno de `10` y `11` (Final Hard Gate), el `00-orquestador` emite formalmente la decisión estratégica que rige las directrices del `08-redactor-senior`.
3. **Ejecución de `02-compilador` como Subagente Real:** `02` se despacha vía `invoke_subagent` (`Model: flash_lite`) para ejecutar la conversión a `.docx` oficial asegurando tipografía $\ge$ 11 pt y aislamiento documental.
4. **Disciplina Factual y Jurídica Infranqueable (`10/11`):** Ningún dato reportado verbalmente (`[D]`), apreciación (`[A]`) o hipótesis pericial (`[I]`) puede transmutar en hecho probado (`[F]`) ni sustentar acusaciones disciplinarias o penales sin acervo probatorio directo.
