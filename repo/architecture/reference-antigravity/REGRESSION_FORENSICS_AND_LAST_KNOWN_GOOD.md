# Regression Forensics & Last-Known-Good (Antigravity 2.9.1)

Fecha análisis: 2026-08-21 · cuenta `consumer` · Antigravity 2.9.1.

## Pregunta investigada
¿Hubo alguna vez un estado en el que Pisoso ejecutó **subagentes NATIVOS reales**
(`invoke_subagent` → hijo real con UUID + transcript + output)? ¿Qué cambio lo rompió?

## Evidencia forense (brain/)  `CONFIRMED BY RUNTIME`
Barrido de **766 transcripts** en `~/.gemini/antigravity/brain/*/.system_generated/logs/`:
- Step-types presentes: `PLANNER_RESPONSE, EPHEMERAL_MESSAGE, GENERIC, ERROR_MESSAGE, SYSTEM_MESSAGE, USER_INPUT, MODEL, CHECKPOINT`.
- **0 archivos** con un step real `INVOKE_SUBAGENT` (`"type":"INVOKE_SUBAGENT"` / `CORTEX_STEP_TYPE_INVOKE_SUBAGENT` / `"tool":"invoke_subagent"`).
- Las únicas menciones a `invoke_subagent` son dentro de `EPHEMERAL_MESSAGE` = el texto del hook "⚡ [PISOSO GOBERNANZA EJECUTABLE …]" (inyección de mandato), NO una llamada.
- **112 transcripts** contienen contenido `MODEL` del tipo: `"Ejecución genuina del subagente 06-… produciendo el artefacto …"` → el **modelo (main agent) ESCRIBIENDO que ejecuta un subagente** y creando el artefacto él mismo = **SIMULACIÓN monolítica**, no ejecución real.
- `brain/<uuid>` = una conversación/turno del main agent (empieza con `USER_INPUT` o `MODEL`), NO un hijo de subagente. Los "UUIDs" no son child-invocation IDs.

## Conclusión
- **NUNCA hubo ejecución nativa real de subagentes.** Cero `invoke_subagent` reales en todo el historial.
- Los "subagentes reales de ayer / UUIDs reales" eran **carpetas de conversación** + **texto del modelo simulando** subagentes. Esto es exactamente lo que la gobernanza anti-simulación estaba diseñada para rechazar.
- El "runaway" de tokens (pico Aug 20 16:00) fue **muchos turnos caros del main agent** (loop de Stop=continue + re-inyección del hook + el modelo simulando repetidamente), NO fan-out de subagentes. La corrección previa (circuit breaker de Stop, inyección una-sola-vez, caps) sí atacó el loop real; pero la etiqueta "recursión de subagentes" fue una **interpretación incorrecta** del conteo de `brain/` — corregida aquí.
- **La teoría plan/entitlement queda CONFIRMADA:** `invoke_subagent` nunca estuvo disponible (cuenta `consumer`, gated server-side por Unleash / teamwork-preview=Ultra) → nunca se ejecutó → no existe "last-known-good" que restaurar. No hubo regresión desde un estado funcional; no hubo estado funcional.

## Regla para futuros sistemas (marketing / docencia / frontend)
- NO contar `brain/<uuid>` como "invocaciones de subagente": son conversaciones/turnos.
- Un PASS multiagente exige un step real `INVOKE_SUBAGENT` con hijo real; texto del modelo diciendo "ejecuté el subagente X" NO cuenta.
- Antes de asumir "antes funcionaba", verificar en `brain/` que existan steps `INVOKE_SUBAGENT` reales.
