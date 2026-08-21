#!/usr/bin/env python3
"""
Synthetic tests for the Pisoso External Orchestrator (Option B).
Uses a TEMP PISOSO_CASES_ROOT (never touches real cases).
Backend auto-select: GeminiAPIBackend if GEMINI_API_KEY is set (REAL model exec),
else LocalPlumbingBackend (NON-MODEL plumbing verification only).

Run REAL model executions:
  GEMINI_API_KEY=<your_ai_studio_key> python3 test_external_orchestrator.py
"""
import os, sys, tempfile, json, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pisoso_external_orchestrator import (PisosoExternalOrchestrator, LocalPlumbingBackend,
                                          GeminiAPIBackend, FORBIDDEN)

os.environ.setdefault("PISOSO_CASES_ROOT", os.path.join(tempfile.mkdtemp(), "cases"))
os.environ.setdefault("PISOSO_AGENTS_DIR", "/Users/edergope/Documents/Pisoso Legal/.agents/agents")


def main():
    gem = GeminiAPIBackend()
    backend = gem if gem.available() else LocalPlumbingBackend()
    orch = PisosoExternalOrchestrator(backend)

    def new_case(cid, text):
        cdir = os.path.join(orch.ep.cases_dir, cid)
        os.makedirs(os.path.join(cdir, "trabajo_interno", "md"), exist_ok=True)
        orch.ep.generate_orchestration_plan(cid, text, "NEW_MATTER", "HIGH_STAKES", cdir)
        return cdir

    def completed(cdir):
        ex = json.load(open(os.path.join(cdir, "trabajo_interno", "AGENT_EXECUTION_LEDGER.json")))["executions"]
        return {s: e for s, e in ex.items() if e.get("status") == "COMPLETED"}

    R = {}
    c1 = new_case("SYN-EXT-1", "revisar contrato comercial de prestacion de servicios")
    r01 = orch.dispatch(c1, "01-intake-y-clasificador", "Intake trivial de prueba tecnica.")
    comp1 = completed(c1)
    R["TEST1"] = (r01["dispatched"] and r01["status"] == "COMPLETED" and r01["invocation_id"]
                  and not r01["invocation_id"].startswith(("fake", "inv-auto", "inv-manual"))
                  and os.path.exists(os.path.join(c1, "trabajo_interno", "md", r01["artifact"]))
                  and list(comp1.keys()) == ["01-intake-y-clasificador"])

    c2 = new_case("SYN-EXT-2", "revisar contrato comercial de prestacion de servicios")
    spec = json.load(open(os.path.join(c2, "trabajo_interno", "ORCHESTRATION_PLAN.json")))["substantive_specialists"][0]
    early = orch.dispatch(c2, spec, "no aun")
    d01 = orch.dispatch(c2, "01-intake-y-clasificador", "intake")
    d03 = orch.dispatch(c2, "03-investigador-normativo-jurisprudencial", "investigacion")
    dspec = orch.dispatch(c2, spec, "analisis contractual")
    comp2 = completed(c2)
    no_forbidden = all(f not in json.dumps(comp2).lower() for f in FORBIDDEN)
    ids = [e["invocation_id"] for e in comp2.values()]
    R["TEST2"] = ((not early["dispatched"]) and early["block"].get("code") == "WAVE_ORDER_VIOLATION"
                  and d01["dispatched"] and d03["dispatched"] and dspec["dispatched"]
                  and set(comp2.keys()) == {"01-intake-y-clasificador",
                                            "03-investigador-normativo-jurisprudencial", spec}
                  and len(comp2) == 3
                  and all(i and not i.startswith(("fake", "inv-auto", "inv-manual")) for i in ids)
                  and no_forbidden)

    print("BACKEND:", backend.kind, "| REAL_MODEL:", backend.kind == "gemini_api")
    print("TEST1 (01 -> return -> STOP):", "PASS" if R["TEST1"] else "FAIL")
    print("TEST2 (01+03 -> FOUNDATION -> specialist -> STOP):", "PASS" if R["TEST2"] else "FAIL")
    shutil.rmtree(os.path.dirname(orch.ep.cases_dir), ignore_errors=True)
    sys.exit(0 if all(R.values()) else 1)


if __name__ == "__main__":
    main()
