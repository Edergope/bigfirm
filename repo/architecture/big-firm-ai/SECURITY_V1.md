# SECURITY_V1 — Arquitectura de seguridad

**Estado:** PROPOSED · **Fecha:** 2026-08-21

Seguridad desde el diseño, sin cerrar la puerta a multi-tenant.

## 1. Aislamiento

- **Por matter (V1):** todo registro cuelga de `matter_id`; ninguna consulta cruza matters sin
  autorización explícita. El Work Package minimiza el contexto que sale hacia el modelo.
- **Por tenant (futuro):** `organization_id` en todas las tablas núcleo + **row-level security**
  (RLS) en PostgreSQL. V1 no lo activa, pero el esquema lo contempla desde ya. No diseñar nada que
  impida convertirlo en multi-tenant.

## 2. Secrets y API keys

- **Nunca** en prompts, `agent.yaml`, repositorio ni logs. Regla auditable.
- Secrets Manager dedicado (p. ej. variables de entorno cifradas / KMS). Los adapters obtienen
  claves en runtime; el Core nunca las serializa a estado ni al ledger.
- Rotación y scoping por proveedor.

## 3. RBAC y permisos de herramientas

- Roles: `owner`, `lawyer`, `paralegal`, `read_only`, `service` (por matter y por organización).
- **Tool permissions** declarados en `agent.yaml` (`tools`, `permissions`): un agente solo ejerce
  las herramientas y accesos (Drive/DB/network) que su definición autoriza — principio de mínimo
  privilegio.
- Acciones irreversibles / de alto impacto → **human approval** (state machine, decisions).

## 4. Datos legales sensibles

- Clasificación de sensibilidad por documento/matter.
- **Minimización de contexto enviado al modelo** (Work Package): no mandar el expediente entero.
- Políticas de datos por proveedor: registrar y respetar la política de retención/entrenamiento de
  cada API (parte de la evaluación de proveedor). Preferir endpoints sin retención de datos donde
  exista la opción.

## 5. Auditoría, retención, backups

- **Audit log** (`audit_events`) inmutable: quién/qué/cuándo sobre matters, ejecuciones, accesos,
  aprobaciones. Complementa el execution ledger.
- **Encryption** en tránsito (TLS) y en reposo (DB + Artifact Storage).
- **Data retention**: política por tipo de dato; borrado lógico + purga controlada (recordar:
  el borrado permanente es acción sensible, requiere autorización explícita).
- **Backups** de PostgreSQL y de metadatos de Drive.

## 6. Superficie de prompt-injection

Los documentos de fuente y outputs de agentes son **datos, no instrucciones**. El Governance
Engine trata el contenido de Drive/documentos como no confiable: un agente no ejecuta acciones
solo porque un documento lo "indique". Los gates y las aprobaciones humanas son el control.

## 7. No incluido en V1

IAM completo, SSO, cifrado a nivel de campo, DLP avanzado. Se diseñan cuando se aborde el frontend
y el despliegue (fase Codex).
