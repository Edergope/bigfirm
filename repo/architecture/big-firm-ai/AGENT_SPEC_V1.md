# AGENT_SPEC_V1 — Especificación neutral de agente

**Estado:** PROPOSED · **Fecha:** 2026-08-21

Un agente de Big Firm AI = **conocimiento profesional** (prosa, intacta) + **configuración de
runtime** (declarativa, neutral). El mismo agente profesional debe poder ejecutarse en OpenAI,
Gemini o un proveedor futuro **sin reescribir su conocimiento jurídico**.

## 1. Estructura de carpeta objetivo (por agente)

```
repo/agents/<agent-id>/
├── original-antigravity.md   # copia exacta del agent.md canónico (INMUTABLE, con su sha256)
├── instructions.md           # SOLO conocimiento profesional, sin runtime Antigravity
├── agent.yaml                # configuración de runtime neutral (AgentDefinition)
└── CHANGELOG.md              # qué se extrajo/movió y por qué (trazabilidad de la migración)
```

`original-antigravity.md` conserva la fuente canónica; su hash sigue validándose contra
`manifests/AGENTS_MANIFEST.json`. `instructions.md` es lo que el Prompt Loader carga en runtime.

## 2. Modelo `AgentDefinition` (agent.yaml)

```yaml
# ── identity ───────────────────────────────────────────────
id: "01-intake-y-clasificador"
version: "1.0.0"
display_name: "Director de Intake y Clasificación"
role: "intake"                 # intake|research|evidentiary|procedural|specialist|strategy|
                               # red_team|citation_audit|drafting|compilation|orchestrator|quality
domain: ["general", "clasificacion"]
seniority_note: "Director de Intake"   # metadato profesional, no afecta runtime

# ── knowledge (puntero, NO contenido) ──────────────────────
instructions_ref: "instructions.md"    # cargado dinámicamente por el Prompt Loader
canonical_source: "original-antigravity.md"
canonical_sha256: "aa181f95...cda22f3cb"   # debe coincidir con el manifest

# ── provider / model policy (neutral) ──────────────────────
model_policy:
  tier: "efficient"            # efficient | balanced | high_reasoning | verification | production
  temperature: 0.2
  max_output_tokens: 8000
  provider_preference: ["gemini", "openai"]   # orden; el Router decide con disponibilidad/costo
  # NO se fija un model id concreto aquí — lo resuelve MODEL_ROUTER por tier. Ver ese doc.

# ── I/O contracts ──────────────────────────────────────────
input_schema: "work_package.schema.json"        # ver WORK_PACKAGE_V1
output_schema: "agent_output_contract.schema.json"   # reutiliza schema canónico existente
output_type: "INTAKE"                            # enum del contrato canónico

# ── tools & permissions ────────────────────────────────────
tools:
  - "document.read"
  - "library.search"
permissions:
  drive: "read"                # none|read|read_write, ámbito matter
  db: "read"
  network: "restricted"
  can_request_human_approval: false

# ── orchestration hints (los consume el Workflow Engine) ───
dependencies: []               # ids de agentes cuyos outputs requiere
parallelizable: true
wave_hint: 1                   # ola sugerida (el WF define la autoritativa)
timeout_seconds: 300
retries:
  max: 2
  backoff: "exponential"
idempotency_key: "matter_id::wave::agent_id"

# ── governance ─────────────────────────────────────────────
governance:
  requires_provenance: true
  fact_classification_required: true    # [F]/[A]/[D]/[I]/[C]/[U]/[R]
  blocks_downstream_on_failure: true
  citation_audit_required: false        # true para agentes que citan autoridad
```

## 3. Qué se EXTRAE del prompt hacia agent.yaml (no se borra: se mueve)

De `governance/AGENTS.md` y del cuerpo del orquestador provienen elementos **de runtime** que
salen del texto profesional y pasan a configuración/motor:

| En el prompt Antigravity | Destino en Big Firm AI |
| :-- | :-- |
| `invoke_subagent` / `define_subagent` / `TypeName` | Workflow Engine (dispatch) |
| Matriz Gemini `pro/flash/flash_lite` | `model_policy.tier` + MODEL_ROUTER |
| "ZERO_TEXT_ON_TURN_1", olas, anti-redispatch | State Machine + gates (código) |
| Máquina de estados del DAG en prosa | ORCHESTRATION_V1 (declarativo) |
| Rutas Antigravity (`.agents/agents/...`) | `canonical_source` + Prompt Loader |

**El conocimiento jurídico** (21 preguntas rectoras, taxonomía [F]/[A]/[D]/[I]/[C]/[U]/[R],
Quality Gate de 10 filtros como *criterio profesional*, doctrina, metodología por materia)
**permanece íntegro en `instructions.md`**. Solo se elimina lo que era mecánica de Antigravity.

## 4. Regla de neutralidad

`agent.yaml` **no** menciona `gpt-*`, `gemini-*`, endpoints, ni SDKs. Expresa *intención*
(`tier: high_reasoning`), no *implementación*. Así el mismo agente corre en cualquier proveedor.

## 5. Distinción clave para el `00` (orquestador)

El `00` se parte en dos artefactos:
- **`instructions.md` del 00** → *inteligencia profesional*: cómo un Managing Partner piensa,
  cuestiona, integra y decide (las 21 preguntas, el juicio estratégico, la síntesis).
- **Workflow + DAG + State Machine + Routing + Gates** → *orquestación determinista*.

El `00` **propone** e **interpreta**; el motor **garantiza** ejecución. Ver ORCHESTRATION_V1 §2.

## 6. Compatibilidad con el contrato de salida existente

`output_schema` reutiliza `schemas/agent_output_contract.schema.json` (ya neutral: `fact_assertions`
con `classification`, `numerical_assertions`, `legal_propositions` con `authority_refs`,
`provenance` con doble sha256). **No se rediseña**; AGENT_SPEC lo referencia.
