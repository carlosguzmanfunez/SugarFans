# Cobros, suscripciones y disputas: avisos y recuperación

Implementación local en `codex/partial-refunds`. Esta entrega depende de las devoluciones parciales de la misma rama. No aplica migraciones remotas, publica, cambia tarifas, habilita dinero ni modifica cron.

## Qué procesa

Avisos firmados `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED/CANCELLED/EXPIRED/SUSPENDED`, `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED` y `PAYMENT.CAPTURE.REVERSED` / `PAYMENT.SALE.REVERSED`. Los avisos de devolución usan el registro de la entrega anterior y ahora también se recuperan desde el panel. Los avisos de Payouts conservan su circuito existente.

1. La API comprueba la firma con PayPal y conserva el contenido original, entorno, aplicación e ID del aviso.
2. Consulta el recurso actual por una ruta fija construida con su ID validado. No visita URLs proporcionadas por el aviso.
3. Guarda la consulta y concilia su resultado con el pedido, suscripción o venta local. La prueba y los cambios financieros se confirman en la misma transacción. Si falla la escritura, otro intento conserva la consulta fallida sin confirmar importes.
4. Si no puede terminar, conserva el aviso pendiente. Una diferencia de identidad, importe, moneda o versión abre revisión, sin inventar una entrega ni liberar una retención.

Un ID repetido no duplica ganancias ni débitos. Si cambia el contenido de ese ID, se conserva el original y se abre revisión. Los intentos y comprobantes son inmutables. Las tablas privadas tienen RLS y no conceden lectura ni escritura directa a `anon`, `authenticated` o `service_role`; los RPC del servidor tienen privilegios específicos. El listado administrativo exige `assert_admin()`.

## Orden, interrupciones y accesos

Cada consulta obtiene un turno de dos minutos y una secuencia. Una respuesta cuyo turno venció no puede confirmar cambios. Una consulta antigua no puede sobrescribir otra posterior; para suscripciones y disputas también se comprueba la fecha nativa de actualización. Dos estados contradictorios con la misma fecha requieren revisión. Las renovaciones comparten esta comprobación con los avisos de estado de la suscripción.

Un cobro confirmado puede recuperar el registro que perdió la respuesta del navegador, sin capturar ni cobrar otra vez. Se comprueban su pedido, importe, moneda y captura nativa. La recuperación conserva los controles existentes contra pagos propios, perfiles de demostración y creadores suspendidos.

El antiguo RPC público `paypal_money_back` queda retirado, incluso para `service_role`. Su cuerpo se conserva en un procedimiento privado utilizado únicamente después de conciliar evidencia. No restaurar el antiguo manejador como vía de recuperación.

## Disputas y devoluciones parciales

Una resolución a favor del comprador **no significa devolver toda la venta**. La conciliación espera los comprobantes individuales de la devolución y conserva el importe original. Si faltó un aviso, puede localizar esos comprobantes mediante el historial autenticado del pedido o pago, consultar cada devolución y verificar su cobro padre. Se identifica esa evidencia como `provider-query`, no como una notificación firmada.

La devolución se descuenta una sola vez por su ID nativo. La disputa conserva los fondos discutidos hasta completar su evidencia. Una resolución favorable al vendedor no libera otra disputa todavía abierta de esa venta. Un resultado ausente o desconocido no se interpreta como favorable al vendedor. Un reembolso parcial ordinario preserva el acceso pagado; el total también exige confirmar la cancelación de la suscripción correspondiente.

Los avisos de riesgo retienen solo a los creadores identificados como expuestos. Una devolución pendiente de Créditos bloquea gasto nuevo en regalos de esa billetera mientras se concilia. Las retenciones requieren el procedimiento documentado de causa, cobertura y liberación; el botón de consulta no autoriza su liberación por sí mismo.

## Seguimientos externos inciertos

Un cobro huérfano o rechazado por los controles de dominio conserva una intención estable de cancelación/devolución. Solo su procesamiento procedente de un aviso firmado puede marcar el primer envío monetario como intentado y hacer ese POST. Ese estado queda guardado antes de llamar a PayPal. Una respuesta perdida no permite repetir automáticamente la devolución; se consulta el mismo pago y se abre incidencia si no se confirma.

La recuperación administrativa **no inicia cobros, devoluciones ni Payouts**. Puede confirmar sus resultados y terminar la cancelación de una suscripción cuyo reembolso total ya está comprobado para evitar futuros cargos. Cada confirmación de ese seguimiento conserva la respuesta nativa. Esta distinción también aparece en la pantalla.

## Uso del panel y límites

En operaciones de pagos, «Avisos de cobros y disputas» muestra cantidades pendientes y en revisión, fecha de Honduras, motivo y número de comprobaciones. «Comprobar avisos pendientes» utiliza una sesión administrativa y una acción exclusiva del servidor. El navegador no puede cambiar entorno ni habilitar ejecución mediante ese cuerpo.

Cada petición intenta comprobar hasta cinco avisos. **Ese límite corresponde a consultas de recuperación de avisos; no cambia el tamaño ni la frecuencia de los lotes de pagos.** Se reserva espacio para devoluciones que pueden desbloquear disputas pendientes y se rotan los avisos ya consultados para no dejar atrás otros nuevos. Un fallo de proveedor de un seguimiento no detiene los siguientes avisos recuperables. Un fallo general de base de datos puede detener la petición conservando sus referencias.

El procesador tiene presupuesto de tiempo, consultas y tiempos de espera HTTP; por ello puede terminar antes de cinco. Las consultas ordinarias pendientes vuelven a estar disponibles después de treinta segundos; un proceso perdido deja vencer su turno de dos minutos. Después de doce intentos de conciliación ordinaria se abre revisión humana. Los seguimientos de acciones externas mantienen consulta y evidencia sin repetir su envío monetario, hasta confirmar o resolver su incidencia.

La revisión diaria existente detecta avisos atrasados más de cinco minutos, diferencias en revisión y seguimientos inciertos. Las cancelaciones pendientes de suscripciones reembolsadas también siguen visibles. Utiliza la cola de incidencias y avisos existente. **No se añade un cron de recuperación de cobros** ni se certifica aquí otro envío real de correo.

## Validación reproducible

- `npm run test:income-events`: 45 escenarios con SQL real en PGlite y proveedor completamente simulado; incluye orden, duplicados, caída, turnos, importes parciales, acceso, retenciones, rotación y recuperación sin nuevos envíos.
- `node e2e/income-events-admin-api.mjs`: 8 comprobaciones de la API administrativa real y SQL, con transporte simulado; sesiones, permisos, entorno fijo, devoluciones y cancelación pendiente.
- `npm run test:income-events-ui`: 4 comprobaciones de escritorio/móvil con SQL real, teclado, ausencia de desbordamiento y fallo de consulta sin mostrar un falso saldo vacío.
- `node e2e/income-events-postgres.mjs`: todas las migraciones en PostgreSQL local desechable y conexiones independientes; 7 comprobaciones funcionales más los asesores opcionales. Requiere `PGHOST` local, `PGPORT`, `PGUSER` y `psql` en PATH. Crea y elimina únicamente `fr_income_events_test`. `FANSRESERVE_ADVISOR_BIN` permite ejecutar los asesores de Supabase sobre esa base local.
- `node e2e/refunds-db.mjs`: 14 comprobaciones nativas de devoluciones, disputas, Reserve, suscripciones, Créditos, cobertura por expediente y autopago. La batería anterior ahora utiliza avisos y evidencia comprobada; verifica también que el escritor público retirado siga inaccesible al servidor. Crea y elimina únicamente `fr_refunds_test`.
- `npm run test:partial-refunds`, `node e2e/paypal-api.mjs`, `node e2e/payout-review-safety.mjs`, `npm run typecheck` y `npm run build` comprueban compatibilidad y revisión sin ejecutar dinero.

Las pruebas de esta entrega no consultan PayPal ni Supabase remotos ni acreditan devoluciones nativas Sandbox. Los asesores sobre la base local informan cinco advertencias de rendimiento de políticas existentes en tablas públicas y ningún error; no aparecen advertencias sobre los objetos nuevos de avisos. La compilación conserva avisos sobre el tamaño de algunos recursos de la aplicación.

## Publicación y pendientes

Orden de instalación: `20261023191316_partial_refund_accounting.sql`, después `20261023191322_income_event_reconciliation.sql`, después `20261023191333_honduras_payout_cost.sql`, y después servidor y cliente conjuntamente. Las tres actualizaciones de base se aplicaron el 23 de octubre de 2026, después de las pruebas aisladas. Durante la publicación conservar `execution_enabled=false` y `batch_handoff_enabled=false`.

Las excepciones parciales de Créditos, descuentos Reserve, contratos especiales y bases históricas incompletas continúan retenidas para un procedimiento supervisado específico. Tampoco se resuelven automáticamente las evidencias contradictorias que ya están en revisión. El listado muestra el motivo sin exponer el comprobante privado; su inspección detallada sigue requiriendo intervención técnica autorizada. No presentar esta entrega como automatización completa de esos casos.

Sigue después la auditoría de comisión real frente a estimada en los distintos tipos de cobro. No cambiar el reparto contractual para hacer coincidir estimaciones. La autorización comercial escrita de PayPal y la conciliación con extractos reales siguen pendientes.

Referencias: [suscripción nativa](https://developer.paypal.com/api/subscriptions/v1/definitions/subscription/), [consulta de disputa](https://developer.paypal.com/api/customer-disputes/v1/disputes-get), [pago v1](https://developer.paypal.com/api/deprecated/payments/v1/definitions/payment/), [especificaciones oficiales](https://github.com/paypal/paypal-rest-api-specifications).
