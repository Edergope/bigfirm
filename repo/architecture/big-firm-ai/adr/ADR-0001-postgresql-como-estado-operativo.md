# ADR-0001 — PostgreSQL como estado operativo (multi-tenant-ready)

> **Status: SUPERSEDED**
> **Superseded by:** `documentacion/IUSIA_04_Technical_Master_Blueprint_MVP_v1.pdf`
> **Reason:** Cloudflare-first MVP architecture approved (D1 + Drizzle como estado; Cloudflare Workflows como motor durable del DAG). Se conserva como historia arquitectónica.
> **Date:** 2026-08-21

> Nota específica: El estado operativo del MVP es **Cloudflare D1 + Drizzle**, no PostgreSQL. El diseño de repositorios deja la puerta abierta a migrar partes a PostgreSQL/Hyperdrive según crecimiento, no por anticipación.


- **Estado:** SUPERSEDED
- **Fecha:** 2026-08-21

## Contexto

Big Firm AI necesita una fuente de verdad transaccional para matters, ejecuciones, ledgers y
costos. Google Drive es documental, no transaccional. Se requiere aislamiento por matter y no
cerrar la puerta a multi-tenant.

## Decisión (propuesta)

Adoptar **PostgreSQL** como estado operativo: soporte `jsonb` para contratos/ledgers,
constraints e índices para trazabilidad, y **row-level security (RLS)** para aislamiento por
`organization_id` cuando se active multi-tenant. En V1 el esquema incluye `organization_id` pero
la tenancy puede permanecer inactiva.

## Consecuencias

- (+) Un solo motor para estado, ledger y costos; consultas de agregación de costo nativas.
- (+) Camino claro a multi-tenant sin rediseño (RLS).
- (−) Requiere disciplina de migraciones y modelado (fase Codex).

## Alternativas

Rechazadas para V1: NoSQL documental (débil en trazabilidad relacional/costos); Drive como DB
(no transaccional). Estado: no aprobado hasta confirmación (D-01, D-08).
