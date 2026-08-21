# MATTER_MODEL_V1 — Modelo de dominio y datos

**Estado:** PROPOSED · **Fecha:** 2026-08-21 · **DB propuesta:** PostgreSQL

Modelo de dominio del expediente y su persistencia. **No es esquema SQL definitivo** — es el
modelo conceptual a validar antes de escribir migraciones.

## 1. Entidades núcleo

```
organizations ──< users
organizations ──< matters
matters ──< matter_parties
matters ──< documents ──< sources
matters ──< facts
matters ──< issues
matters ──< chronology_events
matters ──< workflow_runs ──< executions
executions ──< execution_dependencies
executions ──< tool_calls
executions ──< provider_calls ──< model_usage ──< costs
matters ──< artifacts
matters ──< decisions        (gates, aprobaciones humanas)
* ──< audit_events           (todo muta el audit log)
agent_definitions ──< agent_versions
```

## 2. Ledgers de gobernanza (reutilizan schemas canónicos)

Los ledgers ya existen como schemas y se adoptan como tablas de primera clase:

| Ledger | Schema canónico | Rol |
| :-- | :-- | :-- |
| Canonical Fact Ledger | `schemas/canonical_fact_ledger.schema.json` | hechos con clasificación [F/A/D/I/C/U/R] |
| Authority Ledger | `schemas/authority_ledger.schema.json` | autoridades citadas + vigencia |
| Entity Ledger | `schemas/entity_ledger.schema.json` | partes/entidades canónicas |
| Agent Output Contract | `schemas/agent_output_contract.schema.json` | salida estructurada por ejecución |
| Agent Deliverable Header | `schemas/agent_deliverable.schema.json` | metadatos de entregable |

**Machine state** (ledgers, contratos) vive en tablas; **human artifacts** (informes, Word) viven
en Artifact Storage con puntero en `artifacts`.

## 3. Tabla `executions` (multiagencia real)

Campos requeridos (del enunciado del proyecto):

```
execution_id (uuid, pk)      matter_id (fk)         agent_id (fk)
parent_execution_id (fk)     provider                model
model_configuration (jsonb)  status (enum SM)
started_at                   completed_at
input_refs (jsonb)           source_refs (jsonb)    upstream_execution_refs (jsonb)
output_ref                   token_usage (jsonb)     estimated_cost (numeric)
tool_calls (fk/jsonb)        errors (jsonb)          retries (int)
provenance (jsonb: sha256_native + sha256_persisted)
idempotency_key (unique)     workflow_run_id (fk)    wave (int)   gate_group (text)
```

`status` = enum de la state machine de [ORCHESTRATION_V1](ORCHESTRATION_V1.md) §3.

## 4. Identidad de matter y convenciones

- `matter_id` patrón `CASE-AAAA-NNN` (coherente con contratos existentes:
  `^CASE-[0-9]{4}-[A-Z0-9]+$`).
- Todo registro operativo cuelga de `matter_id` → base para **aislamiento por matter** y, más
  tarde, por `organization_id` (multi-tenant). Ver [SECURITY_V1](SECURITY_V1.md).

## 5. Fuente de verdad

- **PostgreSQL** = fuente de verdad del **estado operativo** (matters, ejecuciones, ledgers, costos).
- **Google Drive** = repositorio **documental** (fuentes, entregables). Nunca la DB transaccional.
- **Artifact Storage** = binarios de entregables versionados (puede ser Drive + metadatos en DB).

Ver [GOOGLE_DRIVE_ARCHITECTURE_V1](GOOGLE_DRIVE_ARCHITECTURE_V1.md).

## 6. Versionado de agentes

`agent_definitions` (id lógico) → `agent_versions` (semver + `canonical_sha256` +
`instructions_ref`). Una ejecución fija la `agent_version_id` usada → reproducibilidad:
sabemos exactamente qué conocimiento y qué política de modelo produjeron cada output.

## 7. No definitivo

Índices, particionamiento, RLS (row-level security para tenancy), tipos exactos y constraints se
definen en la fase de implementación (Codex), tras aprobar este modelo conceptual.
