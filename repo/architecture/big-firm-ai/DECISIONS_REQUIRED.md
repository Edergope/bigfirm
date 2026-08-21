# DECISIONS_REQUIRED — Decisiones que requieren tu aprobación

**Estado:** ABIERTO · **Fecha:** 2026-08-21

Ninguna de estas está decidida. Marca cada una como APPROVED / REJECTED / DEFERRED. Las que
impliquen compromiso arquitectónico se registran como ADR.

## Decisiones

| # | Decisión | Opciones | Recomendación | ADR |
| :-- | :-- | :-- | :-- | :-- |
| D-01 | Base de datos operativa | PostgreSQL / otra | **PostgreSQL** (jsonb + RLS para tenancy) | ADR-0001 |
| D-02 | Acoplamiento OpenAI | Responses API (own-the-loop) / Agents SDK como Core | **Responses API**; SDK solo referencia | ADR-0002 |
| D-03 | Acoplamiento Google | Gemini API directa / ADK como Core | **Gemini API directa**; ADK referencia | ADR-0002 |
| D-04 | A2A / agentes remotos | adoptar ahora / diferir / descartar | **DEFERIR** (adapter opcional futuro) | ADR-0003 |
| D-05 | Orquestación | motor determinista propio / delegar en SDK del proveedor | **Motor propio** (DAG + state machine) | ADR-0004 |
| D-06 | Estructura por agente | 4 archivos (original/instructions/yaml/changelog) | **4 archivos** | ADR-0005 |
| D-07 | Fuente de model ids | fijarlos ahora / diferir a ADR post-V1 | **Diferir**; tiers ahora, ids después | — |
| D-08 | Multi-tenant en V1 | activar RLS ya / dejar esquema listo pero inactivo | **Esquema listo, inactivo** | ADR-0001 |
| D-09 | Repositorio documental | Drive fijo / abstracción `DocumentRepositoryAdapter` | **Abstracción**, Drive primera impl. | — |
| D-10 | Proveedor(es) del piloto | OpenAI+Gemini ambos / uno primero | **Ambos** (prueba de neutralidad) | — |
| D-11 | Alcance del piloto | 00/01/03 / otro subconjunto | **00/01/03** | — |
| D-12 | Contrato de salida | reutilizar `agent_output_contract` / rediseñar | **Reutilizar** (ya es neutral) | — |

## Preguntas abiertas para ti

1. ¿Confirmas **PostgreSQL** como DB principal, o evalúo alternativas?
2. ¿De acuerdo con **no** adoptar Agents SDK / ADK como orquestador (mantener motor propio)?
3. ¿A2A **diferido** te parece bien, o quieres priorizarlo por la estrategia multi-vendor?
4. ¿Apruebas el **piloto 00/01/03** una vez aprobado AGENT_SPEC_V1?
5. ¿Presupuesto/techo de costo por matter que deba modelar el Model Router?

## Riesgos arquitectónicos principales (TOP)

| Riesgo | Impacto | Mitigación propuesta |
| :-- | :-- | :-- |
| **R-1 Pérdida de conocimiento al extraer runtime del `00`** | Alto | `original-antigravity.md` inmutable + diff revisado + piloto antes del lote |
| **R-2 Paridad imperfecta de structured outputs / concurrencia entre proveedores** | Medio-alto | Core exige JSON Schema; capacidades exclusivas fuera del camino crítico; validación en piloto |
| **R-3 Determinismo del DAG vs. adaptabilidad del juicio del `00`** | Medio | `00` propone, motor valida/impone; fan-out dinámico acotado al catálogo de 30 |
| **R-4 Costo de cadenas largas de agentes `high_reasoning`** | Medio | Cost ceilings por matter + tiers + fallback de proveedor + observabilidad |
| **R-5 Deriva de model ids de proveedores** | Bajo-medio | Tiers neutrales; ids en ADR versionado, no en arquitectura |
| **R-6 Fuga de datos legales sensibles al proveedor** | Alto | Minimización de contexto (Work Package) + políticas de retención por proveedor + secrets fuera de prompts |
