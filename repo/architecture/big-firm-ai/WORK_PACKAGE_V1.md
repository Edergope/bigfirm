# WORK_PACKAGE_V1 — Contrato de entrada por agente

**Estado:** PROPOSED · **Fecha:** 2026-08-21

Cada especialista recibe **solo el contexto necesario**, no el expediente completo. El Work
Package es el contrato de entrada neutral que arma el Agent Runtime a partir del estado del matter
y de los outputs upstream.

## 1. Motivación

- **Minimización de contexto** (seguridad + costo + foco): no enviar todo el matter a cada agente.
- **Trazabilidad**: cada input queda referenciado por id, no copiado sin origen.
- **Neutralidad**: el mismo paquete sirve a cualquier adapter de proveedor.

## 2. Esquema (conceptual)

```json
{
  "matter_id": "CASE-2026-001",
  "execution_id": "b1e7...-uuid",
  "parent_execution_id": null,
  "agent_id": "06-estratega-juridico-convencional",
  "objective": "Definir teoría del caso convencional y cómputo de términos",
  "questions": [
    "¿Cuál es la tesis principal sostenible con el acervo actual?",
    "¿Hay prescripción o caducidad computable?"
  ],
  "facts": [
    { "fact_id": "F-012", "statement": "...", "classification": "CANONICAL_FACT" }
  ],
  "source_refs": [
    { "source_id": "SRC-004", "kind": "primary_document", "drive_file_id": "..." }
  ],
  "upstream_outputs": [
    { "execution_id": "...", "agent_id": "04-analista-probatorio-y-pericial",
      "output_ref": "artifact://...", "output_type": "EVIDENTIARY" }
  ],
  "constraints": [
    "Derecho colombiano vigente",
    "No transmutar [D]/[A]/[I] en [F] sin acervo directo"
  ],
  "expected_output_schema": "agent_output_contract.schema.json",
  "expected_output_type": "STRATEGY",
  "budget": { "max_tokens": 24000, "cost_ceiling_usd": 1.50 }
}
```

## 3. Reglas de construcción (Agent Runtime)

1. **Selección por dependencia.** Se incluyen únicamente `upstream_outputs` declarados en
   `dependencies` del `agent.yaml` (p. ej. `06` recibe `04` y `05`, no la ola de especialistas
   irrelevantes).
2. **Hechos por relevancia.** `facts` se filtran por materia/issue del nodo, no el ledger entero.
3. **Referencias, no copias.** `source_refs` apuntan a Drive/DB; el agente pide el contenido vía
   tool `document.read` si su `permissions.drive` lo autoriza.
4. **Constraints heredados.** Constraints de gobernanza globales + específicos del workflow.
5. **Presupuesto.** `budget` lo fija el Model Router según `model_policy.tier` y el techo del matter.

## 4. Separación machine-state vs human-artifact

El Work Package es **machine state**. La salida del agente también es primero machine state
(`agent_output_contract`) y **adicionalmente** puede generar un artefacto humano (informe,
memorial). Ver [MATTER_MODEL_V1](MATTER_MODEL_V1.md) §Artifacts. El motor razona sobre el
machine state; el humano lee el artefacto.

## 5. Idempotencia

`(matter_id, execution plan node, inputs hash)` produce el `idempotency_key`. Reejecutar un nodo
con el mismo paquete no duplica trabajo ni costo salvo `REJECTED` explícito por un gate.
