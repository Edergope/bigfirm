# OBSERVABILITY_AND_COST_V1 — Execution ledger, tracing y costos

**Estado:** PROPOSED · **Fecha:** 2026-08-21

## 1. Execution Ledger (fuente de verdad de la multiagencia)

Cada ejecución de agente registra (tabla `executions`, [MATTER_MODEL_V1](MATTER_MODEL_V1.md) §3):

```
execution_id · matter_id · agent_id · agent_version_id · parent_execution_id
provider · model · model_configuration · status
started_at · completed_at · retries · errors
input_refs · source_refs · upstream_execution_refs · output_ref
token_usage · estimated_cost · tool_calls · provenance(sha256_native, sha256_persisted)
```

El ledger es **append-only** para trazabilidad; los cambios de estado se registran como eventos.

## 2. Tracing / observabilidad

- **Trace lógico propio** = árbol de ejecuciones por `workflow_run` (raíz `00` → olas → nodos),
  reconstruible desde `parent_execution_id` + `wave`. Independiente del proveedor.
- El tracing nativo del proveedor (OpenAI SDK traces / telemetría Gemini) es **complemento
  opcional**, referenciado por `raw_ref`, nunca la fuente de verdad.
- Métricas por matter: nodos por estado, latencia por ola, tasa de `REJECTED`/gate fails.

## 3. Cost accounting (desde el Core)

El sistema debe responder: **qué agente, qué proveedor, qué modelo, cuántos tokens, qué costo, en
qué matter, para qué ejecución.** Modelo:

```
provider_calls ──< model_usage(prompt_tokens, completion_tokens, ...) ──< costs(amount_usd, rate_ref)
                                                        ▲
                                        agregado por execution_id / matter_id / agent_id
```

- `estimated_cost` por ejecución = `token_usage × tarifa(model, provider)`; tarifas en tabla
  versionada (no hardcode).
- Agregaciones: costo por matter, por workflow_run, por agente, por proveedor, por periodo.
- **Cost ceilings**: `budget.cost_ceiling_usd` en el Work Package; el Model Router puede
  degradar tier o bloquear si se excede (con aprobación humana para continuar).

## 4. Gates como observabilidad de calidad

Los resultados de gates (Fact & Evidence, Substantive, Dual Strategy, Final) se registran en
`decisions`: PASS/STOP, blockers, quién/qué los evaluó. Esto hace medible la disciplina de calidad
(10 filtros, 0 blockers) y alimenta reporting.

## 5. Alertas (futuro)

Umbrales de costo por matter, tasa de fallos por proveedor, latencia de ola. Fuera de V1;
el esquema del ledger ya soporta calcularlos.
