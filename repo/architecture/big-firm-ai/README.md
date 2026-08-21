# Big Firm AI — Arquitectura V1 (HISTÓRICA)

Plataforma multiagente jurídica **propia**, independiente del runtime de Antigravity,
construida sobre el conocimiento canónico ya catalogado en este `repo`.

> **Estado global: SUPERSEDED / HISTÓRICO.**
> **Superseded by:** `documentacion/IUSIA_04_Technical_Master_Blueprint_MVP_v1.pdf` (Cloudflare-first, APPROVED 2026-08-21).
> La arquitectura **activa** del producto IUSIA es la del Blueprint, implementada en `apps/` y
> `packages/`. Estos documentos se conservan como historia del diseño previo. En caso de conflicto,
> gobierna el Blueprint. En particular quedan superseded [ADR-0001](adr/ADR-0001-postgresql-como-estado-operativo.md)
> (PostgreSQL → D1) y [ADR-0004](adr/ADR-0004-orquestacion-determinista.md) (motor DAG propio →
> Cloudflare Workflows). Se mantienen vigentes en principio ADR-0002, ADR-0003 y ADR-0005.

## Principio rector

Separar, para los 30 agentes, dos capas hoy entremezcladas:

```
CONOCIMIENTO PROFESIONAL DEL AGENTE   ≠   CONFIGURACIÓN DEL RUNTIME
(instructions.md, ~97k líneas)            (agent.yaml: modelo, tools, deps, gates)
```

El conocimiento jurídico se **preserva íntegro**; el acoplamiento a Antigravity
(`invoke_subagent`, `TypeName`, matriz Gemini) se **extrae** a configuración declarativa
y a un runtime propio, neutral de proveedor.

## Documentos

| Documento | Contenido | Estado |
| :-- | :-- | :-- |
| [ARCHITECTURE_V1.md](ARCHITECTURE_V1.md) | Visión, capas, componentes, límites del Core | PROPOSED |
| [AGENT_SPEC_V1.md](AGENT_SPEC_V1.md) | Especificación neutral de agente (`agent.yaml` + `instructions.md`) | PROPOSED |
| [WORK_PACKAGE_V1.md](WORK_PACKAGE_V1.md) | Contrato de entrada por agente (minimización de contexto) | PROPOSED |
| [ORCHESTRATION_V1.md](ORCHESTRATION_V1.md) | Workflow engine, DAG, state machine, gates, olas | PROPOSED |
| [MODEL_ROUTER_V1.md](MODEL_ROUTER_V1.md) | Política de modelo por agente + adapters de proveedor | PROPOSED |
| [MATTER_MODEL_V1.md](MATTER_MODEL_V1.md) | Modelo de dominio: matter, documentos, hechos, ledgers | PROPOSED |
| [GOOGLE_DRIVE_ARCHITECTURE_V1.md](GOOGLE_DRIVE_ARCHITECTURE_V1.md) | Drive como repositorio documental (no como DB) | PROPOSED |
| [SECURITY_V1.md](SECURITY_V1.md) | Aislamiento, RBAC, secrets, multi-tenant, datos sensibles | PROPOSED |
| [OBSERVABILITY_AND_COST_V1.md](OBSERVABILITY_AND_COST_V1.md) | Execution ledger, tracing, cost accounting | PROPOSED |
| [OPENAI_RUNTIME_MAPPING.md](OPENAI_RUNTIME_MAPPING.md) | Mapeo Core ↔ OpenAI (Agents SDK / Responses API) | PROPOSED |
| [GOOGLE_RUNTIME_MAPPING.md](GOOGLE_RUNTIME_MAPPING.md) | Mapeo Core ↔ Gemini API / ADK / A2A | PROPOSED |
| [MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md) | Cómo separar conocimiento de runtime; piloto 00/01/03 | PROPOSED |
| [DECISIONS_REQUIRED.md](DECISIONS_REQUIRED.md) | Decisiones que requieren tu aprobación | ABIERTO |
| [adr/](adr/) | Architecture Decision Records | PROPOSED/DEFERRED |

## Cómo leer esto

1. Empieza por `ARCHITECTURE_V1.md` (visión) y `DECISIONS_REQUIRED.md` (lo que necesito de ti).
2. `AGENT_SPEC_V1.md` + `MIGRATION_STRATEGY.md` definen el corazón de la migración.
3. Los *runtime mappings* prueban que el Core no queda acoplado a un solo proveedor.

## Insumos canónicos usados (verificados por SHA-256)

- `agents/<id>/agent.md` — 30 agentes, ~99.134 líneas, 30/30 hashes OK.
- `orchestration/dag/WORKFLOW_ORCHESTRATION.md` — DAG en 4 olas + hard gates.
- `governance/AGENTS.md` — reglas de despacho, matriz de modelos, [F]/[A]/[D]/[I]/[C]/[U]/[R].
- `schemas/*.json` + `orchestration/execution-contracts/*.json` — contratos y ledgers.
