#!/usr/bin/env python3
"""
Pisoso Legal AI — Native Antigravity Hard Governance Enforcement Hooks
Implements Stop Gate and Final Deliverable PreToolUse Gate.
"""

import sys
import os
import re
import json
import argparse
from typing import Dict, List, Any, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
SCRIPTS_DIR = os.path.join(WORKSPACE_ROOT, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)
GOVERNANCE_DIR = os.path.join(SCRIPTS_DIR, "governance")
if GOVERNANCE_DIR not in sys.path:
    sys.path.insert(0, GOVERNANCE_DIR)

try:
    from auto_entrypoint import PisosoAutoEntrypoint
    from governance_engine import PisosoGovernanceEngine
except ImportError:
    from scripts.governance.auto_entrypoint import PisosoAutoEntrypoint
    from scripts.governance.governance_engine import PisosoGovernanceEngine


class PisosoRuntimeHookEnforcer:
    # Anti-runaway ceilings (v5.4.1). The Stop hook may re-enter the loop only a
    # bounded number of times; the dispatch mandate is injected at most once.
    MAX_STOP_CONTINUES = 2
    DISPATCH_SENTINEL = "MANDATO DE DESPACHO MULTIAGENTE INMEDIATO"

    def __init__(self, workspace_root: Optional[str] = None):
        # The engine is path-independent: cases + state come from the entrypoint,
        # which resolves PISOSO_CASES_ROOT (default /…/Pisoso Legal/cases). The hook
        # code may therefore live anywhere (workspace .agents/ or global skill).
        self.entrypoint = PisosoAutoEntrypoint(workspace_root=workspace_root)
        self.workspace_root = self.entrypoint.workspace_root
        self.cases_dir = self.entrypoint.cases_dir
        self.state_dir = self.entrypoint._state_dir()

    # -------------------------------------------------------------
    # PER-CONVERSATION RUNTIME STATE (anti-amplification counters)
    # -------------------------------------------------------------
    def _state_path(self, conversation_id: Optional[str]) -> Optional[str]:
        if not conversation_id:
            return None
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(conversation_id))[:80]
        return os.path.join(self.state_dir, f"{safe}.json")

    def _load_state(self, conversation_id: Optional[str]) -> Dict[str, Any]:
        p = self._state_path(conversation_id)
        if p and os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_state(self, conversation_id: Optional[str], state: Dict[str, Any]) -> None:
        p = self._state_path(conversation_id)
        if not p:
            return
        try:
            os.makedirs(self.state_dir, exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(state, f)
        except Exception:
            pass

    def _any_active_plan_exists(self) -> bool:
        """A dispatch mandate must NOT be re-injected once orchestration has begun."""
        if not os.path.exists(self.cases_dir):
            return False
        for f in os.listdir(self.cases_dir):
            if f.startswith("."):
                continue
            plan = os.path.join(self.cases_dir, f, "trabajo_interno", "ORCHESTRATION_PLAN.json")
            if os.path.exists(plan):
                return True
        return False

    def is_pisoso_session_active(self, transcript_path: Optional[str], stdin_payload: Optional[Dict[str, Any]] = None) -> bool:
        """
        Determines if Pisoso Legal AI is active in the current session.
        Checks transcript, workspace paths, and active matter context.
        """
        if not transcript_path or not os.path.exists(transcript_path):
            if stdin_payload:
                ws_paths = stdin_payload.get("workspacePaths", [])
                if any("pisoso" in p.lower() for p in ws_paths):
                    return True
            return False

        try:
            with open(transcript_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except Exception:
            return False

        pisoso_markers = [
            "/pisoso",
            "name: pisoso",
            "Pisoso Legal AI",
            "00-orquestador-general-juridico",
            "ORCHESTRATION_PLAN",
            "CANONICAL_FACT_LEDGER"
        ]

        for line in reversed(lines[-100:]):
            try:
                data = json.loads(line)
                content = str(data.get("content", "")) + str(data.get("tool_calls", ""))
                if any(marker in content for marker in pisoso_markers):
                    return True
            except Exception:
                if any(marker in line for marker in pisoso_markers):
                    return True

        return False

    def extract_latest_user_prompt(self, transcript_path: Optional[str]) -> str:
        """Extracts the most recent user prompt from the transcript."""
        if not transcript_path or not os.path.exists(transcript_path):
            return ""

        try:
            with open(transcript_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except Exception:
            return ""

        for line in reversed(lines):
            try:
                data = json.loads(line)
                if data.get("type") == "USER_INPUT":
                    content = data.get("content", "")
                    if isinstance(content, str) and content.strip():
                        return content
                    elif isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict) and part.get("text"):
                                return part["text"]
            except Exception:
                continue

        return ""

    def find_active_case_dir(self, prompt: str, transcript_path: Optional[str], target_file: Optional[str] = None,
                             conversation_id: Optional[str] = None) -> Optional[str]:
        """
        §4 DETERMINISTIC ACTIVE-CASE RESOLUTION (FAIL CLOSED).
        Resolution order — every step is unambiguous; there is NO fuzzy fallback:
          1. Bound ACTIVE_CASE state for this conversation (set at intake).
          2. Explicit target_file under /cases/<folder>/.
          3. Exact case-folder-name substring in the prompt.
          4. Exact case-folder-name substring in the transcript.
        If none matches -> return None (FAIL CLOSED). Never score entities, never pick
        the 'most recently modified' matter, never fall back to a neighbour directory.
        """
        if not os.path.exists(self.cases_dir):
            return None

        def _bind_and_return(folder: Optional[str]) -> Optional[str]:
            # WIRING: persist the deterministic ACTIVE_CASE for this conversation the first
            # time it is resolved from an EXACT source, so every later gate reads the bound
            # case. Only exact resolutions reach here — never a heuristic guess.
            if folder and conversation_id and os.path.isdir(folder):
                try:
                    self.entrypoint.set_active_case(conversation_id, os.path.basename(folder), folder)
                except Exception:
                    pass
            return folder

        # 1. Deterministic ACTIVE_CASE binding (highest authority).
        if conversation_id:
            ac = self.entrypoint.resolve_active_case_dir(conversation_id)
            if ac.get("status") == "OK":
                return ac["case_dir"]

        # 2. Target file direct match.
        if target_file and "/cases/" in target_file:
            parts = target_file.split("/cases/")
            if len(parts) > 1:
                case_sub = parts[1].split("/")[0]
                cand = os.path.join(self.cases_dir, case_sub)
                if os.path.isdir(cand) and not os.path.basename(cand).startswith("."):
                    return _bind_and_return(cand)

        case_folders = [
            os.path.join(self.cases_dir, f)
            for f in os.listdir(self.cases_dir)
            if os.path.isdir(os.path.join(self.cases_dir, f)) and not f.startswith(".")
        ]
        if not case_folders:
            return None

        prompt_lower = (prompt or "").lower()

        # 3. Exact folder-name match in prompt (unambiguous substring).
        for folder in case_folders:
            if os.path.basename(folder).lower() in prompt_lower:
                return _bind_and_return(folder)

        # 4. Exact folder-name match in transcript.
        if transcript_path and os.path.exists(transcript_path):
            try:
                with open(transcript_path, "r", encoding="utf-8") as f:
                    transcript_text = f.read().lower()
                for folder in case_folders:
                    if os.path.basename(folder).lower() in transcript_text:
                        return _bind_and_return(folder)
            except Exception:
                pass

        # FAIL CLOSED — do not guess.
        return None

    def _bounded_continue(self, conversation_id: Optional[str], reason: str,
                          case_dir: Optional[str] = None) -> Dict[str, Any]:
        """§3 CIRCUIT BREAKER. Re-enter the agent loop up to MAX_STOP_CONTINUES times per
        conversation. On exhaustion it does NOT degrade to 'allow'/'completed'/any bypass:
        it ABORTS the pipeline (pipeline_status=FAILED, kill active subagents, no final
        opinion, no deliverable authorization) and terminates the loop with an ABORT
        decision that carries the technical abort reason."""
        state = self._load_state(conversation_id)
        used = int(state.get("stop_continues", 0))
        if used >= self.MAX_STOP_CONTINUES:
            abort_info = {}
            if case_dir and os.path.isdir(case_dir):
                abort_info = self.entrypoint.abort_pipeline(
                    case_dir,
                    reason=f"Stop gate agotó {self.MAX_STOP_CONTINUES} reintentos sin completar el pipeline. {reason}",
                    code="CIRCUIT_BREAKER_ABORT"
                )
            state["pipeline_aborted"] = True
            self._save_state(conversation_id, state)
            # 'abort' is NOT 'continue' (loop terminates) and is NOT 'allow' (no success).
            return {
                "decision": "abort",
                "status": "ABORT_PIPELINE",
                "pipeline_status": "FAILED",
                "final_deliverable_authorized": False,
                "final_legal_opinion": None,
                "reason": (
                    f"PISOSO CIRCUIT BREAKER → ABORT_PIPELINE tras {self.MAX_STOP_CONTINUES} reintentos. "
                    "Subagentes activos marcados/terminados; pipeline_status=FAILED; sin dictamen final. "
                    f"Motivo técnico: {reason}"
                ),
                "abort": abort_info or True
            }
        state["stop_continues"] = used + 1
        self._save_state(conversation_id, state)
        return {"decision": "continue", "reason": reason}

    # -------------------------------------------------------------
    # 1. STOP GATE EVALUATOR
    # -------------------------------------------------------------
    def evaluate_stop_gate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        transcript_path = payload.get("transcriptPath")
        conversation_id = payload.get("conversationId")
        
        # 1. Scoping Check: Is Pisoso active?
        if not self.is_pisoso_session_active(transcript_path, payload):
            return {"decision": "allow"}

        # 2. Extract latest request & classify
        user_prompt = self.extract_latest_user_prompt(transcript_path)
        if not user_prompt:
            return {"decision": "allow"}

        req_type = self.entrypoint.detect_request_type(user_prompt)
        risk_level = self.entrypoint.classify_risk_level(user_prompt, req_type)

        # Simple queries are allowed to answer directly
        if req_type == "SIMPLE_QUERY" or risk_level == "SIMPLE":
            return {"decision": "allow"}

        # For MATERIAL / HIGH_STAKES, multiagent pipeline is strictly required
        case_dir = self.find_active_case_dir(user_prompt, transcript_path, conversation_id=conversation_id)
        if not case_dir:
            return self._bounded_continue(
                conversation_id,
                "PISOSO HARD GATE (FAIL CLOSED): Asunto MATERIAL/HIGH_STAKES sin ACTIVE_CASE resoluble (ni ORCHESTRATION_PLAN)."
            )

        internal_dir = os.path.join(case_dir, "trabajo_interno")
        plan_path = os.path.join(internal_dir, "ORCHESTRATION_PLAN.json")
        if not os.path.exists(plan_path):
            return self._bounded_continue(
                conversation_id,
                f"PISOSO HARD GATE: No existe ORCHESTRATION_PLAN.json en {case_dir}. Debe ejecutarse la inicialización y el DAG multiagente.",
                case_dir=case_dir
            )

        completion = self.entrypoint.calculate_pipeline_completion(case_dir)

        # A FAILED/aborted pipeline terminates without success (no bypass to allow).
        if completion.get("status") == "FAILED":
            return {"decision": "abort", "status": "ABORT_PIPELINE", "pipeline_status": "FAILED",
                    "reason": completion.get("message", "PIPELINE ABORTADO.")}

        if not completion.get("pipeline_complete", False) or not completion.get("final_analysis_authorized", False):
            missing = completion.get("missing_agents", [])
            total = completion.get("total_required", 0)
            done = completion.get("completed_count", 0)
            missing_str = ", ".join(missing) if missing else "Verificación de procedencia/compuertas"
            return self._bounded_continue(
                conversation_id,
                f"PISOSO HARD GATE: pipeline multiagente incompleto ({done}/{total} completados). Faltan: {missing_str}.",
                case_dir=case_dir
            )

        return {"decision": "allow"}

    # -------------------------------------------------------------
    # 2. FINAL DELIVERABLE GATE (PreToolUse)
    # -------------------------------------------------------------
    def evaluate_pre_tool_use(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        transcript_path = payload.get("transcriptPath")
        tool_call = payload.get("toolCall", {})
        tool_name = tool_call.get("name", "")
        args = tool_call.get("args", {})

        # Scoping check
        if not self.is_pisoso_session_active(transcript_path, payload):
            return {"decision": "allow"}

        is_final_deliverable_attempt = False
        target_file = ""

        if tool_name == "write_to_file":
            target_file = args.get("TargetFile", "")
            is_docx_or_pdf = target_file.lower().endswith(".docx") or target_file.lower().endswith(".pdf")
            is_final_report = any(k in os.path.basename(target_file).lower() for k in ["informe_final", "concepto_final", "entrega_final", "actuacion_final"])
            is_case_root_deliverable = ("/cases/" in target_file and "/trabajo_interno/" not in target_file and (is_docx_or_pdf or is_final_report))

            if is_docx_or_pdf or is_final_report or is_case_root_deliverable:
                if "/scratch/" not in target_file and "test_" not in os.path.basename(target_file):
                    is_final_deliverable_attempt = True

        elif tool_name == "run_command":
            cmd = args.get("CommandLine", "")
            if any(script in cmd for script in ["markdown_to_docx.py", "generate_docx_reports.py", "compile_clean_docx", "pandoc"]):
                is_final_deliverable_attempt = True

        if not is_final_deliverable_attempt:
            return {"decision": "allow"}

        # It IS an attempt to produce a final deliverable -> Check authorization
        user_prompt = self.extract_latest_user_prompt(transcript_path)
        case_dir = self.find_active_case_dir(user_prompt, transcript_path, target_file=target_file,
                                             conversation_id=payload.get("conversationId"))

        if not case_dir:
            return {
                "decision": "deny",
                "reason": "PISOSO HARD GATE: Generación de entregables finales denegada. No existe expediente activo verificado."
            }

        completion = self.entrypoint.calculate_pipeline_completion(case_dir)
        if not completion.get("final_deliverable_authorized", False):
            missing = completion.get("missing_agents", [])
            return {
                "decision": "deny",
                "reason": f"PISOSO HARD GATE: Generación de entregables finales bloqueada. Pipeline incompleto. Faltan: {', '.join(missing)}."
            }

        return {"decision": "allow"}

    # -------------------------------------------------------------
    # 3. PRE-INVOCATION GATE & DISPATCH INJECTION
    # -------------------------------------------------------------
    def evaluate_pre_invocation(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        transcript_path = payload.get("transcriptPath")
        if not self.is_pisoso_session_active(transcript_path, payload):
            return {}

        user_prompt = self.extract_latest_user_prompt(transcript_path)
        if not user_prompt:
            return {}

        req_type = self.entrypoint.detect_request_type(user_prompt)
        risk_level = self.entrypoint.classify_risk_level(user_prompt, req_type)

        if req_type == "SIMPLE_QUERY" or risk_level == "SIMPLE":
            return {}

        conversation_id = payload.get("conversationId")
        state = self._load_state(conversation_id)

        # --- ANTI-AMPLIFICATION GUARDS (v5.4.1) ---
        # (a) Never inject the dispatch mandate more than once per conversation.
        if state.get("dispatch_injected"):
            return {}
        # (b) Never inject once orchestration has begun (a plan already exists):
        #     this is what prevented every `self`-clone and every later turn from
        #     receiving "your first act must be invoke_subagent OLA 1 + OLA 2",
        #     which was recursively re-spawning waves (the 1671-invocation blowup).
        if self._any_active_plan_exists():
            return {}
        # (c) If the mandate is already present in the transcript, do not repeat it.
        if transcript_path and os.path.exists(transcript_path):
            try:
                with open(transcript_path, "r", encoding="utf-8") as f:
                    if self.DISPATCH_SENTINEL in f.read():
                        return {}
            except Exception:
                pass

        case_dir = self.find_active_case_dir(user_prompt, transcript_path, conversation_id=conversation_id)
        if case_dir:
            completion = self.entrypoint.calculate_pipeline_completion(case_dir)
            if completion.get("pipeline_complete", False):
                return {}

        state["dispatch_injected"] = True
        self._save_state(conversation_id, state)

        msg = (
            "⚡ [PISOSO GOBERNANZA EJECUTABLE - MANDATO DE DESPACHO MULTIAGENTE INMEDIATO]:\n"
            "Se ha detectado un asunto de complejidad MATERIAL / HIGH_STAKES.\n"
            "1. ZERO_TEXT_ON_TURN_1: Está estrictamente PROHIBIDO emitir análisis, dictámenes o texto sustantivo en este turno sin haber ejecutado las olas de subagentes.\n"
            "2. ACCIÓN OBLIGATORIA: Tu primer acto técnico en este turno DEBE ser llamar a 'invoke_subagent' para desplegar concurrentemente la OLA 1 (01-intake-y-clasificador, 03-investigador-normativo) y la OLA 2 (especialistas sustanciales).\n"
            "3. Utiliza TypeName='<agente-id>' (el tipo de subagente REGISTRADO con subagent:true, p.ej. TypeName='01-intake-y-clasificador'). PROHIBIDO TypeName='self' (clona al orquestador y dispara recursión). Asigna a cada subagente su Model ('flash_lite', 'flash', 'pro')."
        )
        return {"injectSteps": [{"ephemeralMessage": msg}]}


def main():
    parser = argparse.ArgumentParser(description="Pisoso Legal AI — Runtime Hook Enforcer")
    parser.add_argument("--event", required=True, choices=["Stop", "PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation"])
    args = parser.parse_args()

    raw_input = sys.stdin.read()
    if not raw_input.strip():
        print(json.dumps({"decision": "allow"} if args.event != "PreInvocation" else {}))
        return

    try:
        payload = json.loads(raw_input)
    except Exception:
        print(json.dumps({"decision": "allow"} if args.event != "PreInvocation" else {}))
        return

    enforcer = PisosoRuntimeHookEnforcer()

    if args.event == "Stop":
        result = enforcer.evaluate_stop_gate(payload)
    elif args.event == "PreToolUse":
        result = enforcer.evaluate_pre_tool_use(payload)
    elif args.event == "PreInvocation":
        result = enforcer.evaluate_pre_invocation(payload)
    else:
        result = {"decision": "allow"}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
