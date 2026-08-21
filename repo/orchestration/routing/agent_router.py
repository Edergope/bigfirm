#!/usr/bin/env python3
"""
Pisoso Legal AI - Enrutador de Agentes y Asignador de Modelos Gemini
Permite consultar el catálogo consolidado de 30 agentes, obtener planes de orquestación
en olas lógicas y asegurar la correcta parametrización de modelos (pro, flash, flash_lite).
"""

import os
import sys
import json
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_FILE = os.path.join(SCRIPT_DIR, "agent_manifest.json")
GLOBAL_MANIFEST = "/Users/edergope/.gemini/config/skills/pisoso/agent_manifest.json"
GLOBAL_AGENTS_DIR = "/Users/edergope/.gemini/config/skills/pisoso/.agents"

# Mapeo de casos típicos a planes de orquestación en olas
WAVE_TEMPLATES = {
    "constitucional_tutela": {
        "title": "Acción de Tutela, Excepción de Inconstitucionalidad y Derechos Fundamentales",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Hechos de Vulneración y Términos de Inmediatez"},
            {"agent": "03-investigador-normativo-jurisprudencial", "model": "flash", "role": "Rastreo en Biblioteca y Sentencias SU/C/T"}
        ],
        "wave2": [
            {"agent": "especialista-constitucional-y-derechos-fundamentales", "model": "pro", "role": "Especialista Constitucional Senior"},
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Estratega Procesal y Cómputo de Inmediatez"},
            {"agent": "15-estratega-disruptivo-y-negociador", "model": "pro", "role": "Excepción de Inconstitucionalidad (Art. 4 C.P.)"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Tutela / Memorial"},
            {"agent": "14-magistrado-procesal-y-nulidades", "model": "pro", "role": "Auditor de Procedibilidad y Vías de Hecho"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador Word"}
        ]
    },
    "societario_mna": {
        "title": "Estructuración Corporativa, Acuerdos de Accionistas o M&A",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Receptor y Clasificador"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Analista de Documentos y Cap Table"}
        ],
        "wave2": [
            {"agent": "especialista-societario-y-mna", "model": "pro", "role": "Especialista Societario y M&A"},
            {"agent": "especialista-tributario-y-aduanero", "model": "pro", "role": "Especialista Tributario Corporativo"},
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Estratega Convencional"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor Senior"},
            {"agent": "10-auditor-juridico-y-red-team", "model": "pro", "role": "Auditor Integral y Red Team"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Generador Word"}
        ]
    },
    "contractual": {
        "title": "Diseño, Revisión o Auditoría Contractual Compleja",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Intake y Extracción de Obligaciones"},
            {"agent": "03-investigador-normativo-jurisprudencial", "model": "flash", "role": "Investigador Normativo y Biblioteca"}
        ],
        "wave2": [
            {"agent": "especialista-contractual-y-negocios", "model": "pro", "role": "Especialista Contractual"},
            {"agent": "15-estratega-disruptivo-y-negociador", "model": "pro", "role": "Estratega de Negociación y Riesgos"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor Senior"},
            {"agent": "14-magistrado-procesal-y-nulidades", "model": "pro", "role": "Auditor de Exigibilidad Judicial"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Generador Word"}
        ]
    },
    "civil_inmobiliario": {
        "title": "Derecho Civil, Estudio de Títulos, Bienes e Inmobiliario",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Intake y Revisión de Matrículas Inmobiliarias"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Estudio de Títulos y Tradición Registral"}
        ],
        "wave2": [
            {"agent": "especialista-civil-bienes-e-inmobiliario", "model": "pro", "role": "Especialista Civil e Inmobiliario"},
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Estratega Civil / Pertenencia / Divisorio"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Contrato / Demanda"},
            {"agent": "14-magistrado-procesal-y-nulidades", "model": "pro", "role": "Auditor Procesal y de Títulos"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Entrega Word"}
        ]
    },
    "familia_patrimonio": {
        "title": "Derecho de Familia, Sucesiones y Planeación Patrimonial",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Inventario de Bienes y Árbol Genealógico"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Cotejo de Activos, Pasivos y Avalúos"}
        ],
        "wave2": [
            {"agent": "especialista-familia-y-planeacion-patrimonial", "model": "pro", "role": "Especialista en Familia y Sucesiones"},
            {"agent": "especialista-tributario-y-aduanero", "model": "pro", "role": "Optimización Fiscal Ganancia Ocasional"},
            {"agent": "15-estratega-disruptivo-y-negociador", "model": "pro", "role": "Negociación Familiar y Protocolo"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Testamento / Liquidación / Partición"},
            {"agent": "10-auditor-juridico-y-red-team", "model": "pro", "role": "Auditor de Legítimas y Blindaje"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Formato Word"}
        ]
    },
    "penal_general_litigio": {
        "title": "Derecho Penal General, Audiencias y Defensa Técnica (Ley 906)",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Hechos de Imputación y Plazos Procesales"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Análisis de EMP y Cadena de Custodia"}
        ],
        "wave2": [
            {"agent": "especialista-penal-general-y-litigio", "model": "pro", "role": "Penalista Litigante Senior"},
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Teoría del Caso Penal y Términos"},
            {"agent": "15-estratega-disruptivo-y-negociador", "model": "pro", "role": "Negociación de Preacuerdos / Oportunidad"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Memoriales y Recursos"},
            {"agent": "14-magistrado-procesal-y-nulidades", "model": "pro", "role": "Control de Garantías y Nulidades"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador Word"}
        ]
    },
    "penal_corporativo": {
        "title": "Derecho Penal Corporativo, Delitos Económicos e Investigaciones",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Intake de Hallazgos y Operaciones"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Auditoría Forense y Evidencia Digital"}
        ],
        "wave2": [
            {"agent": "especialista-penal-corporativo-y-delitos-economicos", "model": "pro", "role": "Penalista Corporativo Senior"},
            {"agent": "oficial-compliance-sagrilaft-ptee", "model": "pro", "role": "Auditor de Cumplimiento y Canales"},
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Estrategia de Denuncia o Defensa"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Denuncia / Informe Forense"},
            {"agent": "10-auditor-juridico-y-red-team", "model": "pro", "role": "Auditor Adversarial de Tipicidad"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador Word"}
        ]
    },
    "litigio_o_demanda": {
        "title": "Proyección o Contestación de Demanda / Litigio Civil o Comercial",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Extracción de Hechos y Plazos"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Matriz Probatoria"},
            {"agent": "05-analista-procesal-y-procedibilidad", "model": "flash", "role": "Control de Procedibilidad y Caducidad"}
        ],
        "wave2": [
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Teoría del Caso Principal y Prescripción"},
            {"agent": "15-estratega-disruptivo-y-negociador", "model": "pro", "role": "Estrategia Alternativa y MASC"},
            {"agent": "14-magistrado-procesal-y-nulidades", "model": "pro", "role": "Simulación de Excepciones y Sentencia"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor Judicial Senior"},
            {"agent": "11-auditor-de-citas-y-vigencia", "model": "flash", "role": "Auditor de Citas y Jurisprudencia"},
            {"agent": "10-auditor-juridico-y-red-team", "model": "pro", "role": "Auditoría Adversarial"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Formato Word"}
        ]
    },
    "propiedad_intelectual": {
        "title": "Marcas, Patentes, Software y Habeas Data",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Intake y Antecedentes"},
            {"agent": "03-investigador-normativo-jurisprudencial", "model": "flash", "role": "Búsqueda en SIC / DNDA / Biblioteca"}
        ],
        "wave2": [
            {"agent": "especialista-propiedad-intelectual-y-datos", "model": "pro", "role": "Especialista en Marcas y PI"},
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Estratega de Registro / Oposición"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Memorial / Contrato"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Entrega Word"}
        ]
    },
    "compliance_laft": {
        "title": "Diseño o Auditoría SAGRILAFT, PTEE y Debida Diligencia",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Intake y Datos Financieros"},
            {"agent": "analista-debida-diligencia-y-listas", "model": "flash", "role": "Cotejo de Listas y Beneficiarios Finales"}
        ],
        "wave2": [
            {"agent": "oficial-compliance-sagrilaft-ptee", "model": "pro", "role": "Oficial de Cumplimiento Senior"},
            {"agent": "especialista-penal-corporativo-y-delitos-economicos", "model": "pro", "role": "Analista Penal Corporativo"}
        ],
        "wave3": [
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor del Manual / Informe"},
            {"agent": "10-auditor-juridico-y-red-team", "model": "pro", "role": "Auditor de Cumplimiento Normativo"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador y Formato Word"}
        ]
    },
    "insolvencia": {
        "title": "Reorganización Empresarial (Ley 1116) o Reestructuración",
        "wave1": [
            {"agent": "01-intake-y-clasificador", "model": "flash_lite", "role": "Extracción de Pasivos y Acreedores"},
            {"agent": "04-analista-probatorio-y-pericial", "model": "flash", "role": "Auditor Contable y Financiero"}
        ],
        "wave2": [
            {"agent": "especialista-insolvencia-y-reestructuracion", "model": "pro", "role": "Especialista Concursal"},
            {"agent": "especialista-laboral-y-seguridad-social", "model": "pro", "role": "Graduación Pasivos Laborales"},
            {"agent": "especialista-tributario-y-aduanero", "model": "pro", "role": "Graduación Pasivos Fiscales"}
        ],
        "wave3": [
            {"agent": "06-estratega-juridico-convencional", "model": "pro", "role": "Estructuración del Acuerdo"},
            {"agent": "08-redactor-senior-juridico", "model": "pro", "role": "Redactor de Solicitud / Acuerdo"},
            {"agent": "02-compilador-y-entrega-final", "model": "flash_lite", "role": "Compilador Word"}
        ]
    }
}

def load_manifest():
    path = MANIFEST_FILE if os.path.exists(MANIFEST_FILE) else GLOBAL_MANIFEST
    if not os.path.exists(path):
        print(f"Error: No se encontró el manifiesto en {path}", file=sys.stderr)
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def list_agents():
    manifest = load_manifest()
    print(f"\n=======================================================")
    print(f"  PISOSO LEGAL AI - CATÁLOGO DE {manifest['total_agents']} AGENTES CONSOLIDADOS")
    print(f"=======================================================\n")
    
    by_category = {}
    for slug, data in manifest["agents"].items():
        cat = data["category"].upper()
        by_category.setdefault(cat, []).append((slug, data))
        
    for cat, agents in sorted(by_category.items()):
        print(f"\n📁 Categoría: {cat}")
        print("-" * 55)
        for slug, data in agents:
            tier = data["model_tier"].upper()
            tier_badge = f"[{tier}]"
            print(f"  • {data['name']} ({slug})")
            print(f"    Modelo: {tier_badge:<12} | {data['description'][:90]}...")

def get_agent_info(slug):
    manifest = load_manifest()
    if slug not in manifest["agents"]:
        print(f"Error: Agente '{slug}' no encontrado en el catálogo.", file=sys.stderr)
        sys.exit(1)
    data = manifest["agents"][slug]
    md_file = os.path.join(GLOBAL_AGENTS_DIR, data["filename"])
    print(f"\n=== Detalle del Agente: {data['name']} ===")
    print(f"Slug:       {slug}")
    print(f"Categoría:  {data['category']}")
    print(f"Modelo:     {data['model_tier']}")
    print(f"Herramientas: {data['tools']}")
    print(f"Descripción: {data['description']}")
    if os.path.exists(md_file):
        print(f"\n--- Contenido del Prompt ({md_file}) ---")
        with open(md_file, "r", encoding="utf-8") as f:
            print(f.read())

def recommend_plan(matter):
    matter_key = matter.lower().replace("-", "_")
    matched_key = None
    for k in WAVE_TEMPLATES:
        if k in matter_key or matter_key in k:
            matched_key = k
            break
    
    if not matched_key:
        print(f"Materia no encontrada directamente. Opciones disponibles: {list(WAVE_TEMPLATES.keys())}")
        matched_key = "contractual"
        
    plan = WAVE_TEMPLATES[matched_key]
    print(f"\n🎯 Plan de Orquestación en Olas: {plan['title']}")
    print("=" * 60)
    
    for wave_num, wave_key in [(1, "wave1"), (2, "wave2"), (3, "wave3")]:
        print(f"\n🌊 OLA {wave_num}:")
        for item in plan[wave_key]:
            print(f"   [Model: {item['model']:<10}] -> {item['agent']:<55} ({item['role']})")
            
    print(f"\n💡 Invocación de Ejemplo en Antigravity:")
    print("```json")
    example_subagents = []
    for item in plan["wave1"]:
        example_subagents.append({
            "TypeName": item["agent"],
            "Role": item["role"],
            "Prompt": f"Ejecutar análisis preliminar e inspección en biblioteca para el caso...",
            "Model": item["model"],
            "Workspace": "inherit"
        })
    print(json.dumps({"Subagents": example_subagents}, indent=2, ensure_ascii=False))
    print("```\n")

def main():
    parser = argparse.ArgumentParser(description="Enrutador de Agentes Pisoso Legal AI")
    parser.add_argument("--list", action="store_true", help="Listar todos los 30 agentes consolidados y sus modelos asignados")
    parser.add_argument("--info", type=str, help="Ver detalle completo y prompt de un agente específico")
    parser.add_argument("--recommend", type=str, help="Obtener plan de orquestación en olas para una materia")
    
    args = parser.parse_args()
    if args.list:
        list_agents()
    elif args.info:
        get_agent_info(args.info)
    elif args.recommend:
        recommend_plan(args.recommend)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
