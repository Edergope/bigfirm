#!/usr/bin/env python3
"""
Pisoso Legal AI v5.3.0 — Pure-Python JSON Schema Validator
Standard library implementation of JSON Schema Draft-07 core validation.
Supports type checking, required properties, regex patterns, enums, array items, and nested object validation without external pip dependencies.
"""

import json
import re
from typing import Dict, List, Any, Tuple, Optional

class SimpleJSONSchemaValidator:
    def __init__(self, schema: Dict[str, Any]):
        self.schema = schema

    def validate(self, instance: Any) -> List[Dict[str, Any]]:
        errors = []
        self._validate_node(instance, self.schema, "#", errors)
        return errors

    def _validate_node(self, instance: Any, schema_node: Dict[str, Any], path: str, errors: List[Dict[str, Any]]):
        if not isinstance(schema_node, dict):
            return

        expected_type = schema_node.get("type")
        if expected_type:
            type_valid, type_err = self._check_type(instance, expected_type)
            if not type_valid:
                errors.append({"path": path, "message": f"Expected type '{expected_type}', got '{type(instance).__name__}'"})
                return

        # Enum check
        if "enum" in schema_node:
            if instance not in schema_node["enum"]:
                errors.append({"path": path, "message": f"Value '{instance}' not in allowed enum {schema_node['enum']}"})

        # Pattern check
        if isinstance(instance, str) and "pattern" in schema_node:
            pattern = schema_node["pattern"]
            if not re.search(pattern, instance):
                errors.append({"path": path, "message": f"String '{instance}' does not match pattern '{pattern}'"})

        # Object check
        if isinstance(instance, dict) and expected_type == "object":
            required_props = schema_node.get("required", [])
            for req in required_props:
                if req not in instance:
                    errors.append({"path": f"{path}/{req}", "message": f"Missing required property '{req}'"})

            properties = schema_node.get("properties", {})
            for prop_name, prop_val in instance.items():
                if prop_name in properties:
                    self._validate_node(prop_val, properties[prop_name], f"{path}/{prop_name}", errors)

        # Array check
        if isinstance(instance, list) and expected_type == "array":
            items_schema = schema_node.get("items")
            if items_schema:
                for idx, item in enumerate(instance):
                    self._validate_node(item, items_schema, f"{path}[{idx}]", errors)

    def _check_type(self, instance: Any, expected_type: str) -> Tuple[bool, str]:
        if expected_type == "string":
            return isinstance(instance, str), ""
        elif expected_type == "number":
            return (isinstance(instance, (int, float)) and not isinstance(instance, bool)), ""
        elif expected_type == "integer":
            return (isinstance(instance, int) and not isinstance(instance, bool)), ""
        elif expected_type == "boolean":
            return isinstance(instance, bool), ""
        elif expected_type == "object":
            return isinstance(instance, dict), ""
        elif expected_type == "array":
            return isinstance(instance, list), ""
        elif expected_type == "null":
            return instance is None, ""
        return True, ""
