# Plan 002: Publicar y verificar el snapshot SaaS final

> Drift check: `git diff --stat fb49e57..HEAD -- README.md SPEC.md .github/workflows plans`

## Estado
- Prioridad: P1
- Esfuerzo: S
- Riesgo: MED (publicación)
- Depende de: 001
- Categoría: deploy/docs
- Planificado en: `fb49e57`, 2026-07-27

## Por qué importa
El repositorio local está 10 commits por delante de `origin/main`, por lo que producción no contiene las correcciones recientes de auth, RLS, geofencing y rate-limit. El README tampoco ofrece la URL de la instancia central como entrada directa. El objetivo de 0 EUR solo es honesto dentro de cuotas gratuitas y, para Vercel Hobby, uso personal/no comercial.

## Alcance
Dentro: `README.md`, `SPEC.md`, publicación de `main` tras gates.
Fuera: crear planes de pago, introducir secretos, cambiar proveedor cloud o crear usuarios de prueba persistentes.

## Pasos
1. Añadir al README `https://lucidfence-web.vercel.app/` como SaaS central y una nota breve de coste 0 honesta.
2. Ejecutar `npm run check`, `npm audit --omit=dev --audit-level=high`, secret scan y `git diff --check`.
3. Obtener revisión independiente del HEAD exacto; corregir y repetir si hay hallazgos importantes.
4. Hacer commit atómico de docs/plan 001, confirmar working tree limpio y hacer `git push origin main`.
5. Esperar CI, Pages y Vercel. Verificar SHA desplegado y URLs vivas: Pages sin 404 de módulos; SaaS runtime 200; auth protegida 401; consola vacía.

## Criterios
- [ ] README enlaza central SaaS y no promete gratis comercial ilimitado.
- [ ] Gates locales PASS.
- [ ] Revisión exacta PASS.
- [ ] CI/Pages/Vercel success sobre el mismo SHA.
- [ ] Navegador vivo PASS.

## STOP
Detener si aparecen secretos, un gate falla, Vercel no despliega el SHA o el hosting exige pago para el uso pretendido. No disfrazar un piloto gratuito como SLA comercial gratuito.
