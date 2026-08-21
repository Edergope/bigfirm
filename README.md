# IUSIA — Legal Operating System

Plataforma LegalTech SaaS multi-tenant de Go Legaltech, sobre Cloudflare.

Fuentes normativas (leerlas antes de construir, en este orden de precedencia):

1. `documentacion/IUSIA_04_Technical_Master_Blueprint_MVP_v1.pdf` — stack y BUILD/ADOPT/DEFER
2. `documentacion/IUSIA_UI_UX_Design_System_MVP_v1.pdf` — vistas, identidad visual, Strategy Room
3. `documentacion/Archivo_no_tocar/` — especificación funcional y modelo de casos
4. `repo/` — conocimiento jurídico canónico: 30 `agent.md`, DAG, gates y contratos

## Qué es propio y qué se adopta

Se **construye** sólo lo que es propiedad intelectual de IUSIA: el modelo de Matter,
la autorización por expediente, el DAG jurídico y sus gates, el WorkPackage, el
Execution Ledger, los ledgers de hechos y autoridades, la auditoría jurídica y la
economía de créditos.

Se **adopta** todo lo demás: Better Auth (identidad), Cloudflare Agents SDK (runtime),
Workflows (durabilidad), D1 + Drizzle, R2, AI Gateway (modelos), Google Drive
(documentos), React Flow, TanStack, Tailwind.

Los 30 prompts canónicos **no se editan, resumen ni migran**. Se cargan en ejecución
desde R2 y se verifican por SHA-256 contra `repo/manifests/AGENTS_MANIFEST.json`.
Si un prompt cambia, la ejecución falla en vez de correr algo que no es el canónico.

## Estructura

```
apps/web/            Worker (Hono + Agents SDK + Workflows) + SPA React
packages/domain/     Matter, autorización, WorkPackage, ledgers, eventos, créditos
packages/db/         Esquema D1 (Drizzle) y repositorios de dominio
packages/agents/     Agent Registry y Prompt Loader
packages/orchestration/  DAG jurídico y gates deterministas
packages/ui/         Design tokens y componentes de IUSIA
repo/                Repositorio canónico de agentes (NO modificar)
docs/PENDIENTES.md   Dependencias externas sin aprovisionar
```

## Puesta en marcha local

Requiere Node 22 (`nvm use`) y pnpm.

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # rellenar secretos
pnpm --filter @iusia/web migrate:local
pnpm prompts:sync                                   # sube los agent.md a R2 local
pnpm dev
```

Con sesión iniciada, `POST /api/dev/bootstrap` registra los agentes del piloto y
acredita créditos de desarrollo (sólo con `IUSIA_ENV=development`).

## Verificación

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Estado del piloto

El DAG activo es el piloto técnico: **00 Managing Partner → 01 Intake → 03 Investigación**.
Los otros 27 agentes existen como conocimiento canónico en `repo/agents/` pero no
están registrados. Habilitarlos es añadir entradas en
`packages/agents/src/pilot-agents.json` y nodos en `packages/orchestration/src/dag.ts`:
no requiere tocar el runtime ni los prompts.
