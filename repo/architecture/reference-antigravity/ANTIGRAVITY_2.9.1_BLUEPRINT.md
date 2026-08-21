# Antigravity 2.9.1 — Agentic System Blueprint

Versión: Antigravity IDE 2.9.1 · 2026-08-21 · cuenta `consumer`.

---

## 1. AGENT DISCOVERY  `CONFIRMED BY UI + BINARY`
- El IDE descubre custom agents en el WORKSPACE ABIERTO: `.agents/agents/<slug>/agent.md`
  (subiendo del CWD al repo root). También variantes `.agent/`, `_agents/`, `_agent/`.
- El global `~/.gemini/config/` NO expone agentes al selector (los archetypes nativos vienen del binario).
- `~/.gemini/config/skills/<name>/` = skills (progressive disclosure). `.agents/hooks.json` = hooks.
- Spec local autoritativa: `~/.gemini/antigravity/builtin/skills/agy-customizations/`.
- **NO** es discovery oficial: `AGENTS_REGISTRY.json` (convención propia, ignorada por el IDE).

## 2. CUSTOM AGENT FRONTMATTER  `CONFIRMED BY BINARY (language_server struct tags)`
Campos yaml del custom agent: `name, description, mainAgent, subagent, model, tools, enabledTools, disabledTools, trigger, type_name`.
- **Schema mínimo que preserva discovery:** SOLO `name` + `description`.
  `CONFIRMED BY UI` (A/B): añadir muchos campos a la vez (tools anidado, model_tier, title, category, jurisdiction, version, status) **oculta el selector completo** (poisoning).
- Obligatorios para descubrir: `name`, `description`.
```yaml
---
name: <slug>            # = identificador; usado como TypeName al invocar
description: <cuándo delegar / rol>
---
```

## 3. MAIN AGENT VISIBILITY  `CONFIRMED BY UI`
- `mainAgent: true` (default) → seleccionable en el selector.
- `mainAgent: false` → **oculto del selector, PERO sigue descubierto e invocable**. (A/B validado en UI: añadir solo `mainAgent:false` a un agente lo quita del selector sin romper discovery.)
- `subagent: true` (default) → invocable vía `invoke_subagent`.
- Para "1 visible + N ocultos": el visible sin `mainAgent`; los ocultos con `mainAgent:false`.

## 4. SUBAGENT INVOCATION  `CONFIRMED BY BINARY + OFFICIAL DOCS`
- El dispatcher llama `invoke_subagent(TypeName='<slug>')`. Enum interno `CORTEX_STEP_TYPE_INVOKE_SUBAGENT`.
- `TypeName:'self'` = clona al llamante → **PROHIBIDO** (causó recursión masiva). Usar slugs concretos.
- `define_subagent` = crear agentes dinámicos → **PROHIBIDO** si los agentes ya existen registrados.
- `manage_subagents(list|kill|kill_all)` existe para monitoreo/terminación.
- **Un custom Main Agent NO recibe `invoke_subagent`.** `enabledTools:[invoke_subagent]` parsea pero NO inyecta la tool (`CONFIRMED BY UI/RUNTIME`). No hay campo de frontmatter que lo conceda.

## 5. RUNTIME ENTITLEMENTS  `CONFIRMED BY BINARY + OFFICIAL DOCS`  →  **PLATFORM LIMITATION**
- El toolset de la sesión se filtra por `AllowedTools`/`allowed_tools` (required) según el perfil del agente y **feature flags server-side**.
- Flags en el binario: `EnableSubagentTools` / `enable_subagent_tools` / `SubagentToolsEnabled`, `EnableTeamworkSubagent` / `enable_teamwork_subagent`, `AllowedSubagents`, y `EnableUnleash` (Unleash = plataforma de experimentos/feature-flags **server-side**).
- La orquestación multiagente vive en los archetypes internos `teamwork_preview_*` (conductor, orchestrator, worker, synthesizer, layer, …) — el modo `/teamwork-preview`, que por docs oficiales requiere **Ultra ($200/mo)**.
- **Conclusión:** en un chat normal (incluido el Main Agent nativo + una domain-skill) sobre una cuenta `consumer`, `invoke_subagent` NO está registrado en la sesión → orquestación multiagente nativa **bloqueada por entitlement de plan/servidor**. No hay flag local seguro para habilitarlo (los flags son server-delivered; editar binarios/flags está prohibido).
- **Acción del usuario para habilitar (si desea multiagente nativo):** plan/preview que habilite subagentes (Ultra / teamwork-preview), o esperar rollout a consumer. No habilitable localmente.

### Alternativas soportadas si el entitlement no está disponible
- **A. Ultra / teamwork-preview** — camino nativo de la plataforma.
- **B. Orquestador externo (plan-independiente)** — ejecutar el DAG del dominio desde un runtime propio (scripts/gobernanza) que invoque el modelo por-agente vía la API oficial (`agentapi new-conversation` / Gemini API), materializando artefactos y aplicando los mismos gates. Es la vía que NO depende del plan.
- **C. Single-agent secuencial** — un agente ejecuta pasos en serie (NO es multiagente real; sujeto a anti-simulation; no marcar Foundation con análisis propios).

## 6. DOMAIN SKILL PATTERN  `CONFIRMED BY OFFICIAL DOCS`
- Main Agent nativo NEUTRAL + `/<domain>` skill que aporta identidad, catálogo (slugs), DAG, gobernanza, case-root.
- Aislamiento por progressive-disclosure: la skill solo se carga al invocarse; sin contaminación entre `/pisoso`, `/marketing`, etc.
- Motor pesado desacoplado en `~/.gemini/config/skills/<domain>/scripts/`, resolviendo datos desde una env root (`<DOMAIN>_ROOT`), no desde el CWD.
- Hooks de auto-activación: **evitar** para sistemas de dominio (un hook de un dominio no debe interceptar conversaciones de otro). Entrypoint = manual vía `/<domain>`.

## 7. TESTING PROTOCOL  (obligatorio, en este orden)
1. **Discovery/selector** (UI): el/los agentes correctos aparecen/ocultan.
2. **1 subagente nativo**: `invoke_subagent(TypeName='<slug>')` → child invocation ID real + retorno real. Si falla aquí, DETENER.
3. **DAG reducido** (≤3 agentes): foundation (2) → 1 especialista → STOP; foundation solo con outputs reales.
4. **Producción**: gates completos.
Reglas: A/B de **una variable** por vez; rollback unitario; NO declarar PASS por filesystem/YAML; validar en UI; NO declarar multiagente sin child invocation real; NO fallback monolítico como prueba de DAG.

## 8. HARDENING GENÉRICO (reutilizable por cualquier dominio)
`TypeName:self=OFF` · `define_subagent=OFF` · anti-redispatch (`execution_key=case_id::wave::agent_slug`) · active-case determinístico (env root, fail-closed, sin latest/alfabético/mtime) · invocation cap · stop-retry cap → ABORT (no "allow") · resource-exhausted (429) → FAILED, kill, no redispatch · production gate (entregable real requerido) · provenance tri-estado (VERIFIED / UNAVAILABLE_BUT_CORROBORATED / INVALID; INVALID bloquea; nunca aceptar IDs fabricados).

---

## 9. EXTERNAL ORCHESTRATOR PATTERN (plan-independiente)  `CONFIRMED BY RUNTIME (plumbing)`
Cuando `invoke_subagent` no está disponible (cuenta sin entitlement), un dominio puede ejecutar
su DAG con un **orquestador externo** que NO depende de Antigravity:
- Reutiliza los prompts canónicos (`.agents/agents/<slug>/agent.md`, cuerpos intactos) como system prompt.
- Reutiliza la gobernanza (plan, `authorize_dispatch` = wave-order + cap + anti-redispatch, completion, provenance).
- Backend = **API oficial soportada, plan-independiente**: Gemini API (`generativelanguage.googleapis.com`, `generateContent`) con `GEMINI_API_KEY` (AI Studio, free tier). NO usa invoke_subagent/define_subagent/self.
- Cada ejecución produce **id real, estado, output y provenance** y se registra en el ledger.
- Backend de plomería `non_model_plumbing` para verificar DAG/gates/STOP sin gastar tokens (NO es un agente real; se etiqueta explícitamente; nunca se presenta como análisis real).
- Implementación de referencia (legal): `~/.gemini/config/skills/pisoso/scripts/pisoso_external_orchestrator.py`.
- Reutilizable por `/marketing`, `/docencia`, `/frontend`: mismo patrón, distinto catálogo/DAG/prompt + `<DOMAIN>_ROOT`.

---

## 10. NATIVE DELEGATION SURFACE (definitivo)  `CONFIRMED BY BINARY + RUNTIME + OFFICIAL DOCS`
Enum de tools de delegación en el runtime 2.9.1: `INVOKE_SUBAGENT` (única general), `BROWSER_SUBAGENT` (solo browser), `CIDER_AGENT_DUMMY` (interno/test), `TASK_BOUNDARY`.
- **El ÚNICO mecanismo nativo para ejecutar otro agente como agente REAL separado es `invoke_subagent`** (los slash-commands "launch dedicated subagents" también van por ahí).
- Skills = workflow de un solo agente (progressive disclosure), NO delegación multiagente.
- Scheduled Tasks = tareas recurrentes en background, NO delegación multiagente en conversación.
- `@`-mentions = adjuntar contexto, NO invocar agentes.
- **`invoke_subagent` está gated server-side (Unleash: `enable_subagent_tools` / `enable_teamwork_subagent`) y es capacidad del modo teamwork-preview (Ultra).** En cuenta `consumer` NO se registra en la sesión (confirmado por prueba real del usuario: "invoke_subagent no está disponible en las declaraciones de herramientas").
- **CONCLUSIÓN:** una cuenta `consumer` en 2.9.1 **NO soporta ejecución/delegación multiagente nativa**. Para un sistema de dominio en cuenta consumer, la vía nativa soportada es una **skill** que el Main Agent ejecuta como agente único (NO multiagente). Multiagente real requiere entitlement (Ultra/teamwork) o un orquestador externo (backup, fuera del flujo principal).
