# GOOGLE_DRIVE_ARCHITECTURE_V1

**Estado:** PROPOSED · **Fecha:** 2026-08-21 · **Implementación:** fuera de V1

Google Drive es el **repositorio documental** inicial. **No** es la base de datos transaccional:
el estado operativo vive en PostgreSQL ([MATTER_MODEL_V1](MATTER_MODEL_V1.md)).

## 1. Estructura por matter

```
Matter (CASE-2026-001)
└── Google Drive Folder  (drive_folder_id ↔ matter_id en DB)
    ├── fuentes/            # documentos originales del cliente (read-only para agentes)
    ├── trabajo_interno/    # .md intermedios (coherente con regla de aislamiento existente)
    ├── entregables/        # .docx / .pdf finales
    ├── anexos/             # soportes
    └── metadata/           # inventario, manifests de versiones
```

## 2. Capacidades requeridas

- Crear carpeta por matter y **relacionar `drive_folder_id` ↔ `matter_id`** (en DB, no en Drive).
- Inventariar archivos (poblar `documents`/`sources`).
- Leer documentos (tool `document.read`, sujeto a `permissions.drive`).
- Guardar entregables y **versionarlos**.
- Mantener trazabilidad (sha256 por archivo en `provenance`).

## 3. Límites (regla dura)

| Sí | No |
| :-- | :-- |
| Almacenar fuentes y entregables | Guardar estado de ejecución/ledger en Drive |
| Referenciar archivos por `drive_file_id` en DB | Usar Drive como cola/orquestador |
| Versionar binarios | Confiar en Drive para consistencia transaccional |

## 4. Trazabilidad y provenance

Cada archivo relevante registra en DB: `drive_file_id`, `sha256`, `version`, `matter_id`,
`produced_by_execution_id` (si es artefacto generado). El contrato de salida ya exige
`sha256_native` + `sha256_persisted` → el entregable en Drive es verificable contra su ejecución.

## 5. Permisos

Acceso a Drive por **matter** y por **rol** (RBAC, [SECURITY_V1](SECURITY_V1.md)): un agente con
`permissions.drive: read` solo lee la carpeta de su matter. Credenciales de Drive vía Secrets
Manager, **nunca** en prompts ni repositorio. OAuth/scopes mínimos necesarios.

## 6. Alternativa / abstracción

`DocumentRepositoryAdapter` (interfaz Core) con `GoogleDriveAdapter` como primera implementación,
para no cerrar la puerta a S3/GCS/SharePoint futuros — mismo patrón que los provider adapters de
modelo. El Core habla de "repositorio documental", no de "Drive".
