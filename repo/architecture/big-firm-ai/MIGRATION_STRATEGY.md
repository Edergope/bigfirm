# MIGRATION_STRATEGY — Separar conocimiento de runtime

**Estado:** PROPOSED · **Fecha:** 2026-08-21

Cómo llevar los 30 agentes de Antigravity a Big Firm AI **sin perder conocimiento jurídico**.

## 1. Principio

```
PRESERVAR:  conocimiento profesional (~97k líneas)  →  instructions.md
EXTRAER:    configuración de runtime Antigravity     →  agent.yaml + motor
CONSERVAR:  fuente canónica intacta                  →  original-antigravity.md (sha256)
```

Hallazgo que habilita esto (verificado): **solo 1 de los 30 agentes** (el orquestador) contiene
tokens de dispatch Antigravity (`invoke_subagent`/`define_subagent`/`TypeName`). Los 29
especialistas ya son casi conocimiento puro → la extracción es **quirúrgica, no masiva**.

## 2. Estructura destino por agente (recordatorio)

```
repo/agents/<id>/
├── original-antigravity.md   # INMUTABLE, = agent.md actual, valida contra manifest
├── instructions.md           # conocimiento profesional, sin runtime
├── agent.yaml                # AgentDefinition (AGENT_SPEC_V1)
└── CHANGELOG.md              # diff conceptual: qué se movió y por qué
```

## 3. Procedimiento (por agente, reversible y auditable)

1. **Copiar** `agent.md` → `original-antigravity.md` (sin tocar el original; hash registrado).
2. **Identificar bloques de runtime** (matriz Gemini, dispatch, olas en prosa, rutas
   `.agents/...`, ZERO_TEXT_ON_TURN_1, anti-redispatch).
3. **Mover** esos bloques a `agent.yaml` (config) o al motor (ORCHESTRATION_V1). **No borrar
   conocimiento** — solo mecánica de runtime.
4. **Redactar `instructions.md`** = conocimiento profesional completo, neutral de proveedor.
5. **Registrar en `CHANGELOG.md`** cada extracción con justificación.
6. **Validar**: `instructions.md` no debe perder ninguna sección sustantiva vs. el original
   (diff asistido + revisión del abogado director). Métrica: cero pérdida de doctrina/metodología.

> **No se ejecuta todavía.** Este documento describe el procedimiento; la migración real espera
> aprobación de AGENT_SPEC_V1.

## 4. Caso especial: el `00` (orquestador)

Es el único con acoplamiento real. Se parte en:
- `instructions.md` → juicio del Managing Partner (21 preguntas, síntesis, criterio estratégico,
  taxonomía [F/A/D/I/C/U/R] como disciplina profesional).
- **Motor** → DAG, olas, gates, state machine, routing (deja de ser "memoria del LLM").

El `00` seguirá **proponiendo** el orchestration plan; el motor lo **hace cumplir**.

## 5. Piloto (tras aprobar AGENT_SPEC_V1): solo 00, 01, 03

Objetivo: probar que —
- el conocimiento jurídico se conserva (diff vs. original = sin pérdida sustantiva);
- desaparece el acoplamiento innecesario a Antigravity;
- se ejecutan con **OpenAI** y con **Gemini** (mismo `instructions.md`);
- producen **structured outputs** válidos contra el contrato;
- participan en un **DAG real** (00 → 01 → 03 con un gate).

Por qué estos tres: `00` (orquestación + juicio), `01` (intake, tier eficiente, entrada del DAG),
`03` (investigación, tier balanced, lectura extensa). Cubren los tres perfiles clave.

**No migrar los 30 todavía.** Solo tras validar el piloto se define el lote completo.

## 6. Criterios de aceptación del piloto

| Criterio | Verificación |
| :-- | :-- |
| Sin pérdida de conocimiento | diff `instructions.md` vs `original-antigravity.md` revisado |
| Neutralidad | mismo agente corre en OpenAI y Gemini sin editar `instructions.md` |
| Structured output | salida valida contra `agent_output_contract.schema.json` |
| DAG real | 00→01→03 con gate ejecuta en el motor, no en el prompt |
| Trazabilidad | ejecuciones en ledger con costo y provenance |
