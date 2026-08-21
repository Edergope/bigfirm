#!/usr/bin/env python3
"""
Pisoso Legal AI — End-to-End Cold Test for Hard Runtime Enforcement
Simulates the full cold execution lifecycle:
1. /pisoso invoked with natural language MATERIAL legal case
2. Model attempts to stop without executing DAG -> Stop Hook blocks with continue
3. Subagents execute in canonical waves (01, 03, especialista, 06, 10, 11) -> intermediate attempts blocked
4. 00 completes final strategic synthesis with real runtime provenance
5. Stop hook validates full pipeline -> allows final stop & delivery
"""

import os
import sys
import json
import uuid
import shutil
import tempfile
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
ENFORCER_SCRIPT = os.path.join(SCRIPT_DIR, "enforce_pisoso_hooks.py")

sys.path.insert(0, os.path.join(WORKSPACE_ROOT, "scripts", "governance"))
from auto_entrypoint import PisosoAutoEntrypoint

def run_hook(event: str, payload: dict) -> dict:
    proc = subprocess.Popen(
        [sys.executable, ENFORCER_SCRIPT, "--event", event],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    stdout, stderr = proc.communicate(input=json.dumps(payload))
    if proc.returncode != 0:
        raise RuntimeError(f"Hook script failed ({proc.returncode}): {stderr}")
    return json.loads(stdout.strip())

def create_mock_runtime_transcript(inv_id: str, agent_slug: str, artifact_name: str) -> str:
    brain_dir = os.path.expanduser("~/.gemini/antigravity/brain")
    inv_dir = os.path.join(brain_dir, inv_id, ".system_generated", "logs")
    os.makedirs(inv_dir, exist_ok=True)
    t_path = os.path.join(inv_dir, "transcript.jsonl")
    
    with open(t_path, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "type": "MODEL",
            "content": f"Ejecución genuina del subagente {agent_slug} produciendo el artefacto {artifact_name} para el expediente."
        }) + "\n")
    return t_path

def main():
    temp_dir = tempfile.mkdtemp(prefix="pisoso_cold_test_")
    test_case_dir = os.path.join(WORKSPACE_ROOT, "cases", "TEST_COLD_ENFORCEMENT_MATTER")
    
    try:
        os.makedirs(os.path.join(test_case_dir, "trabajo_interno", "md"), exist_ok=True)
        logs_dir = os.path.join(temp_dir, ".system_generated", "logs")
        os.makedirs(logs_dir, exist_ok=True)
        main_transcript = os.path.join(logs_dir, "transcript.jsonl")

        # Step 1: User prompt with /pisoso and natural material case
        case_prompt = (
            "/pisoso\n"
            "Tengo un nuevo caso real de revisión y auditoría contractual de prestación de servicios tecnológicos "
            "y automatización por valor de $17 millones COP entre Antonio Dager y Nidia Pitalúa en TEST_COLD_ENFORCEMENT_MATTER."
        )

        with open(main_transcript, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "SYSTEM", "content": "/pisoso RULE[/Users/edergope/Documents/Pisoso Legal/AGENTS.md] Pisoso Legal AI v5.4.0"}) + "\n")
            f.write(json.dumps({"type": "USER_INPUT", "content": case_prompt}) + "\n")

        entrypoint = PisosoAutoEntrypoint(workspace_root=WORKSPACE_ROOT)
        
        # Step 2: Auto-entrypoint initializes ORCHESTRATION_PLAN
        plan = entrypoint.generate_orchestration_plan(
            case_id="TEST_COLD_ENFORCEMENT_MATTER",
            text=case_prompt,
            request_type="DOCUMENT_REVIEW",
            risk_level="MATERIAL",
            case_dir=test_case_dir
        )
        print("STAGE 1: Plan Initialized -> Required:", plan["all_required_agents"])

        # Step 3: Model attempts monolithic stop immediately -> MUST BE BLOCKED BY STOP HOOK
        res_stop_1 = run_hook("Stop", {
            "transcriptPath": main_transcript,
            "workspacePaths": [WORKSPACE_ROOT]
        })
        print("STAGE 2: Early Stop Attempt Result ->", res_stop_1)
        assert res_stop_1.get("decision") == "continue", f"Expected continue, got {res_stop_1}"
        assert "pipeline multiagente incompleto" in res_stop_1.get("reason", "")

        # Step 4: Model attempts to write deliverable -> MUST BE DENIED BY PRETOOLUSE HOOK
        res_tool_1 = run_hook("PreToolUse", {
            "transcriptPath": main_transcript,
            "workspacePaths": [WORKSPACE_ROOT],
            "toolCall": {
                "name": "write_to_file",
                "args": {"TargetFile": os.path.join(test_case_dir, "Concepto_Final_Pisoso.docx")}
            }
        })
        print("STAGE 3: Early Deliverable Attempt Result ->", res_tool_1)
        assert res_tool_1.get("decision") == "deny", f"Expected deny, got {res_tool_1}"

        # Step 5: Execute Wave 1 (01, 03)
        for slug, art in [
            ("01-intake-y-clasificador", "01_INTAKE_TECNOLOGICO.md"),
            ("03-investigador-normativo-jurisprudencial", "03_INVESTIGACION_NORMATIVA_TECH.md")
        ]:
            inv = str(uuid.uuid4())
            create_mock_runtime_transcript(inv, slug, art)
            with open(os.path.join(test_case_dir, "trabajo_interno", "md", art), "w") as f:
                f.write(f"# {slug}\n[F] Hecho verificado.")
            entrypoint.record_agent_execution(test_case_dir, slug, inv, art, validation_status="ACCEPTED")

        # Check Stop Gate again -> MUST STILL BE BLOCKED
        res_stop_2 = run_hook("Stop", {
            "transcriptPath": main_transcript,
            "workspacePaths": [WORKSPACE_ROOT]
        })
        print("STAGE 4: Wave 1 Completed Stop Attempt Result ->", res_stop_2)
        assert res_stop_2.get("decision") == "continue"

        # Step 6: Execute Wave 2 (Specialists) + Wave 3 (06) + Wave 4 (10, 11)
        for slug, art in [
            ("especialista-contractual-y-negocios", "MEMO_ESPECIALISTA_CONTRACTUAL.md"),
            ("especialista-propiedad-intelectual-y-datos", "MEMO_ESPECIALISTA_PI_DATOS.md"),
            ("06-estratega-juridico-convencional", "06_ESTRATEGIA_CONVENCIONAL_TECH.md"),
            ("10-auditor-juridico-y-red-team", "10_AUDITORIA_RED_TEAM_TECH.md"),
            ("11-auditor-de-citas-y-vigencia", "11_AUDITORIA_CITAS_TECH.md")
        ]:
            inv = str(uuid.uuid4())
            create_mock_runtime_transcript(inv, slug, art)
            with open(os.path.join(test_case_dir, "trabajo_interno", "md", art), "w") as f:
                f.write(f"# {slug}\nAnálisis sustancial.")
            entrypoint.record_agent_execution(test_case_dir, slug, inv, art, validation_status="ACCEPTED")

        # Step 7: Execute Wave 5 (00 Final Strategic Synthesis)
        inv_00 = str(uuid.uuid4())
        art_00 = "00_FINAL_STRATEGIC_SYNTHESIS.md"
        create_mock_runtime_transcript(inv_00, "00-final-strategic-synthesis", art_00)
        with open(os.path.join(test_case_dir, "trabajo_interno", "md", art_00), "w") as f:
            f.write("# 00 SINTESIS\nDictamen y síntesis ejecutiva.")
        entrypoint.record_agent_execution(test_case_dir, "00-final-strategic-synthesis", inv_00, art_00, validation_status="ACCEPTED")

        # Step 8: Final Stop Gate -> MUST BE ALLOWED!
        res_stop_final = run_hook("Stop", {
            "transcriptPath": main_transcript,
            "workspacePaths": [WORKSPACE_ROOT]
        })
        print("STAGE 5: Final Stop Attempt Result ->", res_stop_final)
        assert res_stop_final.get("decision") == "allow", f"Expected allow, got {res_stop_final}"

        # Step 9: Final Deliverable Gate -> MUST BE ALLOWED!
        res_tool_final = run_hook("PreToolUse", {
            "transcriptPath": main_transcript,
            "workspacePaths": [WORKSPACE_ROOT],
            "toolCall": {
                "name": "write_to_file",
                "args": {"TargetFile": os.path.join(test_case_dir, "Concepto_Final_Pisoso.docx")}
            }
        })
        print("STAGE 6: Final Deliverable Attempt Result ->", res_tool_final)
        assert res_tool_final.get("decision") == "allow", f"Expected allow, got {res_tool_final}"

        print("\nCOLD TEST RESULT: 100% PASS — LIFECYCLE VERIFIED DETERMINISTICALLY")

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        if os.path.exists(test_case_dir):
            shutil.rmtree(test_case_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
