# Gates (spec)
Los gates (Foundation/Specialist/Strategy/Audit/Delivery, STOP, blocking downstream,
materiality, HIGH_STAKES) están definidos en:
- ../routing/auto_entrypoint.py (authorize_dispatch, _wave_prereq_ready, calculate_pipeline_completion, evaluate_production_gate)
- ../../governance/AGENTS.md y ../../governance/SKILL.md (reglas en prosa)
Status: REFERENCE. La plataforma futura los reimplementará como state-machine explícita.
