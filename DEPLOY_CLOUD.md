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
https://TU_DOMINIO/api/auth/oauth/callback
```

Para previews, añade cada dominio de preview autorizado de forma explícita. El callback debe coincidir con `APP_ORIGIN`; no uses comodines amplios en producción.

## 2. Crear Vercel

Importa este repositorio en la cuenta Vercel propietaria de la instancia.

Añade únicamente:

```text
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=[REDACTED]
GOOGLE_SSO_ENABLED=true
APP_ORIGIN=https://TU_DOMINIO
OAUTH_COOKIE_SECRET=[REDACTED]
```

`OAUTH_COOKIE_SECRET` debe contener al menos 32 bytes aleatorios y guardarse únicamente como secreto de Vercel (genera uno distinto por entorno). `APP_ORIGIN` debe ser el origen HTTPS exacto, sin ruta ni query. Si se omite, el backend usa únicamente la variable de sistema `VERCEL_URL` del deployment; nunca deriva callbacks de `Host` ni `X-Forwarded-Host`. Mantén `GOOGLE_SSO_ENABLED=false` en bundles locales/estáticos.

Para Multi-UEM (opcional y siempre server-side), configura uno o varios proveedores con los nombres documentados en `.env.example`: FleetDM, Applivery, Intune, Jamf o un gateway compatible para Hexnode, Workspace ONE y ChromeOS.

El navegador llama únicamente a `GET /api/uem` incluyendo el `workspaceId` activo. `UEM_ALLOWED_WORKSPACE_IDS` vincula las credenciales server-side a uno o varios UUID de workspace; el BFF comprueba además la membresía y exige rol `owner`, `admin` u `operator` mediante RLS. Sin binding falla cerrado. Después consulta en paralelo los proveedores configurados, tolera fallos parciales, deduplica por serial/IMEI y devuelve un inventario neutral de máximo 10 000 dispositivos. Todas las integraciones son read-only; no existen rutas de lock, wipe, scripts o comandos.

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
