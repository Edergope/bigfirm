# ADR-0005 — Estructura de 4 archivos por agente

- **Estado:** PROPOSED
- **Fecha:** 2026-08-21

## Contexto

Los agentes mezclan conocimiento profesional y runtime Antigravity. Hay que separar preservando la
fuente canónica y su verificación por sha256.

## Decisión (propuesta)

Cada agente adopta:

```
repo/agents/<id>/
├── original-antigravity.md   # INMUTABLE; = agent.md actual; valida contra AGENTS_MANIFEST
├── instructions.md           # conocimiento profesional neutral (cargado en runtime)
├── agent.yaml                # AgentDefinition (AGENT_SPEC_V1)
└── CHANGELOG.md              # trazabilidad de qué se extrajo del original y por qué
```

## Consecuencias

- (+) Fuente canónica intacta y verificable; extracción auditable.
- (+) `instructions.md` neutral cargado por el Prompt Loader; `agent.yaml` declarativo para el motor.
- (−) Duplicación controlada (original + instructions) — justificada por preservación y trazabilidad.

## Nota

El `agent.md` original **no se modifica** en la fase actual. Esta estructura se materializa durante
la migración (piloto 00/01/03 primero). Estado: no aprobado hasta confirmación (D-06).
