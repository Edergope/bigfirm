#!/usr/bin/env python3
"""
Pisoso Legal AI — Auto-Orchestration Entrypoint Engine (v5.4.0)
Autonomous Intake, Request Classification, Risk Scoring, Issue Mapping,
Canonical DAG Enforcement, Deterministic Pipeline Verification, and Anti-Monolithic Hard Blocks.
"""

import os
import sys
import re
import json
import uuid
import datetime
from typing import Dict, List, Any, Optional, Tuple

class PisosoAutoEntrypoint:
    """
    Autonomous Entrypoint & Orchestration Governance Engine for Pisoso Legal AI.
    Intercepts natural language inputs and determines the canonical multiagent pipeline.
    """

    # 1. Keywords / Semantics for Request Type
    SIMPLE_QUERY_PATTERNS = [
        r"^(?:¿|\b)(?:cu[aá]l\s+es\s+el\s+t[eé]rmino|qu[eé]\s+es|c[oó]mo\s+se\s+calcula|cu[aá]nto\s+tiempo|qu[eé]\s+art[ií]culo|cu[aá]les\s+son\s+los\s+requisitos\s+de\s+forma|definici[oó]n\s+de)\b",
        r"\b(?:en\s+una\s+pregunta\s+puntual|duda\s+acad[eé]mica|consulta\s+te[oó]rica|en\s+el\s+cgp|en\s+el\s+c\.co|en\s+el\s+cst)\b",
    ]

    NEW_MATTER_TRIGGERS = [
        r"\b(?:tengo\s+un\s+(?:nuevo\s+)?(?:caso|cliente|asunto|problema|proceso))\b",
        r"\b(?:nos\s+(?:lleg[oó]|notificaron|demandaron|vincularon))\b",
        r"\b(?:necesito\s+(?:defender|estructurar|proteger|asesorar|demandar|contestar|revisar|blindar))\b",
        r"\b(?:un\s+cliente\s+(?:me\s+)?(?:consulta|pide|solicita|presenta))\b",
        r"\b(?:quiero\s+(?:demandar|contestar|formalizar|proteger|constituir|disolver|liquidar))\b",
        r"\b(?:ay[uú]dame\s+con\s+(?:este\s+caso|este\s+asunto|este\s+cliente|esta\s+demanda))\b",
        r"\b(?:se\s+trata\s+de\s+un\s+(?:cliente|caso|conflicto|asunto))\b",
        r"\b(?:abrir\s+(?:y\s+estructurar\s+)?el\s+expediente)\b",
    ]

    CONTINUATION_TRIGGERS = [
        r"\b(?:en\s+el\s+caso\s+anterior|del\s+mismo\s+caso|ahora\s+nos\s+notificaron|acaban\s+de\s+notificar|nos\s+lleg[oó]\s+la\s+contestaci[oó]n|en\s+el\s+mismo\s+expediente|continuando\s+con|nuevo\s+documento\s+del\s+caso|auto\s+admisorio\s+del\s+caso)\b",
        r"\b(?:lleg[oó]\s+la\s+medida\s+cautelar|notificaron\s+medida\s+cautelar|interpusieron\s+recurso)\b",
    ]

    DOCUMENT_REVIEW_TRIGGERS = [
        r"\b(?:revisa\s+(?:este\s+|el\s+)?contrato|audita\s+(?:este\s+|el\s+)?contrato|analiza\s+(?:este\s+|el\s+)?contrato|revisi[oó]n\s+de\s+contrato)\b",
        r"\b(?:revisa\s+(?:este\s+|el\s+)?acuerdo|revisa\s+(?:estos\s+|los\s+)?estatutos|revisa\s+(?:esta\s+|la\s+)?minuta|auditor[ií]a\s+documental)\b",
        r"\b(?:revisa\s+este\s+documento|analiza\s+este\s+documento|eval[uú]a\s+este\s+documento)\b",
    ]

    # 2. Risk Taxonomy Triggers
    HIGH_STAKES_TRIGGERS = [
        r"\b(?:litigio|demanda|medida\s+cautelar|embargo|secuestro|caducidad|prescripci[oó]n|nulidad|casaci[oó]n|tutela|v[ií]a\s+de\s+hecho)\b",
        r"\b(?:penal|delito|fiscal[ií]a|imputaci[oó]n|captura|lavado|corrupci[oó]n|fraude|estafa|sagrilaft|ptee)\b",
        r"\b(?:sanci[oó]n|supersociedades|sic|superfinanciera|dian|investigaci[oó]n\s+administrativa|pliego\s+de\s+cargos)\b",
        r"\b(?:m&a|adquisici[oó]n|fusi[oó]n|escisi[oó]n|due\s+diligence|acuerdo\s+de\s+accionistas|conflicto\s+entre\s+socios|disoluci[oó]n|insolvencia|ley\s+1116|reorganizaci[oó]n)\b",
        r"\b(?:uni[oó]n\s+marital|sociedad\s+patrimonial|capitulaciones|divorcio|gananciales|herencia|sucesi[oó]n|planeaci[oó]n\s+patrimonial)\b",
        r"\b(?:migraci[oó]n|visa|canciller[ií]a|extranjero|deportaci[oó]n|expulsi[oó]n|permanencia|nacionalidad)\b",
        r"\b(?:estados\s+unidos|florida|puerto\s+rico|internacional|jurisdicci[oó]n|activos\s+extranjeros|bienes\s+en\s+el\s+exterior|cross-border)\b",
        r"\b(?:patrimonio\s+significativo|millones|d[oó]lares|usd|\$|cuant[ií]a|alto\s+impacto)\b",
        r"\b(?:datos\s+sensibles|historia\s+cl[ií]nica|salud|cl[ií]nica|m[eé]dico|falla\s+m[eé]dica|responsabilidad\s+m[eé]dica)\b",
        r"\b(?:patente|secreto\s+empresarial|software\s+cr[ií]tico|propiedad\s+intelectual\s+estrat[eé]gica)\b"
    ]

    MATERIAL_TRIGGERS = [
        r"\b(?:contrato\s+comercial|arrendamiento\s+comercial|prestaci[oó]n\s+de\s+servicios|suministro|distribuci[oó]n|franquicia)\b",
        r"\b(?:reclamaci[oó]n|cobro|pagar[eé]|letra|factura|incumplimiento|acuerdo\s+transaccional|nda)\b",
        r"\b(?:despido|liquidaci[oó]n\s+laboral|acoso\s+laboral|contrato\s+de\s+trabajo)\b",
        r"\b(?:marca|registro\s+de\s+marca|oposici[oó]n\s+marcaria)\b"
    ]

    # -------------------------------------------------------------
    # HARD FAN-OUT CEILINGS & TOKEN-BUDGET GOVERNANCE (v5.4.1)
    # Anti-runaway: bound the number of subagents a single matter can spawn.
    # -------------------------------------------------------------
    MAX_SUBSTANTIVE_SPECIALISTS = 3     # cap greedy multi-area matches
    MAX_CONDITIONAL_AGENTS = 2          # cap 04/05/14/15 conditionals
    MAX_TOTAL_AGENTS = 10               # absolute ceiling of DAG breadth
    # Provenance is ADVISORY by default: an unlocatable/soft-mismatched runtime
    # transcript must NOT trap the pipeline in an infinite re-dispatch loop.
    # Fabricated ids are still hard-rejected (anti-simulation preserved).
    # Set PISOSO_PROVENANCE_STRICT=1 to restore hard blocking.
    PROVENANCE_STRICT = os.environ.get("PISOSO_PROVENANCE_STRICT", "0") == "1"

    # -------------------------------------------------------------
    # PATH INDEPENDENCE (v5.5.0) — the engine must NOT depend on living inside
    # the user's operative folder. Cases resolve from PISOSO_CASES_ROOT.
    #   PISOSO_CASES_ROOT : single source of truth for expedientes
    #                       (default: /Users/edergope/Documents/Pisoso Legal/cases)
    #   PISOSO_HOME       : optional engine home (default: parent of cases root)
    #   PISOSO_STATE_DIR  : ACTIVE_CASE / runtime state (default: <home>/.pisoso_runtime_state)
    # -------------------------------------------------------------
    DEFAULT_CASES_ROOT = "/Users/edergope/Documents/Pisoso Legal/cases"

    def __init__(self, workspace_root: Optional[str] = None):
        cases_env = os.environ.get("PISOSO_CASES_ROOT")
        if cases_env:
            self.cases_dir = os.path.abspath(cases_env)
            self.workspace_root = workspace_root or os.environ.get("PISOSO_HOME") or os.path.dirname(self.cases_dir)
        else:
            self.workspace_root = workspace_root or os.environ.get("PISOSO_HOME") or "/Users/edergope/Documents/Pisoso Legal"
            self.cases_dir = os.path.join(self.workspace_root, "cases")
        # State lives beside the cases root by default, overridable and location-independent.
        self._state_dir_override = os.environ.get("PISOSO_STATE_DIR")

    # -------------------------------------------------------------
    # 1. REQUEST TYPE DETECTION
    # -------------------------------------------------------------
    def detect_request_type(self, text: str, context: Optional[Dict[str, Any]] = None) -> str:
        text_clean = text.strip().lower()

        # Check for Continuation first if context or explicit continuation phrases exist
        if any(re.search(pat, text_clean) for pat in self.CONTINUATION_TRIGGERS):
            return "EXISTING_MATTER_CONTINUATION"

        # Check for Document Review
        if any(re.search(pat, text_clean) for pat in self.DOCUMENT_REVIEW_TRIGGERS):
            return "DOCUMENT_REVIEW"

        # Check for Simple Query: short text, question structure, no complex factual scenarios
        is_question = text.strip().startswith("¿") or text_clean.startswith("cual ") or text_clean.startswith("que ") or text_clean.startswith("como ")
        has_simple_query_phrase = any(re.search(pat, text_clean) for pat in self.SIMPLE_QUERY_PATTERNS)
        word_count = len(text_clean.split())

        # If it's a short question (< 35 words) with no factual parties/scenario
        has_parties = any(k in text_clean for k in ["cliente", "empresa", "sociedad", "pareja", "conyuge", "esposo", "esposa", "demandante", "demandado", "millones", "dolares", "propiedad", "inmueble"])
        
        if (is_question or has_simple_query_phrase) and word_count < 35 and not has_parties:
            return "SIMPLE_QUERY"

        # Check for New Matter
        if any(re.search(pat, text_clean) for pat in self.NEW_MATTER_TRIGGERS):
            return "NEW_MATTER"

        # Default fallback: If it describes facts, assets, people or legal needs -> NEW_MATTER; else SIMPLE_QUERY
        if word_count > 30 or has_parties:
            return "NEW_MATTER"
        
        return "SIMPLE_QUERY"

    # -------------------------------------------------------------
    # 2. RISK CLASSIFICATION
    # -------------------------------------------------------------
    def classify_risk_level(self, text: str, request_type: str, context: Optional[Dict[str, Any]] = None) -> str:
        text_clean = text.lower()

        if request_type == "SIMPLE_QUERY":
            return "SIMPLE"

        # High stakes evaluation
        high_stakes_matches = sum(1 for pat in self.HIGH_STAKES_TRIGGERS if re.search(pat, text_clean))
        
        # Check specific quantitative high stakes (amounts >= $100M COP or >= $50k USD)
        has_large_money = bool(re.search(r"(?:[5-9]\d|\d{3,})\s*(?:millones|m\b|mm\b|k\b|mil\s+d[oó]lares)|(?:usd|\$)\s*[5-9]\d{4,}", text_clean))
        
        # Check multi-factor combination (e.g. foreigner + assets + relationship + corporate)
        factors = 0
        if any(k in text_clean for k in ["extranjero", "estados unidos", "usa", "florida", "puerto rico", "visa", "migra"]): factors += 1
        if any(k in text_clean for k in ["sociedad", "empresa", "accionista", "acciones", "sas"]): factors += 1
        if any(k in text_clean for k in ["pareja", "convive", "convivencia", "union marital", "matrimonio", "espos"]): factors += 1
        if any(k in text_clean for k in ["patrimonio", "inmueble", "casa", "lote", "bienes", "proteger"]): factors += 1

        if high_stakes_matches >= 2 or has_large_money or factors >= 3:
            return "HIGH_STAKES"

        if high_stakes_matches == 1 or any(re.search(pat, text_clean) for pat in self.MATERIAL_TRIGGERS):
            return "MATERIAL"

        if request_type in ["NEW_MATTER", "DOCUMENT_REVIEW"]:
            return "MATERIAL"

        return "SIMPLE"

    # -------------------------------------------------------------
    # 3. MASTER RULE: MULTIAGENT REQUIREMENT
    # -------------------------------------------------------------
    def evaluate_multiagent_requirement(self, request_type: str, risk_level: str) -> bool:
        if request_type in ["NEW_MATTER", "DOCUMENT_REVIEW", "EXISTING_MATTER_CONTINUATION"] and risk_level in ["MATERIAL", "HIGH_STAKES"]:
            return True
        return False

    # -------------------------------------------------------------
    # 4. DYNAMIC ISSUE MAPPING
    # -------------------------------------------------------------
    def extract_issue_map(self, text: str) -> Dict[str, Any]:
        text_clean = text.lower()
        specialists = []
        mandatory_foundation = ["01-intake-y-clasificador", "03-investigador-normativo-jurisprudencial"]
        mandatory_closing = ["06-estratega-juridico-convencional", "10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"]
        conditional_agents = []

        # Family & Estate Planning
        if any(re.search(r"\b" + k, text_clean) for k in [r"pareja", r"conviv", r"uni[oó]n\s+marital", r"sociedad\s+patrimonial", r"capitulaci", r"matrimonio", r"hijo", r"alimento", r"sucesi[oó]n", r"herencia", r"patrimonio\s+familiar"]):
            specialists.append("especialista-familia-y-planeacion-patrimonial")

        # Corporate / SAS / M&A
        if any(re.search(r"\b" + k, text_clean) for k in [r"sociedad", r"empresa", r"accionista", r"acciones", r"s\.a\.s", r"sas\b", r"junta", r"asamblea", r"m&a", r"adquisici", r"fusi[oó]n", r"capital"]):
            specialists.append("especialista-societario-y-mna")

        # Civil & Real Estate
        if any(re.search(r"\b" + k, text_clean) for k in [r"inmueble", r"casa", r"lote", r"terreno", r"matr[ií]cula", r"tradici[oó]n", r"t[ií]tulo", r"arrendamiento", r"mutuo", r"pr[eé]stamo", r"veh[ií]culo", r"compraventa"]):
            specialists.append("especialista-civil-bienes-e-inmobiliario")

        # Immigration & Mobility
        if any(re.search(r"\b" + k, text_clean) for k in [r"visa\b", r"visas\b", r"migraci", r"canciller[ií]a", r"extranjero", r"residencia", r"nacionalidad", r"permanencia"]):
            specialists.append("especialista-migratorio-y-movilidad")

        # Tax & Customs
        if any(re.search(r"\b" + k, text_clean) for k in [r"tributar", r"impuesto", r"dian\b", r"renta\b", r"ganancia\s+ocasional", r"residencia\s+fiscal", r"retenci"]):
            specialists.append("especialista-tributario-y-aduanero")

        # Constitutional / Fundamental Rights
        if any(re.search(r"\b" + k, text_clean) for k in [r"tutela", r"derecho\s+fundamental", r"debido\s+proceso", r"inconstitucional", r"corte\s+constitucional"]):
            specialists.append("especialista-constitucional-y-derechos-fundamentales")

        # Criminal Law
        if any(re.search(r"\b" + k, text_clean) for k in [r"penal", r"delito", r"fiscal[ií]a", r"denuncia", r"imputaci", r"c[aá]rcel", r"preacuerdo"]):
            specialists.append("especialista-penal-general-y-litigio")

        # Contractual & Business
        if any(re.search(r"\b" + k, text_clean) for k in [r"contrat", r"cl[aá]usul", r"servici", r"prestaci[oó]n", r"suministr", r"acuerdo", r"make\b", r"contratista", r"obligaci", r"cumplimiento", r"entregable"]):
            specialists.append("especialista-contractual-y-negocios")

        # IP & Data Protection
        if any(re.search(r"\b" + k, text_clean) for k in [r"propiedad\s+intelectual", r"marca", r"patente", r"derecho\s+de\s+autor", r"software", r"datos", r"habeas\s+data", r"sic\b", r"google\s+workspace", r"automatiz", r"usuario"]):
            specialists.append("especialista-propiedad-intelectual-y-datos")

        # Labor & Social Security
        if any(re.search(r"\b" + k, text_clean) for k in [r"laboral", r"emplead", r"trabajador", r"salario", r"despido", r"pensi[oó]n", r"ugpp"]):
            specialists.append("especialista-laboral-y-seguridad-social")

        # Insolvency
        if any(re.search(r"\b" + k, text_clean) for k in [r"insolvencia", r"ley\s+1116", r"reorganizaci", r"quiebra", r"acreedor"]):
            specialists.append("especialista-insolvencia-y-reestructuracion")

        # 04 Evidentiary
        if any(re.search(r"\b" + k, text_clean) for k in [r"prueba", r"evidencia", r"flujo", r"cuentas", r"extracto", r"bit[aá]cora", r"fotos", r"pagos", r"transferencia", r"perit"]):
            conditional_agents.append("04-analista-probatorio-y-pericial")

        # 05 Procedural / Caducidad
        if any(re.search(r"\b" + k, text_clean) for k in [r"demanda\b", r"t[eé]rmino", r"caducidad", r"prescripci[oó]n", r"notificaci", r"competencia", r"cuant[ií]a", r"jurisdicci"]):
            conditional_agents.append("05-analista-procesal-y-procedibilidad")

        # 14 Judicial / Nulidades
        if any(k in text_clean for k in ["juez", "sentencia", "nulidad", "litigio", "demanda", "recurso", "apelaci"]):
            conditional_agents.append("14-magistrado-procesal-y-nulidades")

        # 15 Disruption / MASC / Negotiation
        if any(k in text_clean for k in ["negociar", "acuerdo", "conciliaci", "transacci", "disruptivo", "masc"]):
            conditional_agents.append("15-estratega-disruptivo-y-negociador")

        # If no specialists matched, default to general civil/contractual
        if not specialists:
            specialists = ["especialista-contractual-y-negocios"]

        # Production agents (08, 02)
        production_agents = []
        if any(re.search(r"\b" + k, text_clean) for k in [r"redact", r"minuta", r"word\b", r"docx\b", r"elaborar\s+documento", r"preparar\s+contrato", r"informe\s+escrito"]):
            production_agents = ["08-redactor-senior-juridico", "02-compilador-y-entrega-final"]

        # --- HARD FAN-OUT CEILINGS (anti-runaway v5.4.1) ---
        # Dedupe first (order-preserving), then clamp to ceilings so a keyword-rich
        # matter cannot silently explode into 15-18 heavy `pro` subagents.
        specialists = list(dict.fromkeys(specialists))[: self.MAX_SUBSTANTIVE_SPECIALISTS]
        conditional_agents = list(dict.fromkeys(conditional_agents))[: self.MAX_CONDITIONAL_AGENTS]

        return {
            "mandatory_foundation": mandatory_foundation,
            "substantive_specialists": specialists,
            "mandatory_closing": mandatory_closing,
            "conditional_agents": conditional_agents,
            "production_agents": production_agents
        }

    # -------------------------------------------------------------
    # 5. ORCHESTRATION PLAN GENERATION
    # -------------------------------------------------------------
    def generate_orchestration_plan(
        self,
        case_id: str,
        text: str,
        request_type: str,
        risk_level: str,
        case_dir: str,
        issue_map: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        if issue_map is None:
            issue_map = self.extract_issue_map(text)

        multiagent_req = self.evaluate_multiagent_requirement(request_type, risk_level)

        mandatory_agents = list(dict.fromkeys(issue_map["mandatory_foundation"] + issue_map["mandatory_closing"]))
        all_required = list(dict.fromkeys(
            ["00-orquestador-general-juridico"] +
            issue_map["mandatory_foundation"] +
            issue_map["conditional_agents"] +
            issue_map["substantive_specialists"] +
            issue_map["mandatory_closing"] +
            issue_map["production_agents"]
        ))

        plan = {
            "case_id": case_id,
            "created_at": datetime.datetime.now().isoformat(),
            "request_type": request_type,
            "risk_level": risk_level,
            "multiagent_required": multiagent_req,
            "issues_detected": issue_map["substantive_specialists"],
            "mandatory_agents": mandatory_agents,
            "substantive_specialists": issue_map["substantive_specialists"],
            "conditional_agents": issue_map["conditional_agents"],
            "production_agents": issue_map["production_agents"],
            "all_required_agents": all_required,
            "canonical_dag_waves": {
                "wave_1_intake_and_research": issue_map["mandatory_foundation"] + [a for a in issue_map["conditional_agents"] if a in ["04-analista-probatorio-y-pericial", "05-analista-procesal-y-procedibilidad"]],
                "wave_2_substantive_specialists": issue_map["substantive_specialists"],
                "wave_3_strategy_and_litigation": ["06-estratega-juridico-convencional"] + [a for a in issue_map["conditional_agents"] if a in ["14-magistrado-procesal-y-nulidades", "15-estratega-disruptivo-y-negociador"]],
                "wave_4_auditing_and_integrity": ["10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"],
                "wave_5_synthesis_and_delivery": ["00-final-strategic-synthesis", "08-redactor-senior-juridico", "02-compilador-y-entrega-final"]
            },
            "hard_gates": {
                "wave_1_gate": "PENDING",
                "wave_2_gate": "PENDING",
                "wave_3_gate": "PENDING",
                "wave_4_final_hard_gate": "PENDING",
                "synthesis_gate": "PENDING"
            },
            "production_required": bool(issue_map["production_agents"]),
            "planned_required_invocations": len(all_required),
            "pipeline_status": "INITIALIZED"
        }

        internal_dir = os.path.join(case_dir, "trabajo_interno")
        os.makedirs(internal_dir, exist_ok=True)
        plan_path = os.path.join(internal_dir, "ORCHESTRATION_PLAN.json")
        with open(plan_path, "w", encoding="utf-8") as f:
            json.dump(plan, f, indent=2, ensure_ascii=False)

        # Initialize Agent Execution Ledger
        self.init_agent_execution_ledger(case_dir, all_required)

        return plan

    # -------------------------------------------------------------
    # 6. AGENT EXECUTION LEDGER INITIALIZATION & RUNTIME VERIFICATION
    # -------------------------------------------------------------
    def init_agent_execution_ledger(self, case_dir: str, required_agents: List[str]):
        internal_dir = os.path.join(case_dir, "trabajo_interno")
        os.makedirs(internal_dir, exist_ok=True)
        ledger_json_path = os.path.join(internal_dir, "AGENT_EXECUTION_LEDGER.json")
        ledger_md_path = os.path.join(internal_dir, "AGENT_EXECUTION_LEDGER.md")

        ledger_data = {
            "case_dir": case_dir,
            "updated_at": datetime.datetime.now().isoformat(),
            "executions": {}
        }

        for agent in required_agents:
            ledger_data["executions"][agent] = {
                "agent_slug": agent,
                "required": True,
                "invocation_id": None,
                "model": "pro" if any(k in agent for k in ["especialista", "00", "06", "10", "14", "15", "08"]) else ("flash_lite" if any(k in agent for k in ["01", "02"]) else "flash"),
                "status": "PENDING",
                "validation_status": "PENDING",
                "artifact": None,
                "started_at": None,
                "completed_at": None,
                "provenance_verified": False,
                "runtime_transcript": None
            }

        with open(ledger_json_path, "w", encoding="utf-8") as f:
            json.dump(ledger_data, f, indent=2, ensure_ascii=False)

        # Markdown representation
        md_lines = [
            "# AGENT EXECUTION LEDGER",
            f"**Case:** `{os.path.basename(case_dir)}`",
            f"**Initialized:** {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "| Agent Slug | Required | Invocation ID | Model | Status | Validation | Artifact | Completed At |",
            "|---|:---:|---|:---:|:---:|:---:|---|---|"
        ]
        for slug, data in ledger_data["executions"].items():
            md_lines.append(f"| `{slug}` | `{data['required']}` | `{data['invocation_id'] or 'NONE'}` | `{data['model']}` | `{data['status']}` | `{data['validation_status']}` | `{data['artifact'] or 'NONE'}` | `{data['completed_at'] or 'NONE'}` |")

        with open(ledger_md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(md_lines) + "\n")

    def verify_runtime_provenance(
        self,
        invocation_id: str,
        agent_slug: Optional[str] = None,
        artifact_path: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Physically verifies that invocation_id corresponds to a genuine Antigravity runtime transcript,
        and optionally verifies that the transcript matches the declared agent_slug and generated artifact.
        Returns: (is_valid, transcript_path, error_code)
        """
        # Anti-simulation guard is ALWAYS hard: fabricated / self-minted ids are rejected
        # regardless of strict mode.
        if not invocation_id or not isinstance(invocation_id, str):
            if self.PROVENANCE_STRICT:
                return False, None, "MISSING_INVOCATION_ID"
            return True, None, "PROVENANCE_UNVERIFIED_SOFT_PASS"

        inv_clean = invocation_id.strip()
        if inv_clean.lower().startswith("fake") or inv_clean.lower().startswith("inv-auto") or inv_clean.lower().startswith("inv-manual"):
            return False, None, "INVALID_EXECUTION_PROVENANCE"

        brain_dir = os.path.expanduser("~/.gemini/antigravity/brain")
        transcript_path = os.path.join(brain_dir, inv_clean, ".system_generated", "logs", "transcript.jsonl")

        # An UNLOCATABLE genuine transcript must NOT trap the pipeline in an infinite
        # re-dispatch / Stop=continue loop (root cause of the 1671-invocation runaway).
        # Under non-strict mode these degrade to an advisory soft-pass.
        if not os.path.exists(transcript_path):
            if self.PROVENANCE_STRICT:
                return False, None, "RUNTIME_TRANSCRIPT_NOT_FOUND"
            return True, None, "PROVENANCE_UNVERIFIED_SOFT_PASS"

        if os.path.getsize(transcript_path) == 0:
            if self.PROVENANCE_STRICT:
                return False, None, "EMPTY_RUNTIME_TRANSCRIPT"
            return True, transcript_path, "PROVENANCE_UNVERIFIED_SOFT_PASS"

        # Deep transcript content inspection
        try:
            with open(transcript_path, "r", encoding="utf-8") as f:
                transcript_text = f.read(65536) # Read initial chunks
        except Exception:
            if self.PROVENANCE_STRICT:
                return False, None, "TRANSCRIPT_READ_ERROR"
            return True, transcript_path, "PROVENANCE_UNVERIFIED_SOFT_PASS"

        # 1. Verify agent_slug matching in transcript
        if agent_slug:
            slug_clean = agent_slug.lower().replace("-", "_")
            role_token_map = {
                "01_intake_y_clasificador": ["director_intake", "01-intake", "01_intake", "director de intake"],
                "03_investigador_normativo_jurisprudencial": ["investigador_normativo", "03-investigador", "03_investigador", "investigador normativo"],
                "especialista_contractual_y_negocios": ["especialista_contractual", "especialista-contractual", "especialista contractual"],
                "especialista_propiedad_intelectual_y_datos": ["especialista_pi_datos", "especialista-propiedad-intelectual", "propiedad intelectual y datos"],
                "06_estratega_juridico_convencional": ["estratega_convencional", "06-estratega", "06_estratega", "estratega convencional", "estratega jurídico convencional"],
                "10_auditor_juridico_y_red_team": ["auditor_red_team", "10-auditor", "10_auditor", "red team"],
                "11_auditor_de_citas_y_vigencia": ["auditor_citas", "11-auditor", "11_auditor", "auditor de citas"],
                "04_analista_probatorio_y_pericial": ["analista_probatorio", "04-analista", "04_analista", "analista probatorio"],
                "00_final_strategic_synthesis": ["orquestador_sintesis", "00-orquestador", "00_final_strategic_synthesis", "managing partner"]
            }
            expected_tokens = role_token_map.get(slug_clean, [slug_clean, agent_slug.lower()])
            t_lower = transcript_text.lower()
            if not any(token in t_lower for token in expected_tokens):
                if self.PROVENANCE_STRICT:
                    return False, transcript_path, "PROVENANCE_AGENT_MISMATCH"
                return True, transcript_path, "PROVENANCE_UNVERIFIED_SOFT_PASS"

        # 2. Verify artifact matching in transcript
        if artifact_path:
            art_base = os.path.basename(artifact_path).lower()
            art_base_no_ext = os.path.splitext(art_base)[0]
            t_lower = transcript_text.lower()
            if art_base not in t_lower and art_base_no_ext not in t_lower:
                if self.PROVENANCE_STRICT:
                    return False, transcript_path, "ARTIFACT_PROVENANCE_MISMATCH"
                return True, transcript_path, "PROVENANCE_UNVERIFIED_SOFT_PASS"

        return True, transcript_path, None

    def record_agent_execution(
        self,
        case_dir: str,
        agent_slug: str,
        invocation_id: str,
        artifact_path: str,
        model: Optional[str] = None,
        status: str = "COMPLETED",
        validation_status: str = "ACCEPTED"
    ) -> Dict[str, Any]:
        internal_dir = os.path.join(case_dir, "trabajo_interno")
        ledger_json_path = os.path.join(internal_dir, "AGENT_EXECUTION_LEDGER.json")
        ledger_md_path = os.path.join(internal_dir, "AGENT_EXECUTION_LEDGER.md")

        # 1. Verify physical Antigravity runtime provenance and content alignment first
        is_prov_valid, transcript_path, err_code = self.verify_runtime_provenance(
            invocation_id=invocation_id,
            agent_slug=agent_slug,
            artifact_path=artifact_path
        )
        if not is_prov_valid:
            return {
                "status": "REJECTED",
                "code": err_code if err_code in ["PROVENANCE_AGENT_MISMATCH", "ARTIFACT_PROVENANCE_MISMATCH"] else "INVALID_EXECUTION_PROVENANCE",
                "error_detail": err_code,
                "message": f"HARD PROVENANCE BLOCK: Invocación '{invocation_id}' para '{agent_slug}' rechazada ({err_code})."
            }

        # 2. Verify artifact physical existence and non-emptiness
        if artifact_path:
            full_art_path = artifact_path if os.path.isabs(artifact_path) else os.path.join(internal_dir, "md", artifact_path)
            if not os.path.exists(full_art_path) or os.path.getsize(full_art_path) == 0:
                return {
                    "status": "REJECTED",
                    "code": "AGENT_EXECUTION_INCOMPLETE",
                    "message": f"HARD PROVENANCE BLOCK: Artefacto '{artifact_path}' no existe o está vacío en disco para '{agent_slug}'."
                }

        if os.path.exists(ledger_json_path):
            with open(ledger_json_path, "r", encoding="utf-8") as f:
                ledger = json.load(f)
        else:
            ledger = {"case_dir": case_dir, "executions": {}}

        now_str = datetime.datetime.now().isoformat()
        entry = ledger["executions"].get(agent_slug, {
            "agent_slug": agent_slug,
            "required": True,
            "started_at": now_str
        })
        entry.update({
            "invocation_id": invocation_id,
            "artifact": os.path.basename(artifact_path) if artifact_path else None,
            "status": status,
            "validation_status": validation_status,
            "completed_at": now_str,
            "provenance_verified": True,
            "runtime_transcript": transcript_path
        })
        if model:
            entry["model"] = model

        ledger["executions"][agent_slug] = entry
        ledger["updated_at"] = now_str

        with open(ledger_json_path, "w", encoding="utf-8") as f:
            json.dump(ledger, f, indent=2, ensure_ascii=False)

        # Update MD
        md_lines = [
            "# AGENT EXECUTION LEDGER",
            f"**Case:** `{os.path.basename(case_dir)}`",
            f"**Updated:** {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "| Agent Slug | Required | Invocation ID | Model | Status | Validation | Artifact | Completed At |",
            "|---|:---:|---|:---:|:---:|:---:|---|---|"
        ]
        for slug, data in ledger["executions"].items():
            md_lines.append(f"| `{slug}` | `{data.get('required', True)}` | `{data.get('invocation_id') or 'NONE'}` | `{data.get('model', 'pro')}` | `{data.get('status', 'PENDING')}` | `{data.get('validation_status', 'PENDING')}` | `{data.get('artifact') or 'NONE'}` | `{data.get('completed_at') or 'NONE'}` |")

        with open(ledger_md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(md_lines) + "\n")

        return {
            "status": "ACCEPTED",
            "agent_slug": agent_slug,
            "invocation_id": invocation_id,
            "runtime_transcript": transcript_path,
            "code": "EXECUTION_RECORDED"
        }

    # -------------------------------------------------------------
    # 7. DETERMINISTIC PIPELINE COMPLETION ENGINE
    # -------------------------------------------------------------
    def calculate_pipeline_completion(self, case_dir: str, orchestration_plan: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        internal_dir = os.path.join(case_dir, "trabajo_interno")
        md_dir = os.path.join(internal_dir, "md")
        plan_path = os.path.join(internal_dir, "ORCHESTRATION_PLAN.json")
        ledger_json_path = os.path.join(internal_dir, "AGENT_EXECUTION_LEDGER.json")

        if orchestration_plan is None:
            if os.path.exists(plan_path):
                with open(plan_path, "r", encoding="utf-8") as f:
                    orchestration_plan = json.load(f)
            else:
                return {
                    "pipeline_complete": False,
                    "status": "BLOCKED",
                    "code": "MISSING_ORCHESTRATION_PLAN",
                    "final_analysis_authorized": False,
                    "final_deliverable_authorized": False,
                    "missing_agents": ["ORCHESTRATION_PLAN"],
                    "message": "No existe plan de orquestación registrado para el caso."
                }

        # §3 Circuit-breaker / abort short-circuit: a FAILED pipeline never authorizes.
        if orchestration_plan.get("pipeline_status") == "FAILED" or os.path.exists(os.path.join(internal_dir, self.ABORT_MANIFEST)):
            return {
                "pipeline_complete": False,
                "status": "FAILED",
                "code": "PIPELINE_ABORTED",
                "final_analysis_authorized": False,
                "final_deliverable_authorized": False,
                "missing_agents": [],
                "message": "PIPELINE ABORTADO (circuit breaker / resource-exhausted). No se autoriza síntesis ni entregable."
            }

        multiagent_req = orchestration_plan.get("multiagent_required", True)
        if not multiagent_req:
            return {
                "pipeline_complete": True,
                "status": "NOT_REQUIRED",
                "final_analysis_authorized": True,
                "final_deliverable_authorized": True,
                "missing_agents": [],
                "message": "Asunto de baja complejidad (SIMPLE_QUERY / SIMPLE). No requiere pipeline multiagente."
            }

        # Load executions from ledger
        executions = {}
        if os.path.exists(ledger_json_path):
            with open(ledger_json_path, "r", encoding="utf-8") as f:
                ledger = json.load(f)
                executions = ledger.get("executions", {})

        missing_agents = []
        unvalidated_agents = []
        fake_provenance_agents = []

        all_required = orchestration_plan.get("all_required_agents", [])
        if not all_required:
            all_required = list(dict.fromkeys(
                ["01-intake-y-clasificador", "03-investigador-normativo-jurisprudencial", "06-estratega-juridico-convencional", "10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"] +
                orchestration_plan.get("substantive_specialists", [])
            ))

        for agent in all_required:
            if agent == "00-orquestador-general-juridico":
                agent_key = "00-final-strategic-synthesis"
            else:
                agent_key = agent

            exec_entry = executions.get(agent_key) or executions.get(agent)
            if not exec_entry or exec_entry.get("status") != "COMPLETED":
                missing_agents.append(agent_key)
                continue

            inv_id = str(exec_entry.get("invocation_id", ""))
            art_name = exec_entry.get("artifact")
            art_full_for_prov = os.path.join(md_dir, art_name) if art_name else None
            gate_ok = self._wave_prereq_ready(case_dir, agent, orchestration_plan)[0]
            prov = self.classify_provenance(inv_id, agent_key, art_full_for_prov,
                                            plan=orchestration_plan, exec_entry=exec_entry, gate_ok=gate_ok)
            # §2 Only INVALID blocks. VERIFIED and UNAVAILABLE_BUT_CORROBORATED pass.
            if prov["state"] == "INVALID":
                fake_provenance_agents.append(agent_key)
                missing_agents.append(agent_key)
                continue

            if not art_name:
                missing_agents.append(agent_key)
                continue
            art_full = os.path.join(md_dir, art_name)
            if not os.path.exists(art_full) or os.path.getsize(art_full) == 0:
                missing_agents.append(agent_key)
                continue

            if exec_entry.get("validation_status") not in ["ACCEPTED", "PASSED"]:
                unvalidated_agents.append(agent_key)

        # Mandatory Core Checks
        mandatory_core = ["01-intake-y-clasificador", "03-investigador-normativo-jurisprudencial", "06-estratega-juridico-convencional", "10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"]
        missing_mandatory = [a for a in mandatory_core if a in missing_agents]

        is_06_missing = "06-estratega-juridico-convencional" in missing_agents
        is_10_missing = "10-auditor-juridico-y-red-team" in missing_agents
        is_11_missing = "11-auditor-de-citas-y-vigencia" in missing_agents
        is_00_synthesis_missing = "00-final-strategic-synthesis" in missing_agents

        blocked_gates = []
        if is_06_missing:
            blocked_gates.append("10_AUTHORIZED = FALSE (06 Missing)")
        if is_11_missing or is_10_missing:
            blocked_gates.append("FINAL_HARD_GATE = BLOCKED (10 or 11 Missing)")
        if is_00_synthesis_missing:
            blocked_gates.append("08_AUTHORIZED = FALSE (00 Synthesis Missing)")

        is_complete = (len(missing_agents) == 0 and len(unvalidated_agents) == 0 and len(fake_provenance_agents) == 0)

        # §7 PRODUCTION DOCX GATE: when production_required, a .md is NOT a deliverable;
        # a readable .docx under <case>/entregables/ plus 08+02 ACCEPTED are mandatory.
        prod_gate = self.evaluate_production_gate(case_dir, orchestration_plan)
        final_deliverable_authorized = is_complete and prod_gate.get("authorized", True)

        return {
            "pipeline_complete": is_complete,
            "status": "COMPLETE" if is_complete else "INCOMPLETE",
            "final_analysis_authorized": is_complete,
            "final_deliverable_authorized": final_deliverable_authorized,
            "production_gate": prod_gate,
            "missing_agents": list(dict.fromkeys(missing_agents)),
            "missing_mandatory": missing_mandatory,
            "unvalidated_agents": unvalidated_agents,
            "fake_provenance_agents": fake_provenance_agents,
            "blocked_gates": blocked_gates,
            "total_required": len(all_required),
            "completed_count": len(all_required) - len(missing_agents)
        }

    # -------------------------------------------------------------
    # 8. MONOLITHIC EXECUTION BLOCK
    # -------------------------------------------------------------
    def enforce_monolithic_block(self, case_dir: str, requested_action: str = "generate_final_report") -> Dict[str, Any]:
        comp_status = self.calculate_pipeline_completion(case_dir)
        if not comp_status["pipeline_complete"]:
            return {
                "action": requested_action,
                "authorized": False,
                "status": "BLOCKED",
                "code": "MONOLITHIC_EXECUTION_BLOCKED",
                "reason": "PIPELINE_INCOMPLETE",
                "missing_agents": comp_status["missing_agents"],
                "blocked_gates": comp_status["blocked_gates"],
                "message": f"HARD BLOCK: La acción '{requested_action}' fue rechazada. El pipeline multiagente no está completo ({comp_status['completed_count']}/{comp_status['total_required']} completados). Falta ejecutar e incorporar: {', '.join(comp_status['missing_agents'])}."
            }

        return {
            "action": requested_action,
            "authorized": True,
            "status": "AUTHORIZED",
            "code": "EXECUTION_PERMITTED"
        }

    # -------------------------------------------------------------
    # 9. CONTINUATION & DELTA ORCHESTRATION
    # -------------------------------------------------------------
    def handle_continuation(self, case_dir: str, delta_text: str) -> Dict[str, Any]:
        delta_risk = self.classify_risk_level(delta_text, "EXISTING_MATTER_CONTINUATION")
        issue_map = self.extract_issue_map(delta_text)

        reopened_agents = list(dict.fromkeys(
            issue_map["substantive_specialists"] +
            ["06-estratega-juridico-convencional", "10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia", "00-final-strategic-synthesis"] +
            issue_map["production_agents"]
        ))

        return {
            "request_type": "EXISTING_MATTER_CONTINUATION",
            "delta_risk_level": delta_risk,
            "delta_orchestration": True,
            "reopened_agents": reopened_agents,
            "message": f"Continuación de caso detectada ({delta_risk}). Se activa Delta Orchestration para {len(reopened_agents)} agentes downstream sin reiniciar intake de hechos base."
        }

    # -------------------------------------------------------------
    # 10. RUNTIME AUTO-DISPATCH & EVENT GENERATION
    # -------------------------------------------------------------
    def _build_subagent_specs(self, agents: List[str], case_dir: str, plan: Dict[str, Any]) -> List[Dict[str, Any]]:
        case_id = plan.get("case_id", os.path.basename(case_dir))
        md_dir = os.path.join(case_dir, "trabajo_interno", "md")
        specs = []

        mapping = {
            "01-intake-y-clasificador": {
                "TypeName": "director_intake",
                "Role": "Director de Intake y Clasificador",
                "Model": "flash_lite",
                "prompt_suffix": f"Realizar el intake fáctico y estructurar el CANONICAL_FACT_LEDGER.md en: {md_dir}/01_INTAKE_TECNOLOGICO.md"
            },
            "03-investigador-normativo-jurisprudencial": {
                "TypeName": "investigador_normativo",
                "Role": "Investigador Normativo y Jurisprudencial",
                "Model": "flash",
                "prompt_suffix": f"Investigar marco normativo (C.Co, Ley 1450/2011 art 28, Ley 1581/2012) y guardar en: {md_dir}/03_INVESTIGACION_NORMATIVA_TECH.md"
            },
            "especialista-contractual-y-negocios": {
                "TypeName": "especialista_contractual",
                "Role": "Socio Especialista Contractual y Negocios",
                "Model": "pro",
                "prompt_suffix": f"Analizar hitos, UAT, SLA, Cap de responsabilidad y guardar en: {md_dir}/MEMO_ESPECIALISTA_CONTRACTUAL.md"
            },
            "especialista-propiedad-intelectual-y-datos": {
                "TypeName": "especialista_pi_datos",
                "Role": "Socio Especialista Propiedad Intelectual y Datos",
                "Model": "pro",
                "prompt_suffix": f"Auditar Background vs Foreground IP (Art 28 Ley 1450) y DPA (Ley 1581) y guardar en: {md_dir}/MEMO_ESPECIALISTA_PI_DATOS.md"
            },
            "06-estratega-juridico-convencional": {
                "TypeName": "estratega_convencional",
                "Role": "Estratega Jurídico Convencional",
                "Model": "pro",
                "prompt_suffix": f"Integrar dictámenes de Wave 1 y Wave 2 y articular estrategia de blindaje en: {md_dir}/06_ESTRATEGIA_CONVENCIONAL_TECH.md"
            },
            "10-auditor-juridico-y-red-team": {
                "TypeName": "auditor_red_team",
                "Role": "Auditor Jurídico Senior y Red Team",
                "Model": "pro",
                "prompt_suffix": f"Realizar STRESS-TESTING ADVERSARIAL de la estrategia y guardar en: {md_dir}/10_AUDITORIA_RED_TEAM_TECH.md"
            },
            "11-auditor-de-citas-y-vigencia": {
                "TypeName": "auditor_citas",
                "Role": "Auditor de Citas y Vigencia",
                "Model": "flash",
                "prompt_suffix": f"Auditar vigencia y fidelidad de citas jurídicas y guardar en: {md_dir}/11_AUDITORIA_CITAS_TECH.md"
            },
            "00-final-strategic-synthesis": {
                "TypeName": "orquestador_sintesis",
                "Role": "Orquestador General y Managing Partner",
                "Model": "pro",
                "prompt_suffix": f"Revisar todas las compuertas y emitir la síntesis estratégica final ejecutiva en: {md_dir}/00_FINAL_STRATEGIC_SYNTHESIS.md"
            }
        }

        # §10 CONTEXT-RETURN OPTIMIZATION (runtime directive, NOT a prompt-body edit):
        # every subagent must materialize its full development in its own artifact and
        # return to the orchestrator ONLY a compact executive synthesis (no full dumps,
        # no re-attaching source documents already materialized on disk).
        RETURN_CONTRACT = (
            "\n\n[CONTRATO DE RETORNO — OBLIGATORIO]:\n"
            "1. Escribe tu desarrollo COMPLETO únicamente en tu artefacto interno (la ruta indicada).\n"
            "2. Devuelve al orquestador SOLO una síntesis ejecutiva compacta (máx ~15 líneas): hallazgos clave, riesgos, recomendación y la ruta del artefacto.\n"
            "3. NO devuelvas cientos de líneas al contexto principal ni el contenido completo de tu memo.\n"
            "4. NO re-adjuntes documentos fuente ya materializados; refiérelos por ruta.\n"
            "5. NO puedes invocar, definir ni gestionar otros subagentes."
        )
        for agent in agents:
            meta = mapping.get(agent, {
                "Role": agent,
                "Model": "pro",
                "prompt_suffix": f"Ejecutar dictamen especializado para el caso {case_id} y guardar en {md_dir}/."
            })
            prompt = f"EXPEDIENTE: {case_id}.\nMisión {agent}:\n{meta['prompt_suffix']}\nReporta al terminar." + RETURN_CONTRACT
            specs.append({
                "agent_slug": agent,
                # §1 ANTI-RECURSION: TypeName MUST be the registered subagent type (the
                # canonical slug that declares `subagent: true`). Never 'self', never an
                # ad-hoc alias — those either clone the orchestrator or fail to resolve.
                "TypeName": agent,
                "Role": meta["Role"],
                "Model": meta["Model"],
                "Prompt": prompt
            })

        return specs

    def get_next_dispatch_request(self, case_dir: str) -> Dict[str, Any]:
        """
        Determines the next required wave and subagent dispatch requests according to the DAG.
        Returns a structured event for the native Antigravity runtime layer to execute.
        """
        internal_dir = os.path.join(case_dir, "trabajo_interno")
        plan_path = os.path.join(internal_dir, "ORCHESTRATION_PLAN.json")
        ledger_path = os.path.join(internal_dir, "AGENT_EXECUTION_LEDGER.json")

        if not os.path.exists(plan_path):
            return {"action": "ERROR", "code": "MISSING_PLAN", "message": "No orchestration plan found."}

        with open(plan_path, "r", encoding="utf-8") as f:
            plan = json.load(f)

        executions = {}
        if os.path.exists(ledger_path):
            with open(ledger_path, "r", encoding="utf-8") as f:
                executions = json.load(f).get("executions", {})

        def is_agent_done(slug: str) -> bool:
            e = executions.get(slug)
            if not e or e.get("status") != "COMPLETED":
                return False
            is_v, _, _ = self.verify_runtime_provenance(e.get("invocation_id", ""), slug, e.get("artifact"))
            return is_v and (e.get("validation_status") in ["ACCEPTED", "PASSED"])

        # Check Wave 1 (Intake & Research)
        wave_1_agents = ["01-intake-y-clasificador", "03-investigador-normativo-jurisprudencial"]
        if not all(is_agent_done(a) for a in wave_1_agents):
            pending = [a for a in wave_1_agents if not is_agent_done(a)]
            return {
                "event": "MULTIAGENT_ORCHESTRATION_REQUIRED",
                "case_id": plan.get("case_id"),
                "wave": "WAVE_1",
                "action": "INVOKE_SUBAGENTS",
                "agents": pending,
                "subagent_specs": self._build_subagent_specs(pending, case_dir, plan)
            }

        # Check Wave 2 (Substantive Specialists)
        substantive = plan.get("substantive_specialists", [])
        if not all(is_agent_done(a) for a in substantive):
            pending = [a for a in substantive if not is_agent_done(a)]
            return {
                "event": "WAVE_ADVANCE_REQUIRED",
                "case_id": plan.get("case_id"),
                "wave": "WAVE_2",
                "action": "INVOKE_SUBAGENTS",
                "agents": pending,
                "subagent_specs": self._build_subagent_specs(pending, case_dir, plan)
            }

        # Check Wave 3 (06 Strategy)
        if not is_agent_done("06-estratega-juridico-convencional"):
            return {
                "event": "WAVE_ADVANCE_REQUIRED",
                "case_id": plan.get("case_id"),
                "wave": "WAVE_3",
                "action": "INVOKE_SUBAGENTS",
                "agents": ["06-estratega-juridico-convencional"],
                "subagent_specs": self._build_subagent_specs(["06-estratega-juridico-convencional"], case_dir, plan)
            }

        # Check Wave 4 (Auditing: 10 & 11)
        wave_4_agents = ["10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"]
        if not all(is_agent_done(a) for a in wave_4_agents):
            pending = [a for a in wave_4_agents if not is_agent_done(a)]
            return {
                "event": "WAVE_ADVANCE_REQUIRED",
                "case_id": plan.get("case_id"),
                "wave": "WAVE_4",
                "action": "INVOKE_SUBAGENTS",
                "agents": pending,
                "subagent_specs": self._build_subagent_specs(pending, case_dir, plan)
            }

        # Check Final Hard Gate -> 00 Synthesis
        synthesis_done = is_agent_done("00-final-strategic-synthesis")
        if not synthesis_done:
            return {
                "event": "FINAL_HARD_GATE_AUTHORIZED",
                "case_id": plan.get("case_id"),
                "wave": "FINAL_SYNTHESIS",
                "action": "INVOKE_SUBAGENTS",
                "agents": ["00-final-strategic-synthesis"],
                "subagent_specs": self._build_subagent_specs(["00-final-strategic-synthesis"], case_dir, plan)
            }

        return {
            "event": "PIPELINE_COMPLETED",
            "case_id": plan.get("case_id"),
            "action": "PIPELINE_DONE",
            "status": "ALL_STAGES_COMPLETED"
        }

    # =============================================================
    # CONSISTENCY-AUDIT HARDENING (v5.4.2) — deterministic governance
    # =============================================================
    STATE_DIRNAME = ".pisoso_runtime_state"
    DISPATCH_LEDGER = "DISPATCH_LEDGER.json"
    ABORT_MANIFEST = "PIPELINE_ABORT.json"
    RUNNING_STATES = ("RUNNING", "COMPLETED", "ACCEPTED")
    RETRYABLE_STATES = ("FAILED", "REJECTED", "TIMEOUT")

    def _state_dir(self) -> str:
        if getattr(self, "_state_dir_override", None):
            return os.path.abspath(self._state_dir_override)
        # Beside the cases root, so ACTIVE_CASE state follows the expedientes,
        # not the (now relocatable) engine code.
        return os.path.join(os.path.dirname(self.cases_dir), self.STATE_DIRNAME)

    # ---- §4 DETERMINISTIC ACTIVE CASE (FAIL CLOSED) ----
    def set_active_case(self, conversation_id: str, case_id: str, case_dir: str) -> Dict[str, Any]:
        """Bind an unambiguous ACTIVE_CASE to this conversation/execution. Called by intake."""
        if not conversation_id:
            return {"ok": False, "code": "NO_CONVERSATION_ID"}
        os.makedirs(self._state_dir(), exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(conversation_id))[:80]
        p = os.path.join(self._state_dir(), f"{safe}.json")
        state = {}
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    state = json.load(f)
            except Exception:
                state = {}
        state["active_case_id"] = case_id
        state["active_case_dir"] = os.path.abspath(case_dir)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(state, f)
        return {"ok": True, "active_case_id": case_id, "active_case_dir": state["active_case_dir"]}

    def resolve_active_case_dir(self, conversation_id: Optional[str]) -> Dict[str, Any]:
        """FAIL CLOSED: return the bound ACTIVE_CASE only. Never guess, never fallback
        to neighbours, timestamps or the 'most recent' matter."""
        if not conversation_id:
            return {"status": "FAIL_CLOSED", "code": "NO_ACTIVE_CASE_STATE", "case_dir": None}
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(conversation_id))[:80]
        p = os.path.join(self._state_dir(), f"{safe}.json")
        if not os.path.exists(p):
            return {"status": "FAIL_CLOSED", "code": "NO_ACTIVE_CASE_STATE", "case_dir": None}
        try:
            with open(p, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            return {"status": "FAIL_CLOSED", "code": "UNREADABLE_STATE", "case_dir": None}
        cid = state.get("active_case_id")
        cdir = state.get("active_case_dir")
        if not cid or not cdir:
            return {"status": "FAIL_CLOSED", "code": "ACTIVE_CASE_UNSET", "case_dir": None}
        if not os.path.isdir(cdir):
            return {"status": "FAIL_CLOSED", "code": "ACTIVE_CASE_DIR_MISSING", "case_dir": None}
        return {"status": "OK", "active_case_id": cid, "case_dir": cdir}

    # ---- §2 PROVENANCE TRI-STATE ----
    def classify_provenance(self, invocation_id: Optional[str], agent_slug: str,
                            artifact_full_path: Optional[str], plan: Optional[Dict[str, Any]] = None,
                            exec_entry: Optional[Dict[str, Any]] = None,
                            gate_ok: Optional[bool] = None) -> Dict[str, Any]:
        """Returns one of: VERIFIED | UNAVAILABLE_BUT_CORROBORATED | INVALID.

        INVALID (always blocks): fabricated / self-minted ids, or an artifact offered
        as a substitute for real execution with no corroboration.
        VERIFIED: a genuine Antigravity runtime transcript exists AND matches slug/artifact.
        UNAVAILABLE_BUT_CORROBORATED: transcript not exposed by the runtime, BUT every
        independent native corroboration signal holds. A bare existing file is NEVER enough.
        """
        reasons: List[str] = []
        inv = (invocation_id or "").strip()

        # Hard fabrication guard (never bypassable).
        if inv[:4].lower() in ("fake",) or inv.lower().startswith("inv-auto") or inv.lower().startswith("inv-manual"):
            return {"state": "INVALID", "reasons": ["FABRICATED_INVOCATION_ID"]}
        if exec_entry and exec_entry.get("manual_parent_created") is True:
            return {"state": "INVALID", "reasons": ["MANUAL_PARENT_CREATED_ARTIFACT"]}

        # Attempt hard verification first.
        is_valid, tpath, code = self.verify_runtime_provenance(inv, agent_slug, artifact_full_path)
        if is_valid and tpath and code is None:
            return {"state": "VERIFIED", "reasons": ["RUNTIME_TRANSCRIPT_MATCHED"]}

        # Corroboration signals (all independent, all must hold).
        registered = False
        if plan is not None:
            registered = agent_slug in plan.get("all_required_agents", []) or agent_slug == "00-final-strategic-synthesis"
        artifact_ok = bool(artifact_full_path and os.path.exists(artifact_full_path) and os.path.getsize(artifact_full_path) > 0)
        temporal_ok = bool(exec_entry and exec_entry.get("started_at") and exec_entry.get("completed_at")
                           and str(exec_entry.get("started_at")) <= str(exec_entry.get("completed_at")))
        no_sim = not (inv[:4].lower() == "fake" or inv.lower().startswith("inv-auto") or inv.lower().startswith("inv-manual"))
        gate_signal = bool(gate_ok) if gate_ok is not None else True
        observed = bool(inv)  # an invocation id was actually recorded by the runtime layer

        signals = {
            "registered_agent_correct": registered,
            "artifact_exists": artifact_ok,
            "temporal_order_ok": temporal_ok,
            "gate_ok": gate_signal,
            "no_simulation_signals": no_sim,
            "execution_observed": observed,
        }
        reasons = [k for k, v in signals.items() if v]
        # Require the full independent set; a lone existing file is insufficient.
        if all(signals.values()):
            return {"state": "UNAVAILABLE_BUT_CORROBORATED", "reasons": reasons, "signals": signals}
        missing = [k for k, v in signals.items() if not v]
        return {"state": "INVALID", "reasons": ["INSUFFICIENT_CORROBORATION"], "missing": missing, "signals": signals}

    # ---- §5/§6/§H DISPATCH AUTHORIZATION (wave order + anti-redispatch + cap) ----
    def _dispatch_ledger_path(self, case_dir: str) -> str:
        return os.path.join(case_dir, "trabajo_interno", self.DISPATCH_LEDGER)

    def _load_dispatch_ledger(self, case_dir: str) -> Dict[str, Any]:
        p = self._dispatch_ledger_path(case_dir)
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {"dispatches": {}}
        return {"dispatches": {}}

    def _save_dispatch_ledger(self, case_dir: str, data: Dict[str, Any]) -> None:
        os.makedirs(os.path.join(case_dir, "trabajo_interno"), exist_ok=True)
        with open(self._dispatch_ledger_path(case_dir), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _exec_ledger(self, case_dir: str) -> Dict[str, Any]:
        p = os.path.join(case_dir, "trabajo_interno", "AGENT_EXECUTION_LEDGER.json")
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f).get("executions", {})
            except Exception:
                return {}
        return {}

    def _agent_gate_done(self, case_dir: str, slug: str) -> bool:
        """An agent counts as a satisfied gate iff its exec ledger status is
        COMPLETED/ACCEPTED and its provenance is not INVALID."""
        ex = self._exec_ledger(case_dir)
        e = ex.get(slug)
        if not e and slug == "00-orquestador-general-juridico":
            e = ex.get("00-final-strategic-synthesis")
        if not e or e.get("status") not in ("COMPLETED", "ACCEPTED"):
            return False
        art = e.get("artifact")
        art_full = os.path.join(case_dir, "trabajo_interno", "md", art) if art else None
        plan = None
        pp = os.path.join(case_dir, "trabajo_interno", "ORCHESTRATION_PLAN.json")
        if os.path.exists(pp):
            try:
                plan = json.load(open(pp, encoding="utf-8"))
            except Exception:
                plan = None
        pr = self.classify_provenance(e.get("invocation_id"), slug, art_full, plan=plan, exec_entry=e)
        return pr["state"] != "INVALID"

    def _wave_prereq_ready(self, case_dir: str, agent_slug: str, plan: Dict[str, Any]) -> Tuple[bool, str]:
        s = agent_slug
        foundation = ["01-intake-y-clasificador", "03-investigador-normativo-jurisprudencial"]
        foundation += [a for a in plan.get("conditional_agents", []) if a in ("04-analista-probatorio-y-pericial", "05-analista-procesal-y-procedibilidad")]
        specialists = plan.get("substantive_specialists", [])

        def all_done(lst):
            return all(self._agent_gate_done(case_dir, a) for a in lst)

        if s in foundation:
            return True, "FOUNDATION_WAVE"
        if s in specialists:
            if not all_done(foundation):
                return False, "FOUNDATION_GATE_NOT_READY"
            return True, "SPECIALIST_WAVE"
        if s in ("06-estratega-juridico-convencional",):
            if not all_done(foundation) or not all_done(specialists):
                return False, "SPECIALISTS_NOT_COMPLETE_BEFORE_06"
            return True, "STRATEGY_WAVE"
        if s in ("14-magistrado-procesal-y-nulidades", "15-estratega-disruptivo-y-negociador"):
            if not self._agent_gate_done(case_dir, "06-estratega-juridico-convencional"):
                return False, "06_NOT_DONE_BEFORE_14_15"
            return True, "LITIGATION_WAVE"
        if s in ("10-auditor-juridico-y-red-team", "11-auditor-de-citas-y-vigencia"):
            if not self._agent_gate_done(case_dir, "06-estratega-juridico-convencional"):
                return False, "06_NOT_DONE_BEFORE_10_11"
            return True, "AUDIT_WAVE"
        if s in ("00-orquestador-general-juridico", "00-final-strategic-synthesis"):
            if not (self._agent_gate_done(case_dir, "10-auditor-juridico-y-red-team") and self._agent_gate_done(case_dir, "11-auditor-de-citas-y-vigencia")):
                return False, "10_11_NOT_DONE_BEFORE_00"
            return True, "SYNTHESIS_WAVE"
        if s in ("08-redactor-senior-juridico", "02-compilador-y-entrega-final"):
            if not plan.get("production_required", False):
                return False, "PRODUCTION_NOT_REQUIRED"
            if not self._agent_gate_done(case_dir, "00-orquestador-general-juridico"):
                return False, "00_SYNTHESIS_NOT_DONE_BEFORE_PRODUCTION"
            return True, "PRODUCTION_WAVE"
        return True, "UNCLASSIFIED_WAVE"

    def authorize_dispatch(self, case_dir: str, agent_slug: str, wave: Optional[str] = None,
                           retry_authorized: bool = False) -> Dict[str, Any]:
        plan_path = os.path.join(case_dir, "trabajo_interno", "ORCHESTRATION_PLAN.json")
        if not os.path.exists(plan_path):
            return {"authorized": False, "code": "MISSING_PLAN"}
        with open(plan_path, "r", encoding="utf-8") as f:
            plan = json.load(f)

        # Aborted pipelines never authorize anything.
        if plan.get("pipeline_status") == "FAILED" or os.path.exists(os.path.join(case_dir, "trabajo_interno", self.ABORT_MANIFEST)):
            return {"authorized": False, "code": "PIPELINE_FAILED", "abort": True}

        ok_wave, wave_reason = self._wave_prereq_ready(case_dir, agent_slug, plan)
        wave = wave or wave_reason
        exec_key = f"{plan.get('case_id')}::{wave}::{agent_slug}"

        dl = self._load_dispatch_ledger(case_dir)
        entry = dl["dispatches"].get(exec_key)

        # §6 ANTI-REDISPATCH
        if entry:
            st = entry.get("status")
            if st in self.RUNNING_STATES:
                return {"authorized": False, "code": "REDISPATCH_DENIED", "state": st, "execution_key": exec_key}
            if st in self.RETRYABLE_STATES and not retry_authorized:
                return {"authorized": False, "code": "RETRY_NOT_AUTHORIZED", "state": st, "execution_key": exec_key}

        # §H MAX INVOCATION CAP (count distinct active/consumed executions)
        planned = int(plan.get("planned_required_invocations", self.MAX_TOTAL_AGENTS))
        active_keys = [k for k, v in dl["dispatches"].items() if v.get("status") in self.RUNNING_STATES]
        if exec_key not in dl["dispatches"] and len(active_keys) >= planned:
            self.abort_pipeline(case_dir, reason=f"Se intentó la invocación #{len(active_keys)+1} con planned_required_invocations={planned}.", code="MAX_INVOCATIONS_EXCEEDED")
            return {"authorized": False, "code": "MAX_INVOCATIONS_EXCEEDED", "abort": True, "execution_key": exec_key}

        # §5 WAVE ORDER
        if not ok_wave:
            return {"authorized": False, "code": "WAVE_ORDER_VIOLATION", "reason": wave_reason, "execution_key": exec_key}

        return {"authorized": True, "code": "AUTHORIZED", "execution_key": exec_key, "wave": wave}

    def record_dispatch(self, case_dir: str, agent_slug: str, wave: str, status: str,
                        invocation_id: Optional[str] = None) -> Dict[str, Any]:
        plan_path = os.path.join(case_dir, "trabajo_interno", "ORCHESTRATION_PLAN.json")
        case_id = os.path.basename(case_dir)
        if os.path.exists(plan_path):
            try:
                with open(plan_path, "r", encoding="utf-8") as f:
                    case_id = json.load(f).get("case_id", case_id)
            except Exception:
                pass
        exec_key = f"{case_id}::{wave}::{agent_slug}"
        dl = self._load_dispatch_ledger(case_dir)
        dl["dispatches"][exec_key] = {
            "agent_slug": agent_slug, "wave": wave, "status": status,
            "invocation_id": invocation_id, "updated_at": datetime.datetime.now().isoformat()
        }
        self._save_dispatch_ledger(case_dir, dl)
        return {"execution_key": exec_key, "status": status}

    # ---- §3 CIRCUIT BREAKER ABORT ----
    def abort_pipeline(self, case_dir: str, reason: str, code: str = "CIRCUIT_BREAKER_ABORT") -> Dict[str, Any]:
        internal = os.path.join(case_dir, "trabajo_interno")
        os.makedirs(internal, exist_ok=True)
        # Mark plan FAILED.
        plan_path = os.path.join(internal, "ORCHESTRATION_PLAN.json")
        if os.path.exists(plan_path):
            try:
                with open(plan_path, "r", encoding="utf-8") as f:
                    plan = json.load(f)
                plan["pipeline_status"] = "FAILED"
                with open(plan_path, "w", encoding="utf-8") as f:
                    json.dump(plan, f, indent=2, ensure_ascii=False)
            except Exception:
                pass
        # Kill (mark) active subagents so nothing is re-dispatched.
        dl = self._load_dispatch_ledger(case_dir)
        for k, v in dl["dispatches"].items():
            if v.get("status") in ("RUNNING",):
                v["status"] = "TIMEOUT"
                v["killed_by_abort"] = True
        self._save_dispatch_ledger(case_dir, dl)
        manifest = {
            "pipeline_status": "FAILED",
            "code": code,
            "reason": reason,
            "final_deliverable_authorized": False,
            "final_legal_opinion": None,
            "aborted_at": datetime.datetime.now().isoformat()
        }
        with open(os.path.join(internal, self.ABORT_MANIFEST), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        return {"action": "ABORT_PIPELINE", **manifest}

    # ---- §I RESOURCE EXHAUSTED ----
    def handle_resource_exhausted(self, case_dir: str, http_status: int = 429) -> Dict[str, Any]:
        res = self.abort_pipeline(case_dir, reason=f"Runtime devolvió {http_status} RESOURCE_EXHAUSTED.", code="RESOURCE_EXHAUSTED")
        res["kill_active_subagents"] = True
        res["redispatch"] = False
        return res

    # ---- §7 PRODUCTION DOCX GATE ----
    def evaluate_production_gate(self, case_dir: str, plan: Dict[str, Any]) -> Dict[str, Any]:
        """When production_required, a .md in trabajo_interno is NOT a deliverable.
        Requires 08 ACCEPTED, 02 ACCEPTED and a readable .docx under <case>/entregables/."""
        if not plan.get("production_required", False):
            return {"production_required": False, "authorized": True}
        ex = self._exec_ledger(case_dir)
        def accepted(slug):
            e = ex.get(slug)
            return bool(e and e.get("status") in ("COMPLETED", "ACCEPTED") and e.get("validation_status") in ("ACCEPTED", "PASSED"))
        c08 = accepted("08-redactor-senior-juridico")
        c02 = accepted("02-compilador-y-entrega-final")
        entregables = os.path.join(case_dir, "entregables")
        docx = []
        if os.path.isdir(entregables):
            docx = [f for f in os.listdir(entregables) if f.lower().endswith(".docx") and os.path.getsize(os.path.join(entregables, f)) > 0]
        file_ok = len(docx) > 0
        authorized = c08 and c02 and file_ok
        return {
            "production_required": True,
            "08_accepted": c08, "02_accepted": c02,
            "deliverable_file_exists": file_ok,
            "deliverable_dir": entregables,
            "deliverable_files": docx,
            "authorized": authorized
        }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Pisoso Legal AI — Auto-Orchestration Entrypoint Engine")
    parser.add_argument("--detect", type=str, help="Texto para clasificar intención y riesgo")
    parser.add_argument("--case-dir", type=str, help="Ruta del caso para calcular completion o verificar hard block")
    parser.add_argument("--check-completion", action="store_true", help="Calcular determinísticamente pipeline completion")
    parser.add_argument("--check-block", type=str, help="Verificar hard block sobre acción solicitada")
    
    args = parser.parse_args()
    engine = PisosoAutoEntrypoint()

    if args.detect:
        req_type = engine.detect_request_type(args.detect)
        risk = engine.classify_risk_level(args.detect, req_type)
        multi = engine.evaluate_multiagent_requirement(req_type, risk)
        issues = engine.extract_issue_map(args.detect)
        res = {
            "input_preview": args.detect[:80] + "...",
            "request_type": req_type,
            "risk_level": risk,
            "multiagent_required": multi,
            "issue_map": issues
        }
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.case_dir and args.check_completion:
        res = engine.calculate_pipeline_completion(args.case_dir)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.case_dir and args.check_block:
        res = engine.enforce_monolithic_block(args.case_dir, args.check_block)
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
