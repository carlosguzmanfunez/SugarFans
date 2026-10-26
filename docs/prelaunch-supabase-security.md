# Preparación de lanzamiento: seguridad de Supabase

## Alcance activo (26 oct 2026)
1. Autorización por roles / RLS y privacidad financiera.
2. Seguridad y pruebas de reservas, videollamadas y datos.
3. Pruebas sandbox sin pagos reales, observabilidad y recuperación de errores.
4. Lanzamiento piloto solo después de aceptar la matriz de calidad y las condiciones de PayPal.

**Pospuesto y eliminado del plan de desarrollo activo:** rediseño visual V3. No implica cerrar ni borrar sus referencias históricas.

**Dependencia externa**: aprobación comercial PayPal; no activar LIVE, pagos reales ni payouts hasta recibirla y validar el contrato/proveedor.

## Cambios de permisos probados en QA
Proyecto QA: `fansreserve-qa-payouts`; migración `20261026223245_prelaunch_financial_privacy_and_rls`.
- `public.top_fans(text)` contiene nombres y cantidades pagadas mediante regalos. El permiso EXECUTE anónimo ahora está revocado también de PUBLIC. El filtrado de filas solo permite ver registros al creador propietario o al administrador. Los invitados no pueden ejecutar la RPC.
- Las políticas SELECT de `paypal_orders` y `paypal_subscriptions` siguen siendo de propiedad `user_id = auth.uid()`, ahora con `(select auth.uid())` para evitar reevaluaciones por fila.
- **No se cambiaron comisiones, capturas PayPal, payouts, webhooks ni datos financieros de producción.**

## Endurecimiento de denuncias y soporte público (QA)
- Migración `20261026224849_prelaunch_report_submission_guard` aplicada **solo a QA**.
- Conserva `submit_report` accesible a invitados; valida longitudes y formato del correo en servidor (descripción 10–4000, motivo hasta 200, email hasta 254 caracteres).
- La RPC limita envíos repetidos por identidad: hasta 5 reportes por hora para un correo de invitado y hasta 10 por hora para una cuenta autenticada, con bloqueo transaccional por clave de remitente.
- `src/lib/platformRules.ts`, los controles `Help.tsx` y `ReportDialog.tsx` reflejan los nuevos límites sin modificar el diseño.
- Pruebas SQL con `BEGIN…ROLLBACK`: invitado puede reportar, el sexto reporte se rechaza, usuario autenticado puede enviar diez y el undécimo se rechaza, texto mayor de 4000 se rechaza. Sin efectos persistentes.
- **Limitación conocida**: esto no equivale a limitación por IP. Un atacante con múltiples correos puede intentar evadir el tope; para cierre de producción falta protección por IP/CDN o verificación antispam compatible con reportes legítimos.

## Evidencia (comprobada en QA)
- Supabase Advisors: advertencias de funciones privilegiadas ejecutables anónimamente: **28 → 27**; advertencias `auth_rls_initplan` en las dos tablas de PayPal: **2 → 0**.
- Probar una transacción de regalo con datos ficticios dentro de `BEGIN...ROLLBACK` dio:
  - Anónimo: ejecución RPC denegada.
  - Fan no relacionado: cero resultados.
  - Propietario: importe de su creador visible.
  - La transacción de prueba se revirtió.
- En producción, **sin cambios de esquema ni datos**, pruebas de roles solo de lectura confirmaron que anon y fans ajenos no ven reservas/payouts y que una identidad sin privilegios no supera el control administrativo financiero.

## Aceptación reproducible
- Con PostgreSQL local de pruebas configurado: `npm run test:supabase-permissions`. El script crea una base descartable, aplica migraciones, crea cuentas ficticias, verifica RLS, donantes y límites de reportes, y la elimina después. Pendiente ejecutarlo en CI local.
- `npm run test:db` para flujos de acceso y reservas existentes.
- `npm run typecheck`, `npm run build` y pruebas CI aplicables.
- Una vez publicada la migración, repetir Supabase Advisors y pruebas de acceso con tokens reales de prueba desde el cliente, con cuentas independientes de fan/creador/admin.

## Pendientes de seguridad
- Los 27 avisos anónimos restantes incluyen funciones de catálogo, disponibilidad y contenidos. **No revocar masivamente**: algunas son necesarias para explorar sin iniciar sesión; revisar cada firma, exposición de datos y propósito.
- Las 115+ advertencias de `SECURITY DEFINER` invocables por usuarios autenticados requieren triaje, especialmente RPCs administrativas. Contar con EXECUTE no implica por sí solo una falla si hacen autorización interna.
- Denuncias públicas: topes básicos por remitente probados en QA; falta rate limit a nivel IP/CDN. Revisar abuso y autenticidad de fuentes en la RPC pública de registro de errores.
- Activar protección contra contraseñas filtradas en Auth (operación en configuración separada).
- Resolver 403 al consultar logs de Vercel.
- Alinear QA con todas las migraciones de producción antes de certificar el lanzamiento: la muestra de QA no equivale a validar automáticamente todos los cambios recientes.
- Revisar y aprobar cualquier cambio de permisos en una pull request; no automatizar su despliegue a producción desde esta auditoría.
