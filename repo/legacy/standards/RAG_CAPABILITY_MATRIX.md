# RAG Capability Matrix

| Capacidad | Agente | Workflow | Entrada | Salida | Auditor |
| --------- | ------ | -------- | ------- | ------ | ------- |
| Ingestión | gestor-ingestion-fuentes | ingerir-fuente-juridica | fuente sintética/metadatos | registro | auditor-procedencia-rag |
| Vigencia | verificador-vigencia-rag | verificar-vigencia-fuente | fuente/fecha | validity result | auditor-vigencia-rag |
| Chunking | fragmentador-juridico | fragmentar-fuente-juridica | normalizado | chunks | auditor-fragmentacion-rag |
| Recuperación | especialista-recuperacion-juridica | consultar-rag-juridico | query | evidence bundle | auditor-recuperacion-rag |
| Citas | generador-citas-verificadas | generar-cita-verificada | fragmento | cita | auditor-citas-rag |

## Sprint 06 — intento de carga controlada bloqueado

Se intentó iniciar Lote 1 del corpus jurídico colombiano prioritario, pero las fuentes oficiales troncales no pudieron verificarse/descargarse desde el entorno. No se simuló corpus real, no se inventaron URLs, no se cargaron fuentes secundarias como primarias y el sistema sigue no productivo.
