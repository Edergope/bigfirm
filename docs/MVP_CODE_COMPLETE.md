# IUSIA — MVP CODE COMPLETE

**Estado:** `LLM_LAYER_LIVE_VALIDATED — NOT_PRODUCTION_READY`
**Agentes:** `AGENT_PROMPT_SYSTEM_READY — 30/30`
**Fecha:** 2026-08-22 · **Tag:** `mvp-code-complete-v0.4`

> `LLM_LAYER_LIVE_VALIDATED` ≠ `MVP_PRODUCTION_READY`: la capa LLM (AI Gateway →
> BYOK OpenAI → DAG real) quedó validada live end-to-end, pero siguen pendientes
> las demás integraciones externas (Gemini, Drive OAuth, AI Search, Resend live,
> recursos Cloudflare de staging) y el hardening de producción.

## Verificación
- `typecheck` · `lint` · **116 tests** · `build` — verdes.
- Migración desde DB vacía (0000 + 0001) OK.
- Auditoría del Agent Prompt System: 30 dirs = 30 `agent.md` = 30 manifest = 30 registry,
  SHA idéntico (registry=archivo=manifest), `agent_id`/`node_code` únicos, 0 huérfanos,
  0 duplicados, 0 secretos/rutas absolutas/placeholders. Dry-run 30/30 AGENT_RUNTIME_READY.

## No hay CODE_GAP P0/P1
Todo lo pendiente es integración externa, clasificado como:
- **B CONFIGURATION_REQUIRED:** AI Gateway (+claves OpenAI/Gemini), Resend, recursos Cloudflare (D1/R2/Queues), AI Search.
- **C OAUTH_REQUIRED:** Google Drive, GitHub push.
- **D LIVE_VALIDATION_REQUIRED:** ejecución LLM E2E, ingestión Drive, envío Resend, recall RAG.
- **E DEFER:** Stripe, SSO, OpenFGA, marketplace, e-firma.

## Bloqueadores externos activos
- `ACTION_REQUIRED_SECRET` — AI Gateway (`AI_GATEWAY_TOKEN` + gateway `iusia` con claves de proveedor).
- `ACTION_REQUIRED_SECRET` — Resend (`RESEND_API_KEY`).
- `ACTION_REQUIRED_OAUTH` — Google Drive (`GOOGLE_CLIENT_ID/SECRET`).
- `ACTION_REQUIRED_OAUTH`/CONFIG — AI Search (instancia + binding).
- `GITHUB_PUSH_ACTION_REQUIRED` — `gh auth login` + `git push`.

`MVP_CODE_COMPLETE` ≠ `MVP_PRODUCTION_READY`: la segunda requiere completar las integraciones y las pruebas live.
