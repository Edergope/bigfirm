# MODEL_ROUTER_V1 — Política de modelo y adapters de proveedor

**Estado:** PROPOSED · **Fecha:** 2026-08-21

Traduce la *intención* de cada agente (`model_policy.tier`) a un `(provider, model, params)`
concreto, sin que el agente ni el motor conozcan proveedores.

## 1. Abstracción

```
AgentDefinition.model_policy.tier  ──▶  Model Router  ──▶  (provider, model_id, params)
                                             │
                                   ┌─────────┴──────────┐
                                   ▼                    ▼
                            OpenAIAdapter         GeminiAdapter        FutureProviderAdapter
```

### Interfaz `ModelProviderAdapter` (Core)

```
generate(request: ModelRequest) -> ModelResponse
  ModelRequest  = { system, messages, tools[], response_schema, params, budget }
  ModelResponse = { content, structured_output, tool_calls[], token_usage, finish_reason, raw_ref }
```

Toda capacidad que el Core usa debe existir en la interfaz común: **function calling**,
**structured output (JSON Schema)**, **streaming**, **token usage**, **stop/finish reasons**.
Lo exclusivo de un proveedor se degrada con gracia (ver §5).

## 2. Tiers (neutral) y su origen

La matriz Gemini `pro/flash/flash_lite` de `governance/AGENTS.md` se **generaliza** a tiers
neutrales. El agente declara tier; el Router elige el modelo del proveedor activo.

| Tier | Perfil | Agentes (referencia, NO asignación final) |
| :-- | :-- | :-- |
| `efficient` | ingesta, clasificación, compilación, formateo | 01, 02, arquitecto-metodológico |
| `balanced` | lectura extensa, cotejo probatorio, investigación, citas | 03, 04, 05, 11, DD-listas |
| `high_reasoning` | máximo razonamiento, socios senior, estrategia, redacción | 00, 06, 08, 15, 14, 15 especialistas |
| `verification` | verificación de citas/vigencia con baja creatividad | 11 (modo estricto) |
| `production` | producción jurídica formal (memoriales) | 08 |

> **No se asignan model ids todavía.** Este documento define la *política*; el mapeo
> `tier → model concreto por proveedor` se decide y versiona en un ADR aparte tras aprobar V1.

## 3. Tabla de resolución (plantilla, a completar en implementación)

```yaml
routing:
  efficient:
    openai:  { model: "<tbd>", temperature: 0.2 }
    gemini:  { model: "<tbd>", temperature: 0.2 }
  balanced:
    openai:  { model: "<tbd>" }
    gemini:  { model: "<tbd>" }
  high_reasoning:
    openai:  { model: "<tbd>" }
    gemini:  { model: "<tbd>" }
  # verification / production análogos
selection:
  order: use AgentDefinition.provider_preference, then availability, then cost_ceiling
  fallback: if preferred provider fails/over-budget, try next in preference list
```

## 4. Política de selección

1. Respeta `provider_preference` del `agent.yaml`.
2. Verifica disponibilidad (health del adapter) y `budget`/`cost_ceiling`.
3. Fallback ordenado si el preferido falla o excede presupuesto.
4. Registra en el ledger `provider`, `model`, `token_usage`, `estimated_cost`
   (ver [OBSERVABILITY_AND_COST_V1](OBSERVABILITY_AND_COST_V1.md)).

## 5. Degradación de capacidades exclusivas

| Capacidad | OpenAI | Gemini | Estrategia Core |
| :-- | :-- | :-- | :-- |
| Structured output (JSON Schema) | sí | sí (`responseSchema`) | **Core la exige**; adapter traduce |
| Function calling / tools | sí | sí | Core común |
| Sessions/state gestionado | Agents SDK sessions | vía ADK/app | **Core mantiene su propio estado** (no depende del proveedor) |
| Handoffs entre agentes | Agents SDK handoffs | ADK / A2A | **Core orquesta**; no delega el DAG al proveedor |
| Tracing | SDK tracing | telemetría | Core tiene su ledger; tracing del proveedor es complemento |
| "thinking" budget | (razonamiento interno) | `thinking` | opcional vía `params`, nunca requerido |

Regla: si una capacidad no está en ≥2 proveedores, **no** entra al camino crítico del Core.

## 6. Por agente = política propia

Cada `agent.yaml` puede fijar su propio tier, temperatura y preferencia de proveedor. Ejemplo
conceptual (sin asignar modelos): `10 Red Team` → `high_reasoning`, `provider_preference` distinto
a `06` para diversidad adversarial; `11 Autoridades` → `verification`, temperatura mínima.
