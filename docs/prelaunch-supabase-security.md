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

## Aislamiento de liquidación de beneficios de regalos (QA)
- **Hallazgo de seguridad:** `public.settle_overdue_perks()` con `SECURITY DEFINER` era ejecutable por cualquier cuenta autenticada y actualizaba transacciones `status='refunded'` de **todos** los creadores cuyos beneficios estuvieran vencidos. No había un filtro por actor.
- **Migración probada solo en QA:** `20261026231108_prelaunch_scope_overdue_perk_settlement`. Una cuenta fan procesa exclusivamente regalos donde `perk_requests.fan_id = auth.uid()`; una cuenta creadora también procesa los de su `my_creator_profile_id()`. Un visitante sin sesión no puede iniciarlo.
- `src/lib/backend/supabaseGifts.ts` llama esta RPC cuando el fan consulta su billetera o las solicitudes de beneficio. Conservar la RPC para usuarios autenticados evita romper esos accesos. `schedule_perk_call` y `deliver_perk_video` también la llaman internamente.
- **Evidencia:** prueba de aislamiento con dos creadores, dos fans y dos transacciones de regalo ficticias dentro de `BEGIN…ROLLBACK`. El fan A cambió solo su transacción; la del fan B y su beneficio permanecieron intactos. El creador B pudo procesar después su beneficio.
- **Actualización posterior:** la migración `20261027001505_prelaunch_gift_expiry_no_automatic_refunds` elimina totalmente las devoluciones automáticas por caducidad. Se conserva en este documento el antecedente del riesgo y la prueba de aislamiento anterior como evidencia histórica, no como comportamiento final.
- **Límite operativo:** el nuevo comportamiento no anula ni cierra automáticamente beneficios antiguos. Definir tratamiento supervisado de obligaciones vencidas, sin simular reembolsos.

## Política comercial confirmada: Créditos y regalos sin devolución voluntaria
- **Decisión del propietario:** la compra de Créditos virtuales se acredita al fan y no se devuelve por simple cambio de opinión, ni porque el fan decida conservarlos en vez de enviarlos. El saldo permanece disponible mientras subsistan los derechos y condiciones aplicables.
- El envío voluntario de un regalo consume Créditos y mantiene el registro económico de pago al creador correspondiente. El regalo no garantiza Reserve, videollamadas ni prestaciones nuevas.
- **Corrección QA `20261027001505_prelaunch_gift_expiry_no_automatic_refunds`:** la RPC `settle_overdue_perks()` deja de cambiar `public.transactions.status` a `refunded` y de marcar beneficios antiguos como devueltos solo por vencimiento. Mantiene la firma por compatibilidad, pero no realiza actualizaciones. Los beneficios antiguos permanecen pendientes de un procedimiento de soporte supervisado y de las condiciones originalmente prometidas.
- Armonizar `src/lib/backend/localGifts.ts` para no reintegrar Créditos ni revertir el libro de regalos por vencimientos de beneficios; la implementación Supabase queda controlada por migración. `e2e/supabase-permissions.mjs` ahora exige que las monedas gastadas no reaparezcan.
- **Prueba SQL de QA:** 2000 Créditos de compra ficticia, 500 gastados en regalo, saldo 1500. Ante vencimiento, saldo 1500, transacción `paid` y beneficio histórico `pending`. Todo `BEGIN…ROLLBACK`.
- **Excepciones importantes:** fraude, duplicidad/cobro indebido, devoluciones legalmente exigibles, disputas y contracargos reales de PayPal siguen existiendo y se concilian por un proceso separado. No eliminar `paypal_refund_apply` ni los estados de reembolso auténtico.
- **Contabilidad a revisar:** saldo de Créditos prepagados no equivale automáticamente a beneficio realizado. La plataforma cobra el paquete, pero mantiene una obligación por monedas sin usar y una posible obligación con creadores cuando se gasten; tratamiento fiscal/contable requiere revisión profesional antes del lanzamiento.
- **Cobros reales:** política comercial sin devolución voluntaria no elimina los derechos irrenunciables del consumidor ni las facultades de PayPal/issuer para revertir transacciones según sus términos.
- **Atención:** la migración de esta sección sustituye en orden a `20261026231108_prelaunch_scope_overdue_perk_settlement`; esta última queda superada en su parte de caducidad. No aplicar la migración nueva fuera de orden.

## Certificación contable básica de Créditos y regalos (QA, sin PayPal LIVE)
- **Compra y regalo normal:** prueba SQL directamente en QA, con usuario sintético y `BEGIN…ROLLBACK`: compra de 2000 Créditos por USD 19.99; regalo de 500 Créditos (USD 5); quedan 1500 Créditos. `public.finance_sources` incrementó **USD 3** para el creador (60%) y el regalo no generó beneficios nuevos.
- **Reversión excepcional interna:** una segunda prueba SQL llamó al procedimiento financiero `finance_private.income_money_back` con referencia ficticia; la compra pasó a `refunded`, se revirtieron los regalos pagados con esos Créditos, el saldo se concilió a 0 y la variación en el libro del creador volvió a 0. Repetir la rutina no generó un segundo ajuste. **Se revirtió todo con ROLLBACK.**
- **Limitaciones de alcance:** esta simulación invocó una rutina interna y no certifica la validación de firma, la prueba del proveedor ni todas las restricciones diferidas que pueden ejecutarse al hacer COMMIT. Un intento posterior de forzar la validación inmediata de restricciones en QA fue bloqueado por controles de la herramienta; **no puede declararse una prueba de reembolso completo aprobada**.
- La interfaz no debe ofrecer reembolsos voluntarios por no usar Créditos; pero el módulo de disputa/contracargo de PayPal debe permanecer operativo para excepciones reales.
- Nueva prueba automatizada propuesta: `npm run test:credits-ledger`. Usa un PostgreSQL local desechable con migraciones y escenarios sintéticos. **Aún no ejecutada:** este entorno no tiene `psql`, por tanto su resultado está pendiente; el chequeo de Vercel no es sustituto de la suite.
- **Antes del lanzamiento:** verificar las reglas de reconocimientos contables de Créditos prepagados, los saldos de los creadores ante contracargos, los registros del libro financiero y la repetición del mismo webhook. Para aceptar una devolución excepcional como conciliada se necesita evidencia del proveedor y ejecución completa de la transacción con validaciones diferidas.

## Evidencia (comprobada en QA)
- Supabase Advisors: advertencias de funciones privilegiadas ejecutables anónimamente: **28 → 27**; advertencias `auth_rls_initplan` en las dos tablas de PayPal: **2 → 0**.
- Probar una transacción de regalo con datos ficticios dentro de `BEGIN...ROLLBACK` dio:
  - Anónimo: ejecución RPC denegada.
  - Fan no relacionado: cero resultados.
  - Propietario: importe de su creador visible.
  - La transacción de prueba se revirtió.
- En producción, **sin cambios de esquema ni datos**, pruebas de roles solo de lectura confirmaron que anon y fans ajenos no ven reservas/payouts y que una identidad sin privilegios no supera el control administrativo financiero.

## Aceptación reproducible
- Con PostgreSQL local de pruebas configurado: `npm run test:supabase-permissions`. El script crea una base descartable, aplica migraciones, crea cuentas ficticias, verifica RLS, donantes, límites de reportes y aislamiento de vencimientos de beneficios, y la elimina después. Pendiente ejecutarlo en CI local.
- `npm run test:db` para flujos de acceso y reservas existentes.
- `npm run test:errors-email-db` para fuentes confiables del servidor, navegador anónimo y fan autenticado (PostgreSQL local desechable).
- `npm run typecheck`, `npm run build` y pruebas CI aplicables.
- Una vez publicada la migración, repetir Supabase Advisors y pruebas de acceso con tokens reales de prueba desde el cliente, con cuentas independientes de fan/creador/admin.

## Pendientes de seguridad
- Los 27 avisos anónimos restantes incluyen funciones de catálogo, disponibilidad y contenidos. **No revocar masivamente**: algunas son necesarias para explorar sin iniciar sesión; revisar cada firma, exposición de datos y propósito.
- Las 115+ advertencias de `SECURITY DEFINER` invocables por usuarios autenticados requieren triaje, especialmente RPCs administrativas. Contar con EXECUTE no implica por sí solo una falla si hacen autorización interna.
- Denuncias públicas: topes básicos por remitente probados en QA; falta rate limit a nivel IP/CDN. Revisar abuso y autenticidad de fuentes en la RPC pública de registro de errores.
- **Registro de incidentes QA corregido:** migración `20261026225614_prelaunch_log_source_integrity`. Antes, una llamada anónima podía escribir una fila con `source='api'`. Ahora toda llamada de visitante o fan se clasifica `web`, y `api/email` requiere el claim PostgREST `service_role`. Probamos ambas identidades y el servicio en una transacción `BEGIN...ROLLBACK`. Se limita además el contador de errores repetidos a 100000, evitando su desbordamiento.
- **Pendiente de aceptación antes de producción:** comprobar con un acceso de servicio real por `sb_secret_` y por el formato JWT heredado usado por el servidor que la clasificación legítima de errores `api/email` se conserva. Las pruebas SQL con claims simulados no acreditan por sí solas ese funcionamiento; si falla, bloquear despliegue y adaptar el manejo de fuentes. Mantener los reportes anónimos de errores web.
- Activar protección contra contraseñas filtradas en Auth (operación en configuración separada).
- Resolver 403 al consultar logs de Vercel.
- Alinear QA con todas las migraciones de producción antes de certificar el lanzamiento: la muestra de QA no equivale a validar automáticamente todos los cambios recientes.
- Revisar y aprobar cualquier cambio de permisos en una pull request; no automatizar su despliegue a producción desde esta auditoría.


## Cierre técnico de QA (26 oct Honduras / 27 oct UTC)
Las comprobaciones que este documento dejaba pendientes se ejecutaron después. **305/305 comprobaciones en 18 suites aprobadas**, junto con typecheck y build; véase [certificación detallada](qa-certification-pr113.md). Se alinearon horarios y protección de referencias archivadas solo en QA. El acceso real detectó y permitió corregir la clasificación de errores con ambas claves de servicio mediante `20261027015737_prelaunch_verified_log_source.sql`. Se confirmó además en QA una compra, regalo y dos devoluciones ficticias con decisiones simultáneas, sin saldos duplicados. Producción y PayPal no se modificaron; la PR permanece sin fusionar y el lanzamiento comercial continúa NO-GO.
