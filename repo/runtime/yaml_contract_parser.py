#!/usr/bin/env python3
"""
Pisoso Legal AI v5.3.0 — Pure-Python YAML Contract Parser
Parses structured AGENT_OUTPUT YAML contracts from deliverables without external pyyaml dependency.
Robustly parses nested sublists (e.g. fact_refs, authority_refs) inside list elements.
"""

import re
import json
from typing import Dict, List, Any, Optional

class SimpleYAMLContractParser:
    """Parses standard nested YAML dictionaries and lists with key: value pairs."""
    
    @staticmethod
    def parse_frontmatter(content: str) -> Optional[Dict[str, Any]]:
        yaml_match = re.search(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
        if not yaml_match:
            yaml_block_match = re.search(r"```yaml\s*\n(AGENT_OUTPUT:.*?)\n```", content, re.DOTALL | re.IGNORECASE)
            if not yaml_block_match:
                return None
            raw_yaml = yaml_block_match.group(1)
        else:
            raw_yaml = yaml_match.group(1)

        return SimpleYAMLContractParser._parse_yaml_lines(raw_yaml)

    @staticmethod
    def _parse_yaml_lines(raw_text: str) -> Dict[str, Any]:
        """Inductive line-by-line parser for structured YAML contracts."""
        lines = [line.rstrip() for line in raw_text.split("\n") if line.strip() and not line.strip().startswith("#")]
        
        root: Dict[str, Any] = {}
        current_section: Optional[str] = None
        current_dict_item: Optional[Dict[str, Any]] = None
        current_sublist_name: Optional[str] = None

        for line in lines:
            indent = len(line) - len(line.lstrip())
            stripped = line.strip()

            if stripped in ["AGENT_OUTPUT:", "AGENT_OUTPUT"]:
                continue

            # Section header (indent == 0, ends with ":")
            if indent == 0 and stripped.endswith(":"):
                current_section = stripped[:-1].strip()
                current_dict_item = None
                current_sublist_name = None
                if current_section in ["fact_assertions", "numerical_assertions", "legal_propositions", "entities_used", "recommended_actions", "unknowns"]:
                    root[current_section] = []
                elif current_section in ["nba", "provenance"]:
                    root[current_section] = {}
                continue

            # Top-level list item in current_section: "- key: val"
            if indent <= 2 and stripped.startswith("- "):
                item_content = stripped[2:].strip()
                current_sublist_name = None

                if current_section and isinstance(root.get(current_section), list):
                    if ":" in item_content:
                        k, v = item_content.split(":", 1)
                        current_dict_item = {k.strip(): SimpleYAMLContractParser._coerce_val(v.strip())}
                        root[current_section].append(current_dict_item)
                    else:
                        root[current_section].append(SimpleYAMLContractParser._coerce_val(item_content))
                continue

            # Nested sublist items inside a dict item (indent >= 4, starts with "- ")
            if current_dict_item is not None and current_sublist_name and stripped.startswith("- "):
                sub_val = stripped[2:].strip()
                if isinstance(current_dict_item.get(current_sublist_name), list):
                    current_dict_item[current_sublist_name].append(SimpleYAMLContractParser._coerce_val(sub_val))
                continue

            # Key-value inside dictionary item of list (indent >= 4)
            if current_dict_item is not None and indent >= 4 and ":" in stripped:
                k, v = stripped.split(":", 1)
                k = k.strip()
                v = v.strip()
                if not v: # Sublist declaration, e.g. "fact_refs:"
                    current_sublist_name = k
                    current_dict_item[k] = []
                else:
                    current_sublist_name = None
                    current_dict_item[k] = SimpleYAMLContractParser._coerce_val(v)
                continue

            # Key-value inside section dictionary (e.g. provenance: or nba:)
            if current_section and isinstance(root.get(current_section), dict) and indent >= 2 and ":" in stripped:
                k, v = stripped.split(":", 1)
                root[current_section][k.strip()] = SimpleYAMLContractParser._coerce_val(v.strip())
                continue

            # Root-level key: value
            if indent == 0 and ":" in stripped:
                k, v = stripped.split(":", 1)
                root[k.strip()] = SimpleYAMLContractParser._coerce_val(v.strip())
                current_section = None
                current_dict_item = None
                current_sublist_name = None
                continue

        return root

    @staticmethod
    def _coerce_val(val: str) -> Any:
        val = val.strip().strip("'\"")
        if val.lower() == "true":
            return True
        if val.lower() == "false":
            return False
        if val.lower() in ["null", "none", ""]:
            return None
        if len(val) == 64 and re.match(r"^[a-f0-9]+$", val):
            return str(val)
        if re.match(r"^-?\d+$", val):
            return int(val)
        if re.match(r"^-?\d+\.\d+$", val):
            return float(val)
        return str(val)
