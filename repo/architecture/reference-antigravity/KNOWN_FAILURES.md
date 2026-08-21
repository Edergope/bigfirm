# Known Failures — NO repetir (Antigravity 2.9.1)

Errores cometidos/observados durante la construcción de `/pisoso`. Evitarlos en `/marketing`, `/docencia`, `/frontend`, etc.

1. **Confundir global skill root con workspace agent discovery.** El selector lee `.agents/agents/` del WORKSPACE abierto; copiar agentes a `~/.gemini/config/agents/` NO los muestra. `CONFIRMED`.
2. **Tratar `AGENTS_REGISTRY.json` como discovery oficial.** No lo es; el IDE lo ignora.
3. **Frontmatter no-mínimo.** Añadir muchos campos a la vez (tools anidado, model_tier, title, category, jurisdiction, version, status) **oculta el selector entero**. Usar solo `name`+`description` (+`mainAgent:false` para ocultar).
4. **`TypeName:'self'`.** Clona al orquestador → recursión/explosión (se llegó a ~1671 invocaciones/hora). PROHIBIDO.
5. **`define_subagent` para agentes ya registrados.** Innecesario y peligroso. PROHIBIDO.
6. **Intentar dar `invoke_subagent` a un custom Main Agent vía frontmatter** (`enabledTools`, `tools.subagent_tools`, `access_grants`). Parsea pero NO inyecta la tool. Camino cerrado.
7. **Declarar PASS por filesystem/YAML.** El YAML válido ≠ discovery real ≠ tool disponible. Validar en UI/runtime.
8. **Declarar orquestación multiagente PASS sin child invocation real** (invocation id + retorno). No aceptar fallback monolítico, UUIDs falsos, ni análisis del padre atribuidos a un hijo.
9. **Cambiar 10 variables a la vez.** Siempre A/B de una variable + rollback unitario + snapshot previo.
10. **Limpiar runtime/workspace antes de validar.** No retirar el sistema viejo hasta confirmar el nuevo en UI.
11. **No confundir "símbolo existe en binario" con "tool disponible en la sesión".** `CORTEX_STEP_TYPE_INVOKE_SUBAGENT` existe pero está gated por feature-flags server-side / plan.

## Root cause raíz del bloqueo multiagente (2.9.1, cuenta consumer)
`invoke_subagent` NO se registra en sesiones de chat normales; es capacidad del modo teamwork-preview / archetypes internos, gated **server-side (Unleash) por plan (Ultra)**. No habilitable localmente. → **PLATFORM LIMITATION / ENTITLEMENT**.
