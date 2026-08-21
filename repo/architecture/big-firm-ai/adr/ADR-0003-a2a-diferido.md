# ADR-0003 — A2A / agentes remotos diferidos

- **Estado:** DEFERRED
- **Fecha:** 2026-08-21

## Contexto

A2A (Agent2Agent) es un protocolo neutral de framework/vendor para colaboración entre agentes de
distintos ecosistemas. Encaja con la estrategia multi-vendor, pero añade complejidad y no es
necesario para el DAG interno de V1.

## Decisión (propuesta)

**Diferir** A2A. El Core define su propio contrato agente↔agente (Work Package + Output Contract).
A2A se evalúa más adelante como `RemoteAgentAdapter` **opcional** para exponer/consumir agentes
remotos (terceros, servicios), sin cambiar `AgentDefinition`.

## Consecuencias

- (+) V1 más simple; sin dependencia de un protocolo externo en evolución.
- (+) Puerta abierta: el modelo de agente no impide adoptar A2A luego.
- (−) Interoperabilidad con agentes de terceros no disponible en V1.

## Revisión

Reconsiderar cuando exista necesidad concreta de agentes remotos/de terceros (D-04).
