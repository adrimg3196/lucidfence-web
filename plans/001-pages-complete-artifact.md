# Plan 001: Garantizar que GitHub Pages publica todos los módulos de la PWA

> Executor: sigue cada paso y detente si el snapshot cambió. No publiques ni hagas push hasta superar todos los gates.
>
> Drift check: `git diff --stat fb49e57..HEAD -- .github/workflows/pages.yml tests/deployment_contract.test.mjs index.html`

## Estado
- Prioridad: P1
- Esfuerzo: S
- Riesgo: LOW
- Dependencias: ninguna
- Categoría: bug/tests
- Planificado en: `fb49e57`, 2026-07-27

## Por qué importa
El despliegue público en GitHub Pages devuelve 404 para `web-uem.js` y `web-fleet.js`; por ello `LucidFenceApp`, `LucidFenceUem` y `LucidFenceFleet` quedan sin definir. La prueba actual solo comprueba que el workflow ejecuta QA, no que el artefacto contenga todos los scripts que carga `index.html`.

## Estado actual
- `.github/workflows/pages.yml:33-38` copia una allowlist estática a `_site`, pero omite `web-uem.js` y `web-fleet.js`.
- `index.html` carga ambos módulos antes de `web-app.js`.
- `tests/deployment_contract.test.mjs:60-65` no contrasta la allowlist con los `<script src>` reales.
- Evidencia viva: `https://adrimg3196.github.io/lucidfence-web/web-uem.js` y `/web-fleet.js` devolvieron 404; los tres globals de aplicación quedaron `undefined`.

## Comandos
- Focal: `node --test tests/deployment_contract.test.mjs` → todos PASS.
- Completo: `npm run check` → 137 tests PASS, 0 FAIL y sintaxis limpia.
- Diff: `git diff --check` → sin salida, exit 0.

## Alcance
Dentro: `.github/workflows/pages.yml`, `tests/deployment_contract.test.mjs`.
Fuera: APIs, Supabase, secretos, frontend y lógica UEM.

## Pasos
1. Añade primero una prueba que extraiga todos los `src` locales de `index.html` y afirme que cada archivo aparece en el bloque de preparación de `_site` del workflow. Verifica RED: debe fallar por `web-uem.js`/`web-fleet.js`.
2. Añade esos dos archivos a la allowlist `cp` de Pages. No copies directorios ni uses `cp -r`; conserva la allowlist explícita.
3. Ejecuta el test focal y después `npm run check`.
4. Ejecuta `git diff --check` y confirma que solo cambiaron los dos archivos permitidos.

## Tests
Modela el nuevo test junto a `Pages executes the full gate...` en `tests/deployment_contract.test.mjs`. Debe cubrir todos los `<script src="./archivo.js">` locales de `index.html`, no solo los dos módulos hoy ausentes, para impedir futuras omisiones.

## Criterios de terminado
- [ ] RED capturado antes de editar el workflow.
- [ ] El test focal pasa.
- [ ] `npm run check` pasa con 0 fallos.
- [ ] Cada script local de `index.html` está en el artefacto Pages.
- [ ] Ningún archivo fuera del alcance cambia.

## STOP
Detente si `index.html` deja de ser la entrada Pages, si el workflow ya no usa una allowlist explícita o si el arreglo exige tocar lógica de producto.

## Mantenimiento
Cada nuevo script de la entrada pública debe quedar cubierto automáticamente por este contrato. Mantener una allowlist explícita evita publicar APIs, tests o configuración privada.
