# Política de fuentes

## Prioridad de fuentes oficiales

Se priorizan Constitución, leyes, decretos, actos administrativos, jurisprudencia y fuentes institucionales oficiales.

## Vigencia

Toda fuente debe verificarse antes de usarse como fundamento definitivo.

## Jerarquía normativa

El análisis debe respetar jerarquía normativa y competencia de la autoridad emisora.

## Derogatorias y modificaciones

Registrar derogatorias, modificaciones, suspensiones o condicionamientos conocidos.

## Jurisprudencia

Identificar corporación, sala, fecha, radicado, magistrado ponente cuando aplique y fuente de consulta.

## Doctrina

La doctrina oficial debe diferenciarse de opiniones privadas o académicas.

## Fuentes no oficiales

Pueden orientar búsqueda, pero no ser fundamento definitivo sin verificación oficial.

## Fecha de consulta

Toda fuente incorporada debe registrar fecha de consulta.

## Prohibición

No usar fuentes no verificadas como fundamento definitivo.

## Micro Sprint 03A — investigación ampliada

Las investigaciones normativas, jurisprudenciales, doctrinales, regulatorias, históricas, comparadas y territoriales deben registrar fuente, autoridad, fecha, vigencia, método de consulta y límites de uso. Las fuentes comparadas no se usan como fundamento definitivo de derecho colombiano sin explicar diferencias institucionales y aplicabilidad. Los antecedentes legislativos, documentos de política pública y datos económicos se tratan como insumos, no como norma vigente.


## Anexo Micro Sprint 03B — arquitectura contractual, reestructuración e insolvencia

Pisoso Legal AI reconoce la arquitectura contractual como capacidad transversal: auditoría, arquitectura, despliegue e integridad. Antes de redactar contratos complejos debe comprender negocio, objetivo jurídico/económico, partes, obligaciones, restricciones, estructura, elementos típicos y atípicos, riesgos de recalificación, garantías, incumplimiento, adaptación, terminación, consecuencias concursales y ejecutabilidad.

Los casos de startup, inversión, reorganización, insolvencia, salvamento, novación, renegociación y paquetes documentales deben usar órdenes sucesivas de diagnóstico, estrategia, arquitectura documental, redacción y auditoría. Se prohíben estructuras para ocultar activos, defraudar acreedores, simular operaciones o alterar prelaciones.

## Micro Sprint 03C — núcleo empresarial, compliance, LA/FT/FPADM, PI y franquicias

Se incorporan agentes y workflows profundos para M&A, due diligence, tributario, penal empresarial, penal tributario, compliance, LA/FT/FPADM, investigaciones internas, propiedad intelectual, marcas, software, transferencia tecnológica y franquicias. Toda salida requiere revisión humana; ningún agente declara delitos, garantiza registros, reporta a autoridades o aprueba documentos finales automáticamente.

Rutas ejemplo: compra de empresa → fusiones-adquisiciones → due diligence integral → tributario/laboral/compliance/penal empresarial/PI → arquitectura contractual → auditoría M&A. Programa de cumplimiento → diagnóstico → riesgo corporativo → LA/FT/FPADM + anticorrupción + penal empresarial → programa → auditoría. Expansión por franquicia → diagnóstico de franquiciabilidad → marcas + secretos + contractual + tributario → paquete documental → auditoría de franquicia.

## Sprint 05 — Arquitectura RAG 0.5.0

Se incorpora arquitectura técnica, documental y jurídica del RAG. Los agentes pueden solicitar evidence bundles, citas verificadas, autoridad, vigencia, temporalidad, conflictos y abstención. No se han cargado fuentes jurídicas reales masivamente ni conectado servicios externos. Ninguna fuente es fundamento definitivo sin procedencia, autoridad, integridad, vigencia, versión, ubicación exacta y revisión humana cuando aplique.

## Sprint 06 — intento de carga controlada bloqueado

Se intentó iniciar Lote 1 del corpus jurídico colombiano prioritario, pero las fuentes oficiales troncales no pudieron verificarse/descargarse desde el entorno. No se simuló corpus real, no se inventaron URLs, no se cargaron fuentes secundarias como primarias y el sistema sigue no productivo.

## Protocolo de Abstención y Solicitud Activa de Información

Ante cualquier caso, consulta o problema para el cual el sistema no esté preparado (por carecer de corpus temático indexado) o cuando no posea la información de soporte suficiente para dar una respuesta con total certeza, el sistema **debe abstenerse de formular inferencias o deducir respuestas**. Es obligatorio que el flujo de trabajo se detenga y solicite al usuario o abogado director la información complementaria, hechos aclaratorios o los documentos físicos necesarios.

## Lista de Sitios Web de Confianza para Investigación Externa

Cuando el RAG local resulte insuficiente o carezca de información para un caso, el agente investigador podrá recurrir de forma complementaria a la investigación web. No obstante, las consultas deben limitarse **estrictamente** a dominios y sitios web de confianza pública oficial de la República de Colombia. Los sitios autorizados son:

1. **Corte Constitucional de Colombia:** `https://www.corteconstitucional.gov.co` (Jurisprudencia constitucional y sentencias de tutela/constitucionalidad).
2. **Corte Suprema de Justicia:** `https://cortesuprema.gov.co` (Jurisprudencia de casación en materias civil, penal y laboral).
3. **Consejo de Estado:** `https://www.consejodeestado.gov.co` (Jurisprudencia administrativa y conceptos de la Sala de Consulta).
4. **Secretaría General del Senado:** `http://www.secretariasenado.gov.co` (Texto oficial de la Constitución, leyes, códigos y estatutos vigentes).
5. **Departamento Administrativo de la Función Pública (Gestor Normativo DAFP):** `https://www.funcionpublica.gov.co/eva/gestornormativo` (Decretos reglamentarios, resoluciones y directivas administrativas).
6. **Dirección de Impuestos y Aduanas Nacionales (DIAN):** `https://www.dian.gov.co` (Doctrina tributaria, conceptos oficiales de impuestos y aduanas).
7. **Superintendencia de Sociedades (SuperSociedades):** `https://www.supersociedades.gov.co` (Conceptos, autos, resoluciones e insolvencia societaria/mercantil).

Queda estrictamente prohibido utilizar blogs, foros o portales de noticias jurídicas privadas como fuente formal para justificar y estructurar conceptos legales sin contrastarlos con estas fuentes oficiales.

