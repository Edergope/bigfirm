#!/usr/bin/env python3
"""
Pisoso Legal AI - Selector Inteligente de Plantillas Word (.docx)
Mapea tipos documentales y materias jurídicas a la plantilla oficial de 'Palntillas word/'.
"""

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.dirname(SCRIPT_DIR)
TEMPLATES_DIR = os.path.join(WORKSPACE_ROOT, "Palntillas word")

# Mapeo de reglas y palabras clave a la plantilla exacta
TEMPLATE_MAPPING = {
    # 04. Concepto Jurídico
    "concepto": "04_Plantilla_Concepto_Juridico_Formal_Pisoso_Legal.docx",
    "dictamen": "04_Plantilla_Concepto_Juridico_Formal_Pisoso_Legal.docx",
    "opinion": "04_Plantilla_Concepto_Juridico_Formal_Pisoso_Legal.docx",
    "memorando": "04_Plantilla_Concepto_Juridico_Formal_Pisoso_Legal.docx",
    "consulta": "04_Plantilla_Concepto_Juridico_Formal_Pisoso_Legal.docx",

    # 05. Informe de Auditoría y Diagnóstico
    "auditoria": "05_Plantilla_Informe_Auditoria_Diagnostico_Legal_Pisoso_Legal.docx",
    "diagnostico": "05_Plantilla_Informe_Auditoria_Diagnostico_Legal_Pisoso_Legal.docx",
    "riesgos": "05_Plantilla_Informe_Auditoria_Diagnostico_Legal_Pisoso_Legal.docx",
    "compliance_report": "05_Plantilla_Informe_Auditoria_Diagnostico_Legal_Pisoso_Legal.docx",

    # 06. Debida Diligencia (Due Diligence)
    "due_diligence": "06_Plantilla_Informe_Debida_Diligencia_Legal_Pisoso_Legal.docx",
    "debida_diligencia": "06_Plantilla_Informe_Debida_Diligencia_Legal_Pisoso_Legal.docx",
    "investigacion_interna": "06_Plantilla_Informe_Debida_Diligencia_Legal_Pisoso_Legal.docx",

    # 07. Actuación Judicial (Demandas, Tutelas, Recursos, Contestaciones)
    "demanda": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "contestacion": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "tutela": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "recurso": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "apelacion": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "reposicion": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "excepciones": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "alegatos": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "incidente": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "penal_audiencia": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",
    "denuncia": "07_Plantilla_Actuacion_Judicial_Pisoso_Legal.docx",

    # 08. Actuación Administrativa
    "administrativa": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",
    "derecho_peticion": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",
    "peticion": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",
    "via_gubernativa": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",
    "oposicion_marca": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",
    "sic": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",
    "dian": "08_Plantilla_Actuacion_Administrativa_Pisoso_Legal.docx",

    # 09. Poder Especial / General
    "poder": "09_Plantilla_Poder_Especial_y_General_Pisoso_Legal.docx",
    "poder_especial": "09_Plantilla_Poder_Especial_y_General_Pisoso_Legal.docx",

    # 10. Estatutos y Constitución Societaria
    "estatutos": "10_Plantilla_Estatutos_y_Constitucion_Societaria_Pisoso_Legal.docx",
    "constitucion_sas": "10_Plantilla_Estatutos_y_Constitucion_Societaria_Pisoso_Legal.docx",
    "reforma_estatutaria": "10_Plantilla_Estatutos_y_Constitucion_Societaria_Pisoso_Legal.docx",
    "acuerdo_accionistas": "10_Plantilla_Estatutos_y_Constitucion_Societaria_Pisoso_Legal.docx",
    "sha": "10_Plantilla_Estatutos_y_Constitucion_Societaria_Pisoso_Legal.docx",

    # 11. Actas y Decisiones Societarias
    "acta": "11_Plantilla_Actas_y_Decisiones_Societarias_Pisoso_Legal.docx",
    "asamblea": "11_Plantilla_Actas_y_Decisiones_Societarias_Pisoso_Legal.docx",
    "junta_directiva": "11_Plantilla_Actas_y_Decisiones_Societarias_Pisoso_Legal.docx",

    # 12. Contratos Comerciales y Civiles
    "contrato": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "arrendamiento": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "suministro": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "prestacion_servicios": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "franquicia": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "distribucion": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "cesion": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "licencia": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",
    "spa": "12_Plantilla_Contratos_Comerciales_y_Civiles_Pisoso_Legal.docx",

    # 16. Acuerdo de Confidencialidad (NDA)
    "nda": "16_Plantilla_Acuerdo_Confidencialidad_NDA_Pisoso_Legal.docx",
    "confidencialidad": "16_Plantilla_Acuerdo_Confidencialidad_NDA_Pisoso_Legal.docx",

    # 18. Habeas Data / Datos Personales
    "datos_personales": "18_Plantilla_Autorizacion_Tratamiento_Datos_Personales_Pisoso_Legal.docx",
    "habeas_data": "18_Plantilla_Autorizacion_Tratamiento_Datos_Personales_Pisoso_Legal.docx",
    "politica_datos": "18_Plantilla_Autorizacion_Tratamiento_Datos_Personales_Pisoso_Legal.docx",

    # 01. Propuesta Comercial
    "propuesta": "01_Plantilla_Propuesta_Comercial_y_Cotizacion_Pisoso_Legal.docx",
    "cotizacion": "01_Plantilla_Propuesta_Comercial_y_Cotizacion_Pisoso_Legal.docx",

    # 02. Contrato de Servicios Jurídicos
    "contrato_servicios_juridicos": "02_Plantilla_Contrato_Prestacion_Servicios_Juridicos_Pisoso_Legal.docx",

    # Fallbacks generales
    "general": "Plantilla_Portada_y_Membrete_Pisoso_Legal.docx",
    "membrete": "Hoja_Membrete_Pisoso_Legal.docx"
}

def resolve_template(doc_type_or_hint=""):
    """Determina la ruta absoluta de la plantilla según la palabra clave o tipo documental."""
    hint = doc_type_or_hint.lower().replace("-", "_").strip()
    
    # Búsqueda exacta o por subcadena
    for key, filename in TEMPLATE_MAPPING.items():
        if key == hint or key in hint:
            target_path = os.path.join(TEMPLATES_DIR, filename)
            if os.path.exists(target_path):
                return target_path, filename

    # Fallback default
    fallback = "Plantilla_Portada_y_Membrete_Pisoso_Legal.docx"
    return os.path.join(TEMPLATES_DIR, fallback), fallback

def main():
    if len(sys.argv) > 1:
        hint = sys.argv[1]
        path, filename = resolve_template(hint)
        print(f"Plantilla seleccionada: {filename}")
        print(f"Ruta completa: {path}")
    else:
        print("Uso: python3 template_selector.py <tipo_documento_o_pista>")
        print("\nEjemplos: concepto, demanda, contrato, estatutos, nda, due_diligence, tutela")

if __name__ == "__main__":
    main()
