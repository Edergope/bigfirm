#!/usr/bin/env python3
"""
Pisoso Legal AI — Orquestador y Creador de Expedientes
Automatiza la creación de carpetas de casos, aislamiento de entregables (File-First),
control de dependencias DAG (06 -> 15/14, 00 synthesis -> 08, 02 subagent) y verificación de compuertas.
"""

import os
import sys
import json
import argparse
import re
from datetime import datetime
from typing import Optional, List, Dict, Any

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Path-independent: cases resolve from PISOSO_CASES_ROOT (single SSOT of expedientes),
# so intake works from any location (workspace .agents/ or global skill).
CASES_DIR = os.path.abspath(os.environ.get("PISOSO_CASES_ROOT") or "/Users/edergope/Documents/Pisoso Legal/cases")
WORKSPACE_ROOT = os.environ.get("PISOSO_HOME") or os.path.dirname(CASES_DIR)

sys.path.insert(0, os.path.join(SCRIPT_DIR, "governance"))
try:
    from governance_engine import PisosoGovernanceEngine
except ImportError:
    pass

try:
    from auto_entrypoint import PisosoAutoEntrypoint
except ImportError:
    from scripts.governance.auto_entrypoint import PisosoAutoEntrypoint

try:
    from agent_router import WAVE_TEMPLATES, load_manifest
except ImportError:
    from scripts.agent_router import WAVE_TEMPLATES, load_manifest

def auto_intake_case(prompt_text: str, client_name: Optional[str] = None, case_id: Optional[str] = None,
                     conversation_id: Optional[str] = None):
    entrypoint = PisosoAutoEntrypoint(workspace_root=WORKSPACE_ROOT)
    req_type = entrypoint.detect_request_type(prompt_text)
    risk_level = entrypoint.classify_risk_level(prompt_text, req_type)
    multi_req = entrypoint.evaluate_multiagent_requirement(req_type, risk_level)
    issue_map = entrypoint.extract_issue_map(prompt_text)

    if not client_name:
        # Extract potential client name or generic
        name_match = re.search(r"\b(?:cliente\s+es|cliente\s+|contra\s+|para\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s]{4,30})", prompt_text)
        if name_match:
            client_name = name_match.group(1).strip().replace(" ", "_")
        else:
            client_name = "Cliente_Asunto"

    if not case_id:
        case_id = f"CASE-{datetime.now().strftime('%Y')}-{datetime.now().strftime('%m%d%H%M')}"

    case_folder_name = f"{case_id}_{client_name}"
    case_path = os.path.join(CASES_DIR, case_folder_name)

    internal_work_md = os.path.join(case_path, "trabajo_interno", "md")
    internal_work_scripts = os.path.join(case_path, "trabajo_interno", "scripts")
    os.makedirs(internal_work_md, exist_ok=True)
    os.makedirs(internal_work_scripts, exist_ok=True)

    # Generate Orchestration Plan & Ledgers
    plan = entrypoint.generate_orchestration_plan(
        case_id=case_id,
        text=prompt_text,
        request_type=req_type,
        risk_level=risk_level,
        case_dir=case_path,
        issue_map=issue_map
    )

    metadata_content = f"""# METADATOS DEL EXPEDIENTE: {case_id}
**Cliente:** {client_name}
**Request Type:** {req_type}
**Risk Level:** {risk_level}
**Multiagent Required:** {multi_req}
**Fecha de Creación:** {datetime.now().strftime('%Y-%m-%d %H:%M')}
**Estado:** ORCHESTRATION_INITIALIZED

## Descripción del Requerimiento
{prompt_text}

## Especialistas Seleccionados
{', '.join(plan['substantive_specialists'])}

## Estructura de Entregables
- **Raíz del Caso (`{case_folder_name}/`):** ÚNICAMENTE documentos finales Word (.docx), PDF oficial y anexos definitivos.
- **Trabajo Interno (`trabajo_interno/md/`):** Dictámenes, minutas, metadatos y análisis intermedios de los subagentes.
"""
    with open(os.path.join(internal_work_md, "CASE_METADATA.md"), "w", encoding="utf-8") as f:
        f.write(metadata_content)

    # WIRING: bind the deterministic ACTIVE_CASE for this conversation at intake time.
    # Requires a real conversationId; otherwise FAIL CLOSED (no binding, no alt selection).
    active_case_binding = None
    if conversation_id:
        active_case_binding = entrypoint.set_active_case(conversation_id, case_id, case_path)
        print(f"   • ACTIVE_CASE vinculado: conv={conversation_id} -> {case_id}")
    else:
        print("   • ⚠️  ACTIVE_CASE NO vinculado (sin conversationId real) -> governance FAIL CLOSED hasta que el hook lo vincule por match exacto.")

    print(f"\n🎯 [AUTO_ORCHESTRATION_ENTRYPOINT] Expediente creado con éxito:")
    print(f"   • Caso: {case_id}")
    print(f"   • Request Type: {req_type}")
    print(f"   • Risk Level: {risk_level}")
    print(f"   • Multiagent Required: {multi_req}")
    print(f"   • Especialistas: {', '.join(plan['substantive_specialists'])}")
    print(f"   • Total Agentes DAG: {len(plan['all_required_agents'])}")
    print(f"   • Ruta: {case_path}\n")

    return case_path, plan

def init_case(case_id, client_name, matter_type, description=""):
    case_folder_name = f"{case_id}_{client_name.replace(' ', '_')}"
    case_path = os.path.join(CASES_DIR, case_folder_name)
    
    internal_work_md = os.path.join(case_path, "trabajo_interno", "md")
    internal_work_scripts = os.path.join(case_path, "trabajo_interno", "scripts")
    
    os.makedirs(internal_work_md, exist_ok=True)
    os.makedirs(internal_work_scripts, exist_ok=True)
    
    metadata_content = f"""# METADATOS DEL EXPEDIENTE: {case_id}
**Cliente:** {client_name}
**Materia Principal:** {matter_type}
**Fecha de Creación:** {datetime.now().strftime('%Y-%m-%d %H:%M')}
**Estado:** INTAKE_PENDING

## Descripción del Requerimiento
{description if description else '[Pendiente de intake inicial por 01-intake-y-clasificador]'}

## Estructura de Entregables
- **Raíz del Caso (`{case_folder_name}/`):** ÚNICAMENTE documentos finales Word (.docx), PDF oficial y anexos definitivos.
- **Trabajo Interno (`trabajo_interno/md/`):** Dictámenes, minutas, metadatos y análisis intermedios de los subagentes.
"""
    with open(os.path.join(internal_work_md, "CASE_METADATA.md"), "w", encoding="utf-8") as f:
        f.write(metadata_content)
        
    print(f"\n✅ Expediente creado con éxito en: {case_path}")
    print(f"📁 Metadatos y subcarpeta de trabajo interno creados en: {internal_work_md}")
    
    matter_key = matter_type.lower().replace("-", "_")
    matched_key = "contractual"
    for k in WAVE_TEMPLATES:
        if k in matter_key or matter_key in k:
            matched_key = k
            break
            
    plan = WAVE_TEMPLATES[matched_key]
    print(f"\n🌊 Plan de Olas para {plan['title']}:")
    print("-" * 55)
    
    for wave_num, wave_key in [(1, "wave1"), (2, "wave2"), (3, "wave3")]:
        print(f"\n👉 OLA {wave_num}:")
        for item in plan[wave_key]:
            print(f"   • {item['agent']} (Model: {item['model']}) - {item['role']}")
            
    return case_path

def check_authorization(agent_name: str, case_dir: str, payload_context: str = ""):
    engine = PisosoGovernanceEngine(case_dir=case_dir)
    context_dict = {"context": payload_context} if payload_context else None
    res = engine.check_agent_authorization(agent_name, context_dict)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return res

def main():
    parser = argparse.ArgumentParser(description="Orquestador de Casos Pisoso Legal AI")
    parser.add_argument("--auto-intake", type=str, help="Texto natural de requerimiento para intake automático")
    parser.add_argument("--conversation-id", type=str, default=None, help="conversationId real de Antigravity para vincular ACTIVE_CASE")
    parser.add_argument("--new", type=str, help="ID del Caso (ej. CASE-2026-002)")
    parser.add_argument("--client", type=str, help="Nombre del Cliente (ej. Inversiones_Gaviria)")
    parser.add_argument("--matter", type=str, default="societario_mna", help="Materia")
    parser.add_argument("--desc", type=str, default="", help="Breve descripción del caso")
    parser.add_argument("--check-agent", type=str, help="Verificar autorización DAG de un agente")
    parser.add_argument("--case-dir", type=str, help="Ruta del caso para verificación")
    parser.add_argument("--payload", type=str, default="", help="Payload o contexto del agente")
    parser.add_argument("--check-completion", action="store_true", help="Calcular completitud del pipeline")
    parser.add_argument("--check-block", type=str, help="Verificar bloqueo de acción")
    
    args = parser.parse_args()
    if args.auto_intake:
        auto_intake_case(args.auto_intake, args.client, args.new, conversation_id=args.conversation_id)
    elif args.new and args.client:
        init_case(args.new, args.client, args.matter, args.desc)
    elif args.check_agent and args.case_dir:
        check_authorization(args.check_agent, args.case_dir, args.payload)
    elif args.check_completion and args.case_dir:
        engine = PisosoGovernanceEngine(case_dir=args.case_dir)
        res = engine.calculate_pipeline_completion()
        print(json.dumps(res, indent=2, ensure_ascii=False))
    elif args.check_block and args.case_dir:
        engine = PisosoGovernanceEngine(case_dir=args.case_dir)
        res = engine.enforce_monolithic_block(args.check_block)
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

