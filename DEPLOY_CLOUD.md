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

## 2. Crear Vercel

Importa este repositorio en la cuenta Vercel propietaria de la instancia.

Añade únicamente:

```text
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=[REDACTED]
```

Para el conector FleetDM (opcional, solo lectura), añade también:

```text
FLEET_URL=https://fleet.tuempresa.com
FLEET_API_TOKEN=[REDACTED]
FLEET_FLEET_ID=
```

El token de Fleet vive solo en el servidor. La PWA nunca lo recibe; el BFF `/api/fleet/hosts` devuelve dispositivos normalizados y no permite escrituras. GeoIP de Fleet es aproximado y jamás dispara acciones MDM.

La publishable key está diseñada para cliente público, pero aquí se usa server-side para que la PWA no dependa directamente de Supabase. Nunca configures `service_role`, `sb_secret_*`, la contraseña de Postgres ni un JWT secret.

Despliega y verifica:

```text
GET  /api/runtime
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
