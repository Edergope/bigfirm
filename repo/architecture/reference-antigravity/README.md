# Antigravity 2.x — Agentic System Blueprint (reusable)

**Ubicación:** `~/.gemini/config/_agentic_blueprint/` — SOLO documentación. NO es un skill,
NO se auto-activa, NO está en el discovery scope de agentes/skills. No copiar dentro de
ningún workspace de usuario (p.ej. `Pisoso Legal/`), que debe quedar orientado a datos.

**Propósito:** que los futuros sistemas agénticos (`/marketing`, `/docencia`, `/frontend`, …)
NO repitan la investigación ni los errores del sistema legal `/pisoso`.

**Versión validada:** Antigravity IDE 2.9.1 · fecha 2026-08-21 · cuenta `consumer`.

## Índice
- [ANTIGRAVITY_2.9.1_BLUEPRINT.md](ANTIGRAVITY_2.9.1_BLUEPRINT.md) — discovery, frontmatter, visibilidad, invocación de subagentes, entitlements de runtime, patrón de domain-skill, protocolo de pruebas.
- [KNOWN_FAILURES.md](KNOWN_FAILURES.md) — errores que NO se deben repetir.

## Niveles de evidencia (usar SIEMPRE al documentar hallazgos)
`CONFIRMED BY UI` · `CONFIRMED BY RUNTIME` · `CONFIRMED BY BINARY` · `CONFIRMED BY OFFICIAL DOCS` · `HYPOTHESIS` · `PLATFORM LIMITATION`. No mezclar niveles.

## Patrón objetivo (genérico, NO específico de dominio)
```
ANTIGRAVITY MAIN AGENT (nativo, neutral)
        ↓  (el usuario escribe /<domain-skill>)
   /<domain-skill>          → identidad + gobernanza del dominio
        ↓
   domain agents (.agents/agents/<slug>/agent.md, mainAgent:false)
        ↓
   domain workspace / cases
```
El Main Agent nativo NO se convierte en el dominio; la identidad se activa por skill (aislamiento por progressive-disclosure). Nunca poner reglas de dominio en configuración global permanente.
