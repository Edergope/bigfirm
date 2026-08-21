# PISOSO LEGAL AI — ROOT ARCHITECTURE HARDENING CHANGELOG

## Versión 5.4.1 (2026-08-20) — Auditoría de Runtime Antigravity & Anti-Runaway Hardening

### Autopsia del descontrol de tokens (evidencia)
- `~/.gemini/antigravity/brain/`: **2.156 invocaciones**; pico de **1.671 en la hora 16:00** (343 a las 13:00). **812 transcripts de subagente contenían el mandato de despacho** → recursión de olas.
- **Causa raíz #1 — recursión por `TypeName:'self'`**: ningún agente declaraba `subagent: true`, forzando `self` (clon del orquestador con su mandato de despacho) → cada clon relanzaba OLA 1+2.
- **Causa raíz #2 — amplificador `PreInvocation`**: el hook inyectaba el mandato de despacho a *toda* invocación MATERIAL, incluidos los clones.
- **Causa raíz #3 — loop infinito `Stop`**: `verify_runtime_provenance` era insatisfacible (el modelo no conoce el UUID hijo) → completitud nunca `True` → `Stop` devolvía `continue` perpetuamente.
- **Causa raíz #4 — fan-out sin tope**: `extract_issue_map` greedy seleccionaba 15-18 agentes `pro` (26-63KB c/u) sin `MAX`.

### Correcciones ejecutadas (no se tocó el contenido intelectual de `agents/`)
1. **Registro real de subagentes**: `subagent: true` añadido al frontmatter de los **29 subagentes** (excluido el primario `00`), en workspace y skill global. Mandato de despacho migrado a `TypeName:'<agente-id>'` (prohibido `self`) en `AGENTS.md`, `SKILL.md` y el hook.
2. **Topes de fan-out** (`auto_entrypoint.py`): `MAX_SUBSTANTIVE_SPECIALISTS=3`, `MAX_CONDITIONAL_AGENTS=2`, `MAX_TOTAL_AGENTS=10` + dedupe.
3. **Provenance no-fatal**: soft-pass de transcripts genuinos no ubicables (rompe el loop); IDs fabricados siguen bloqueados. Reversible con `PISOSO_PROVENANCE_STRICT=1`.
4. **Circuit breaker `Stop`**: máximo `MAX_STOP_CONTINUES=2` reintentos por conversación; estado en `.pisoso_runtime_state/`.
5. **Anti-amplificación `PreInvocation`**: el mandato se inyecta **una sola vez por conversación** y nunca si ya existe `ORCHESTRATION_PLAN` o el sentinel en el transcript.
6. **Limpieza**: 71 activos residuales (16 agentes legacy ×2 rutas, 6 backups ×2, 12 subdirectorios ×2, 3 casos de prueba) movidos a `_QUARANTINE_ELIMINAR/`. Casos de clientes reales intactos.
- Tests: `test_pisoso_hard_hooks.py` 10/10 · `cold_test_pisoso_enforcement.py` 100%.


## Versión 5.3.1 (2026-08-19) — Root Architecture Consolidation & Runtime Path Unification

### Resumen Ejecutivo
Se ejecutó la consolidación canónica definitiva de Pisoso Legal AI, unificando el repositorio base (), el workspace activo de Antigravity () y el skill runtime () bajo una única verdad canónica sin pérdida de ningún activo histórico ni contingente:

1. **UNIFICACIÓN TOTAL DE ACTIVOS (8.204 Archivos Sincronizados)**:
   - Preservación íntegra de todos los casos (,  a , , , ).
   - Preservación íntegra de carpetas de clientes (, ).
   - Unificación de plantillas oficiales ( y ).
   - Sincronización de los 30 agentes con la regla maestra anti-monolítica ().
   - Sincronización de motores determinísticos  y  con compuerta de orquestación multiagente.
   - Sincronización de schemas JSON/YAML y workflows operativos (WF-01 a WF-12).

2. **CERTIFICACIÓN DE PRUEBAS AUTOMATIZADAS**:
   - 10/10 pruebas unitarias de aceptación y regresión pasando al 100% en todas las ubicaciones.

---

## Versión 5.3.0 (2026-08-19) — Final Governance Rebase & 5 Non-Negotiable Invariants

### Resumen Ejecutivo
Se completó de manera definitiva la consolidación de la capa de gobernanza ejecutable determinística bajo la ruta estructurada `scripts/governance/`. Se eliminaron permanentemente todas las heurísticas ad-hoc basadas en casos previos. Toda la validación, persistencia y enrutamiento downstream opera bajo **5 Invariantes Innegociables**:

1. **INVARIANTE 1 — FACT TRACEABILITY**: Control estricto contra `CANONICAL_FACT_LEDGER.md` y `fact_refs`.
2. **INVARIANTE 2 — NUMBER TRACEABILITY**: Extracción aritmética agnóstica sin falsos negativos. Clasificación mandatoria en 5 categorías (`CANONICAL_FACT`, `DERIVED_CALCULATION` con fórmula matemática evaluable, `LEGAL_AUTHORITY`, `CLIENT_DEFINED`, `EXPLICIT_HYPOTHESIS`).
3. **INVARIANTE 3 — LEGAL AUTHORITY TRACEABILITY**: Control estricto contra `AUTHORITY_LEDGER.md` y `authority_refs`.
4. **INVARIANTE 4 — PROVENANCE & IMMUTABILITY**: Función segura `persist_agent_output` que actualiza automáticamente `VERSION_MANIFEST.md` y `PROVENANCE_MANIFEST.md`, garantizando consistencia SHA-256 (`sha256_native == sha256_persisted`).
5. **INVARIANTE 5 — NO DOWNSTREAM AFTER FAILURE**: Función `validate_and_route` que impone bloqueo técnico insalvable si el entregable tiene findings `BLOCKER` (`STATUS: REJECTED`), impidiendo la ejecución de agentes downstream.

---

### Componentes de Gobernanza Implementados

| COMPONENTE | UBICACIÓN EN REPOSITORIO | PROPÓSITO TÉCNICO |
|---|---|---|
| **Motor de Gobernanza Unificado** | [`scripts/governance/governance_engine.py`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/scripts/governance/governance_engine.py) | Motor determinístico con `validate_deliverable`, `persist_agent_output` y `validate_and_route`. |
| **Parser de Contrato YAML** | [`scripts/validators/yaml_contract_parser.py`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/scripts/validators/yaml_contract_parser.py) | Parser inductivo puro para contratos `AGENT_OUTPUT`. |
| **Schema Contrato de Salida** | [`schemas/agent_output_contract.schema.json`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/schemas/agent_output_contract.schema.json) | Contrato formal de salida de subagente basado en 5 invariantes. |
| **Schema Entity Ledger** | [`schemas/entity_ledger.schema.json`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/schemas/entity_ledger.schema.json) | Schema para control de identidades societarias y personas. |
| **Schema Authority Ledger** | [`schemas/authority_ledger.schema.json`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/schemas/authority_ledger.schema.json) | Schema para control de fuentes y citas normativas. |
| **Suite de Aceptación 5 Invariantes** | [`tests/test_5_invariants_acceptance.py`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/tests/test_5_invariants_acceptance.py) | 8 pruebas de aceptación (genéricas para moneda, %, plazos, fórmulas derivadas, routing y persistencia). |
| **Fixtures de Regresión Histórica** | [`tests/test_regression_fixtures.py`](file:///Users/edergope/Documents/seq/Pisoso_legal_ia/pisoso-legal-ai/tests/test_regression_fixtures.py) | Valida el rechazo automático de las estrategias v1 históricas de Nexora y Terranova. |

---

### Certificación de Ejecución de Pruebas
```text
TEST SUITE DISCOVERY (test_*.py):
----------------------------------------------------------------------
Ran 10 tests in 0.016s -> OK (100% Pass)
- 8 Tests de Aceptación de los 5 Invariantes
- 2 Tests de Regresión sobre Fixtures Históricos
```
