# LucidFence Web

Geofencing UEM/MDM local-first con dos formas de consumo compatibles.

## 1. Aplicación pública y descargable

**https://adrimg3196.github.io/lucidfence-web/**

No necesita cuenta, tarjeta, instalación, servidor Python ni backend. Guarda los datos en IndexedDB y continúa funcionando offline.

Release descargable: **https://github.com/adrimg3196/lucidfence-web/releases**

## 2. SaaS central Vercel + Supabase

El mismo frontend detecta automáticamente si existe `/api/runtime`:

- Sin backend: permanece local y offline.
- Con Vercel/Supabase: ofrece Auth, workspaces y sincronización multi-dispositivo.
- La sincronización es manual y usa control de revisión para evitar overwrites silenciosos.
- Access y refresh tokens permanecen en cookies HttpOnly.
- PostgreSQL RLS aísla cada workspace.

[Desplegar frontend en Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fadrimg3196%2Flucidfence-web&env=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY)

Antes del deploy central debe aplicarse la migración Supabase. Consulta [DEPLOY_CLOUD.md](DEPLOY_CLOUD.md).

> Vercel Hobby está limitado oficialmente a uso personal/no comercial. Para una instancia comercial hay que utilizar un plan que permita dicho uso. Supabase Free es adecuado para pruebas y pilotos, pero puede pausar proyectos y no ofrece SLA empresarial.

## Capacidades

- Flota demo y geovallas offline.
- Objetivos medibles.
- Compañía autónoma determinista.
- Ciclos seguros en Web Worker.
- Evidencia y clasificación de riesgo.
- Persistencia local mediante IndexedDB.
- Auth Supabase opcional.
- Workspaces multi-tenant con roles.
- Sincronización versionada.
- Importación y exportación del workspace.
- Service Worker para recarga offline.
- Diseño desktop y móvil.

## Aislamiento cloud

Tablas:

```text
workspaces
workspace_members
workspace_state
```

Roles:

```text
owner
admin
operator
auditor
viewer
```

Todas las tablas tenant tienen RLS habilitado y forzado. Las funciones serverless consultan Supabase con el JWT del usuario, nunca con `service_role`.

## Límites honestos

El control plane solo autoejecuta simulaciones de bajo riesgo. No ejecuta `wipe`, `lock`, `factory_reset`, `delete` ni otras mutaciones destructivas.

Para consultar una flota live que requiera una API key, el cliente debe desplegar el gateway read-only de `gateway/`. Los secretos UEM nunca deben introducirse en la PWA ni guardarse en Supabase como parte del workspace.

## Autoalojar

Descarga el repositorio o un release y publica sus archivos estáticos en GitHub Pages, Cloudflare Pages, S3, Nginx, Caddy o una intranet.

Consulta [SELF_HOST.md](SELF_HOST.md).

Para una instancia cloud propiedad del cliente, crea sus propios proyectos Vercel/Supabase y aplica [DEPLOY_CLOUD.md](DEPLOY_CLOUD.md).

## Desarrollo y QA

```bash
npm install
npm test
npm run check
```

Los tests no requieren credenciales reales.

## Seguridad

- CSP restrictiva.
- Sin scripts, fuentes o analítica de terceros.
- Sesión cloud mediante cookies HttpOnly, Secure y SameSite Strict.
- CSRF bloqueado mediante comprobación de origen.
- RLS tenant-scoped.
- Payload máximo de 1 MiB.
- Importaciones y sync con campos de secretos rechazados.
- Optimistic locking de revisiones.
- Gateway opcional read-only y CORS por origen.
- Acciones destructivas fuera del control plane.

## Licencia

Apache-2.0.
