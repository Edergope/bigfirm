# Sprint 06 Browser Acquisition Report

## Navegador utilizado

Codex In-app Browser con navegación visual de páginas oficiales. La solicitud pedía navegador externo; en este entorno el navegador controlable disponible fue el navegador integrado de Codex.

## Dominio oficial usado

- `www.funcionpublica.gov.co` — EVA Gestor Normativo, portal estatal colombiano.

## Fuentes descargadas

| Constitución Política 1 de 1991 Asamblea Nacional Constituyente | www.funcionpublica.gov.co | approved_source | review_required | 263 | `545224a8eb3e4ebe49b743f37cad3d42321bfe981428a098fdab15b1eaad88e7` |
| Decreto 410 de 1971 — Código de Comercio | www.funcionpublica.gov.co | approved_source | review_required | 221 | `f43e6c78871241871c9bef2350b9dbef5fe5a4309fbaaec67735d5b448f7e681` |
| Ley 1564 de 2012 — Código General del Proceso | www.funcionpublica.gov.co | approved_source | review_required | 151 | `62715c868da25cea92bcabf3ceb386c8499e43e166668f24b12bf960ac2a866b` |
| Ley 1437 de 2011 — CPACA | www.funcionpublica.gov.co | approved_source | review_required | 128 | `6883aad1cae0be99d57833cec380d82cbf7fb9dc88e2ebe8a5d13cacf5108be7` |
| Ley 1755 de 2015 — Derecho de petición | www.funcionpublica.gov.co | approved_source | review_required | 7 | `7bd770a1bafb4f787f9d53a774aa81e737b858b20948a997a3ac66381c6cc655` |
| Decreto 2591 de 1991 — Acción de tutela | www.funcionpublica.gov.co | approved_source | review_required | 9 | `e2bc61ebdfdfc1d7d6d4cd3a7754858eda6d1f3f17793c6e0d2db9c3306f1687` |
| Ley 2220 de 2022 — Estatuto de Conciliación | www.funcionpublica.gov.co | approved_source | review_required | 43 | `a8d724cf9adbac40a0ff727378782e3fff1d84f90149408c6b7ff4e207b8eaeb` |
| Ley 527 de 1999 — Mensajes de datos | www.funcionpublica.gov.co | approved_source | review_required | 12 | `abe444333053302a8399fb11fa8f3b999dee1432baaa0cd148f380f1abe252bc` |
| Decreto 2364 de 2012 — Firma electrónica | www.funcionpublica.gov.co | approved_source | review_required | 2 | `9dffa4a9e1c8e007798ff276ef5959bce49b70e74f484a682bd366f78e2a8286` |

## Ruta de navegación

1. Apertura visual de EVA Gestor Normativo.
2. Uso del buscador interno `dafpIndexerBGN/norma/index`.
3. Apertura de ficha `norma.php?i=...`.
4. Verificación visual de título, entidad, botón `Descargar PDF`, temas/vigencias y advertencia del repositorio.
5. Descarga desde `norma_pdf.php?i=...`.
6. Validación local con `pdfinfo`, SHA-256 y capturas.

## Capturas

Capturas guardadas en `rag-ingestion/downloads/sprint-06-lote-01/screenshots/`.

## Fallos

- Secretaría Senado Constitución: timeout previo por terminal.
- Corte Constitucional PDF Constitución: 404 previo.
- Secretaría Senado Código Civil: timeout por navegador.
- EVA Código Civil: no se obtuvo ficha exacta; resultados imprecisos.

## Clasificación

Las 9 fuentes adquiridas quedan aprobadas solo como fuente oficial/informativa estatal y pendientes de revisión humana de vigencia. No se indexan productivamente.
