# LucidFence SaaS — SPEC de cierre

## Producto
Control plane Multi-UEM de geofencing para organizaciones. Unifica inventario, ubicación, compliance y evidencia desde FleetDM, Applivery, Intune, Jamf o gateway compatible, con conectores de solo lectura administrados desde el dashboard.

## Usuarios
Owner/admin configura conectores; operator sincroniza; auditor/viewer consulta. El comprador puede usar el SaaS central o la distribución BYOI local-first sin cuenta cloud.

## Valor y límites
- SaaS central multi-tenant con Supabase Auth/RLS, cookies HttpOnly y aislamiento por workspace.
- Credenciales UEM verificadas antes de persistir, cifradas server-side y nunca devueltas al navegador.
- La PWA conserva demo/importación/exportación/offline sin backend.
- No ejecuta wipe, lock, factory reset ni comandos destructivos.
- Coste base objetivo: 0 EUR mientras el uso permanezca dentro de cuotas gratuitas. No se promete SLA, capacidad ilimitada ni uso comercial permitido por planes que lo prohíban. Vercel Hobby es solo para uso personal/no comercial; una explotación comercial requiere un plan/licencia de hosting compatible o infraestructura BYOI.

## Definition of Done
1. `npm run check`: sintaxis limpia y 0 tests fallidos.
2. `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades high/critical.
3. GitHub Pages publica todos los módulos cargados por la PWA; 0 recursos 404 y globals de app definidos.
4. El SaaS central responde en producción: runtime 200, auth sin sesión 401, endpoints protegidos 401, cabeceras CSP/no-store presentes.
5. UI de login y PWA local verificadas en navegador con consola sin errores materiales; navegación, objetivos y conectores renderizan.
6. Revisión independiente del snapshot exacto sin hallazgos CRITICAL/IMPORTANT pendientes.
7. `main` remoto contiene el snapshot aprobado; CI, Pages y despliegue Vercel terminan en success.
8. README enlaza la instancia central y documenta honestamente el límite de coste 0.

## Fuera de alcance
SLA empresarial gratuito, proveedores UEM sin credenciales reales del cliente, SMTP/MFA administrado por LucidFence, acciones UEM destructivas y garantía de permanencia de cuotas de terceros.
