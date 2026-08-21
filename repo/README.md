# Pisoso — Repositorio Canónico de Especificaciones

Este repositorio contiene la **especificación canónica** del sistema jurídico multiagente Pisoso.
Es la base para construir una **plataforma propia** independiente del runtime de Antigravity.

## Separación de capas (principio central)
- **LEGAL KNOWLEDGE / AGENT BEHAVIOR** → `agents/<id>/agent.md` (los 30 prompts canónicos). NO son código.
- **WORKFLOWS** → `workflows/` (WF-01..12).
- **ORCHESTRATION** → `orchestration/` (dag, routing, gates, state-machine, execution-contracts).
- **GOVERNANCE** → `governance/` (reglas, QA engine, schemas de ledger/contrato).
- **RUNTIME REFERENCE** → `runtime/` (implementación Antigravity-era: REFERENCE / EXPERIMENTAL / DEPRECATED).
- **ARCHITECTURE** → `architecture/pisoso/` (diseño futuro) y `architecture/reference-antigravity/` (hallazgos, referencia histórica).
- **SCHEMAS** → `schemas/`.
- **TEMPLATES** → `templates/` (aún sin migrar).
- **LEGACY** → `legacy/` (estándares/known-how histórico).
- **MANIFESTS** → `manifests/*.json` (índice con sha256, line_count, status, version).

## Regla arquitectónica innegociable
Los prompts NO se incrustan en el código. La plataforma futura los **carga dinámicamente** desde
`agents/<id>/agent.md` vía el manifest. El código y el conocimiento jurídico permanecen separados.

## Estado
Fase: catalogación (COPIA verificada por SHA-256). NO se implementó la plataforma, ni adapters
OpenAI/Gemini, ni Google Drive. Originales intactos.
