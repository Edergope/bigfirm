# OPENAI_RUNTIME_MAPPING — Core ↔ OpenAI

**Estado:** PROPOSED · **Fecha:** 2026-08-21
**Fuente:** documentación oficial OpenAI (developers.openai.com/api/docs/guides/agents).

> Regla: OpenAI es **una** implementación de `ModelProviderAdapter`. El Core no adopta su modelo de
> agentes como propio; usa sus primitivas de bajo nivel y mantiene su **propia** orquestación,
> estado y ledger.

## 1. Primitivas oficiales relevantes

| Primitiva OpenAI | Qué es | Uso en Big Firm AI |
| :-- | :-- | :-- |
| **Responses API** | "own the loop": control propio del modelo + tool execution | **Base del OpenAIAdapter.** El Core dueño del loop y del estado. |
| **Agents SDK** | agent loop, handoffs, sessions, guardrails, tracing gestionados | Referencia/opcional; **no** delegamos el DAG al SDK. |
| **Tools / Function calling** | invocar herramientas; MCP local | Mapeo directo de `agent.yaml.tools`. |
| **Structured Outputs** | salida determinista con schema | **Requerido**: `agent_output_contract.schema.json`. |
| **Guardrails / approval flows** | bloquear/pausar antes de acción riesgosa | Complementa human-approval del Core (no lo sustituye). |
| **Tracing** | trazas de model/tools/agents | `raw_ref` opcional; ledger propio es la verdad. |
| **Sessions/state** | continuidad de conversación | **No** usado como estado autoritativo; el Core persiste. |
| **Handoffs** | delegación entre especialistas | El **Workflow Engine** hace el fan-out; no los handoffs del SDK. |

## 2. Decisión de acoplamiento: Responses API, no Agents SDK como Core

- **Por qué:** el Agents SDK trae su propia orquestación/estado/handoffs. Adoptarlo acoplaría el
  Core a OpenAI y competiría con nuestro DAG determinista. La **Responses API** ("own the loop") da
  las primitivas sin imponer arquitectura.
- **Resultado:** `OpenAIAdapter.generate()` implementa la interfaz común usando Responses API +
  structured outputs + function calling. El DAG, gates, sessions, cost y tracing son del Core.

## 3. Mapeo de la interfaz común

```
ModelRequest.system/messages   → input de Responses API
ModelRequest.tools[]           → tools / function definitions
ModelRequest.response_schema   → Structured Outputs (JSON Schema)
ModelResponse.structured_output→ salida validada contra contrato
ModelResponse.token_usage      → usage → cost accounting
ModelResponse.tool_calls[]     → ejecutados por Agent Runtime (no por el SDK)
ModelResponse.raw_ref          → id/trace de OpenAI (observabilidad opcional)
```

## 4. Concurrencia y olas

El paralelismo de una ola lo maneja el **motor** (N llamadas concurrentes a `generate()`), no los
handoffs del SDK. Así el comportamiento es idéntico con cualquier proveedor.

## 5. Qué NO adoptamos (para preservar neutralidad)

Agents SDK como framework de orquestación; sessions del SDK como estado autoritativo; handoffs
como mecanismo de DAG; tracing del SDK como ledger. Todo eso es Core-propio o degradable.
