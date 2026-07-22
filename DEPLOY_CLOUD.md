# Despliegue cloud de LucidFence

LucidFence ofrece dos distribuciones con la misma PWA.

## Infraestructura central

La instancia central usa una cuenta Vercel y un proyecto Supabase controlados por el operador de LucidFence. Los clientes acceden a una URL común, crean una cuenta y sincronizan workspaces aislados mediante RLS.

Importante: Vercel Hobby está documentado oficialmente para proyectos personales y uso no comercial. Una instancia comercial debe utilizar un plan de Vercel que permita ese uso. Supabase Free sirve para pruebas y pilotos, pero puede pausar proyectos con poca actividad y no aporta un SLA empresarial.

## Infraestructura del cliente

Cada cliente puede hacer fork, crear sus propios proyectos Vercel/Supabase y aplicar exactamente la misma migración. También puede usar solo el bundle estático y conservar todo en IndexedDB sin Supabase.

## Modelo de seguridad

- El navegador habla únicamente con `/api/*` en el mismo origen.
- Vercel intercambia las credenciales con Supabase Auth.
- Access y refresh tokens viven en cookies `HttpOnly; SameSite=Strict; Secure`.
- JavaScript nunca puede leer los tokens.
- Todas las consultas a PostgREST usan el JWT del usuario; nunca se usa `service_role`.
- PostgreSQL aplica RLS a `workspaces`, `workspace_members` y `workspace_state`.
- Los writes usan revisión optimista para evitar sobrescrituras silenciosas.
- Cada usuario puede ser propietario de hasta 20 workspaces en esta versión; el límite se aplica en PostgreSQL.
- El estado sincronizado tiene límite de 1 MiB y rechaza campos de secretos.

## 1. Crear Supabase

Crea un proyecto en la organización que vaya a ser propietaria de los datos. Conserva fuera del repositorio cualquier contraseña o secreto.

Instala una versión fijada de la CLI oficial como dependencia de desarrollo y ejecútala mediante `npx`:

```bash
npm install --save-dev supabase@2.109.1
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

`npx supabase db push` aplica:

```text
supabase/migrations/202607210001_initial.sql
supabase/migrations/202607220001_revision_conflict_status.sql
supabase/migrations/202607220002_workspace_uem_connectors.sql
supabase/migrations/202607220003_connector_server_proof.sql
supabase/migrations/202607220004_exact_connector_envelope.sql
supabase/migrations/202607220005_fix_connector_upsert_conflict.sql
supabase/migrations/202607220006_dedicated_connector_rpc_secret.sql
```

Después configura en Supabase Auth:

- Site URL: dominio final de Vercel.
- Redirect URLs: dominio final y previews autorizadas.
- Confirmación de email: activada.
- SMTP propio: recomendado antes de producción.
- MFA de la cuenta propietaria: activado.

### Google SSO mediante Supabase Auth (opcional)

Supabase Auth actúa como broker OIDC: Vercel no recibe ni valida directamente un Google ID token. En Google Cloud Console habilita el proveedor OAuth de Supabase y registra como **Authorized redirect URI** exactamente:

```text
${SUPABASE_URL}/auth/v1/callback
```

En Supabase, activa Google en **Authentication > Providers** con las credenciales de Google. En **Authentication > URL Configuration**, añade a la allowlist de redirect URLs cada callback de LucidFence que vayas a servir, por ejemplo:

```text
https://TU_DOMINIO/api/auth/oauth/callback?flow=*
```

El `flow` es un correlador base64url aleatorio de 256 bits y cambia en cada login. Por eso la entrada autorizada incluye `?flow=*`; el comodín queda limitado a ese único valor y no debe ampliarse al host ni al path. Si `APP_ORIGIN` coincide con la **Site URL**, GoTrue también acepta el callback por compartir exactamente esquema, host y puerto, preservando su query. Para previews, añade cada dominio de preview autorizado de forma explícita con el mismo path y patrón de query. El callback debe coincidir con `APP_ORIGIN`; no uses comodines de dominio o path en producción.

Supabase GoTrue posee el parámetro OAuth superior `state`: crea un UUID interno, lo envía a Google y lo consume en `${SUPABASE_URL}/auth/v1/callback`. LucidFence **no** envía ni espera un `state` propio en `/auth/v1/authorize`. El binding de navegador/login-CSRF usa dos piezas independientes:

1. una cookie AEAD `HttpOnly` de un solo uso que contiene `flowId`, PKCE verifier, fecha y destino;
2. el mismo `flowId` únicamente dentro del `redirect_to` como `?flow=<id>`.

Al completar Google, GoTrue conserva esa query y añade `code`; el callback final de LucidFence recibe únicamente `flow` + `code` (o `flow` + `error`), compara `flow` en tiempo constante con la cookie y canjea una sola vez en `POST /auth/v1/token?grant_type=pkce` con JSON `{ "auth_code": "...", "code_verifier": "..." }`. El UUID `state` interno de GoTrue nunca llega a LucidFence.

## 2. Crear Vercel

Importa este repositorio en la cuenta Vercel propietaria de la instancia.

Añade únicamente:

```text
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=[REDACTED]
GOOGLE_SSO_ENABLED=true
APP_ORIGIN=https://TU_DOMINIO
OAUTH_COOKIE_SECRET=[REDACTED]
UEM_SECRETS_ENCRYPTION_KEY=[REDACTED]
UEM_CONNECTOR_RPC_SECRET=[REDACTED]
```

`OAUTH_COOKIE_SECRET`, `UEM_SECRETS_ENCRYPTION_KEY` y `UEM_CONNECTOR_RPC_SECRET` deben ser valores independientes con al menos 32 bytes aleatorios. La clave `UEM_SECRETS_ENCRYPTION_KEY` cifra exclusivamente los sobres AES-256-GCM. `UEM_CONNECTOR_RPC_SECRET` autentica las llamadas internas BFF→RPC y su preimage solo vive en Vercel; Supabase conserva únicamente su SHA-256 público.

Antes de `supabase db push`, genera el secreto RPC una sola vez, añade ese mismo valor a Vercel y crea su migración verificadora sin imprimirlo:

```bash
export UEM_CONNECTOR_RPC_SECRET="$(openssl rand -base64 32)"
npm run connector:verifier -- --write
npx supabase db push
npm run connector:verifier
```

El primer comando mantiene el valor solo en la shell actual; añádelo a Preview y Production desde el gestor de secretos de Vercel antes de cerrar esa shell. `--write` crea una migración nueva y fechada; nunca reescribe una migración ya aplicada. El último comando falla si la variable y la última migración no coinciden. Repite este procedimiento al rotar el secreto RPC. Rotar `UEM_SECRETS_ENCRYPTION_KEY` es una operación distinta: obliga a volver a guardar los conectores porque los sobres anteriores fallan cerrados.

`APP_ORIGIN` debe ser el origen HTTPS canónico exacto (`https://host`): sin slash final, puerto explícito, punto final en el hostname, userinfo, ruta, query ni fragment. Si se omite, el backend usa únicamente la variable de sistema `VERCEL_URL` del deployment; nunca deriva callbacks de `Host` ni `X-Forwarded-Host`. Mantén `GOOGLE_SSO_ENABLED=false` en bundles locales/estáticos.

Para Multi-UEM, un owner o admin abre **Conectar** en el dashboard, elige FleetDM, Applivery, Intune, Jamf o un gateway compatible y pega una credencial de solo lectura. `PUT /api/uem/connectors` comprueba el rol antes de contactar al proveedor, valida la conexión real y solo entonces cifra con AES-256-GCM y AAD ligado a `workspaceId + provider`. Supabase guarda únicamente un sobre de tamaño fijo. Si la prueba falla, no se persiste nada. `GET /api/uem/connectors` devuelve esquema, estado, fecha e identidad no secreta del entorno —host, tenant u organización—; nunca devuelve plaintext, fingerprints del secreto ni ciphertext. Owner/admin pueden rotar o eliminar; operator puede sincronizar; viewer/auditor quedan sin capacidad de uso o gestión.

`GET /api/uem` comprueba sesión, membresía y rol mediante RLS/RPC, descifra el sobre solo dentro de la función serverless y lo entrega en memoria al adaptador read-only. Consulta proveedores en paralelo, tolera fallos parciales, deduplica por serial/IMEI y limita la respuesta a 10 000 dispositivos. No existen rutas de lock, wipe, scripts o comandos. Las variables por proveedor de `.env.example` y `UEM_ALLOWED_WORKSPACE_IDS` permanecen solo como fallback legacy para despliegues administrados por el operador; no son necesarias cuando las credenciales se gestionan desde el dashboard.

La publishable key está diseñada para cliente público, pero aquí se usa server-side para que la PWA no dependa directamente de Supabase. Nunca configures `service_role`, `sb_secret_*`, la contraseña de Postgres ni un JWT secret.

Despliega y verifica:

```text
GET  /api/runtime
GET  /api/auth/oauth/providers
GET  /api/auth/oauth/start?provider=google
GET  /api/auth/oauth/callback
POST /api/auth/signup
POST /api/auth/login
GET  /api/auth/me
GET  /api/workspaces
POST /api/workspaces
GET  /api/workspaces/state?workspaceId=UUID
PUT  /api/workspaces/state
GET  /api/uem/connectors?workspaceId=UUID
PUT  /api/uem/connectors
DELETE /api/uem/connectors
GET  /api/uem?provider=status&workspaceId=UUID
GET  /api/uem?provider=all&workspaceId=UUID
```

## 3. Validación

```bash
npm test
npm run check
```

Crea dos usuarios y dos workspaces. Verifica que cada usuario recibe solo sus membresías y que un UUID de otro tenant devuelve una lista vacía o acceso denegado por RLS.

## Portabilidad

El botón Exportar produce un workspace local. El cliente puede descargarlo, usar la PWA offline, desplegar este repositorio en otra cuenta o aplicar las migraciones en su propio Supabase.

No existe bloqueo obligatorio con la infraestructura central.
