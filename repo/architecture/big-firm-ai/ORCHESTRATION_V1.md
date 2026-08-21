# ORCHESTRATION_V1 — Workflow Engine, DAG, State Machine, Gates

**Estado:** PROPOSED · **Fecha:** 2026-08-21

Formaliza como **motor determinista** lo que hoy vive en prosa en
`orchestration/dag/WORKFLOW_ORCHESTRATION.md` y `governance/AGENTS.md`.

## 1. Por qué determinista

El DAG **no puede depender de que el LLM "recuerde" ejecutarlo**. Separamos:

- **Inteligencia profesional (00):** cómo piensa/evalúa/integra el Managing Partner.
- **Orquestación determinista (motor):** qué agentes corren, cuándo, en qué orden, con qué
  dependencias y bajo qué gates.

El `00` emite un *orchestration plan* como **propuesta**; el Workflow Engine lo **valida contra el
workflow declarado** y lo ejecuta. Si el `00` omite un nodo obligatorio, el motor lo impone.

## 2. Modelo de ejecución

```
Workflow (WF-0x, declarativo)
  └── DAG de nodos (agent_id, dependencies, wave, gate_group)
        └── Waves (olas): fan-out paralelo dentro de la ola, barrera al final
              └── Node execution (state machine por nodo)
                    └── Gate evaluation (por ola / final)
```

### DAG canónico (de WORKFLOW_ORCHESTRATION.md, ahora declarativo)

```
00  Clasificación fáctica + issue map + orchestration plan
      ↓
Wave 1:  01 ‖ 03 ‖ 04 ‖ 05        (fan-out paralelo)
      ── HARD GATE: Fact & Evidence Ledger ──
Wave 2:  especialistas sustantivos requeridos (fan-out dinámico)
      ── HARD GATE: Substantive Alignment ──
Wave 3a: 06  (estratega convencional)          [secuencial, insumo obligatorio de 15 y 14]
Wave 3b: 15 ‖ 14                                (consumen 06_estrategia)
      ── HARD GATE: Dual Strategy & Procedibility ──
Wave 4:  10 (red team) ‖ 11 (citas/vigencia)
      ── FINAL HARD GATE: 10 quality gates / 0 blockers ──
00  Síntesis y decisión estratégica definitiva
      ↓
08  Redacción formal → 02  Compilación entrega (Word .docx)
```

## 3. State Machine (por nodo)

Estados (formalizados desde los hoy implícitos en `auto_entrypoint`):

```
PENDING → READY → RUNNING → { COMPLETED → ACCEPTED | REJECTED } 
RUNNING → { FAILED | TIMEOUT | CANCELLED }
REJECTED → READY (solo si un gate ordena re-evaluación; respeta anti-redispatch)
```

- `READY`: dependencias satisfechas (`_wave_prereq_ready`).
- `ACCEPTED`: contrato de salida válido **y** gate de ola en PASS.
- `blocks_downstream_on_failure`: un `FAILED`/`REJECTED` no remediado **detiene** downstream
  (regla *no-downstream-after-failure*).

Capacidades requeridas del motor: secuencial, paralelo, dependencias, fan-out, fan-in, gates,
wait, retries, timeout, cancellation, failure propagation, blocking downstream, human approval,
**resumabilidad** (persistir estado por nodo) e **idempotencia** (`idempotency_key`).

## 4. Gates (de prosa a validadores)

| Gate | Momento | Criterio (programático) | Falla ⇒ |
| :-- | :-- | :-- | :-- |
| **Fact & Evidence** | fin Wave 1 | ledger de hechos poblado; clasificación [F/A/D/I/C/U/R] presente | STOP Wave 2 |
| **Substantive Alignment** | fin Wave 2 | dictámenes de especialistas con `authority_refs` mínimos | STOP Wave 3 |
| **Dual Strategy & Procedibility** | fin Wave 3 | existe `06` + `14` + `15`; términos computados | STOP Wave 4 |
| **Final Quality Gate** | fin Wave 4 | 10 filtros PASS, 0 blockers, citas verificadas (11), red team (10) sin críticos | STOP síntesis 00 |

Cada gate es una función pura sobre el estado del matter y los contratos de salida
(reutiliza la lógica de `legal_qa_engine.py` / `governance_engine.py` como referencia,
reimplementada como servicio del Core). Ver [OBSERVABILITY_AND_COST_V1](OBSERVABILITY_AND_COST_V1.md).

## 5. Routing Engine

Dos routings distintos, no confundir:
- **Workflow routing** (este doc): mapa "solicitud → WF-0x" y "WF → nodos/olas". Determinista.
- **Model routing** ([MODEL_ROUTER_V1](MODEL_ROUTER_V1.md)): "nodo → provider/model". Ortogonal.

Fan-out dinámico de Wave 2: el issue map del `00` determina **qué especialistas** entran, pero el
motor valida que cada especialista elegido exista en el catálogo de 30 (regla "solo catálogo").

## 6. Anti-patrones prohibidos (heredados de governance, ahora forzados por código)

- Re-despacho redundante de un nodo ya en ejecución/completado (salvo `REJECTED`).
- Texto sustantivo antes de completar las olas (el motor no libera artefacto humano final hasta
  el gate final).
- Ejecutar downstream tras un fallo no remediado.

## 7. Neutralidad de proveedor

El motor solo conoce `AgentDefinition` y contratos; nunca llama a un SDK de proveedor
directamente — siempre vía Agent Runtime → Model Router → Adapter. Un mismo DAG corre idéntico
con OpenAI o Gemini. Paralelismo real: el motor lanza N nodos de una ola concurrentemente y hace
`fan-in` en la barrera, independientemente de cómo cada adapter implemente concurrencia.
