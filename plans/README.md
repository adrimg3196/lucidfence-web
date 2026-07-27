# Planes de implementación

Generados con la skill `improve` el 2026-07-27 contra `fb49e57`. Ejecutar en orden; no publicar hasta superar el gate final.

| Plan | Título | Prioridad | Esfuerzo | Depende de | Estado |
|---|---|---|---|---|---|
| 001 | Publicar todos los módulos de la PWA en GitHub Pages | P1 | S | — | DONE |
| 002 | Publicar y verificar el snapshot SaaS final | P1 | S | 001 | IN PROGRESS |

## Dependencias
001 bloquea la verificación pública de la distribución local-first. 002 solo puede ejecutar la publicación cuando 001 y todos los gates estén aprobados.

## Hallazgos considerados y rechazados
- Invertir la semántica `min`/`max` de objetivos: rechazado tras vetting. En LucidFence `min` significa mínimo exigido (`compliance >= target`) y `max` máximo permitido (`critical_devices <= target`); `tests/goal_templates.test.mjs:16-23` confirma el contrato actual.
- Convertir ahora BYOI estático en un segundo SaaS de conectores: rechazado para este cierre; el SaaS central ya cubre conectores gestionados y BYOI conserva gateway/importación local sin cuenta cloud.
- Eliminar `index.html`/`web.html` duplicados: deuda real pero no bloquea funcionamiento; se difiere para no ampliar el diff de release.
- Eliminar `undici`: rechazado; se usa `Agent` para fijar DNS después de validación SSRF.
- Sustituir seguridad, validación o accesibilidad por menos código: rechazado; Ponytail excluye explícitamente esas áreas de la simplificación.

## Procedencia de las skills
- Ponytail: commit `16f29800fd2681bdf24f3eb4ccffe38be3baec6b`, licencia MIT. Aplicado como escalera YAGNI/reutilización/stdlib y exigencia de un check mínimo.
- Improve: commit `03369ee6d7cafbfcecc4346539b05b3dc0a603bb`, licencia MIT. Aplicado en modo advisor read-only; solo este directorio de planes fue escrito durante la auditoría.
