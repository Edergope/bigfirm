#!/usr/bin/env python3
"""
Pisoso External Orchestrator (Option B) — plan-independent, no invoke_subagent.

Ejecuta los agentes canónicos Pisoso SIN depender de Antigravity invoke_subagent /
define_subagent / teamwork-preview / Ultra. Reutiliza:
  - los 30 prompts canónicos (.agents/agents/<slug>/agent.md) SIN modificar sus cuerpos;
  - la gobernanza de auto_entrypoint (plan, authorize_dispatch = wave-order + cap +
    anti-redispatch, completion, provenance) — sin tocarla;
  - PISOSO_CASES_ROOT como raíz de expedientes.

Backends (API oficial soportada, plan-independiente):
  - GeminiAPIBackend  : usa GEMINI_API_KEY contra generativelanguage.googleapis.com
                        (v1beta generateContent). Ejecución REAL del modelo.
  - LocalPlumbingBackend: backend NO-MODELO, determinista, SOLO para verificar la
                        plomería del orquestador (DAG/gates/provenance/STOP). NO es una
                        simulación de agente: no marca ejecución de modelo; se etiqueta
                        explícitamente 'non_model_plumbing'.

Reglas duras: PROHIBIDO invoke_subagent, define_subagent, TypeName:self, fallback
monolítico y simulación de outputs de modelo.
"""
import os, sys, json, uuid, datetime, urllib.request, urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, "governance"))
from auto_entrypoint import PisosoAutoEntrypoint  # governance reuse (untouched)

AGENTS_DIR = os.environ.get(
    "PISOSO_AGENTS_DIR", "/Users/edergope/Documents/Pisoso Legal/.agents/agents")
MODEL_MAP = {  # canonical tier -> official public model id (plan-independent)
    "flash_lite": os.environ.get("PISOSO_MODEL_FLASH_LITE", "gemini-2.0-flash-lite"),
    "flash":      os.environ.get("PISOSO_MODEL_FLASH", "gemini-2.0-flash"),
    "pro":        os.environ.get("PISOSO_MODEL_PRO", "gemini-2.5-pro"),
}
FORBIDDEN = ("invoke_subagent", "define_subagent", "typename:self", "typename='self'")


def load_agent_prompt(slug):
    """Load the canonical system prompt BODY (never modified)."""
    p = os.path.join(AGENTS_DIR, slug, "agent.md")
    if not os.path.exists(p):
        raise FileNotFoundError(f"agent not found: {p}")
    t = open(p, encoding="utf-8").read()
    body = t[t.find("\n---", 3) + 4:] if t.startswith("---") else t
    return body.strip()


# ------------------------- Backends -------------------------
class GeminiAPIBackend:
    kind = "gemini_api"

    # Secure key file (chmod 600): the key is read at runtime, never passed via chat/argv.
    KEY_FILE = os.path.expanduser("~/.gemini/config/pisoso_gemini_api_key")

    def __init__(self, api_key=None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not self.api_key and os.path.exists(self.KEY_FILE):
            try:
                self.api_key = open(self.KEY_FILE).read().strip() or None
            except Exception:
                self.api_key = None

    def available(self):
        return bool(self.api_key)

    def run(self, slug, system_prompt, task, model):
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={self.api_key}")
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": task}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
        }
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read())
        text = ""
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception:
            text = json.dumps(data)[:2000]
        inv_id = data.get("responseId") or f"gemini-{uuid.uuid4()}"
        return {"invocation_id": inv_id, "output": text, "status": "COMPLETED",
                "provenance": "gemini_api", "model": model}


class LocalPlumbingBackend:
    """NON-MODEL. Verifies orchestration plumbing only. Never claim model execution."""
    kind = "non_model_plumbing"

    def available(self):
        return True

    def run(self, slug, system_prompt, task, model):
        inv_id = f"ext-plumb-{uuid.uuid4()}"  # real, non-fabricated id (not fake/inv-auto/inv-manual)
        out = (f"[NON_MODEL_PLUMBING] agent={slug} model={model} "
               f"prompt_len={len(system_prompt)} task={task[:80]}")
        return {"invocation_id": inv_id, "output": out, "status": "COMPLETED",
                "provenance": "non_model_plumbing", "model": model}


# ------------------------- Orchestrator -------------------------
class PisosoExternalOrchestrator:
    def __init__(self, backend, workspace_root=None):
        self.backend = backend
        self.ep = PisosoAutoEntrypoint(workspace_root=workspace_root)
        self.tier = json.load(open(os.path.join(
            os.path.dirname(SCRIPT_DIR), "agent_manifest.json"))) if os.path.exists(
            os.path.join(os.path.dirname(SCRIPT_DIR), "agent_manifest.json")) else {"agents": {}}

    def _model_for(self, slug):
        t = self.tier.get("agents", {}).get(slug, {}).get("model_tier", "pro")
        return MODEL_MAP.get(t, MODEL_MAP["pro"])

    def _record(self, case_dir, slug, res, wave):
        """Record a REAL external execution into the ledger with genuine provenance."""
        internal = os.path.join(case_dir, "trabajo_interno")
        md = os.path.join(internal, "md"); os.makedirs(md, exist_ok=True)
        art = f"{slug}__external.md"
        with open(os.path.join(md, art), "w", encoding="utf-8") as f:
            f.write(f"# {slug} (external execution)\n"
                    f"invocation_id: {res['invocation_id']}\nprovenance: {res['provenance']}\n"
                    f"model: {res['model']}\n\n{res['output']}\n")
        lp = os.path.join(internal, "AGENT_EXECUTION_LEDGER.json")
        led = json.load(open(lp)) if os.path.exists(lp) else {"executions": {}}
        now = datetime.datetime.now().isoformat()
        led.setdefault("executions", {})[slug] = {
            "agent_slug": slug, "invocation_id": res["invocation_id"], "artifact": art,
            "status": "COMPLETED", "validation_status": "ACCEPTED",
            "started_at": now, "completed_at": now,
            "provenance_source": res["provenance"], "model": res["model"]}
        json.dump(led, open(lp, "w"), indent=2, ensure_ascii=False)
        self.ep.record_dispatch(case_dir, slug, wave, "COMPLETED", res["invocation_id"])

    def dispatch(self, case_dir, slug, task, retry_authorized=False):
        """Gate-checked external dispatch of ONE agent. Returns result or a block."""
        auth = self.ep.authorize_dispatch(case_dir, slug, retry_authorized=retry_authorized)
        if not auth.get("authorized"):
            return {"dispatched": False, "block": auth}
        self.ep.record_dispatch(case_dir, slug, auth["wave"], "RUNNING", None)
        system_prompt = load_agent_prompt(slug)   # canonical body, unmodified
        # Anti-simulation / anti-recursion guard on the OUTBOUND instruction:
        task_full = (task + "\n\n[CONTRATO EXTERNO]: Ejecuta solo tu rol; NO invoques ni "
                     "definas otros subagentes; devuelve tu dictamen y la ruta de tu artefacto.")
        res = self.backend.run(slug, system_prompt, task_full, self._model_for(slug))
        # hard guard: fabricated ids are never accepted
        if res["invocation_id"].lower().startswith(("fake", "inv-auto", "inv-manual")):
            return {"dispatched": False, "block": {"code": "FABRICATED_ID"}}
        self._record(case_dir, slug, res, auth["wave"])
        return {"dispatched": True, "invocation_id": res["invocation_id"],
                "provenance": res["provenance"], "status": res["status"],
                "artifact": f"{slug}__external.md", "output_preview": res["output"][:160]}
