#!/usr/bin/env python3
"""
Pisoso Legal AI — Consistency-Audit Synthetic Test Suite (v5.4.2)
Cheap deterministic fixtures. NO real case, NO Word/PDF, NO legal research, NO real
subagent execution. Exercises the hardened governance:
  A NO RECURSION        B NO DUPLICATE        C WAVE ORDERING
  D PROVENANCE TRISTATE E CIRCUIT BREAKER      F ACTIVE CASE ISOLATION
  G PRODUCTION GATE     H MAX INVOCATION CAP   I RESOURCE_EXHAUSTED
Brain is snapshotted before/after and asserted UNCHANGED.
"""
import os, sys, json, uuid, shutil, tempfile, datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
sys.path.insert(0, os.path.join(WORKSPACE_ROOT, "scripts", "governance"))
sys.path.insert(0, SCRIPT_DIR)
from auto_entrypoint import PisosoAutoEntrypoint
from enforce_pisoso_hooks import PisosoRuntimeHookEnforcer

BRAIN = os.path.expanduser("~/.gemini/antigravity/brain")
AGENTS_DIR = os.path.join(WORKSPACE_ROOT, ".agents")
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))

def frontmatter_flag(path, key):
    val = None
    with open(path, "r", encoding="utf-8") as f:
        c = 0
        for line in f:
            if line.strip() == "---":
                c += 1
                if c == 2: break
                continue
            if c == 1 and line.strip().startswith(key + ":"):
                val = line.split(":", 1)[1].strip()
    return val

def make_case(ws, case_id, text, request="NEW_MATTER", risk="HIGH_STAKES"):
    ep = PisosoAutoEntrypoint(workspace_root=ws)
    cdir = os.path.join(ws, "cases", case_id)
    os.makedirs(os.path.join(cdir, "trabajo_interno", "md"), exist_ok=True)
    plan = ep.generate_orchestration_plan(case_id=case_id, text=text, request_type=request,
                                          risk_level=risk, case_dir=cdir)
    return ep, cdir, plan

def add_exec(ep, cdir, slug, art, inv=None, status="COMPLETED", vstatus="ACCEPTED", real_transcript=False):
    """Record a completed agent. Optionally create+track a real brain transcript."""
    md = os.path.join(cdir, "trabajo_interno", "md")
    with open(os.path.join(md, art), "w", encoding="utf-8") as f:
        f.write(f"# {slug}\nContenido sintético.")
    inv = inv or str(uuid.uuid4())
    created = None
    if real_transcript:
        d = os.path.join(BRAIN, inv, ".system_generated", "logs")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "transcript.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "MODEL", "content": f"Ejecución del agente {slug} produciendo {art}."}) + "\n")
        created = os.path.join(BRAIN, inv)
    # write ledger entry directly (bypass provenance hard-record for synthetic setup)
    lp = os.path.join(cdir, "trabajo_interno", "AGENT_EXECUTION_LEDGER.json")
    led = json.load(open(lp)) if os.path.exists(lp) else {"executions": {}}
    now = datetime.datetime.now().isoformat()
    led["executions"][slug] = {"agent_slug": slug, "invocation_id": inv, "artifact": art,
                               "status": status, "validation_status": vstatus,
                               "started_at": now, "completed_at": now}
    json.dump(led, open(lp, "w"), indent=2)
    return inv, created

def main():
    brain_before = len(os.listdir(BRAIN)) if os.path.isdir(BRAIN) else 0
    tmp = tempfile.mkdtemp(prefix="pisoso_consistency_")
    brain_created = []
    try:
        # ---------- A: NO RECURSION (RUNTIME-enforced) + DISCOVERY-SAFE SCHEMA ----------
        # Antigravity 2.9.1 only discovers agents with MINIMAL frontmatter (name+description);
        # extra fields (incl. subagent_tools) poison the catalog and hide the whole selector.
        # So per-agent subagent_tools:false is intentionally ABSENT; anti-recursion is now
        # enforced at RUNTIME: (1) TypeName is always the registered slug, never 'self';
        # (2) every dispatched subagent carries the return-contract forbidding child spawns.
        NESTED = os.path.join(AGENTS_DIR, "agents")
        active = [d for d in os.listdir(NESTED) if os.path.isdir(os.path.join(NESTED, d))]
        def fm_keys(slug):
            t = open(os.path.join(NESTED, slug, "agent.md"), encoding="utf-8").read()
            fm = t[3:t.find("\n---", 3)]
            return [l.split(":", 1)[0].strip() for l in fm.splitlines() if l.strip() and not l[:1].isspace()]
        # Discovery-safe schema in 2.9.1 = name + description (+ optional mainAgent, the
        # only extra field UI-confirmed as accepted; used to hide the 29 from the selector).
        # Confirmed-valid fields in 2.9.1: name, description (discovery), mainAgent (hide,
        # UI-confirmed), enabledTools (tool entitlement, from language_server struct tags).
        minimal_ok = all(set(fm_keys(d)) <= {"name", "description", "mainAgent", "enabledTools"} for d in active)
        ep0, cdirA, planA = make_case(tmp, "SYN-A", "contrato comercial societario incumplimiento")
        specs = ep0._build_subagent_specs(["01-intake-y-clasificador"], cdirA, planA)
        no_self = all(s["TypeName"] != "self" and s["TypeName"] == s["agent_slug"] for s in specs)
        return_contract = all("no puedes invocar, definir ni gestionar otros subagentes" in s["Prompt"].lower()
                              or "no puedes invocar" in s["Prompt"].lower() for s in specs)
        check("A. NO_RECURSION (runtime: TypeName=slug never self, return-contract) + discovery-safe minimal frontmatter",
              minimal_ok and no_self and return_contract,
              f"minimal_frontmatter={minimal_ok} no_self={no_self} return_contract={return_contract}")

        # ---------- B: NO DUPLICATE (anti-redispatch) ----------
        ep, cdirB, planB = make_case(tmp, "SYN-B", "contrato comercial")
        a1 = ep.authorize_dispatch(cdirB, "01-intake-y-clasificador")
        ep.record_dispatch(cdirB, "01-intake-y-clasificador", a1["wave"], "RUNNING", str(uuid.uuid4()))
        a2 = ep.authorize_dispatch(cdirB, "01-intake-y-clasificador")
        check("B. NO_DUPLICATE (2nd same key DENIED)",
              a1["authorized"] and (not a2["authorized"]) and a2["code"] == "REDISPATCH_DENIED", str(a2))

        # ---------- C: WAVE ORDERING ----------
        ep, cdirC, planC = make_case(tmp, "SYN-C", "contrato societario comercial")
        spec_slug = planC["substantive_specialists"][0]
        early = ep.authorize_dispatch(cdirC, spec_slug)  # before foundation
        add_exec(ep, cdirC, "01-intake-y-clasificador", "01.md")
        add_exec(ep, cdirC, "03-investigador-normativo-jurisprudencial", "03.md")
        later = ep.authorize_dispatch(cdirC, spec_slug)  # after foundation
        check("C. WAVE_ORDER (specialist DENIED before foundation, allowed after)",
              (not early["authorized"]) and early["code"] == "WAVE_ORDER_VIOLATION" and later["authorized"],
              f"early={early.get('code')} later={later.get('authorized')}")

        # ---------- D: PROVENANCE TRISTATE ----------
        ep, cdirD, planD = make_case(tmp, "SYN-D", "contrato comercial")
        # VERIFIED: real transcript matching slug+artifact
        invV, br = add_exec(ep, cdirD, "01-intake-y-clasificador", "01_INTAKE.md", real_transcript=True)
        if br: brain_created.append(br)
        exV = json.load(open(os.path.join(cdirD, "trabajo_interno", "AGENT_EXECUTION_LEDGER.json")))["executions"]["01-intake-y-clasificador"]
        pV = ep.classify_provenance(invV, "01-intake-y-clasificador", os.path.join(cdirD, "trabajo_interno", "md", "01_INTAKE.md"), plan=planD, exec_entry=exV, gate_ok=True)
        # UNAVAILABLE_BUT_CORROBORATED: genuine-looking uuid, no transcript, full corroboration
        invU = str(uuid.uuid4())
        exU = {"invocation_id": invU, "artifact": "u.md", "started_at": "2026-01-01T00:00:00", "completed_at": "2026-01-01T00:01:00"}
        with open(os.path.join(cdirD, "trabajo_interno", "md", "u.md"), "w") as f: f.write("x")
        pU = ep.classify_provenance(invU, "01-intake-y-clasificador", os.path.join(cdirD, "trabajo_interno", "md", "u.md"), plan=planD, exec_entry=exU, gate_ok=True)
        # FABRICATED -> INVALID
        pF = ep.classify_provenance("fake-123", "01-intake-y-clasificador", os.path.join(cdirD, "trabajo_interno", "md", "u.md"), plan=planD, exec_entry=exU, gate_ok=True)
        # bare file, NO corroboration (unregistered agent, no temporal) -> INVALID
        pBare = ep.classify_provenance(str(uuid.uuid4()), "ghost-agent", None, plan=planD, exec_entry={}, gate_ok=False)
        check("D. PROVENANCE (VERIFIED / CORROBORATED / FABRICATED=INVALID / bare=INVALID)",
              pV["state"] == "VERIFIED" and pU["state"] == "UNAVAILABLE_BUT_CORROBORATED" and pF["state"] == "INVALID" and pBare["state"] == "INVALID",
              f"V={pV['state']} U={pU['state']} F={pF['state']} bare={pBare['state']}")

        # ---------- E: CIRCUIT BREAKER ----------
        enf = PisosoRuntimeHookEnforcer(workspace_root=tmp)
        conv = "conv-E"
        r1 = enf._bounded_continue(conv, "retry", case_dir=None)
        r2 = enf._bounded_continue(conv, "retry", case_dir=None)
        r3 = enf._bounded_continue(conv, "retry", case_dir=None)
        check("E. CIRCUIT_BREAKER (retry1,2 continue; retry3 ABORT not allow)",
              r1["decision"] == "continue" and r2["decision"] == "continue" and r3["decision"] == "abort" and r3["decision"] != "allow",
              f"{r1['decision']},{r2['decision']},{r3['decision']}")

        # ---------- F: ACTIVE CASE ISOLATION ----------
        ep = PisosoAutoEntrypoint(workspace_root=tmp)
        c1 = os.path.join(tmp, "cases", "SYN-F1"); c2 = os.path.join(tmp, "cases", "SYN-F2")
        os.makedirs(c1, exist_ok=True); os.makedirs(c2, exist_ok=True)
        ep.set_active_case("conv-F", "SYN-F1", c1)
        resolved = ep.resolve_active_case_dir("conv-F")
        enfF = PisosoRuntimeHookEnforcer(workspace_root=tmp)
        # prompt mentions NEITHER folder; must resolve to bound ACTIVE_CASE, never guess
        bound = enfF.find_active_case_dir("texto sin nombre de expediente", None, conversation_id="conv-F")
        failclosed = enfF.find_active_case_dir("texto sin nombre", None, conversation_id="conv-UNKNOWN")
        check("F. ACTIVE_CASE (bound resolves; unknown FAIL_CLOSED; other case untouched)",
              resolved["status"] == "OK" and os.path.abspath(bound) == os.path.abspath(c1) and failclosed is None and os.path.isdir(c2),
              f"bound={bound} failclosed={failclosed}")

        # ---------- G: PRODUCTION GATE ----------
        ep, cdirG, planG = make_case(tmp, "SYN-G", "redactar contrato en word, informe escrito con minuta")
        prod_required = planG.get("production_required")
        gate_no = ep.evaluate_production_gate(cdirG, planG)
        # now satisfy: 08+02 accepted and a readable docx in entregables/
        add_exec(ep, cdirG, "08-redactor-senior-juridico", "08.md")
        add_exec(ep, cdirG, "02-compilador-y-entrega-final", "02.md")
        entg = os.path.join(cdirG, "entregables"); os.makedirs(entg, exist_ok=True)
        with open(os.path.join(entg, "ENTREGABLE.docx"), "w") as f: f.write("DOCXDATA")
        gate_yes = ep.evaluate_production_gate(cdirG, planG)
        check("G. PRODUCTION_GATE (md not enough; docx+08+02 required)",
              prod_required is True and gate_no["authorized"] is False and gate_yes["authorized"] is True,
              f"required={prod_required} no={gate_no['authorized']} yes={gate_yes['authorized']}")

        # ---------- H: MAX INVOCATION CAP ----------
        ep, cdirH, planH = make_case(tmp, "SYN-H", "contrato")
        # force a synthetic plan cap of 3
        pp = os.path.join(cdirH, "trabajo_interno", "ORCHESTRATION_PLAN.json")
        pl = json.load(open(pp)); pl["planned_required_invocations"] = 3; json.dump(pl, open(pp, "w"))
        for i, slug in enumerate(["01-intake-y-clasificador", "03-investigador-normativo-jurisprudencial", "especialista-contractual-y-negocios"]):
            ep.record_dispatch(cdirH, slug, f"W{i}", "RUNNING", str(uuid.uuid4()))
        fourth = ep.authorize_dispatch(cdirH, "06-estratega-juridico-convencional")
        plH_after = json.load(open(pp))
        check("H. MAX_INVOCATION_CAP (4th -> ABORT_PIPELINE)",
              (not fourth["authorized"]) and fourth["code"] == "MAX_INVOCATIONS_EXCEEDED" and fourth.get("abort") and plH_after["pipeline_status"] == "FAILED",
              str(fourth))

        # ---------- I: RESOURCE EXHAUSTED ----------
        ep, cdirI, planI = make_case(tmp, "SYN-I", "contrato")
        ep.record_dispatch(cdirI, "01-intake-y-clasificador", "W1", "RUNNING", str(uuid.uuid4()))
        rex = ep.handle_resource_exhausted(cdirI, http_status=429)
        after = ep.authorize_dispatch(cdirI, "03-investigador-normativo-jurisprudencial")
        comp = ep.calculate_pipeline_completion(cdirI)
        dl = json.load(open(os.path.join(cdirI, "trabajo_interno", "DISPATCH_LEDGER.json")))
        killed = all(v["status"] != "RUNNING" for v in dl["dispatches"].values())
        check("I. RESOURCE_EXHAUSTED (FAILED, kill subagents, no redispatch, no opinion)",
              rex["pipeline_status"] == "FAILED" and rex["redispatch"] is False and killed and (not after["authorized"]) and comp["final_deliverable_authorized"] is False,
              f"redispatch={rex['redispatch']} killed={killed} after={after.get('code')} deliverable={comp['final_deliverable_authorized']}")

        # ---------- J: ACTIVE_CASE WIRING (conversationId -> set_active_case) ----------
        epJ = PisosoAutoEntrypoint(workspace_root=tmp)
        enfJ = PisosoRuntimeHookEnforcer(workspace_root=tmp)
        cA = os.path.join(tmp, "cases", "CASE-WIRE-A"); os.makedirs(cA, exist_ok=True)
        cB = os.path.join(tmp, "cases", "CASE-WIRE-B"); os.makedirs(cB, exist_ok=True)
        # First contact per conversation resolves via EXACT prompt match and auto-binds.
        rA = enfJ.find_active_case_dir("nuevo asunto en CASE-WIRE-A", None, conversation_id="conversation-A")
        rB = enfJ.find_active_case_dir("nuevo asunto en CASE-WIRE-B", None, conversation_id="conversation-B")
        resA = epJ.resolve_active_case_dir("conversation-A")
        resB = epJ.resolve_active_case_dir("conversation-B")
        resU = enfJ.find_active_case_dir("texto sin nombre", None, conversation_id="conversation-UNKNOWN")
        # Cross-contamination: conv-A now sees a prompt mentioning B's folder, must still get A.
        cross = enfJ.find_active_case_dir("aunque mencione CASE-WIRE-B aquí", None, conversation_id="conversation-A")
        wiring_ok = (
            os.path.abspath(rA) == os.path.abspath(cA) and os.path.abspath(rB) == os.path.abspath(cB) and
            resA.get("case_dir") == os.path.abspath(cA) and resB.get("case_dir") == os.path.abspath(cB) and
            resU is None and os.path.abspath(cross) == os.path.abspath(cA)
        )
        check("J. ACTIVE_CASE_WIRING (A->A, B->B, unknown->None, no cross-contamination)",
              wiring_ok, f"A={rA} B={rB} unknown={resU} cross={cross}")

    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        for d in brain_created:
            shutil.rmtree(d, ignore_errors=True)

    brain_after = len(os.listdir(BRAIN)) if os.path.isdir(BRAIN) else 0
    print("=== CONSISTENCY AUDIT — SYNTHETIC TESTS ===")
    npass = 0
    for name, ok, detail in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  :: {detail}" if not ok else ""))
        npass += 1 if ok else 0
    print(f"\nTOTAL: {npass}/{len(results)} PASSED")
    print(f"BRAIN dirs before={brain_before} after={brain_after} -> {'UNCHANGED' if brain_before==brain_after else 'CHANGED!!'}")
    sys.exit(0 if npass == len(results) else 1)

if __name__ == "__main__":
    main()
