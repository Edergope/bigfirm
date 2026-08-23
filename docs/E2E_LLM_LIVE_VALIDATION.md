# IUSIA — Primer E2E LLM Live Validado

**Estado:** `FIRST_LIVE_DAG_EXECUTION_VALIDATED`
**Fecha:** 2026-08-22
**Alcance:** capa LLM real (AI Gateway → BYOK OpenAI → DAG durable), datos sintéticos.

## Configuración validada (sin exponer secretos)

- Gateway: `iusia` · Account: `e4478495bf6483c58722d92498f0362f`
- Token `IUSIA AI Gateway — E2E Validation` (user-owned, active) con permisos
  AI Gateway Run/Read + Workers AI Read sobre el account real.
- BYOK OpenAI `default` resuelto por el gateway (la petición NO transporta clave de
  proveedor; auth de gateway vía `cf-aig-authorization: Bearer …`).
- `REST_AI_GATEWAY_VALIDATED` (POST `/accounts/{id}/ai/v1/chat/completions`, HTTP 200).
- `AI_GATEWAY_AUTH_VALIDATED` (endpoint `/compat` de IUSIA, HTTP 200).
- `MODEL_GATEWAY_REQUEST_SHAPE_VALIDATED` (request-shape exacto de `callOnce`, HTTP 200).

## CODE_GAPs corregidos (descubiertos durante la validación)

1. **`MODEL_PARAMETER_COMPATIBILITY` (max_tokens).** La familia de razonamiento de
   OpenAI (gpt-5, o1/o3/o4/oN) rechaza `max_tokens` (400 `unsupported_parameter`) y
   exige `max_completion_tokens`; `/compat` no lo traduce. Fix: `outputTokenParam()`.
   Commit `d29c333`.
2. **`MODEL_PARAMETER_COMPATIBILITY` (temperature).** Esa misma familia sólo admite
   `temperature` = default (1); 0.2 → 400 `unsupported_value`. Fix: se omite
   `temperature` para razonamiento (`modelRequestParams()`). Commit `be4f6bd`.
3. **`WORKERS_FETCH_THIS_BINDING`.** Guardar el `fetch` global como propiedad y
   llamarlo como método provoca "Illegal invocation" en workerd (kind=network, fail
   instantáneo, sin llamada real). Fix: wrapper `(input, init) => fetch(input, init)`
   en ModelGateway, GoogleDriveAdapter y ResendNotificationProvider. Commit `8b6bd71`.

Los tres tienen prueba unitaria de regresión. `typecheck` · `lint` · `build` verdes.

## DAG real ejecutado

Fixture `E2E_VALIDATION_FIXTURE` (matter `mtr_p8bd3k4kjbv2jsjw`, ref `IUS-2026-001`,
MATERIAL, datos sintéticos). Root `exe_w5z13x54r64fgyez`. Duración ~91 s.

`00 Managing Partner → 01 Intake → 03 Investigación → gate → integración`

| Nodo | Estado | provider/model | in/out tok | créditos | prompt |
|------|--------|----------------|-----------|----------|--------|
| 00 pisoso-orquestador | COMPLETED | openai/gpt-5 | 2228/5140 | 55 | v1, sha a66999… |
| 01 intake-y-clasificador | COMPLETED | openai/gpt-5 | 6650/3237 | 41 | v1, sha aa181f… |
| 03 investigador-normativo | COMPLETED | **openai/gpt-5 (fallback)** | 11151/3928 | 54 | v1, sha 2f4eb5… |
| gate FOUNDATION_GATE | PASSED | — | — | — | — |
| raíz | COMPLETED | — | — | — | — |

## Criterios verificados

- **Registry / agent_id / prompt version / SHA / runtime_prompt_ref:** provenance
  completa en cada output (produced_by, execution_id, prompt_version v1, prompt_sha256
  íntegro coincidente con D1 y con el manifest, provider, model, produced_at).
- **WorkPackage:** `work_package_ref` poblado por nodo (`wpk_…`).
- **Provider/model efectivo:** openai/gpt-5 real en los 3 nodos.
- **Fallback de 03:** preferred `google/gemini-2.5-pro` no configurado → fallback a
  `openai/gpt-5` conforme a la política existente (retries=0, sin parche para el E2E).
- **Output schema:** tipos correctos (STRATEGY/INTAKE/RESEARCH); contenido jurídico
  sustantivo (8–13 k chars) persistido en R2 `iusia-artifacts`.
- **Usage/tokens/créditos:** Credit Ledger con 3 `CONSUMPTION` (-55/-41/-54) ligadas a
  su `execution_id`, `balance_after` en cascada; wallet 50000 → 49850.
- **Execution Ledger:** eventos secuenciados created→dispatched→started→work_package.sent
  →output.received→completed, gate.passed, execution.completed.
- **Transferencias / fan-out-fan-in:** grafo de Strategy Room = 3 nodos + 4 aristas
  (pisoso→01→pisoso, pisoso→03→pisoso), proyectado del ledger real.
- **Matter authorization + tenant isolation:** otra organización → HTTP 404 al matter
  y a la ejecución.
- **Ausencia de secretos:** 0 coincidencias de token/Bearer/cf-aig-authorization en D1
  (executions, execution_events) y en el log del servidor.

## Pendiente (no bloquea la capa LLM; sí para producción)

Gemini BYOK, Google Drive OAuth, ingestión + AI Search, envío Resend live, recursos
Cloudflare de staging, y hardening de producción.
