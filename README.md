# LucidFence Web

Geofencing UEM/MDM gratuito, browser-only y local-first.

## Abrir

La aplicación pública se sirve mediante GitHub Pages:

**https://adrimg3196.github.io/lucidfence-web/**

No necesita cuenta, tarjeta, instalación, servidor Python ni backend de LucidFence.

## Qué funciona sin infraestructura adicional

- Flota demo y geovallas offline.
- Objetivos medibles.
- Compañía autónoma determinista.
- Ciclos seguros en Web Worker.
- Evidencia y clasificación de riesgo.
- Persistencia en IndexedDB.
- Importación y exportación del workspace.
- Service Worker para recarga offline.
- Diseño desktop y móvil.

Los datos permanecen en el navegador. La PWA no envía telemetría a LucidFence.

## Límites honestos

El modo público simula operaciones: no ejecuta wipe, lock, factory reset ni otras mutaciones UEM.

Para consultar una flota live que requiera una API key, el cliente debe desplegar el gateway read-only incluido en `gateway/` dentro de su propia cuenta Cloudflare o infraestructura. Los secretos nunca deben introducirse en la PWA.

## Autoalojar

Descarga el repositorio o un release y publica sus archivos estáticos en GitHub Pages, Cloudflare Pages, S3, Nginx, Caddy o una intranet.

Consulta [SELF_HOST.md](SELF_HOST.md).

## Integridad

`SHA256SUMS` contiene el hash de cada archivo del bundle. El paquete se genera de forma reproducible y no incluye Python, base de datos ni backend central.

## Seguridad

- CSP restrictiva.
- Sin scripts o fuentes de terceros.
- Sin analítica.
- Importaciones con secretos rechazadas.
- Gateway opcional read-only y CORS por origen.
- Acciones destructivas fuera del control plane.

## Licencia

Apache-2.0.
