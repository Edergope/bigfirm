# Google Workspace MCP — Matriz para IUSIA

**Estado:** INVENTARIO (solo documentación oficial de Google) · **Fecha:** 2026-08-21
**No configurado.** Este documento NO modifica `~/.claude.json` ni crea credenciales OAuth.
Todos los servidores están en **Google Workspace Developer Preview Program** (requiere enrolamiento).

> **Nota de callback (importante):** el redirect `https://claude.ai/api/mcp/auth_callback` que aparece
> en las guías de Google corresponde a **Claude.ai / Claude Desktop**, NO a **Claude Code CLI**.
> Para Claude Code CLI se dejará que su propio flujo OAuth gestione el callback local en la
> instalación definitiva. No usar el callback de Claude.ai para el CLI.

## 1. Matriz única

| Servidor | Endpoint MCP | API Cloud | Servicio MCP | Acceso | Estado | Ya activo aquí |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| **Docs** | `https://docsmcp.googleapis.com/mcp/v1` | docs.googleapis.com | docsmcp.googleapis.com | **R/W** | Dev Preview | No (Drive lee .gdoc) |
| **Sheets** | `https://sheetsmcp.googleapis.com/mcp/v1` | sheets.googleapis.com | sheetsmcp.googleapis.com | **R/W** | Dev Preview | No |
| **Calendar** | `https://calendarmcp.googleapis.com/mcp/v1` | calendar-json.googleapis.com | calendarmcp.googleapis.com | **R/W** | Dev Preview | **Sí** (conector activo) |
| **Gmail** | `https://gmailmcp.googleapis.com/mcp/v1` | gmail.googleapis.com | gmailmcp.googleapis.com | **R/W** | Dev Preview | **Sí** (conector activo) |
| **People** | `https://people.googleapis.com/mcp/v1` | people.googleapis.com | people.googleapis.com | **R** | Dev Preview | No |
| **Slides** | `https://slidesmcp.googleapis.com/mcp/v1` | slides.googleapis.com | slidesmcp.googleapis.com | **R/W** | Dev Preview | No |
| **Chat** | `https://chatmcp.googleapis.com/mcp/v1` | chat.googleapis.com | chatmcp.googleapis.com | **R/W** | Dev Preview | No |

> Además: **Drive** (`drivemcp.googleapis.com/mcp/v1`, R/W) ya está **activo** en este entorno vía
> conector de claude.ai (mismas 8 tools). Ya analizado aparte.

## 2. Detalle por servidor (campos 5–7 y 10)

### Docs — R/W — **prioridad ALTA**
- **Scopes:** `drive.readonly`, `drive.file`, `documents.readonly`, `documents`.
- **Tools:** `read_doc` (lee estructura + texto; `documents.get`), `update_doc` (batchUpdate:
  insertar/editar texto, estilos, estructura).
- **Utilidad IUSIA:** leer y **modificar** memoriales, conceptos, contratos y entregables
  directamente en Docs. Núcleo del flujo de redacción (agente 08) y compilación.

### Sheets — R/W — **prioridad ALTA**
- **Scopes:** `drive.readonly`, `drive.file`, `spreadsheets.readonly`, `spreadsheets`.
- **Tools:** `get_values` (lee celdas/grids), `update_values` (escribe valores/fórmulas),
  batchUpdate estructural (insertar filas/columnas, etc.).
- **Utilidad IUSIA:** matrices de **due diligence**, **cronologías**, ledgers de hechos/autoridades
  exportables, importación de datos estructurados, tableros de control de matter.

### Calendar — R/W — **prioridad MEDIA**
- **Scopes:** lectura `calendar.calendarlist.readonly`, `calendar.events.readonly`,
  `calendar.events.freebusy`; **escritura requiere scope de eventos** (`calendar.events`) — la tabla
  maestra solo listaba los de lectura; **verificar el scope de escritura en la guía de configuración**.
- **Tools:** `list_calendars`, `list_events`, `get_event`, `search_events` (R); `create_event`,
  `update_event`, `delete_event`, `respond_to_event` (W); `suggest_time`.
- **Utilidad IUSIA:** **términos procesales**, audiencias, vencimientos, disponibilidad.
  ⚠️ Ya hay un conector Calendar activo con **estas mismas tools** → no duplicar.

### Gmail — R/W (compose/draft) — **prioridad MEDIA**
- **Scopes:** `gmail.readonly`, `gmail.compose`.
- **Tools:** `search_threads`, `get_thread`, `list labels` (R); `create_draft`, `label_message` (W).
  No "send" directo documentado en el set base (compose = borradores).
- **Utilidad IUSIA:** intake de correos de clientes, recuperación de hilos como fuente.
  ⚠️ Ya hay conector Gmail activo con estas tools → no duplicar. Alta sensibilidad (ver §4).

### People — R (solo lectura) — **prioridad BAJA/MEDIA**
- **Scopes:** `directory.readonly`, `userinfo.profile`, `contacts.readonly`.
- **Tools:** `search_directory_people`, `search_contacts`, `get_user_profile`.
- **Utilidad IUSIA:** resolver partes/contactos, poblar `entity_ledger`. Marginal en V1.

### Slides — R/W — **prioridad BAJA**
- **Scopes:** `drive.readonly`, `drive.file`, `presentations.readonly`, `presentations`.
- **Tools:** `read_presentation` (R), `update_presentation` (W, 50+ operaciones batchUpdate).
- **Utilidad IUSIA:** presentaciones a cliente/junta. No es núcleo jurídico. Postergar.

### Chat — R/W — **prioridad BAJA**
- **Scopes:** `chat.spaces.readonly`, `chat.memberships.readonly`, `chat.messages.readonly`,
  `chat.messages.create`, `chat.users.readstate`.
- **Tools:** `list_messages`, `search_messages`, `search_conversations`, `mark_as_read` (R);
  `send_message`, `mark_as_unread` (W).
- **Utilidad IUSIA:** solo si la firma usa Google Chat como canal interno. Descartar en V1.

## 3. Recomendación de instalación para IUSIA

| Servidor | Recomendación | Razón |
| :-- | :-- | :-- |
| **Docs** | ✅ **Instalar (alta)** | Lectura+escritura de entregables jurídicos; núcleo de redacción/compilación |
| **Sheets** | ✅ **Instalar (alta)** | Due diligence, cronologías, ledgers, datos estructurados |
| **Calendar** | 🟡 **Diferir / usar el activo** | Ya hay conector activo; instalar la versión GCP-propia solo si se quiere control de datos propio |
| **Gmail** | 🟡 **Diferir / usar el activo** | Ya activo; alta sensibilidad → tratar con controles de §4 |
| **People** | 🟡 **Postergar** | Utilidad marginal en V1; solo lectura |
| **Slides** | 🔴 **Descartar en V1** | Fuera del núcleo jurídico |
| **Chat** | 🔴 **Descartar en V1** | Solo si se adopta Google Chat interno |

**Conjunto mínimo recomendado para desarrollo IUSIA V1:** **Docs + Sheets** (ambos R/W, ambos
requieren `docsmcp`/`sheetsmcp` + sus APIs). Calendar y Gmail: **reutilizar los conectores ya
activos** en lugar de duplicar, salvo que se decida migrar a un proyecto GCP propio por gobernanza
de datos (recomendable a futuro para una plataforma jurídica, ver §5).

## 4. Seguridad — Indirect Prompt Injection (control obligatorio en IUSIA)

Google advierte **expresamente**: al exponer un modelo a datos no confiables (correos, documentos,
hojas leídos vía MCP) existe riesgo de **inyección indirecta de instrucciones**, que puede llevar a
"modificar, robar o eliminar tus datos". Controles recomendados por Google:

1. **Solo herramientas confiables.** Nunca conectar servidores MCP de Workspace a aplicaciones no
   verificadas.
2. **No procesar fuentes no verificadas.** Evitar pedir al cliente MCP que procese correos/documentos
   de origen desconocido.
3. **Revisar siempre las acciones** del agente antes de ejecutarlas.

**Implicación para IUSIA (plataforma jurídica, R/W sobre Docs/Sheets/Gmail):**
- El contenido de documentos/hojas/correos es **DATO, no instrucción** (coherente con
  [SECURITY_V1](SECURITY_V1.md) §6). Un agente no ejecuta acciones porque un documento lo "indique".
- **Human-in-the-loop obligatorio** antes de toda acción de **escritura** (update_doc, update_values,
  create_event, send/draft) → encaja con los gates y `client_approval_required` del
  [contrato de salida](../../schemas/agent_output_contract.schema.json).
- **Aislamiento por matter** y **minimización de contexto** ([WORK_PACKAGE_V1](WORK_PACKAGE_V1.md)):
  no exponer documentos de otros matters al agente.
- Preferir **scopes de lectura** por defecto; habilitar escritura solo en los agentes que la requieren
  (Redactor 08, Compilador 02), no en todos.

## 5. Nota de gobernanza de datos (decisión futura)

Los conectores **ya activos** (Drive/Gmail/Calendar) los gestiona la plataforma claude.ai. Instalar
las versiones **Google-native bajo proyecto GCP propio** da a IUSIA control directo de: proyecto,
cliente OAuth, scopes, consent screen y política de datos — deseable para una firma jurídica. Es una
decisión a tomar en la pasada única de Google Cloud, no ahora.

## 6. Fuentes oficiales

- Configurar Workspace MCP: https://developers.google.com/workspace/guides/configure-mcp-servers
- Docs MCP: https://developers.google.com/workspace/docs/api/reference/mcp
- Sheets MCP: https://developers.google.com/workspace/sheets/api/reference/mcp
- Calendar MCP: https://developers.google.com/workspace/calendar/api/v3/reference/mcp
- Gmail MCP: https://developers.google.com/workspace/gmail/api/reference/mcp
- People MCP: https://developers.google.com/people/api/mcp
- Slides MCP: https://developers.google.com/workspace/slides/api/reference/mcp
- Chat MCP: https://developers.google.com/workspace/chat/api/reference/mcp
