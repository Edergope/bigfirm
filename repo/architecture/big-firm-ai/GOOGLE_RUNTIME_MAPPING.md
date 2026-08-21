# GOOGLE_RUNTIME_MAPPING — Core ↔ Gemini / ADK / A2A

**Estado:** PROPOSED · **Fecha:** 2026-08-21
**Fuentes:** ai.google.dev/gemini-api/docs · google.github.io/adk-docs/a2a/ (A2A) · Google Cloud
blog (ADK↔A2A). Verificado 2026-08.

> Regla: Gemini es **otra** implementación de `ModelProviderAdapter`. El Core no depende de ADK ni
> A2A; los trata como opcionales/futuros.

## 1. Primitivas oficiales relevantes

| Primitiva Google | Qué es | Uso en Big Firm AI |
| :-- | :-- | :-- |
| **Gemini API (generateContent)** | inferencia de modelos Gemini (Pro / Flash / Flash-Lite) | **Base del GeminiAdapter.** |
| **Function calling / tools** | tools + built-in (Search, code exec, URL context) | Mapeo de `agent.yaml.tools`. |
| **Structured output (`responseSchema`)** | salida JSON restringida por schema | **Requerido**: contrato de salida. |
| **Streaming** | flujo incremental | soportado vía interfaz común. |
| **Thinking** | presupuesto de razonamiento | opcional en `params`, nunca requerido por el Core. |
| **Long context** | millones de tokens | aprovecha lectura directa de biblioteca/PDF (agente 03). |
| **Live API** | voz/tiempo real | fuera de alcance V1. |
| **ADK** | framework multi-agente + Orchestrator Agent | **Referencia**; el Core no delega su DAG. |
| **A2A protocol** | comunicación agente↔agente **framework/vendor-neutral** | **Futuro**: candidato para agentes remotos. |

## 2. Decisión de acoplamiento: Gemini API directa, ADK como referencia

- `GeminiAdapter.generate()` usa la **Gemini API** (generateContent) + `responseSchema` +
  function calling. Estado, DAG, gates, cost y tracing son del Core.
- **ADK** (Orchestrator Agent, sub-agentes) resuelve un problema que el Core ya resuelve de forma
  neutral; se documenta como referencia, no como dependencia.

## 3. A2A como oportunidad estratégica (no dependencia)

A2A es un protocolo **neutral de framework y vendor** para que agentes colaboren entre ecosistemas.
Encaja con el principio "no depender de una sola empresa de IA":

- **Futuro:** exponer/consumir "agentes remotos" (especialistas de terceros, servicios) vía A2A a
  través de un `RemoteAgentAdapter`, sin cambiar el modelo `AgentDefinition`.
- **Ahora:** el Core define su propio contrato agente↔agente (Work Package + Output Contract). A2A
  se evalúa como **adapter opcional**, decisión diferida (ver ADR-0003).

## 4. Mapeo de la interfaz común

```
ModelRequest.system/messages    → systemInstruction + contents
ModelRequest.tools[]            → tools (functionDeclarations / built-ins)
ModelRequest.response_schema    → generationConfig.responseSchema (+ responseMimeType JSON)
ModelResponse.structured_output → JSON validado contra contrato
ModelResponse.token_usage       → usageMetadata → cost accounting
ModelResponse.raw_ref           → response id / telemetría (observabilidad opcional)
```

## 5. Tiers → familias Gemini (política, sin fijar ids)

La matriz histórica `pro/flash/flash_lite` de `governance/AGENTS.md` informa el mapeo de tiers,
pero **los model ids concretos se fijan en un ADR** tras aprobar V1 (los nombres de versión de
Gemini evolucionan; no se hardcodean en arquitectura).

## 6. Qué NO adoptamos (para preservar neutralidad)

ADK como orquestador del Core; A2A como dependencia obligatoria; Live API; built-in tools que no
tengan equivalente en otros proveedores en el camino crítico.
