# Conciliación durable de eventos de retiros (punto 3)

Un aviso de PayPal puede repetirse, llegar tarde o perder su respuesta. Antes se aplicaba directamente al estado local; un FAILED atrasado podía convertir un retiro pagado en fallido y devolver el saldo.

Ahora el servidor verifica la firma y guarda el evento de Payouts con identidad única por entorno, aplicación emisora e ID de evento. Después crea una consulta durable, obtiene los detalles actuales del lote desde la API del entorno configurado y comprueba lote, referencia del retiro, ítem, destinatario, tipo de destinatario, importe y moneda contra el snapshot original. Ningún enlace del aviso se utiliza como URL de consulta.

La respuesta completa de la consulta, el estado anterior, el resultado y el estado posterior se confirman en la misma transacción. Un error revierte la transición y deja el aviso pendiente. Una consulta iniciada más tarde impide que otra anterior sobrescriba el resultado al terminar tarde. No se mantiene una transacción abierta durante HTTP.

## Comportamiento

- Duplicado idéntico ya conciliado: se confirma sin otro débito ni consulta. Mismo ID con contenido diferente: se conserva el original y se registra revisión.
- Provider inaccesible o detalles aún ausentes: conserva fondos apartados, evento pendiente y respuesta HTTP 503 para solicitar reintento de PayPal.
- Abrir Ingresos reintenta eventos pendientes del propietario, incluso si el retiro local ya figura pagado. No ejecuta nuevos pagos para esos eventos.
- SUCCESS confirma el pago. FAILED solo libera un retiro que aún no estaba pagado; en caso contrario conserva el descuento y congela nuevos retiros para revisión. RETURNED, REFUNDED o REVERSED actuales y conciliados permiten devolver saldo.
- Si una consulta actual confirma SUCCESS después de un failed local, se corrige el retiro original y se congela la cuenta. Si el saldo liberado ya se retiró otra vez, se conserva el saldo negativo; no se oculta la deuda ni se envía otro pago. Una situación pendiente posterior a failed vuelve a apartar el retiro y exige revisión.
- Cancelación: registra la consulta antes del POST y confirma la devolución mediante GET. Un POST exitoso o una respuesta perdida por sí solos no liberan fondos. El historial incluye el resultado del POST y la consulta posterior.
- Incoherencias: registro privado de revisión y aviso en la pestaña administrativa Errores mediante `log_app_error`. Este cambio no añade notificaciones por correo.
- Históricos sin snapshot original: revisión manual, también cuando conservan un lote conocido. No se reconstruye destinatario ni entorno usando la cuenta actual.

Los estados `review` requieren evaluación humana; no se reenvían ni se liberan automáticamente. Las consultas completadas no se reescriben al repetir la misma solicitud. La bandeja y las consultas no admiten acceso directo de anon, authenticated ni service_role; solo cuatro RPC del servidor permiten las operaciones acotadas. El RPC `paypal_payout_mark` queda retirado, sin permisos y con rechazo explícito incluso si se concediera EXECUTE por error.

## Publicación

Aplicar `20261020015716_payout_event_reconciliation.sql` después de las migraciones de los puntos 1 y 2, antes de publicar este servidor. Durante ese breve intervalo el servidor anterior falla al intentar usar el escritor retirado y conserva las reservas; PayPal podrá reintentar los avisos. No habilitar un ejecutor automático con este cambio.

No revertir a `paypal_payout_mark` ni al manejo antiguo que convertía errores de envío incierto en fallidos. Un rollback de aplicación debe conservar el cierre de esos caminos y detener la ejecución de retiros si no puede utilizar la conciliación nueva. No borrar las tablas de evidencia ni los snapshots como rollback.

Comprobaciones del operador con permisos de administración, sin exponer cuerpos o destinatarios al navegador:

```sql
select state, reason, count(*) from public.paypal_payout_events group by state, reason;
select outcome, reason, count(*) from public.paypal_payout_reconciliations group by outcome, reason;
select id, payout_id, received_at, reason from public.paypal_payout_events
where state in ('pending','review') order by received_at;
```

## Validación y límites

`node e2e/payout-recovery.mjs` carga las migraciones reales y la API real en PGlite, con toda la red sustituida por simulaciones que rechazan destinos inesperados. Incluye las 40 comprobaciones de recuperación y 25 adicionales de eventos, devoluciones, cancelación, errores de escritura, contradicciones y permisos. La suite de contratos de API sigue verificando cobros, suscripciones y retiros; también se mantienen las pruebas de calendario y cierre del fallback.

Las consultas superpuestas se simulan intercalando operaciones reales de SQL; PGlite utiliza una conexión. Faltan conexiones independientes de PostgreSQL y eventos de cuentas PayPal Sandbox reales (punto 5). Las firmas de webhook se simulan: esto no certifica la integración criptográfica ni la configuración de producción.

El alcance nuevo son eventos de Payouts, consultas y cancelaciones de retiros. Las disputas, reembolsos de cobros y suscripciones conservan su tratamiento previo; aún necesitan su propia bandeja y conciliación. Este registro de evidencias no sustituye el ledger de doble entrada ni las reservas/asignaciones por lote del punto 4. Tampoco convierte la apertura de Ingresos en un conciliador periódico en segundo plano.

Referencias: [eventos de Payouts](https://developer.paypal.com/payouts/webhooks/), [detalles de un ítem](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-item-get), [cancelación de un ítem no reclamado](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-item-cancel), [permisos de funciones de Supabase](https://supabase.com/docs/guides/database/functions).
# Mensajes de retiro

Los snapshots nuevos, tanto manuales como preparados por lote, usan un asunto neutral: «Tu retiro de Fans Reserve». El correo remite al panel y a PayPal para consultar el estado; no afirma que el dinero ya se entregó. PayPal controla el envío de ese correo: esta corrección no crea un nuevo proceso de emails ni modifica las alertas del ejecutor.

El panel anuncia entrega únicamente para el estado local `paid`, confirmado por la conciliación del ítem. `sending`, los envíos inciertos y una respuesta sin estado explícito conservan un mensaje de confirmación pendiente. `UNCLAIMED` permite solicitar cancelación, pero el saldo solo se libera después de confirmar la devolución. Los controles se sitúan debajo de la explicación en pantallas pequeñas.

La migración `20261020231703_payout_notification_wording.sql` cambia únicamente los textos de las dos funciones que crean snapshots. No reescribe solicitudes anteriores: sus reintentos deben conservar payload y referencia originales. No modifica permisos, importes, reservas, estados ni el interruptor de lotes automáticos.

Validación local: `npm run test:payout-notifications`, `TEST_FINANCE_LEDGER=1 node e2e/payout-recovery.mjs`, `npm run test:finance-ledger`, `npm run typecheck` y `npm run build`. Para revisar el componente real con fixtures sin red externa: `node e2e/payout-notifications-preview.mjs` y abrir la URL impresa. Admite `state=PENDING|UNCLAIMED|ONHOLD|SUBMISSION_UNCERTAIN|PAID|RETURNED` y `state=REQUEST&result=sending|paid|unknown`. No conecta a Supabase ni a PayPal; detener con Ctrl+C.
