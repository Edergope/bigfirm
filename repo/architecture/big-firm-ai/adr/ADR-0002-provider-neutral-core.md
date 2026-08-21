# ADR-0002 — Core neutral de proveedor

- **Estado:** PROPOSED
- **Fecha:** 2026-08-21

## Contexto

El proyecto exige no depender de una sola empresa de IA. OpenAI (Agents SDK, Responses API) y
Google (Gemini API, ADK, A2A) ofrecen frameworks de orquestación propios que, si se adoptan como
Core, acoplan la plataforma a un vendor.

## Decisión (propuesta)

El Core usa las **primitivas de bajo nivel** de cada proveedor tras una interfaz común
`ModelProviderAdapter`:
- **OpenAI:** Responses API ("own-the-loop") + Structured Outputs + function calling.
- **Gemini:** Gemini API (generateContent) + `responseSchema` + function calling.

Los frameworks de orquestación de alto nivel (Agents SDK, ADK) se documentan como **referencia**,
no como dependencia. Una capacidad entra al camino crítico del Core solo si existe en ≥2
proveedores (o es emulable).

## Consecuencias

- (+) El mismo agente corre en OpenAI o Gemini sin reescribir conocimiento.
- (+) Estado, DAG, gates, cost y tracing permanecen bajo control propio.
- (−) Reimplementamos orquestación que los SDK dan "gratis" (ver ADR-0004).
- (−) Debemos mantener paridad de capacidades entre adapters.

## Estado

No aprobado hasta confirmación (D-02, D-03).
