# ARCHITECTURE_V1 — Big Firm AI

**Estado:** PROPOSED · **Fase:** diseño (sin implementación) · **Fecha:** 2026-08-21

## 1. Objetivo

Construir una plataforma que se comporte como una **firma jurídica Big Law / Tier 1 digital**:
gestiona *matters*, ejecuta 30 agentes profesionales reales en un DAG con gates de calidad,
produce entregables verificables y contabiliza costos — sobre un **runtime propio**,
**neutral de proveedor** (OpenAI, Gemini y futuros), sin depender de `invoke_subagent` ni de
una sola empresa de IA.

## 2. Principios arquitectónicos innegociables

1. **Separación conocimiento / runtime.** El prompt jurídico (`instructions.md`) nunca se
   incrusta en código ni se acopla a un proveedor. Se carga dinámicamente vía manifest.
2. **Provider-neutral Core.** El Core no depende de ninguna capacidad exclusiva de un
   proveedor. Todo lo específico vive detrás de un `ModelProviderAdapter`. Ver
   [OPENAI_RUNTIME_MAPPING](OPENAI_RUNTIME_MAPPING.md) / [GOOGLE_RUNTIME_MAPPING](GOOGLE_RUNTIME_MAPPING.md).
3. **Orquestación determinista, inteligencia profesional separada.** El DAG lo decide un
   Workflow Engine + State Machine, **no** la memoria del LLM. El `00` aporta juicio
   profesional; el motor garantiza *qué* corre, *cuándo* y bajo *qué* gates.
4. **Estado en base de datos, no en Drive.** Drive es repositorio documental; el estado
   operativo y el ledger viven en PostgreSQL.
5. **Gobernanza como control programático.** Las reglas de integridad fáctica, trazabilidad
   y gates migran de prosa/prompt a validadores ejecutables donde sea posible.
6. **Multi-tenant-ready.** V1 puede ser mono-firma, pero ningún esquema cierra la puerta a
   múltiples organizaciones con datos aislados.
7. **Minimización de contexto.** Cada agente recibe un *Work Package* con lo necesario, no el
   expediente entero. Ver [WORK_PACKAGE_V1](WORK_PACKAGE_V1.md).

## 3. Vista de capas (conceptual)

```
┌──────────────────────────────────────────────────────────────┐
│                        BIG FIRM AI WEB                         │  (fuera de V1)
└───────────────────────────────┬──────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                          API / CORE                           │
│  auth · RBAC · matter API · execution API · artifact API      │
└───────┬───────────────────────────────────────────┬──────────┘
        ▼                                             ▼
┌───────────────┐                       ┌─────────────────────────┐
│ MATTER        │                       │      ORCHESTRATOR        │
│ MANAGER       │◀── domain state ─────▶│  Workflow Engine         │
│ matters,docs, │                       │  DAG · State Machine     │
│ facts, ledgers│                       │  Gates · Routing Engine  │
└──────┬────────┘                       └───────────┬─────────────┘
       │                                            ▼
       │                                 ┌─────────────────────────┐
       │                                 │      AGENT RUNTIME       │
       │                                 │  Prompt Loader           │
       │                                 │  Work Package Builder    │
       │                                 │  Structured Output Guard │
       │                                 └───────────┬─────────────┘
       │                                             ▼
       │                                 ┌─────────────────────────┐
       │                                 │       MODEL ROUTER       │
       │                                 │  policy → provider/model │
       │                                 └──────┬──────────┬───────┘
       │                                        ▼          ▼
       │                            ┌────────────────┐ ┌────────────────┐
       │                            │ OPENAI ADAPTER │ │ GEMINI ADAPTER │ ...
       │                            └────────────────┘ └────────────────┘
       ▼
┌────────────┐   ┌───────────────┐   ┌──────────────────┐   ┌──────────────┐
│ POSTGRESQL │   │ GOOGLE DRIVE  │   │ ARTIFACT STORAGE │   │ SECRETS MGR  │
│ (estado)   │   │ (documentos)  │   │ (entregables)    │   │ (API keys)   │
└────────────┘   └───────────────┘   └──────────────────┘   └──────────────┘
```

## 4. Componentes del Core (responsabilidades)

| Componente | Responsabilidad | No hace |
| :-- | :-- | :-- |
| **API / Core** | Autenticación, RBAC, endpoints de matter/execution/artifact | Razonar jurídicamente |
| **Matter Manager** | CRUD de matter, documentos, hechos, fuentes, cronología, ledgers | Orquestar |
| **Orchestrator** | Instancia workflows, resuelve DAG, avanza state machine, evalúa gates | Llamar modelos |
| **Workflow Engine** | Ejecuta WF-01..12 como grafos declarativos con olas y dependencias | Elegir modelo |
| **Agent Runtime** | Carga `instructions.md`, arma Work Package, exige structured output, registra ejecución | Decidir el DAG |
| **Model Router** | Traduce `model_policy` del agente → (provider, model, params) | Conocer derecho |
| **Provider Adapters** | Hablan la API concreta (OpenAI/Gemini) tras una interfaz común | Persistir estado |
| **Governance Engine** | Valida contratos de salida, integridad fáctica, gates, no-downstream-after-failure | Redactar |

## 5. Límite Core vs Provider (regla de oro)

> Una capacidad entra al **Core** solo si puede expresarse de forma equivalente en ≥2 proveedores
> (o emularse). Si es exclusiva de uno, vive en su **Adapter** y el Core la trata como opcional.

Ejemplos:
- **Core:** function calling, structured output (JSON Schema), streaming, uso de tokens,
  reintentos, tracing lógico, aprobación humana. → Todos los proveedores lo soportan.
- **Adapter-only:** `Responses API`/Agents SDK sessions de OpenAI; `thinking` budget o Live API
  de Gemini; A2A. → Se aprovechan si están, pero el Core no los presupone.

## 6. Flujo de una ejecución (resumen)

```
Cliente/abogado → API crea Matter → Orchestrator instancia WF-0x →
Workflow Engine expande DAG (olas) → por cada nodo:
  Agent Runtime arma Work Package → Model Router elige provider/model →
  Adapter ejecuta con structured output → Governance valida contrato →
  State Machine registra execution + costo en ledger →
  Gate de ola evalúa (PASS/STOP) → siguiente ola o bloqueo →
Final: 00 sintetiza → 08 redacta → 02 compila entregable Word → Artifact Storage
```

Detalle en [ORCHESTRATION_V1](ORCHESTRATION_V1.md).

## 7. Qué queda explícitamente fuera de V1

Frontend web, implementación real de adapters, llamadas a APIs, esquema SQL definitivo,
integración Drive, migración de los 30 agentes. V1 es **diseño aprobable**, no código.

## 8. Riesgos arquitectónicos principales

Ver [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md) §Riesgos. Resumen: (a) el conocimiento del `00`
mezcla juicio y dispatch — riesgo de perder metodología al extraer runtime; (b) paridad de
structured outputs y concurrencia entre proveedores; (c) determinismo del DAG vs. adaptabilidad
del juicio profesional; (d) costos en cadenas largas de agentes `pro`.
