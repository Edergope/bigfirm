# ADR-0004 — Orquestación determinista propia

> **Status: SUPERSEDED**
> **Superseded by:** `documentacion/IUSIA_04_Technical_Master_Blueprint_MVP_v1.pdf`
> **Reason:** Cloudflare-first MVP architecture approved (D1 + Drizzle como estado; Cloudflare Workflows como motor durable del DAG). Se conserva como historia arquitectónica.
> **Date:** 2026-08-21

> Nota específica: El **principio** de orquestación determinista y gates del lado del servidor se conserva y está implementado en `packages/orchestration`. Lo que queda superseded es construir un **motor DAG propietario**: la ejecución durable la aporta **Cloudflare Workflows**.


- **Estado:** SUPERSEDED
- **Fecha:** 2026-08-21

## Contexto

El DAG canónico (4 olas + hard gates de `WORKFLOW_ORCHESTRATION.md`) no puede depender de que el
LLM "recuerde" ejecutarlo. La inteligencia profesional del `00` (juicio del Managing Partner) debe
separarse de la garantía de ejecución.

## Decisión (propuesta)

Implementar un **Workflow Engine + State Machine + Gates** propios, deterministas:
- El `00` emite un *orchestration plan* como **propuesta**.
- El motor lo **valida contra el workflow declarado** y lo ejecuta; impone nodos obligatorios,
  aplica gates, bloquea downstream tras fallo, gestiona retries/timeout/idempotencia/resumabilidad.
- El fan-out dinámico (Wave 2) queda acotado al catálogo de 30 agentes.

## Consecuencias

- (+) Ejecución garantizada y reproducible, independiente del proveedor.
- (+) Gates de calidad como código, no como prosa.
- (−) Más ingeniería propia (vs. usar handoffs de un SDK) — aceptado por neutralidad (ADR-0002).

## Estado

No aprobado hasta confirmación (D-05).
