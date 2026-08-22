# IUSIA — Estado de módulos (MVP core v0.2)

Leyenda de estado:
`IMPLEMENTED_REAL` · `IMPLEMENTED_ADAPTER` · `TESTED_WITH_FAKE` · `BLOCKED_EXTERNAL` · `DEFERRED`

| Módulo | Estado | Real / Adapter / Fake | Config externa requerida |
| :-- | :-- | :-- | :-- |
| Identidad + tenancy (Better Auth) | IMPLEMENTED_REAL | Real | — |
| Autorización por Matter | IMPLEMENTED_REAL | Real (SQL real) | — |
| Aislamiento multi-tenant | IMPLEMENTED_REAL | Real (13 tests) | — |
| Matter core + ledgers | IMPLEMENTED_REAL | Real | — |
| Agent Registry (30) + Prompt Loader | IMPLEMENTED_REAL | Real (SHA-256) | — |
| Routing jurídico determinista | IMPLEMENTED_REAL | Real (7 tests) | — |
| DAG + gates (Cloudflare Workflows) | IMPLEMENTED_REAL | Real | — |
| LegalWorker runtime | IMPLEMENTED_REAL | Real (infra) | — |
| Ejecución LLM (AI Gateway) | BLOCKED_EXTERNAL | Real infra, sin modelo | Claves de proveedor en el gateway |
| Strategy Room | IMPLEMENTED_REAL | Real (eventos) | — |
| Credit Ledger + idempotencia | IMPLEMENTED_REAL | Real (3 tests) | — |
| Case Brief | IMPLEMENTED_REAL | Real | — |
| Deadlines (cálculo jurídico) | IMPLEMENTED_REAL | Real (5 tests) | — |
| Tasks | IMPLEMENTED_REAL | Real | — |
| IUSIA Intelligence (read-only) | IMPLEMENTED_REAL | Real | — |
| Document Registry | IMPLEMENTED_REAL | Real | — |
| Google Drive (storage/picker) | IMPLEMENTED_ADAPTER | Adapter NOT_CONFIGURED | OAuth Google |
| Ingestión (Queue + DLQ) | IMPLEMENTED_REAL | Real (consumidor idempotente) | — (contenido depende de Drive) |
| AI Search / retrieval | IMPLEMENTED_ADAPTER + TESTED_WITH_FAKE | Adapter + aislamiento probado con índice falso | Instancia AI Search (POC) |
| Templates (Google Docs / Docxtemplater) | IMPLEMENTED_ADAPTER | Adapter NOT_CONFIGURED | OAuth Google / lib docxtemplater |
| Billing (Stripe) | DEFERRED | Adapter DEFERRED_CONFIGURATION | Claves Stripe (post-MVP) |
| Notificaciones (Resend) | DEFERRED | — | API key Resend |
| Administración de firma | IMPLEMENTED_REAL | Real (Better Auth + ACL) | — |
| Perímetro (Turnstile/WAF) | DEFERRED | Nivel plataforma | Configuración Cloudflare |
| CI/CD GitHub → Cloudflare | BLOCKED_EXTERNAL | — | Credenciales git + recursos CF |

Validación en verde (v0.2): `typecheck`, `lint`, `build`, **79 tests** (incl. aislamiento
multi-tenant, ACL, inyección desde documentos, aislamiento de recuperación, idempotencia
de créditos, routing, deadlines, brief e intelligence).
