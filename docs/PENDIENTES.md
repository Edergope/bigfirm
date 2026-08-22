# IUSIA — Dependencias externas pendientes

Lo que quedó **preparado pero no conectado**, con la razón exacta. Nada de esto es
un mock presentado como funcionalidad: las rutas existen y fallan de forma explícita
hasta que se aprovisione la credencial correspondiente.

## 1. Cuenta y recursos de Cloudflare

`apps/web/wrangler.jsonc` tiene `database_id: "REPLACE_WITH_D1_DATABASE_ID"`.
Para desplegar hay que crear los recursos reales:

```bash
pnpm --filter @iusia/web exec wrangler d1 create iusia-db
pnpm --filter @iusia/web exec wrangler r2 bucket create iusia-prompts
pnpm --filter @iusia/web exec wrangler r2 bucket create iusia-artifacts
```

y pegar el `database_id` devuelto en `wrangler.jsonc`.

El desarrollo local **no** lo necesita: Miniflare emula D1 y R2 y el flujo completo
ya se validó así.

## 2. AI Gateway — capa de modelos

Estado: **la única pieza del vertical slice que no se pudo ejecutar contra el servicio real.**

`ModelGateway` llama al endpoint compatible del AI Gateway. Sin `CLOUDFLARE_ACCOUNT_ID`
real y un gateway creado, toda ejecución de agente termina en `PROVIDER_ERROR` — que es
exactamente lo que se observó en la verificación local, y queda registrado en el
Execution Ledger como fallo real, no como éxito simulado.

Para activarlo:

```bash
pnpm --filter @iusia/web exec wrangler secret put CLOUDFLARE_ACCOUNT_ID
pnpm --filter @iusia/web exec wrangler secret put AI_GATEWAY_TOKEN
```

y crear un gateway llamado `iusia` en el panel de Cloudflare, con las claves de
OpenAI y Google configuradas allí (no en el repo).

Pendiente comercial asociado: las tarifas de `MODEL_RATES` en
`apps/web/src/worker/services/model-gateway.ts` son **costo upstream estimado**,
no precio de venta. La fórmula de IUSIA Credits debe fijarse contra facturación real
(Blueprint §12).

## 3. Google Drive — documentos de usuario

Estado: **modelado y persistido, no conectado.**

- La tabla `documents` y `DocumentRepository` existen y funcionan.
- `POST /api/matters/:id/documents` vincula un `drive_file_id` ya seleccionado.
- **Falta** el Google Picker en el frontend y el OAuth de Google, que requieren
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` de una app de Google Cloud.

Mientras tanto la pestaña Documentos del workspace lo dice de forma explícita en la UI.

No implementado todavía (Blueprint §07, fase 3): `changes/watch` de Drive → Worker →
Queue, Drive Activity API, y espejo normalizado en R2.

## 4. Notificaciones (Resend)

No implementado. `requireEmailVerification` está en `false` en Better Auth porque no
hay proveedor de correo. Al añadir Resend detrás de un `NotificationService` propio,
activar la verificación de email.

## 5. AI Search / RAG

No implementado, y **así debe quedar** hasta el POC de aislamiento que exige el
Blueprint §03 ("POC antes de compromiso productivo"): hay que validar tenant isolation,
filtrado por matter y recall antes de usarlo como búsqueda jurídica real.

## 6. Stripe

Diferido por decisión del Blueprint §03. El Credit Ledger de IUSIA ya existe y es
autoridad contable; Stripe sólo aportará el cobro de dinero.

## 7. Git remoto y CI/CD

El repositorio git **ya está inicializado** localmente (`main`, con baseline
`foundation-v0.1` y trabajo posterior) y `origin` apunta a
`https://github.com/Edergope/bigfirm.git`. **El push está BLOQUEADO**: no hay
credenciales de escritura (no hay `gh` instalado ni token de git). Para publicar:

```bash
# Autenticarse (una vez) y luego:
git push -u origin main
git push origin --tags
```

La cuenta de Cloudflare **sí** está autenticada en wrangler
(`edergonzalezpe@gmail.com`, account `a5c1f73aafac11795dbf5192c7a87817`), por lo que
`wrangler deploy` resuelve la cuenta automáticamente. Falta crear los recursos
(D1/R2/Queues) y pegar el `database_id` real en `wrangler.jsonc`.

## 8. Desfase de versión en Better Auth CLI

`@better-auth/cli` publicado (1.4.x) va por detrás de `better-auth` 1.7.1 y no emite
el campo `issuer` de la tabla `account`. Está añadido a mano en
`packages/db/src/schema/auth.ts` con un comentario. **Al actualizar la CLI, regenerar
y comprobar si el parche sigue siendo necesario.**
